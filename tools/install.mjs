#!/usr/bin/env node
// 把 agent-kit 的机器执行层装进本机的 Claude Code 和 Codex（第 1、2 件）。
//   node tools/install.mjs            只预览会改什么，不写任何文件
//   node tools/install.mjs --apply    真正写入；写之前把原文件备份成 *.bak-agent-kit-<时间>
//   node tools/install.mjs --uninstall [--apply]   去掉 agent-kit 加的东西，别的设置原样保留
//   --only claude | --only codex      只装一边
// 改的文件：~/.claude/settings.json（permissions.ask 和 hooks.PreToolUse）、
//          ~/.codex/hooks.json（hooks.PreToolUse）、~/.codex/rules/agent-kit.rules。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_FILES = ['guard-git.mjs', 'lessons-remind.mjs'];

export const isOurHook = h => typeof h?.command === 'string' && HOOK_FILES.some(f => h.command.includes(`hooks/${f}`));

// Homebrew 的 node 真实路径带版本号（/opt/homebrew/Cellar/node/<版本>/bin/node），升级后旧路径会消失、hook 就静默失效；
// 优先用不随版本变的入口。
export function stableNode(execPath = process.execPath, exists = fs.existsSync) {
  if (!execPath.includes('/Cellar/')) return execPath;
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) if (exists(p)) return p;
  return execPath;
}

const cmd = (node, file) => `"${node}" "${path.join(KIT, 'hooks', file)}"`;

export function ourHookGroups(tool, node = stableNode()) {
  const remindMatcher = tool === 'claude' ? 'Bash|Edit|Write|MultiEdit|NotebookEdit' : 'Bash|apply_patch|Edit|Write';
  return [
    { matcher: 'Bash', hooks: [{ type: 'command', command: cmd(node, 'guard-git.mjs') }] },
    { matcher: remindMatcher, hooks: [{ type: 'command', command: cmd(node, 'lessons-remind.mjs') }] },
  ];
}

// 去掉已有的 agent-kit hook（别人的 hook 原样保留），再按需加上新的
export function mergeHooks(config, groups, { remove = false } = {}) {
  const out = structuredClone(config || {});
  out.hooks ||= {};
  const kept = (out.hooks.PreToolUse || [])
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isOurHook(h)) }))
    .filter(g => g.hooks.length);
  out.hooks.PreToolUse = remove ? kept : [...kept, ...groups];
  if (!out.hooks.PreToolUse.length) delete out.hooks.PreToolUse;
  if (!Object.keys(out.hooks).length) delete out.hooks;
  return out;
}

export function mergeAsk(settings, rules, { remove = false } = {}) {
  const out = structuredClone(settings || {});
  out.permissions ||= {};
  const cur = out.permissions.ask || [];
  out.permissions.ask = remove ? cur.filter(r => !rules.includes(r)) : [...cur, ...rules.filter(r => !cur.includes(r))];
  if (!out.permissions.ask.length) delete out.permissions.ask;
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

function writeWithBackup(file, content, plan) {
  if (fs.existsSync(file)) {
    const bak = `${file}.bak-agent-kit-${stamp()}`;
    fs.copyFileSync(file, bak);
    plan.push(`  已备份 ${file} → ${bak}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// 装之前先让两个 hook 各跑一次，确认在这台电脑上能用
export function selfTest(node = process.execPath) {
  const run = (file, input, env = {}) =>
    spawnSync(node, [path.join(KIT, 'hooks', file)], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: { ...process.env, AGENT_KIT_NO_LOG: '1', ...env },
      timeout: 10000,
    });
  const problems = [];
  const g = run('guard-git.mjs', { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } });
  if (g.status !== 0 || !String(g.stdout).includes('"deny"')) problems.push(`guard-git 没拦下强推 main（退出码 ${g.status}，${g.stderr || g.stdout}）`);
  const r = run('lessons-remind.mjs', { session_id: `selftest-${process.pid}-${Date.now()}`, tool_name: 'Bash', tool_input: { command: 'launchctl bootstrap gui/501 x.plist' } });
  if (r.status !== 0 || !String(r.stdout).includes('G-05')) problems.push(`lessons-remind 没对 launchctl 给出 G-05 提醒（退出码 ${r.status}，${r.stderr || r.stdout}）`);
  return problems;
}

export function main(argv = process.argv.slice(2), home = os.homedir(), env = process.env) {
  const apply = argv.includes('--apply');
  const remove = argv.includes('--uninstall');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;
  const doClaude = !only || only === 'claude';
  const doCodex = !only || only === 'codex';
  const plan = [];

  if (!remove) {
    const problems = selfTest();
    if (problems.length) {
      console.error(`自检没通过，什么都没改：\n- ${problems.join('\n- ')}`);
      return 1;
    }
    plan.push('自检通过：guard-git 拦下了强推 main，lessons-remind 对 launchctl 给出了 G-05 提醒。');
  }

  const writes = [];
  if (doClaude) {
    const file = path.join(home, '.claude', 'settings.json');
    const before = readJson(file);
    const ask = JSON.parse(fs.readFileSync(path.join(KIT, 'config', 'claude-permissions.json'), 'utf8')).ask;
    const after = mergeHooks(mergeAsk(before, ask, { remove }), ourHookGroups('claude'), { remove });
    const added = (after.permissions?.ask || []).filter(r => !(before.permissions?.ask || []).includes(r));
    plan.push(`Claude Code：${file}`);
    plan.push(remove ? '  去掉 agent-kit 的 permissions.ask 规则和 2 个 hook' : `  permissions.ask 新增 ${added.length} 条（已有的不重复加）；hooks.PreToolUse 放入 guard-git、lessons-remind（旧的 agent-kit hook 先去掉）`);
    if (JSON.stringify(before) !== JSON.stringify(after)) writes.push([file, `${JSON.stringify(after, null, 2)}\n`]);
    else plan.push('  没有变化');
  }
  if (doCodex) {
    const codexHome = env.CODEX_HOME || path.join(home, '.codex');
    const file = path.join(codexHome, 'hooks.json');
    const before = readJson(file);
    const after = mergeHooks(before, ourHookGroups('codex'), { remove });
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
        plan.push('  复制 config/codex/agent-kit.rules（先问再执行的 git / gh 操作）');
        writes.push([rules, src]);
      }
    }
  }

  if (!apply) {
    console.log(`${plan.join('\n')}\n\n以上只是预览，没有改任何文件。确认后加 --apply 再跑一次。`);
    return 0;
  }
  for (const [file, content] of writes) {
    if (content === null) {
      fs.copyFileSync(file, `${file}.bak-agent-kit-${stamp()}`);
      fs.rmSync(file);
    } else writeWithBackup(file, content, plan);
  }
  console.log(`${plan.join('\n')}\n\n已写入 ${writes.length} 个文件。新开的 Claude Code / Codex 会话才生效；Claude 里可用 /hooks 查看，Codex 第一次可能要你确认信任这两个 hook。然后跑 node tools/doctor.mjs 核对。`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`安装中断，没有写入：${err.message}`);
    process.exitCode = 1;
  }
}
