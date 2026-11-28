#!/usr/bin/env node
// 把 agent-kit 的机器执行层装进本机的 Claude Code 和 Codex（第 1、2 件）。
//   node tools/install.mjs            只预览会改什么，不写任何文件
//   node tools/install.mjs --apply    真正写入
//   node tools/install.mjs --uninstall [--apply]   去掉 agent-kit 加的东西，别的设置原样保留
//   --only claude | --only codex      只装一边
//   --allow-any-branch                允许不在 main 上装（只给测试和有意为之时用）
// 改的文件：~/.claude/settings.json（permissions.deny / ask、hooks.PreToolUse、hooks.PostToolUse 里的 skill-usage、
//          hooks.UserPromptSubmit 里的 thinking-review-nudge、首轮整理和上下文提醒、hooks.PostToolUse 里的上下文提醒、
//          hooks.SessionStart 里的首轮整理、hooks.Stop 里的收尾按钮框兜底 wrapup-guard）、
//          ~/.codex/hooks.json（hooks.PreToolUse）、~/.codex/rules/agent-kit.rules。
// 首轮整理钩子（#65）的真实配置放状态目录 session-organize-once/config.json，不进仓库；没有时从旧位置迁移或拷示例，已有的不覆盖。
// 上下文提醒钩子（#105）同样：配置和提醒记录放状态目录 context-handoff/，没有时从 ~/.claude/hooks/context-handoff/ 迁移。
// 写之前把原文件备份到状态目录 backups/<时间>/；hook 脚本和 LESSONS.md 复制到状态目录 runtime/ 再指向那里，
// 这样主目录换分支、停在冲突里、worktree 被删，都不影响已经装好的 hook。改了 hooks/ 或 LESSONS.md 要在 main 上重装才生效。
// 各仓库共用的 git 钩子（agent-kit#133）也复制到 runtime/git-hooks/：各仓库 scripts/hooks/ 里的转发找的就是这里，
// 不写任何设置文件；改了 git-hooks/ 同样要在 main 上重装，所有转发仓库一起生效。
// 本次新增了哪些权限规则记在状态目录 install-manifest.json，卸载只删这些，你自己原有的同名规则不动。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntry, stateDir } from '../hooks/lib/common.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORGANIZE = 'session-organize-once/session_organize_once.py';
const HANDOFF = 'context-handoff/context_handoff.py';
// 旧路径 ~/.claude/hooks/session-organize-once/…、~/.claude/hooks/context-handoff/… 也带「hooks/<同名>/…」，重装时会被认出来换掉
const HOOK_FILES = ['guard-git.mjs', 'lessons-remind.mjs', 'skill-usage.mjs', 'thinking-review-nudge.mjs', 'bash-precheck.mjs', 'wrapup-guard.mjs', ORGANIZE, HANDOFF];
const TIMEOUT_SEC = 10;
const ORGANIZE_TIMEOUT_SEC = 5;
export const ORGANIZE_LEGACY_DIR = home => path.join(home, '.claude', 'hooks', 'session-organize-once');
export const HANDOFF_LEGACY_DIR = home => path.join(home, '.claude', 'hooks', 'context-handoff');

export const isOurHook = h => typeof h?.command === 'string' && HOOK_FILES.some(f => h.command.includes(`hooks/${f}`));

// Python 也用不随版本变的入口：python.org 安装包的 Versions/Current、Homebrew 的 bin
export function stablePython(exists = fs.existsSync) {
  for (const p of ['/Library/Frameworks/Python.framework/Versions/Current/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3']) if (exists(p)) return p;
  return 'python3';
}

// 首轮整理钩子的命令：脚本在 runtime 副本里，配置和运行记录在状态目录（base 是状态目录下的 runtime/）
export function organizeCommand(python, base) {
  const dir = path.join(path.dirname(base), 'session-organize-once');
  return `"${python}" "${path.join(base, 'hooks', ORGANIZE)}" --config "${path.join(dir, 'config.json')}" --state-dir "${path.join(dir, 'state')}"`;
}

const organizeHook = (python, base) => ({ type: 'command', command: organizeCommand(python, base), timeout: ORGANIZE_TIMEOUT_SEC, statusMessage: '整理新会话' });

// 上下文提醒钩子（#105）的命令：同上，配置和提醒记录在状态目录 context-handoff/
export function handoffCommand(python, base) {
  const dir = path.join(path.dirname(base), 'context-handoff');
  return `"${python}" "${path.join(base, 'hooks', HANDOFF)}" --config "${path.join(dir, 'config.json')}" --state-dir "${path.join(dir, 'state')}"`;
}

// 发消息时显示「检查上下文用量」；工具调用后每次都跑，不显示，免得刷屏
const handoffHook = (python, base, statusMessage) => ({ type: 'command', command: handoffCommand(python, base), timeout: ORGANIZE_TIMEOUT_SEC, ...(statusMessage ? { statusMessage } : {}) });

// 新会话启动时的 hook（SessionStart）：只有 Claude 桌面应用的首轮整理（#65）
export function ourStartGroups(tool, python = stablePython(), base = KIT) {
  if (tool !== 'claude') return [];
  return [{ matcher: 'startup|fork', hooks: [organizeHook(python, base)] }];
}

// 首轮整理的真实配置：已有就不动；没有就从旧位置迁移，再没有就拷示例。返回一句说明
export function ensureOrganizeConfig(sd, home, { write = false, kit = KIT } = {}) {
  const dest = path.join(sd, 'session-organize-once', 'config.json');
  if (fs.existsSync(dest)) return `首轮整理配置已在 ${dest}，不动`;
  const legacy = path.join(ORGANIZE_LEGACY_DIR(home), 'config.json');
  const src = fs.existsSync(legacy) ? legacy : path.join(kit, 'config', 'session-organize-once.example.json');
  if (write) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  return src === legacy ? `首轮整理配置从旧位置 ${legacy} 迁移到 ${dest}` : `首轮整理配置还没有，拷示例到 ${dest}（分区和项目要按本机改）`;
}

// 上下文提醒的配置和提醒记录：配置已有就不动，没有就从旧位置迁移或拷示例；
// 旧位置的提醒记录一并拷过来（已有的同名记录不覆盖），已经提醒过的会话不会再提醒一次。旧目录不删
export function ensureHandoffConfig(sd, home, { write = false, kit = KIT } = {}) {
  const dir = path.join(sd, 'context-handoff');
  const dest = path.join(dir, 'config.json');
  const legacy = HANDOFF_LEGACY_DIR(home);
  const legacyState = path.join(legacy, 'state');
  const marks = fs.existsSync(legacyState) ? fs.readdirSync(legacyState).filter(f => f.endsWith('.json') && !fs.existsSync(path.join(dir, 'state', f))) : [];
  const notes = [];
  if (fs.existsSync(dest)) notes.push(`上下文提醒配置已在 ${dest}，不动`);
  else {
    const src = fs.existsSync(path.join(legacy, 'config.json')) ? path.join(legacy, 'config.json') : path.join(kit, 'config', 'context-handoff.example.json');
    if (write) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(src, dest);
    }
    notes.push(src.startsWith(legacy) ? `上下文提醒配置从旧位置 ${legacy} 迁移到 ${dest}` : `上下文提醒配置还没有，拷示例到 ${dest}`);
  }
  if (marks.length) {
    if (write) {
      fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
      for (const f of marks) fs.copyFileSync(path.join(legacyState, f), path.join(dir, 'state', f));
    }
    notes.push(`旧位置的 ${marks.length} 条提醒记录拷过来`);
  }
  return notes.join('；');
}

// Homebrew 的 node 真实路径带版本号（/opt/homebrew/Cellar/node/<版本>/bin/node），升级后旧路径会消失、hook 就静默失效；
// 优先用不随版本变的入口。
export function stableNode(execPath = process.execPath, exists = fs.existsSync) {
  if (!execPath.includes('/Cellar/')) return execPath;
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) if (exists(p)) return p;
  return execPath;
}

export function ourHookGroups(tool, node = stableNode(), base = KIT) {
  const cmd = file => `"${node}" "${path.join(base, 'hooks', file)}"`;
  const remindMatcher = tool === 'claude' ? 'Bash|Edit|Write|MultiEdit|NotebookEdit' : 'Bash|apply_patch|Edit|Write';
  return [
    { matcher: 'Bash', hooks: [{ type: 'command', command: cmd('guard-git.mjs'), timeout: TIMEOUT_SEC }] },
    { matcher: remindMatcher, hooks: [{ type: 'command', command: cmd('lessons-remind.mjs'), timeout: TIMEOUT_SEC }] },
    // thinking-review 准入提醒（#35）：第一次改项目文件前、退出计划模式前。只有 Claude 有 thinking-review
    ...(tool === 'claude' ? [{ matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit|ExitPlanMode', hooks: [{ type: 'command', command: cmd('thinking-review-nudge.mjs'), timeout: TIMEOUT_SEC }] }] : []),
    // Bash 预检（#49）：提前拦下会触发 Claude Code 内置危险 rm 检查的写法。Codex 没有这个检查
    ...(tool === 'claude' ? [{ matcher: 'Bash', hooks: [{ type: 'command', command: cmd('bash-precheck.mjs'), timeout: TIMEOUT_SEC }] }] : []),
  ];
}

// 用户发消息时的 hook（UserPromptSubmit）：只有 Claude 的 thinking-review 准入提醒（#35）、首轮整理（#65）和上下文提醒（#105）
export function ourPromptGroups(tool, node = stableNode(), base = KIT, python = stablePython()) {
  if (tool !== 'claude') return [];
  return [
    { hooks: [{ type: 'command', command: `"${node}" "${path.join(base, 'hooks', 'thinking-review-nudge.mjs')}"`, timeout: TIMEOUT_SEC }] },
    { hooks: [organizeHook(python, base)] },
    { hooks: [handoffHook(python, base, '检查上下文用量')] },
  ];
}

// 调用后的 hook（PostToolUse）：Claude 的 skill 调用日志（Codex 没有 Skill 工具，由 my-skills 月度体检读会话记录补），
// 和上下文提醒（#105，长时间自主运行的一轮里也能及时提醒）
export function ourPostGroups(tool, node = stableNode(), base = KIT, python = stablePython()) {
  if (tool !== 'claude') return [];
  return [
    { matcher: 'Skill', hooks: [{ type: 'command', command: `"${node}" "${path.join(base, 'hooks', 'skill-usage.mjs')}"`, timeout: TIMEOUT_SEC }] },
    { hooks: [handoffHook(python, base)] },
  ];
}

// 一轮结束时的 hook（Stop）：只有 Claude 的收尾按钮框兜底（#150）。Codex 没有 wrap_up 按钮框
export function ourStopGroups(tool, node = stableNode(), base = KIT) {
  if (tool !== 'claude') return [];
  return [{ hooks: [{ type: 'command', command: `"${node}" "${path.join(base, 'hooks', 'wrapup-guard.mjs')}"`, timeout: TIMEOUT_SEC }] }];
}

// 去掉某个事件下已有的 agent-kit hook（别人的 hook 原样保留），再按需加上新的
export function mergeHooks(config, groups, { remove = false, event = 'PreToolUse' } = {}) {
  const out = structuredClone(config || {});
  out.hooks ||= {};
  const kept = (out.hooks[event] || [])
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isOurHook(h)) }))
    .filter(g => g.hooks.length);
  out.hooks[event] = remove ? kept : [...kept, ...groups];
  if (!out.hooks[event].length) delete out.hooks[event];
  if (!Object.keys(out.hooks).length) delete out.hooks;
  return out;
}

export function mergeRules(settings, key, rules, { remove = false } = {}) {
  const out = structuredClone(settings || {});
  out.permissions ||= {};
  const cur = out.permissions[key] || [];
  out.permissions[key] = remove ? cur.filter(r => !rules.includes(r)) : [...cur, ...rules.filter(r => !cur.includes(r))];
  if (!out.permissions[key].length) delete out.permissions[key];
  if (!Object.keys(out.permissions).length) delete out.permissions;
  return out;
}

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} 不是合法 JSON，先手工修好再装（${err.message}）`);
  }
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

// 装之前先让两个 hook 各跑一次，确认在这台电脑上能用。只测脚本本身；写进设置的那条命令能不能跑，由 tools/doctor.mjs 测。
export function selfTest(base = KIT, node = process.execPath, python = stablePython()) {
  const run = (file, input) =>
    spawnSync(node, [path.join(base, 'hooks', file)], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: { ...process.env, AGENT_KIT_NO_LOG: '1', AGENT_KIT_NO_DEDUPE: '1' },
      timeout: 10000,
    });
  const problems = [];
  const g = run('guard-git.mjs', { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } });
  if (g.status !== 0 || !String(g.stdout).includes('"deny"')) problems.push(`guard-git 没拦下强推 main（退出码 ${g.status}，${g.stderr || g.stdout}）`);
  // G-05 只在改文件时提醒（瘦身提案 S4），自检用「写一份 LaunchAgents 里的 plist」
  const r = run('lessons-remind.mjs', { session_id: 'selftest', tool_name: 'Write', tool_input: { file_path: '/x/Library/LaunchAgents/com.agent-kit.selftest.plist', content: '<plist/>' } });
  if (r.status !== 0 || !String(r.stdout).includes('G-05')) problems.push(`lessons-remind 没对写 plist 给出 G-05 提醒（退出码 ${r.status}，${r.stderr || r.stdout}）`);
  const s = run('skill-usage.mjs', { session_id: 'selftest', tool_name: 'Skill', tool_input: { skill: 'selftest' } });
  if (s.status !== 0) problems.push(`skill-usage 跑不起来（退出码 ${s.status}，${s.stderr || s.stdout}）`);
  const t = run('thinking-review-nudge.mjs', { session_id: 'selftest', hook_event_name: 'UserPromptSubmit', prompt: '这个思维评审一下' });
  if (t.status !== 0 || !String(t.stdout).includes('thinking-review')) problems.push(`thinking-review-nudge 没对「思维评审」给出提醒（退出码 ${t.status}，${t.stderr || t.stdout}）`);
  const b = run('bash-precheck.mjs', { tool_name: 'Bash', tool_input: { command: 'cd /x && rm -f "$O"/*.zip' } });
  if (b.status !== 0 || !String(b.stdout).includes('"deny"')) problems.push(`bash-precheck 没拦下 rm 变量加通配符（退出码 ${b.status}，${b.stderr || b.stdout}）`);
  // 收尾按钮框兜底（#150）：〔等你决定〕却没带 ask 的 wrap_up，应拦下让模型补
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-wrapup-'));
  const wtFile = path.join(wt, 't.jsonl');
  fs.writeFileSync(wtFile, [
    { type: 'user', entrypoint: 'claude-desktop', message: { content: '自检' } },
    { type: 'attachment', attachment: { type: 'prompt_snapshot', tools: [{ name: 'mcp__ccd_turn__wrap_up' }] } },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: '**当前状态**：〔等你决定〕自检\n**下一步**：回复「合并」' }] } },
  ].map(x => JSON.stringify(x)).join('\n'));
  const w = spawnSync(node, [path.join(base, 'hooks', 'wrapup-guard.mjs')], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'selftest', transcript_path: wtFile }),
    encoding: 'utf8',
    env: { ...process.env, AGENT_KIT_NO_LOG: '1', AGENT_KIT_STATE_DIR: wt },
    timeout: 10000,
  });
  fs.rmSync(wt, { recursive: true, force: true });
  if (w.status !== 0 || !String(w.stdout).includes('"block"')) problems.push(`wrapup-guard 没对缺按钮框的〔等你决定〕要求补（退出码 ${w.status}，${w.stderr || w.stdout}）`);
  // 首轮整理（#65）：Python 能跑、示例配置能读；不在桌面应用里时应原样放行（输出 {}）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-organize-'));
  const env = { ...process.env };
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const o = spawnSync(python, ['-B', path.join(base, 'hooks', ORGANIZE), '--config', path.join(base, 'config', 'session-organize-once.example.json'), '--state-dir', path.join(tmp, 'state')], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'selftest', source: 'startup' }),
    encoding: 'utf8',
    env,
    timeout: 10000,
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  if (o.status !== 0 || String(o.stdout).trim() !== '{}') problems.push(`首轮整理钩子跑不起来（${python}，退出码 ${o.status}，${o.stderr || o.stdout}）`);
  // 上下文提醒（#105）：用示例配置和一份越过 50% 的会话记录跑一次，应给出提醒
  const ht = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-handoff-'));
  const transcript = path.join(ht, 't.jsonl');
  fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 600000 } } })}\n`);
  const h = spawnSync(python, ['-B', path.join(base, 'hooks', HANDOFF), '--config', path.join(base, 'config', 'context-handoff.example.json'), '--state-dir', path.join(ht, 'state')], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'selftest', transcript_path: transcript }),
    encoding: 'utf8',
    timeout: 10000,
  });
  fs.rmSync(ht, { recursive: true, force: true });
  if (h.status !== 0 || !String(h.stdout).includes('上下文提醒')) problems.push(`上下文提醒钩子没对 60% 的会话给出提醒（${python}，退出码 ${h.status}，${h.stderr || h.stdout}）`);
  problems.push(...gitHooksSelfTest(base, node));
  return problems;
}

// 各仓库共用的 git 钩子（#133）：入口有可执行位；commit-msg 拦下没写「同类：」的修复提交；规则检查抓到截取 ISO 时间
export function gitHooksSelfTest(base = KIT, node = process.execPath) {
  const dir = path.join(base, 'git-hooks');
  const problems = [];
  for (const f of ['pre-push', 'commit-msg']) {
    try {
      if (!(fs.statSync(path.join(dir, f)).mode & 0o111)) problems.push(`git-hooks/${f} 没有可执行位，git 会跳过它`);
    } catch {
      problems.push(`缺 git-hooks/${f}`);
    }
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-git-hooks-'));
  try {
    fs.writeFileSync(path.join(tmp, 'msg'), 'fix: 截断\n');
    const c = spawnSync(node, [path.join(dir, 'commit-msg.mjs'), path.join(tmp, 'msg')], { encoding: 'utf8', timeout: 10000 });
    if (c.status !== 1 || !String(c.stderr).includes('同类')) problems.push(`git-hooks/commit-msg.mjs 没拦下没写「同类：」的修复提交（退出码 ${c.status}，${c.stderr || c.stdout}）`);
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.writeFileSync(path.join(tmp, 'src', 'a.js'), 'show(item.createdAt.slice(0, 16));\n');
    const r = spawnSync(node, [path.join(dir, 'check-rules.mjs'), tmp], { encoding: 'utf8', timeout: 10000 });
    if (r.status !== 1 || !String(r.stderr).includes('G-02')) problems.push(`git-hooks/check-rules.mjs 没抓到截取 ISO 时间（退出码 ${r.status}，${r.stderr || r.stdout}）`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return problems;
}

// 只从 main 上、没有未提交改动的主目录安装：hook 会在所有会话的每条命令前运行，必须是审过、合并过的版本
export function branchProblem(kit = KIT) {
  const git = args => spawnSync('git', ['-C', kit, ...args], { encoding: 'utf8' });
  const br = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (br.status !== 0) return '这个目录不是 git 仓库，认不出是不是 main 上的版本';
  if (br.stdout.trim() !== 'main') return `当前在 ${br.stdout.trim()} 分支上，不是 main`;
  const dirty = git(['status', '--porcelain', '--', 'hooks', 'git-hooks', 'config', 'global', 'LESSONS.md']).stdout.trim();
  if (dirty) return `hooks/、git-hooks/、config/、global/ 或 LESSONS.md 有没提交的改动：\n${dirty}`;
  return null;
}

// 先拷到旁边的临时目录，再两次改名换上去：各仓库的转发随时可能在读 runtime/git-hooks，先删后拷的那一下会把提交、推送误拦（#141 审查）
export function copyRuntime(final, kit = KIT) {
  const hooks = path.join(kit, 'hooks');
  const dest = `${final}.new-${process.pid}`;
  const old = `${final}.old-${process.pid}`;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  // 只看 hooks/ 以下的相对路径：仓库本身放在 .claude/worktrees/ 这类点开头的目录里时，不能整份跳过；Python 缓存也不复制
  fs.cpSync(hooks, path.join(dest, 'hooks'), { recursive: true, filter: src => !path.relative(hooks, src).split(path.sep).some(p => p.startsWith('.') || p === '__pycache__') });
  fs.copyFileSync(path.join(kit, 'LESSONS.md'), path.join(dest, 'LESSONS.md'));
  // 各仓库共用的 git 钩子（#133）：两个入口显式给可执行位，不靠复制时带过去
  const gitHooks = path.join(kit, 'git-hooks');
  fs.cpSync(gitHooks, path.join(dest, 'git-hooks'), { recursive: true, filter: src => !path.relative(gitHooks, src).split(path.sep).some(p => p.startsWith('.')) });
  for (const f of ['pre-push', 'commit-msg', 'forward/pre-push', 'forward/commit-msg']) fs.chmodSync(path.join(dest, 'git-hooks', f), 0o755);
  fs.rmSync(old, { recursive: true, force: true });
  if (fs.existsSync(final)) fs.renameSync(final, old);
  fs.renameSync(dest, final);
  fs.rmSync(old, { recursive: true, force: true });
}

// 卸载：去掉 runtime/ 里 agent-kit 的 hook 和 LESSONS，留下 git-hooks/。各仓库的转发还指着它，删了连普通提交都会被拦下（#141 审查）
export function removeRuntimeKeepGitHooks(runtime) {
  if (!fs.existsSync(runtime)) return;
  for (const f of fs.readdirSync(runtime)) if (f !== 'git-hooks') fs.rmSync(path.join(runtime, f), { recursive: true, force: true });
}

// 坑提醒的规则（LESSONS.md 的「触发」行和 lessons-remind.mjs）上次真正变化的时间，doctor 按它切开「近 7 天坑提醒」，
// 免得把装机前后两套规则的提醒数混在一起算（#133）。和已装的副本一样就沿用旧时间；旧记录没有这一项时，退回上次安装时间
export const REMIND_FILES = ['LESSONS.md', path.join('hooks', 'lessons-remind.mjs')];
export function remindChangedAt(runtime, manifest, now, kit = KIT) {
  const read = file => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  };
  const changed = REMIND_FILES.some(f => read(path.join(kit, f)) !== read(path.join(runtime, f)));
  return changed ? now : manifest.remindChangedAt || manifest.installedAt || now;
}

export function main(argv = process.argv.slice(2), home = os.homedir(), env = process.env) {
  const apply = argv.includes('--apply');
  const remove = argv.includes('--uninstall');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;
  const doClaude = !only || only === 'claude';
  const doCodex = !only || only === 'codex';
  const sd = stateDir(env, process.platform, home);
  const runtime = path.join(sd, 'runtime');
  const manifestFile = path.join(sd, 'install-manifest.json');
  const manifest = readJson(manifestFile);
  const nextManifest = structuredClone(manifest);
  const plan = [];

  if (!remove) {
    const why = branchProblem();
    if (why && !argv.includes('--allow-any-branch')) {
      const msg = `不能从这里安装：${why}\n请在 agent-kit 主目录、main 分支、拉到最新后再装。`;
      if (apply) {
        console.error(`${msg}\n什么都没改。`);
        return 1;
      }
      plan.push(`⚠ ${msg}（预览照常显示，--apply 会被拒绝）`);
    }
    const problems = selfTest();
    if (problems.length) {
      console.error(`自检没通过，什么都没改：\n- ${problems.join('\n- ')}`);
      return 1;
    }
    plan.push('自检通过：guard-git 拦下了强推 main，lessons-remind 对写 plist 给出了 G-05 提醒，skill-usage 能跑，thinking-review-nudge 对「思维评审」给出了提醒，bash-precheck 拦下了 rm 变量加通配符，首轮整理钩子用 Python 跑通，上下文提醒钩子对 60% 的会话给出了提醒，共用 git 钩子拦下了没写「同类：」的修复提交、规则检查抓到了截取 ISO 时间。');
    plan.push(`hook 脚本和 LESSONS.md 复制到 ${runtime}，设置里指向那里；共用 git 钩子复制到 ${path.join(runtime, 'git-hooks')}，各仓库 scripts/hooks/ 的转发找的是这里。`);
  }

  const writes = [];
  if (doClaude) {
    const file = path.join(home, '.claude', 'settings.json');
    const before = readJson(file);
    const cfg = JSON.parse(fs.readFileSync(path.join(KIT, 'config', 'claude-permissions.json'), 'utf8'));
    let after = before;
    nextManifest.claude ||= {};
    for (const key of ['deny', 'ask']) {
      const had = before.permissions?.[key] || [];
      const mine = manifest.claude?.[key] || [];
      if (remove) after = mergeRules(after, key, mine, { remove: true });
      else {
        // 以前装时加的、配置里已经去掉的规则，重装时一并去掉
        const dropped = mine.filter(r => !cfg[key].includes(r));
        after = mergeRules(mergeRules(after, key, dropped, { remove: true }), key, cfg[key]);
        // 记下「这次新加的」加上「以前装时加的、现在还在的」；你原来就有的同名规则不算
        nextManifest.claude[key] = [...new Set([...mine.filter(r => had.includes(r) && !dropped.includes(r)), ...cfg[key].filter(r => !had.includes(r))])];
      }
    }
    after = mergeHooks(after, ourHookGroups('claude', stableNode(), runtime), { remove });
    after = mergeHooks(after, ourPostGroups('claude', stableNode(), runtime, stablePython()), { remove, event: 'PostToolUse' });
    after = mergeHooks(after, ourPromptGroups('claude', stableNode(), runtime), { remove, event: 'UserPromptSubmit' });
    after = mergeHooks(after, ourStartGroups('claude', stablePython(), runtime), { remove, event: 'SessionStart' });
    after = mergeHooks(after, ourStopGroups('claude', stableNode(), runtime), { remove, event: 'Stop' });
    plan.push(`Claude Code：${file}`);
    if (!remove) plan.push(`  ${ensureOrganizeConfig(sd, home)}`, `  ${ensureHandoffConfig(sd, home)}`);
    if (remove) {
      plan.push(manifest.claude ? `  去掉安装时加的 ${(manifest.claude.deny || []).length} 条 deny、${(manifest.claude.ask || []).length} 条 ask 规则和 11 组 hook；你原有的同名规则不动；首轮整理、上下文提醒的配置和记录，wrapup-guard 的记录和 wrapup-guard.off 开关留在状态目录` : '  找不到安装记录，权限规则不动（只去掉 11 组 hook）');
      delete nextManifest.claude;
    } else {
      const n = key => nextManifest.claude[key].filter(r => !(before.permissions?.[key] || []).includes(r)).length;
      const gone = key => (before.permissions?.[key] || []).filter(r => !(after.permissions?.[key] || []).includes(r)).length;
      plan.push(`  permissions.deny 新增 ${n('deny')} 条、去掉 ${gone('deny')} 条，permissions.ask 新增 ${n('ask')} 条、去掉 ${gone('ask')} 条（已有的不重复加；去掉的是以前装进去、配置里已删的）；hooks.PreToolUse 放入 guard-git、lessons-remind、thinking-review-nudge、bash-precheck，hooks.PostToolUse 放入 skill-usage 和上下文提醒，hooks.UserPromptSubmit 放入 thinking-review-nudge、首轮整理和上下文提醒，hooks.SessionStart 放入首轮整理，hooks.Stop 放入 wrapup-guard（旧的 agent-kit hook 和 ~/.claude/hooks 下的旧首轮整理、旧上下文提醒先去掉）`);
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) writes.push([file, `${JSON.stringify(after, null, 2)}\n`]);
    else plan.push('  没有变化');
  }
  if (doCodex) {
    const codexHome = env.CODEX_HOME || path.join(home, '.codex');
    const file = path.join(codexHome, 'hooks.json');
    const before = readJson(file);
    const after = mergeHooks(before, ourHookGroups('codex', stableNode(), runtime), { remove });
    plan.push(`Codex：${file}`);
    plan.push(remove ? '  去掉 agent-kit 的 2 个 hook' : '  hooks.PreToolUse 放入 guard-git、lessons-remind');
    if (JSON.stringify(before) !== JSON.stringify(after)) writes.push([file, `${JSON.stringify(after, null, 2)}\n`]);
    else plan.push('  没有变化');
    const rules = path.join(codexHome, 'rules', 'agent-kit.rules');
    plan.push(`Codex：${rules}`);
    if (remove) {
      plan.push(fs.existsSync(rules) ? '  删除这个文件' : '  本来就没有');
      if (fs.existsSync(rules)) writes.push([rules, null]);
    } else {
      const src = fs.readFileSync(path.join(KIT, 'config', 'codex', 'agent-kit.rules'), 'utf8');
      if (fs.existsSync(rules) && fs.readFileSync(rules, 'utf8') === src) plan.push('  已是最新');
      else {
        plan.push('  复制 config/codex/agent-kit.rules（禁止 / 先问的 git、gh 操作）');
        writes.push([rules, src]);
      }
    }
  }

  if (!apply) {
    console.log(`${plan.join('\n')}\n\n以上只是预览，没有改任何文件。确认后加 --apply 再跑一次。`);
    return 0;
  }
  const backups = path.join(sd, 'backups', stamp());
  for (const [file, content] of writes) {
    if (fs.existsSync(file)) {
      const bak = path.join(backups, file.replace(home, '~').replace(/[/\\]/g, '__'));
      fs.mkdirSync(backups, { recursive: true });
      fs.copyFileSync(file, bak);
      plan.push(`  已备份 ${file} → ${bak}`);
    }
    if (content === null) fs.rmSync(file);
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  }
  if (remove) {
    if (!doClaude || !doCodex) plan.push(`只卸了一边，${runtime} 保留给另一边用。`);
    else {
      removeRuntimeKeepGitHooks(runtime);
      plan.push(`共用 git 钩子 ${path.join(runtime, 'git-hooks')} 留着：各仓库 scripts/hooks/ 的转发还指着它，删了这些仓库连普通提交都会被拦下。要彻底去掉，先把那些仓库的 core.hooksPath 改回去（git -C <仓库> config --unset core.hooksPath），再删这个目录。`);
    }
    if (nextManifest.claude) fs.writeFileSync(manifestFile, `${JSON.stringify(nextManifest, null, 2)}\n`);
    else fs.rmSync(manifestFile, { force: true });
  } else {
    if (doClaude) {
      ensureOrganizeConfig(sd, home, { write: true });
      ensureHandoffConfig(sd, home, { write: true });
    }
    const now = new Date().toISOString();
    nextManifest.remindChangedAt = remindChangedAt(runtime, manifest, now);
    copyRuntime(runtime);
    nextManifest.kit = KIT;
    nextManifest.installedAt = now;
    fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(manifestFile, `${JSON.stringify(nextManifest, null, 2)}\n`);
  }
  console.log(`${plan.join('\n')}\n\n已写入 ${writes.length} 个设置文件（JSON 会重排成 2 空格缩进，内容不变）。新开的 Claude Code / Codex 会话才生效；Claude 里可用 /hooks 查看，Codex 第一次可能要你确认信任这两个 hook。然后跑 node tools/doctor.mjs 核对。`);
  return 0;
}

if (isEntry(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`安装中断：${err.message}`);
    process.exitCode = 1;
  }
}
