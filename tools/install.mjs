#!/usr/bin/env node
// 把 agent-kit 的机器执行层装进本机的 Claude Code 和 Codex（第 1、2 件）。
//   node tools/install.mjs            只预览会改什么，不写任何文件
//   node tools/install.mjs --apply    真正写入
//   node tools/install.mjs --uninstall [--apply]   去掉 agent-kit 加的东西，别的设置原样保留
//   --only claude | --only codex      只装一边
//   --allow-any-branch                允许不在 main 上装（只给测试和有意为之时用）
// 改的文件：~/.claude/settings.json（permissions.deny / ask、hooks.PreToolUse、hooks.PostToolUse 里的 skill-usage、
//          hooks.UserPromptSubmit 里的 thinking-review-nudge 和首轮整理、hooks.SessionStart 里的首轮整理）、
//          ~/.codex/hooks.json（hooks.PreToolUse）、~/.codex/rules/agent-kit.rules。
// 首轮整理钩子（#65）的真实配置放状态目录 session-organize-once/config.json，不进仓库；没有时从旧位置迁移或拷示例，已有的不覆盖。
// 写之前把原文件备份到状态目录 backups/<时间>/；hook 脚本和 LESSONS.md 复制到状态目录 runtime/ 再指向那里，
// 这样主目录换分支、停在冲突里、worktree 被删，都不影响已经装好的 hook。改了 hooks/ 或 LESSONS.md 要在 main 上重装才生效。
// 本次新增了哪些权限规则记在状态目录 install-manifest.json，卸载只删这些，你自己原有的同名规则不动。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntry, stateDir } from '../hooks/lib/common.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORGANIZE = 'session-organize-once/session_organize_once.py';
// 旧路径 ~/.claude/hooks/session-organize-once/… 也带「hooks/session-organize-once/…」，重装时会被认出来换掉
const HOOK_FILES = ['guard-git.mjs', 'lessons-remind.mjs', 'skill-usage.mjs', 'thinking-review-nudge.mjs', 'bash-precheck.mjs', ORGANIZE];
const TIMEOUT_SEC = 10;
const ORGANIZE_TIMEOUT_SEC = 5;
export const ORGANIZE_LEGACY_DIR = home => path.join(home, '.claude', 'hooks', 'session-organize-once');

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

// 用户发消息时的 hook（UserPromptSubmit）：只有 Claude 的 thinking-review 准入提醒（#35）和首轮整理（#65）
export function ourPromptGroups(tool, node = stableNode(), base = KIT, python = stablePython()) {
  if (tool !== 'claude') return [];
  return [
    { hooks: [{ type: 'command', command: `"${node}" "${path.join(base, 'hooks', 'thinking-review-nudge.mjs')}"`, timeout: TIMEOUT_SEC }] },
    { hooks: [organizeHook(python, base)] },
  ];
}

// 调用后记账的 hook（PostToolUse）：目前只有 Claude 的 skill 调用日志；Codex 没有 Skill 工具，由 my-skills 月度体检读会话记录补
export function ourPostGroups(tool, node = stableNode(), base = KIT) {
  if (tool !== 'claude') return [];
  return [{ matcher: 'Skill', hooks: [{ type: 'command', command: `"${node}" "${path.join(base, 'hooks', 'skill-usage.mjs')}"`, timeout: TIMEOUT_SEC }] }];
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
  const r = run('lessons-remind.mjs', { session_id: 'selftest', tool_name: 'Bash', tool_input: { command: 'launchctl bootstrap gui/501 x.plist' } });
  if (r.status !== 0 || !String(r.stdout).includes('G-05')) problems.push(`lessons-remind 没对 launchctl 给出 G-05 提醒（退出码 ${r.status}，${r.stderr || r.stdout}）`);
  const s = run('skill-usage.mjs', { session_id: 'selftest', tool_name: 'Skill', tool_input: { skill: 'selftest' } });
  if (s.status !== 0) problems.push(`skill-usage 跑不起来（退出码 ${s.status}，${s.stderr || s.stdout}）`);
  const t = run('thinking-review-nudge.mjs', { session_id: 'selftest', hook_event_name: 'UserPromptSubmit', prompt: '这个思维评审一下' });
  if (t.status !== 0 || !String(t.stdout).includes('thinking-review')) problems.push(`thinking-review-nudge 没对「思维评审」给出提醒（退出码 ${t.status}，${t.stderr || t.stdout}）`);
  const b = run('bash-precheck.mjs', { tool_name: 'Bash', tool_input: { command: 'cd /x && rm -f "$O"/*.zip' } });
  if (b.status !== 0 || !String(b.stdout).includes('"deny"')) problems.push(`bash-precheck 没拦下 rm 变量加通配符（退出码 ${b.status}，${b.stderr || b.stdout}）`);
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
  return problems;
}

// 只从 main 上、没有未提交改动的主目录安装：hook 会在所有会话的每条命令前运行，必须是审过、合并过的版本
export function branchProblem(kit = KIT) {
  const git = args => spawnSync('git', ['-C', kit, ...args], { encoding: 'utf8' });
  const br = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (br.status !== 0) return '这个目录不是 git 仓库，认不出是不是 main 上的版本';
  if (br.stdout.trim() !== 'main') return `当前在 ${br.stdout.trim()} 分支上，不是 main`;
  const dirty = git(['status', '--porcelain', '--', 'hooks', 'config', 'global', 'LESSONS.md']).stdout.trim();
  if (dirty) return `hooks/、config/、global/ 或 LESSONS.md 有没提交的改动：\n${dirty}`;
  return null;
}

export function copyRuntime(dest, kit = KIT) {
  const hooks = path.join(kit, 'hooks');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  // 只看 hooks/ 以下的相对路径：仓库本身放在 .claude/worktrees/ 这类点开头的目录里时，不能整份跳过；Python 缓存也不复制
  fs.cpSync(hooks, path.join(dest, 'hooks'), { recursive: true, filter: src => !path.relative(hooks, src).split(path.sep).some(p => p.startsWith('.') || p === '__pycache__') });
  fs.copyFileSync(path.join(kit, 'LESSONS.md'), path.join(dest, 'LESSONS.md'));
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
    plan.push('自检通过：guard-git 拦下了强推 main，lessons-remind 对 launchctl 给出了 G-05 提醒，skill-usage 能跑，thinking-review-nudge 对「思维评审」给出了提醒，bash-precheck 拦下了 rm 变量加通配符，首轮整理钩子用 Python 跑通。');
    plan.push(`hook 脚本和 LESSONS.md 复制到 ${runtime}，设置里指向那里。`);
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
    after = mergeHooks(after, ourPostGroups('claude', stableNode(), runtime), { remove, event: 'PostToolUse' });
    after = mergeHooks(after, ourPromptGroups('claude', stableNode(), runtime), { remove, event: 'UserPromptSubmit' });
    after = mergeHooks(after, ourStartGroups('claude', stablePython(), runtime), { remove, event: 'SessionStart' });
    plan.push(`Claude Code：${file}`);
    if (!remove) plan.push(`  ${ensureOrganizeConfig(sd, home)}`);
    if (remove) {
      plan.push(manifest.claude ? `  去掉安装时加的 ${(manifest.claude.deny || []).length} 条 deny、${(manifest.claude.ask || []).length} 条 ask 规则和 8 组 hook；你原有的同名规则不动；首轮整理配置留在状态目录` : '  找不到安装记录，权限规则不动（只去掉 8 组 hook）');
      delete nextManifest.claude;
    } else {
      const n = key => nextManifest.claude[key].filter(r => !(before.permissions?.[key] || []).includes(r)).length;
      const gone = key => (before.permissions?.[key] || []).filter(r => !(after.permissions?.[key] || []).includes(r)).length;
      plan.push(`  permissions.deny 新增 ${n('deny')} 条、去掉 ${gone('deny')} 条，permissions.ask 新增 ${n('ask')} 条、去掉 ${gone('ask')} 条（已有的不重复加；去掉的是以前装进去、配置里已删的）；hooks.PreToolUse 放入 guard-git、lessons-remind、thinking-review-nudge、bash-precheck，hooks.PostToolUse 放入 skill-usage，hooks.UserPromptSubmit 放入 thinking-review-nudge 和首轮整理，hooks.SessionStart 放入首轮整理（旧的 agent-kit hook 和 ~/.claude/hooks 下的旧首轮整理先去掉）`);
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
    else fs.rmSync(runtime, { recursive: true, force: true });
    if (nextManifest.claude) fs.writeFileSync(manifestFile, `${JSON.stringify(nextManifest, null, 2)}\n`);
    else fs.rmSync(manifestFile, { force: true });
  } else {
    if (doClaude) ensureOrganizeConfig(sd, home, { write: true });
    copyRuntime(runtime);
    nextManifest.kit = KIT;
    nextManifest.installedAt = new Date().toISOString();
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
