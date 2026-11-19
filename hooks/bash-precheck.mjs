#!/usr/bin/env node
// Bash 预检（只装 Claude Code，#49）：命令里出现会被 Claude Code 内置「危险 rm」安全检查拦下的写法时，当场拒绝并说明怎么改写。
//
// 为什么要有：这个检查在 bypass 模式下也要求人工批准。本机的批准请求会被驿窗的 PermissionRequest 钩子接走，
// Claude 窗口里不弹；没人点的话，约 16 分钟后桌面版判会话「Claude Code stopped responding」（2026-11-09 一天 6 次）。
// 提前拒绝，Claude 当场改写重试，会话不会卡住。
//
// 只会更早拒绝，从不替安全检查放行；拿不准的写法一律不管，交给 Claude Code 自己判断。
// 规则来自近 14 天 66280 条真实 Bash 记录里被拦或卡死的 41 条，分两类：
//   rm   ：rm/rmdir 的目标 Claude Code 解析不出来（变量加通配符、整目录通配、可能为空的变量）
//   parse：命令里有 Claude Code 解析不了的写法（`$$(`、`\\$(`）
// 另有两类不是为了防卡住（2026-11-19）：
//   kill ：宽泛的 `pkill -f`（模式里没有路径、端口号、文件名，如 'pnpm test'、'cargo test'），会杀掉别的会话正在跑的同名进程（全局坑 G-32）
//   env  ：读别的进程的环境变量（`ps eww`、`ps -E`、`/proc/<pid>/environ`），会把登录令牌明文打进会话记录（全局坑 G-42）
// 命中记一行到状态目录的 bash-precheck-hits.jsonl（时间、会话、目录、类别，不记命令内容）。
import fs from 'node:fs';
import path from 'node:path';
import { isEntry, parseJson, readStdin, stateDir, stripWrappers, tokenize } from './lib/common.mjs';

const HEREDOC = /<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;

// 去掉 heredoc 的正文（正文是给 python、cat 的输入，不是命令），只留命令本身用来找 rm。
export function stripHeredocBodies(command) {
  const lines = command.split('\n');
  const out = [];
  let ends = [];
  for (const line of lines) {
    if (ends.length) {
      if (line.replace(/^\t+/, '') === ends[0]) ends.shift();
      continue;
    }
    out.push(line);
    for (const m of line.matchAll(HEREDOC)) ends.push(m[2]);
  }
  return out.join('\n');
}

// 按 shell 分隔符切成几段命令。和 common.mjs 的 splitCommands 不同：引号里的分隔符不切，
// 否则 python -c "a; b" 里的内容会被当成命令。
export function segments(command) {
  const segs = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"') cur += command[++i] ?? '';
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\') {
      cur += ch + (command[++i] ?? '');
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    // $( … )、${ … }、` … ` 整段算在当前这个词里，不在里面切
    if ((ch === '$' && (command[i + 1] === '(' || command[i + 1] === '{')) || ch === '`') {
      const end = closeOf(command, ch === '`' ? i : i + 1);
      cur += command.slice(i, end + 1);
      i = end;
      continue;
    }
    // 2>&1、&> 这类重定向里的 & 不是分隔符
    if (ch === '&' && (command[i - 1] === '>' || command[i + 1] === '>')) {
      cur += ch;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '|' || ch === '&' || ch === '(' || ch === ')' || ch === '{' || ch === '}') {
      segs.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  segs.push(cur);
  return segs.map(s => s.trim()).filter(Boolean);
}

// 从 open（指向 ( { 或 `）找到配对的收尾位置；找不到就到末尾。
function closeOf(s, open) {
  const o = s[open];
  if (o === '`') {
    const j = s.indexOf('`', open + 1);
    return j === -1 ? s.length - 1 : j;
  }
  const c = o === '(' ? ')' : '}';
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (s[j] === o) depth++;
    else if (s[j] === c && --depth === 0) return j;
  }
  return s.length - 1;
}

// 一条命令里在 rm 之前赋过值的变量名（X=… 开头的段，或 export X=…）。
function assignedBefore(segs, index) {
  const names = new Set();
  for (const seg of segs.slice(0, index)) {
    let t = tokenize(seg);
    while (t.length && ['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!'].includes(t[0])) t = t.slice(1);
    if (['export', 'local', 'readonly', 'declare', 'typeset'].includes(t[0])) t = t.slice(1);
    // for X in …：循环变量；read [-r] X Y：读进来的变量
    if (t[0] === 'for' && t[1]) names.add(t[1]);
    if (t[0] === 'read') for (const w of t.slice(1)) if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(w)) names.add(w);
    for (const w of t) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(w);
      if (m) names.add(m[1]);
      else break;
    }
  }
  return names;
}

// 目标里引用的变量：[{ name, guarded }]，guarded 指写成 ${X:?…}（变量为空时 shell 直接报错）。
function varRefs(target) {
  const refs = [];
  for (const m of target.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(:\?[^}]*)?[^}]*\}|\$([A-Za-z_][A-Za-z0-9_]*)/g))
    refs.push({ name: m[1] || m[3], guarded: Boolean(m[2]) });
  return refs;
}

function rmTargets(tokens) {
  const words = stripWrappers(tokens);
  if (!words.length || !/^(rm|rmdir)$/.test(path.basename(words[0]))) return null;
  const targets = [];
  let opts = true;
  for (const w of words.slice(1)) {
    if (opts && w === '--') {
      opts = false;
      continue;
    }
    if (opts && w.startsWith('-')) continue;
    targets.push(w);
  }
  return targets;
}

// 检查 rm 的每个目标。返回 { kind, target, detail } 或 null。
// env：钩子和 Claude Code 是同一份环境变量；变量在这里有非空值，Claude Code 也不会当它可能为空。
export function checkRm(command, env = process.env) {
  const segs = segments(stripHeredocBodies(command));
  for (let i = 0; i < segs.length; i++) {
    const targets = rmTargets(tokenize(segs[i]));
    if (!targets) continue;
    const assigned = assignedBefore(segs, i);
    for (const target of targets) {
      const refs = varRefs(target);
      const unguarded = refs.filter(r => !r.guarded);
      const glob = /[*?[]/.test(target);
      if (target.includes('$(') || target.includes('`'))
        return { kind: 'rm-substitution', target, detail: '目标里有命令替换，Claude Code 算不出它会删什么' };
      if (target === '*' || /\/\*$/.test(target))
        return { kind: 'rm-whole-dir', target, detail: '目标是「整个目录里的所有东西」' };
      if (glob && unguarded.length)
        return { kind: 'rm-var-glob', target, detail: `目标里既有变量（$${unguarded[0].name}）又有通配符` };
      const maybeEmpty = unguarded.find(r => !assigned.has(r.name) && !env[r.name]);
      if (maybeEmpty)
        return { kind: 'rm-unset-var', target, detail: `变量 $${maybeEmpty.name} 在这条命令里没有赋值，可能为空` };
    }
  }
  return null;
}

// Claude Code 解析不了的写法。返回 { kind, target, detail } 或 null。
export function checkParse(command) {
  const dd = /(^|[^.\w$])\$\$\(/.exec(command);
  if (dd) return { kind: 'parse-dollar-dollar', target: '$$(', detail: '命令里有 `$$(`（多见于 heredoc 里嵌的前端代码）' };
  if (/\\\\\$\(/.test(command)) return { kind: 'parse-escaped-subst', target: '\\\\$(', detail: '命令里有 `\\\\$(`：两个反斜杠后面的 `$(` 会真的开启命令替换' };
  return null;
}

// 宽泛的 pkill -f（含 -9f 这类合写、--full）。返回 { kind, target, detail } 或 null。
// 带参数的选项（-u root、-t ttys001 等）跳过它的值；第一个不以 - 开头的词是匹配模式，之后不再看选项。
// 「宽泛」：模式里没有能把范围收到自己身上的锚点：路径（含 /）、端口号这类 4 位以上数字、带扩展名的文件名
// （wb_server.py、http.server）。近 14 天 95567 条真实 Bash 里 pkill -f 有 320 条，多数是按端口或脚本名精确重启
// 自己的开发服务，全拦误伤太大；L-33、L-37 的 'pnpm test'、'cargo test --workspace' 都没有锚点。
export function isBroadPattern(pattern) {
  const p = pattern.replace(/^['"]|['"]$/g, '');
  if (!p.trim()) return true;
  return !/\//.test(p) && !/\d{4,}/.test(p) && !/\w\.[A-Za-z]/.test(p);
}

const PKILL_ARG_OPTS = new Set(['-c', '-F', '-g', '-G', '-j', '-P', '-s', '-t', '-T', '-u', '-U']);
export function checkKill(command) {
  for (const seg of segments(stripHeredocBodies(command))) {
    const words = stripWrappers(tokenize(seg));
    if (!words.length || path.basename(words[0]) !== 'pkill') continue;
    let full = false;
    let pattern = '';
    for (let i = 1; i < words.length; i++) {
      const w = words[i];
      if (w === '--') {
        pattern = words[i + 1] ?? '';
        break;
      }
      if (w === '--full') full = true;
      else if (PKILL_ARG_OPTS.has(w)) i++;
      else if (/^-[A-Za-z0-9]+$/.test(w)) {
        if (/^-\d+$/.test(w) || /^-[A-Z]+$/.test(w)) continue; // 信号：-9、-KILL
        if (w.slice(1).includes('f')) full = true;
      } else {
        pattern = w;
        break;
      }
    }
    if (full && isBroadPattern(pattern))
      return { kind: 'kill-pkill-broad', target: pattern || seg, detail: '`pkill -f` 按整条命令行匹配本机所有进程、不分是谁开的，这个模式里没有路径、端口号或文件名能把范围收到自己身上' };
  }
  return null;
}

// 命令替换 $( … ) 和 ` … ` 里面的命令（含嵌套），segments 把它们整段算在一个词里，这里单独拿出来看。
function substBodies(command) {
  const out = [];
  for (let i = 0; i < command.length; i++) {
    if (command[i] === '\\') {
      i++;
      continue;
    }
    if ((command[i] === '$' && command[i + 1] === '(') || command[i] === '`') {
      const open = command[i] === '`' ? i : i + 1;
      const end = closeOf(command, open);
      const body = command.slice(open + 1, end);
      out.push(body, ...substBodies(body));
      i = end;
    }
  }
  return out;
}

// 读别的进程的环境变量（全局坑 G-42，2026-11-19）。返回 { kind, target, detail } 或 null。
// ps：带横线的选项里只有大写 E 显示环境变量（macOS 的 -e 是「所有进程」，不拦）；不带横线的 BSD 写法只认第一个参数
// （macOS 的 ps 只在第一个参数认它，后面的不带横线的词会报 illegal argument），里面有 e 或 E 就算（e、eww、auxe）。
// 带参数的选项（-o 格式、-p 进程号等）跳过它的值，值里的字母不算；$( … ) 里的命令另外单独看。
// /proc/<pid>/environ：读它的命令（cat、xargs、重定向）；echo、printf、git、gh 里只是提到的不算。
const PS_ARG = new Set(['G', 'M', 'N', 'O', 'U', 'g', 'o', 'p', 't', 'u']);
const ENVIRON = /^<?\/proc\/[^/\s]+\/environ$/;
const MENTION_ONLY = new Set(['echo', 'printf', 'git', 'gh']);

function psShowsEnv(args) {
  if (/^[A-Za-z]+$/.test(args[0] ?? '') && /[eE]/.test(args[0])) return true;
  for (let i = 0; i < args.length; i++) {
    if (!/^-[A-Za-z]+$/.test(args[i])) continue;
    const letters = args[i].slice(1);
    for (let j = 0; j < letters.length; j++) {
      if (letters[j] === 'E') return true;
      if (PS_ARG.has(letters[j])) {
        if (j === letters.length - 1) i++;
        break;
      }
    }
  }
  return false;
}

// 把 $( … ) 和 ` … ` 整段换成一个占位词，免得里面的 head、sed 被当成 ps 的参数。
function blankSubst(seg) {
  let out = '';
  for (let i = 0; i < seg.length; i++) {
    if ((seg[i] === '$' && seg[i + 1] === '(') || seg[i] === '`') {
      i = closeOf(seg, seg[i] === '`' ? i : i + 1);
      out += '_';
    } else out += seg[i];
  }
  return out;
}

export function checkEnv(command) {
  const stripped = stripHeredocBodies(command);
  for (const seg of [stripped, ...substBodies(stripped)].flatMap(segments)) {
    const words = stripWrappers(tokenize(blankSubst(seg)));
    if (!words.length) continue;
    const name = path.basename(words[0]);
    if (name === 'ps' && psShowsEnv(words.slice(1)))
      return { kind: 'env-ps-environment', target: seg, detail: '`ps` 带了显示环境变量的选项（`-E`，或不带横线的 `e`），会把进程的环境变量连值一起打出来' };
    if (MENTION_ONLY.has(name)) continue;
    const file = words.find(w => ENVIRON.test(w));
    if (file) return { kind: 'env-proc-environ', target: file.replace(/^</, ''), detail: '`/proc/<进程号>/environ` 是那个进程的全部环境变量，连值一起' };
  }
  return null;
}

export function check(command, env = process.env) {
  if (typeof command !== 'string' || !command) return null;
  return checkParse(command) || checkRm(command, env) || checkKill(command) || checkEnv(command);
}

const FIX = {
  'rm-whole-dir': '把通配符收窄到要删的文件类型（例如 `shots/*.png`），或者写明文件名；确实要清空整个目录时，按字面路径删掉这个目录再重建。',
  'rm-var-glob': '变量写成 `"${变量:?}"`，变量为空时 shell 会直接报错、不会去删，例如 `rm -f "${S:?}"/*.png`；或者把变量换成字面路径。',
  'rm-unset-var': '变量写成 `"${变量:?}"`，或者在同一条命令里先给它赋值。',
  'rm-substitution': '先把命令替换的结果存进变量并检查不为空，再用 `"${变量:?}"` 删；或者写明路径。',
  'parse-dollar-dollar': '要嵌的代码先用 Write 工具写成文件（放 scratchpad），再用一条简单命令执行它；不要把代码放在 heredoc 或引号里。',
  'parse-escaped-subst': '把这段文字放进单引号，或者先用 Write 工具写成文件再用；不要在双引号里写 `\\\\$(`。',
  'kill-pkill-broad': '停自己开的后台任务用任务 ID（Claude Code 的 TaskStop，或 shell 里记下的 `$!`）。确实要按进程停：先 `pgrep -fl \'<写到本 worktree 绝对路径的模式>\'` 看清是哪几个 PID（列表里包着这条命令的 shell 自己也会出现，别杀它），再 `kill <PID>`；或者把模式写到能只认出自己的程度（本 worktree 的绝对路径、自己的端口号、脚本文件名）。',
};

const ENV_FIX = [
  '想知道进程是谁：用命令行参数 `ps -o pid,ppid,command -p <PID>`（不带 `E`），或看程序自己的会话记录、日志。',
  '只要变量名：当前 shell 的用 `env | cut -d= -f1`（只出名字）；别的进程的，看它的启动配置（launchd plist、启动脚本）里写了哪些名字。',
  '只想知道某个变量有没有、对不对：`[ -n "${变量:-}" ] && echo 已设置 || echo 未设置`；要比对值就比摘要 `printf %s "$变量" | shasum -a 256 | cut -c1-12`，不打印值。别的进程的，请常浩在自己的终端里查，只回报有没有。',
].join('\n- ');

export function reasonFor(hit) {
  if (hit.kind.startsWith('env-'))
    return [
      `agent-kit 预检已拦下（${hit.kind}）：${hit.detail}：\`${hit.target}\`。`,
      'Claude 桌面版等程序把登录令牌放在子进程的环境变量里，打出来就原样进了会话记录（磁盘瘦身 L-13 第②点：`ps eww` 的输出里有登录令牌明文）。见全局坑 G-42。',
      `怎么改：\n- ${ENV_FIX}`,
      '不要换一种写法去读同样的内容（套进 `bash -c`、用 Python 读进程参数）；这条拦的是「把值打出来」，不是某个命令。',
    ].join('\n');
  if (hit.kind.startsWith('kill-'))
    return [
      `agent-kit 预检已拦下（${hit.kind}）：${hit.detail}：\`${hit.target}\`。`,
      '并行的会话、子 agent 共用这台机器，按命令名广撒会把别人正在跑的同名进程也杀掉（驿窗 #261 中断了 #264、#265 的全量测试）；包着这条命令的 shell 命令行里也有这串字，也可能把自己杀了（驿窗 L-37，未能排除）。见全局坑 G-32。',
      `怎么改：${FIX[hit.kind]}`,
    ].join('\n');
  return [
    `agent-kit 预检已拦下（${hit.kind}）：这条命令会触发 Claude Code 内置的「危险 rm」安全检查。${hit.detail}：\`${hit.target}\`。`,
    '这个检查在 bypass 模式下也要人批准，而本机的批准请求会被驿窗接走、Claude 窗口里不弹，没人点的话会话会卡约 16 分钟后被判「stopped responding」。',
    `怎么改：${FIX[hit.kind]}`,
    '改写后的命令要同样安全、删的范围不变大；这不是绕过检查，是换成 Claude Code 解析得了的写法。',
  ].join('\n');
}

export function hookOutput(hit) {
  if (!hit) return '';
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reasonFor(hit) },
  });
}

function logHit(input, hit) {
  if (process.env.AGENT_KIT_NO_LOG) return;
  const dir = stateDir();
  fs.mkdirSync(dir, { recursive: true });
  const row = { time: new Date().toISOString(), session: input.session_id || null, cwd: input.cwd || null, kind: hit.kind };
  fs.appendFileSync(path.join(dir, 'bash-precheck-hits.jsonl'), `${JSON.stringify(row)}\n`);
}

export function run(input) {
  if (input?.tool_name && input.tool_name !== 'Bash') return '';
  const hit = check(input?.tool_input?.command);
  if (!hit) return '';
  try {
    logHit(input, hit);
  } catch {}
  return hookOutput(hit);
}

if (isEntry(import.meta.url)) {
  try {
    const out = run(parseJson(readStdin()) || {});
    if (out) process.stdout.write(out);
  } catch (err) {
    process.stderr.write(`agent-kit bash-precheck 出错，本次未检查：${err.message}\n`);
    process.exitCode = 1;
  }
}
