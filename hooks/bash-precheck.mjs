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

export function check(command, env = process.env) {
  if (typeof command !== 'string' || !command) return null;
  return checkParse(command) || checkRm(command, env);
}

const FIX = {
  'rm-whole-dir': '把通配符收窄到要删的文件类型（例如 `shots/*.png`），或者写明文件名；确实要清空整个目录时，按字面路径删掉这个目录再重建。',
  'rm-var-glob': '变量写成 `"${变量:?}"`，变量为空时 shell 会直接报错、不会去删，例如 `rm -f "${S:?}"/*.png`；或者把变量换成字面路径。',
  'rm-unset-var': '变量写成 `"${变量:?}"`，或者在同一条命令里先给它赋值。',
  'rm-substitution': '先把命令替换的结果存进变量并检查不为空，再用 `"${变量:?}"` 删；或者写明路径。',
  'parse-dollar-dollar': '要嵌的代码先用 Write 工具写成文件（放 scratchpad），再用一条简单命令执行它；不要把代码放在 heredoc 或引号里。',
  'parse-escaped-subst': '把这段文字放进单引号，或者先用 Write 工具写成文件再用；不要在双引号里写 `\\\\$(`。',
};

export function reasonFor(hit) {
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
