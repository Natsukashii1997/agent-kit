#!/usr/bin/env node
// 第 3 件（含第 5 件的比对）：agent-kit 自检。只查 agent-kit 自己装进本机的东西和它管的约定：
// 权限规则与 hook 装没装、能不能真跑；两份全局指令是否一致；自动记忆状态；坑提醒命中；可选查各仓库本地 main 有没有没推的提交。
// launchd、Hermes 定时任务、crontab 的体检归 my-skills 的 automation-checkup（my-skills#30），这里不重复做。
//   node tools/doctor.mjs              体检，结果打在屏幕上，同时存一份报告
//   node tools/doctor.mjs --json       输出 JSON（给定时任务或别的脚本用）
//   node tools/doctor.mjs --no-save    不存报告
//   node tools/doctor.mjs --config <文件>   指定配置；默认读状态目录里的 doctor.json，没有就只做内置检查
// 报告存在状态目录 doctor/ 下（macOS：~/Library/Application Support/agent-kit/doctor/），
// 第一行写开始时间、最后一行写 exit N（G-12 的写法）。有 ✗ 时退出码为 1。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntry, stateDir } from '../hooks/lib/common.mjs';
import { inspect } from './global-instructions.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARK = { ok: '✓', warn: '⚠', fail: '✗', info: '·' };

function defaultRun(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 20000, input: opts.input, env: { ...process.env, ...(opts.env || {}) } });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || (r.error ? String(r.error.message) : '') };
}

const readText = file => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

const jsonOr = (text, fallback = {}) => {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
};

// ---------- 解析函数（单独导出，测试直接测） ----------

// 从 Markdown 里取标题含 heading 的那一节正文（不含标题行本身，到下一个同级或更高级标题为止）
export function extractSection(text, heading) {
  if (!text) return null;
  const lines = text.split('\n');
  const start = lines.findIndex(l => /^#{1,6}\s/.test(l) && l.includes(heading));
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .map(l => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

// ---------- 各项检查：每项返回 { name, status, detail[] } ----------

function checkHooks({ home, run, env, dir }) {
  const results = [];
  const settings = jsonOr(readText(path.join(home, '.claude', 'settings.json')));
  const cfg = JSON.parse(readText(path.join(KIT, 'config', 'claude-permissions.json')));
  const missing = [...cfg.deny.filter(r => !(settings.permissions?.deny || []).includes(r)), ...cfg.ask.filter(r => !(settings.permissions?.ask || []).includes(r))];
  const hookCmds = (settings.hooks?.PreToolUse || []).flatMap(g => (g.hooks || []).map(h => h.command || ''));
  const hasGuard = hookCmds.some(c => c.includes('hooks/guard-git.mjs'));
  const hasRemind = hookCmds.some(c => c.includes('hooks/lessons-remind.mjs'));
  const hasSkill = (settings.hooks?.PostToolUse || []).some(g => (g.hooks || []).some(h => (h.command || '').includes('hooks/skill-usage.mjs')));
  const promptCmds = (settings.hooks?.UserPromptSubmit || []).flatMap(g => (g.hooks || []).map(h => h.command || ''));
  const hasNudge = hookCmds.some(c => c.includes('hooks/thinking-review-nudge.mjs')) && promptCmds.some(c => c.includes('hooks/thinking-review-nudge.mjs'));
  const hasPrecheck = hookCmds.some(c => c.includes('hooks/bash-precheck.mjs'));
  // 首轮整理（#65）：启动和发消息两处都要指向 runtime 副本，真实配置要在状态目录
  const ORGANIZE = 'hooks/session-organize-once/session_organize_once.py';
  const startCmds = (settings.hooks?.SessionStart || []).flatMap(g => (g.hooks || []).map(h => h.command || ''));
  const runtimeHooks = path.join(dir, 'runtime', 'hooks');
  const organizeOk = cmds => cmds.some(c => c.includes(ORGANIZE) && c.includes(runtimeHooks));
  const hasOrganize = organizeOk(startCmds) && organizeOk(promptCmds);
  const organizeConfig = fs.existsSync(path.join(dir, 'session-organize-once', 'config.json'));
  if (!missing.length && hasGuard && hasRemind && hasSkill && hasNudge && hasPrecheck && hasOrganize && organizeConfig) results.push({ name: 'Claude 权限规则与 hook', status: 'ok', detail: [`${cfg.deny.length} 条拒绝规则${cfg.ask.length ? `、${cfg.ask.length} 条先问规则` : ''}、6 个 hook 都在，首轮整理配置在状态目录`] });
  else
    results.push({
      name: 'Claude 权限规则与 hook',
      status: 'warn',
      detail: [
        ...(missing.length ? [`缺 ${missing.length} 条权限规则，例如 ${missing[0]}`] : []),
        ...(!hasGuard ? ['没装 guard-git'] : []),
        ...(!hasRemind ? ['没装 lessons-remind'] : []),
        ...(!hasSkill ? ['没装 skill-usage（skill 调用日志）'] : []),
        ...(!hasNudge ? ['没装 thinking-review-nudge（思维评审准入提醒，改文件前和发消息时两处都要有）'] : []),
        ...(!hasPrecheck ? ['没装 bash-precheck（Bash 预检，防会话卡在没人点的安全检查批准上）'] : []),
        ...(!hasOrganize ? ['首轮整理钩子没装，或还指向 ~/.claude/hooks 下的旧位置（启动和发消息两处都要指向 runtime 副本）'] : []),
        ...(!organizeConfig ? ['状态目录里没有首轮整理配置 session-organize-once/config.json'] : []),
        '装法：node tools/install.mjs --apply',
      ],
    });

  const codexHome = env.CODEX_HOME || path.join(home, '.codex');
  const codexHooks = jsonOr(readText(path.join(codexHome, 'hooks.json')));
  const codexCmds = (codexHooks.hooks?.PreToolUse || []).flatMap(g => (g.hooks || []).map(h => h.command || ''));
  const rulesNow = readText(path.join(codexHome, 'rules', 'agent-kit.rules'));
  const rulesSrc = readText(path.join(KIT, 'config', 'codex', 'agent-kit.rules'));
  const codexProblems = [
    ...(!codexCmds.some(c => c.includes('hooks/guard-git.mjs')) ? ['没装 guard-git'] : []),
    ...(!codexCmds.some(c => c.includes('hooks/lessons-remind.mjs')) ? ['没装 lessons-remind'] : []),
    ...(rulesNow === null ? ['没装 rules/agent-kit.rules'] : rulesNow !== rulesSrc ? ['rules/agent-kit.rules 和仓库里的版本不一致，重跑安装'] : []),
  ];
  results.push(
    codexProblems.length
      ? { name: 'Codex hook 与执行策略', status: 'warn', detail: [...codexProblems, '装法：node tools/install.mjs --apply'] }
      : { name: 'Codex hook 与执行策略', status: 'ok', detail: ['2 个 hook 和 agent-kit.rules 都在'] },
  );

  // 装的是状态目录 runtime/ 里的副本：仓库里改了 hooks/ 或 LESSONS.md（比如加了新坑的「触发」行），要重装才生效
  const runtime = path.join(dir, 'runtime');
  if (hasGuard || hasRemind) {
    const files = ['LESSONS.md', ...fs.readdirSync(path.join(KIT, 'hooks'), { recursive: true }).filter(f => (f.endsWith('.mjs') || f.endsWith('.py')) && !f.includes('__pycache__')).map(f => path.join('hooks', f))];
    const stale = files.filter(f => readText(path.join(KIT, f)) !== readText(path.join(runtime, f)));
    results.push(
      stale.length
        ? { name: '已装的 hook 与仓库一致', status: 'warn', detail: [`${stale.join('、')} 和仓库里的不一样`, '仓库在 main 上、拉到最新后重跑 node tools/install.mjs --apply；仓库不在 main 上时这条可以忽略'] }
        : { name: '已装的 hook 与仓库一致', status: 'ok', detail: [`${runtime} 和仓库一致`] },
    );
  }

  // 两个 hook 真跑一次（装了但跑不起来，hook 默认放行，平时看不出来）。
  // 装了就原样执行设置里写的那条命令，这样 node 路径失效（比如 Homebrew 升级）也查得出来。
  const installed = file => hookCmds.find(c => c.includes(`hooks/${file}`));
  const runHook = (file, input, extraEnv = {}) => {
    const c = installed(file);
    const opts = { input: JSON.stringify(input), env: extraEnv };
    return c ? run('/bin/sh', ['-c', c], opts) : run(process.execPath, [path.join(KIT, 'hooks', file)], opts);
  };
  const g = runHook('guard-git.mjs', { tool_name: 'Bash', tool_input: { command: 'git push -f origin main' } });
  const r = runHook('lessons-remind.mjs', { session_id: `doctor-${Date.now()}`, tool_name: 'Bash', tool_input: { command: 'launchctl list' } }, { AGENT_KIT_NO_LOG: '1' });
  const p = runHook('bash-precheck.mjs', { tool_name: 'Bash', tool_input: { command: 'cd /x && rm -f "$O"/*.zip' } }, { AGENT_KIT_NO_LOG: '1' });
  const okG = g.code === 0 && g.stdout.includes('"deny"');
  const okR = r.code === 0 && r.stdout.includes('G-05');
  const okP = p.code === 0 && p.stdout.includes('"deny"');
  results.push(
    okG && okR && okP
      ? { name: 'hook 实跑自检', status: 'ok', detail: [`强推 main 被拦下；launchctl 收到 G-05 提醒；rm 变量加通配符被预检拦下（${hasGuard && hasRemind && hasPrecheck ? '按设置里的命令实跑' : '有没装的，用仓库里的脚本试跑'}）`] }
      : {
          name: 'hook 实跑自检',
          status: 'fail',
          detail: [
            ...(!okG ? [`guard-git 没拦下强推 main：${g.stderr || g.stdout || `退出码 ${g.code}`}`] : []),
            ...(!okR ? [`lessons-remind 没提醒：${r.stderr || r.stdout || `退出码 ${r.code}`}`] : []),
            ...(!okP ? [`bash-precheck 没拦下 rm 变量加通配符：${p.stderr || p.stdout || `退出码 ${p.code}`}`] : []),
          ],
        },
  );
  return results;
}

function checkInstructionSync({ home, env, config }) {
  const heading = config.instructionSection || '跨项目沉淀';
  const claudeFile = path.join(home, '.claude', 'CLAUDE.md');
  const codexFile = path.join(env.CODEX_HOME || path.join(home, '.codex'), 'AGENTS.md');
  const a = extractSection(readText(claudeFile), heading);
  const b = extractSection(readText(codexFile), heading);
  const name = `两份全局指令「${heading}」一致`;
  if (a === null || b === null)
    return { name, status: 'warn', detail: [`找不到这一节：${[a === null && claudeFile, b === null && codexFile].filter(Boolean).join('、')}`] };
  if (a === b) return { name, status: 'ok', detail: [`${a.split('\n').length} 行逐字相同`] };
  const la = a.split('\n');
  const lb = b.split('\n');
  const i = la.findIndex((l, k) => l !== lb[k]);
  const at = i < 0 ? Math.min(la.length, lb.length) : i;
  return { name, status: 'fail', detail: [`第 ${at + 1} 行起不同`, `Claude：${la[at] ?? '（没有这一行）'}`, `Codex ：${lb[at] ?? '（没有这一行）'}`, '改成一样后再跑一次体检'] };
}

// 全局指令进 git（#13）：已装的 CLAUDE.md / AGENTS.md 应等于「仓库版 global/ + 本机个人段」。
// 不一致多半是有人直接改了已装的文件：改动没进 PR、也没版本记录。
function checkGlobalInstructions({ home, env, dir }) {
  return inspect({ home, env, dir }).map(r => {
    const name = `全局指令 ${r.tool} 与仓库版一致`;
    if (r.status === 'same') return { name, status: 'ok', detail: [`${r.dest} = global/ 仓库版 + 个人段`] };
    if (r.status === 'missing-personal') return { name, status: 'warn', detail: [`个人段缺 ${r.missing.join('、')}，应在 ${r.personal}`] };
    if (r.status === 'no-base') return { name, status: 'warn', detail: ['仓库里没有 global/ 仓库版'] };
    return {
      name,
      status: 'warn',
      detail: [`${r.dest} 第 ${r.diff.line} 行起和仓库版不同`, `已装：${r.diff.installed}`, `仓库：${r.diff.composed}`, '改全局指令要改 global/ 走 PR，合并后在 main 上跑 node tools/global-instructions.mjs --apply；仓库不在 main 上时这条可以忽略'],
    };
  });
}

function checkAutoMemory({ home }) {
  const settings = jsonOr(readText(path.join(home, '.claude', 'settings.json')));
  const v = settings.autoMemoryEnabled;
  if (v === false) return { name: 'Claude 自动记忆', status: 'ok', detail: ['已关闭（autoMemoryEnabled: false）'] };
  return {
    name: 'Claude 自动记忆',
    status: 'info',
    detail: [v === true ? '已开启' : '没设置，按官方默认是开启的', '它会不经批准把纠正记成笔记；要关就在 Claude 里打开 /memory 切换，留着就每周整理时看一眼 ~/.claude/projects/*/memory/'],
  };
}

function checkLessonHits({ now, dir }) {
  const text = readText(path.join(dir, 'lessons-hits.jsonl'));
  const since = now - 7 * 864e5;
  const counts = {};
  for (const line of (text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (Date.parse(row.time) < since) continue;
      for (const id of row.ids || []) counts[id] = (counts[id] || 0) + 1;
    } catch {}
  }
  const list = Object.entries(counts).sort((x, y) => y[1] - x[1]);
  return {
    name: '近 7 天坑提醒命中',
    status: 'info',
    detail: list.length ? [list.map(([id, n]) => `${id}×${n}`).join('、')] : ['没有命中（或 hook 还没装）'],
  };
}

// thinking-review 三层分开看（#35）：钩子提醒了几个会话 → 其中几个调用了 skill → 几个真的发起了「思维评审｜」接力。
// 提醒了没调用不一定是漏：判成 B / C 本来就不用调用、不用送。这里只给数，漏没漏要回会话里看。
export const HANDOFFS_FILE = home => path.join(home, 'Library', 'Application Support', 'app.postpane.mac', 'chatgpt', 'handoffs.json');

function checkThinkingReview({ now, dir, home, env }) {
  const since = now - 7 * 864e5;
  const rows = file =>
    (readText(path.join(dir, file)) || '').split('\n').flatMap(l => {
      try {
        const r = JSON.parse(l);
        return Date.parse(r.time) >= since ? [r] : [];
      } catch {
        return [];
      }
    });
  const nudges = rows('thinking-review-nudges.jsonl');
  const nudged = new Set(nudges.filter(r => r.nudged).map(r => r.session));
  const signals = {};
  for (const r of nudges.filter(r => r.nudged)) signals[r.signal] = (signals[r.signal] || 0) + 1;
  const judged = new Set(rows('skill-usage.jsonl').filter(r => /thinking-review$/.test(r.skill || '')).map(r => r.session));
  const handoffs = jsonOr(readText(env.POSTPANE_HANDOFFS || HANDOFFS_FILE(home)));
  const relayed = new Set((Array.isArray(handoffs) ? handoffs : []).filter(h => String(h.title || '').startsWith('思维评审｜') && Number(h.createdAt) >= since).map(h => h.claudeSession));
  const inter = (a, b) => [...a].filter(x => b.has(x)).length;
  const off = fs.existsSync(path.join(dir, 'thinking-review-nudge.off'));
  return {
    name: '近 7 天思维评审触发',
    status: 'info',
    detail: [
      ...(off ? ['准入提醒已手动关闭（删掉状态目录里的 thinking-review-nudge.off 恢复）'] : []),
      `钩子提醒 ${nudged.size} 个会话${Object.keys(signals).length ? `（${Object.entries(signals).map(([k, n]) => `${k}×${n}`).join('、')}）` : ''}；其中调用了 thinking-review ${inter(nudged, judged)} 个，发起接力 ${inter(nudged, relayed)} 个`,
      `全部会话：调用 thinking-review ${judged.size} 个，发起「思维评审｜」接力 ${relayed.size} 个`,
    ],
  };
}

function checkRepos({ config, run }) {
  return (config.repos || []).map(repo => {
    const name = `仓库 ${path.basename(repo)}`;
    const branch = config.mainBranch || 'main';
    const perm = s => /Operation not permitted|EPERM/i.test(s);
    if (config.fetch !== false) {
      const f = run('git', ['-C', repo, 'fetch', '--quiet', 'origin', branch], { timeout: 30000 });
      if (f.code !== 0)
        return { name, status: 'warn', detail: [perm(f.stderr) ? '没有权限读取这个目录（从 launchd 跑时见 G-05）' : `git fetch 失败：${f.stderr.trim().split('\n')[0]}`] };
    }
    const ahead = run('git', ['-C', repo, 'log', '--format=%h %s', `origin/${branch}..${branch}`]);
    if (ahead.code !== 0) return { name, status: 'warn', detail: [perm(ahead.stderr) ? '没有权限读取（G-05）' : `git log 失败：${ahead.stderr.trim().split('\n')[0]}`] };
    const commits = ahead.stdout.trim().split('\n').filter(Boolean);
    const dirty = run('git', ['-C', repo, 'status', '--porcelain']).stdout.trim().split('\n').filter(Boolean).length;
    const tail = dirty ? `；主目录有 ${dirty} 个没提交的改动` : '';
    if (commits.length)
      return { name, status: 'warn', detail: [`本地 ${branch} 比远端多 ${commits.length} 个提交，推之前按《工程流程》5.1 先列给常浩看${tail}`, ...commits.slice(0, 5)] };
    return { name, status: dirty ? 'info' : 'ok', detail: [`本地 ${branch} 没有未推的提交${tail}`] };
  });
}

export function runDoctor(deps = {}) {
  const env = deps.env || process.env;
  const home = deps.home || os.homedir();
  const ctx = {
    env,
    home,
    run: deps.run || defaultRun,
    now: deps.now ?? Date.now(),
    dir: deps.dir || stateDir(env, deps.platform || process.platform, home),
    config: deps.config || {},
  };
  return [
    ...checkHooks(ctx),
    checkInstructionSync(ctx),
    ...checkGlobalInstructions(ctx),
    checkAutoMemory(ctx),
    checkLessonHits(ctx),
    checkThinkingReview(ctx),
    ...checkRepos(ctx),
  ];
}

export function formatReport(results, startedAt) {
  const lines = [`开始 ${startedAt}`];
  for (const r of results) {
    lines.push(`${MARK[r.status]} ${r.name}`);
    for (const d of r.detail) lines.push(`    ${d}`);
  }
  const n = s => results.filter(r => r.status === s).length;
  lines.push(`合计：✓${n('ok')} ⚠${n('warn')} ✗${n('fail')}`);
  return lines;
}

function main(argv = process.argv.slice(2)) {
  const startedAt = new Date().toISOString();
  const dir = stateDir();
  const cfgIdx = argv.indexOf('--config');
  const cfgFile = cfgIdx >= 0 ? argv[cfgIdx + 1] : path.join(dir, 'doctor.json');
  let config = {};
  const cfgText = readText(cfgFile);
  if (cfgText) config = JSON.parse(cfgText);
  else if (cfgIdx >= 0) throw new Error(`读不到配置 ${cfgFile}`);
  const results = runDoctor({ config, dir });
  const code = results.some(r => r.status === 'fail') ? 1 : 0;
  if (argv.includes('--json')) console.log(JSON.stringify({ startedAt, config: cfgText ? cfgFile : null, results, exit: code }, null, 2));
  else console.log([...formatReport(results, startedAt), cfgText ? `配置：${cfgFile}` : `没有配置文件（${cfgFile}），只做了内置检查；样例见 tools/doctor.example.json`].join('\n'));
  if (!argv.includes('--no-save')) {
    const out = path.join(dir, 'doctor');
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, `doctor-${startedAt.replace(/[-:]/g, '').slice(0, 13)}.txt`);
    fs.writeFileSync(file, `${[...formatReport(results, startedAt), `exit ${code}`].join('\n')}\n`);
    const old = fs.readdirSync(out).filter(f => f.startsWith('doctor-')).sort().slice(0, -60);
    for (const f of old) fs.rmSync(path.join(out, f));
  }
  return code;
}

if (isEntry(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`体检中断：${err.message}`);
    process.exitCode = 2;
  }
}
