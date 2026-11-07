import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { branchProblem, copyRuntime, isOurHook, main, mergeHooks, mergeRules, ourHookGroups, selfTest } from '../tools/install.mjs';

const quiet = fn => {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = err;
  }
};

test('合并 hook：保留别人的 hook，重复安装不会叠加', () => {
  const theirs = { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-own-check.sh' }] };
  const start = { model: 'x', hooks: { PreToolUse: [theirs], Stop: [{ hooks: [{ type: 'command', command: 'notify' }] }] } };
  const once = mergeHooks(start, ourHookGroups('claude', '/n'));
  const twice = mergeHooks(once, ourHookGroups('claude', '/n'));
  assert.deepEqual(twice, once);
  assert.equal(once.model, 'x');
  assert.deepEqual(once.hooks.Stop, start.hooks.Stop);
  assert.deepEqual(once.hooks.PreToolUse[0], theirs);
  assert.equal(once.hooks.PreToolUse.filter(g => g.hooks.some(isOurHook)).length, 3, 'guard-git、lessons-remind、thinking-review-nudge');
  assert.equal(mergeHooks(start, ourHookGroups('codex', '/n')).hooks.PreToolUse.filter(g => g.hooks.some(isOurHook)).length, 2, 'Codex 没有 thinking-review');
  const removed = mergeHooks(once, [], { remove: true });
  assert.deepEqual(removed, start);
});

test('合并先问规则：去重，卸载只去掉自己加的', () => {
  const start = { permissions: { allow: ['Bash(npm test)'], ask: ['Bash(rm *)'] } };
  const once = mergeRules(start, 'ask', ['Bash(gh pr merge *)', 'Bash(rm *)']);
  assert.deepEqual(once.permissions.ask, ['Bash(rm *)', 'Bash(gh pr merge *)']);
  assert.deepEqual(mergeRules(once, 'ask', ['Bash(gh pr merge *)']), once);
  assert.deepEqual(mergeRules(once, 'ask', ['Bash(gh pr merge *)'], { remove: true }), start);
  const denied = mergeRules(once, 'deny', ['Bash(git push --force * main)']);
  assert.deepEqual(denied.permissions.deny, ['Bash(git push --force * main)']);
  assert.deepEqual(denied.permissions.allow, ['Bash(npm test)']);
});

test('自检能在本机跑通', () => {
  assert.deepEqual(selfTest(), []);
});

test('不在 main 上：预览照常，--apply 拒绝且不写文件', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-home-'));
  const env = { AGENT_KIT_STATE_DIR: path.join(home, 'state') };
  if (!branchProblem()) return; // 本仓库此刻就在 main 上时跳过
  assert.equal(quiet(() => main([], home, env)), 0);
  assert.equal(quiet(() => main(['--apply'], home, env)), 1);
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'settings.json')));
});

test('整套安装：预览不写；--apply 写入、备份到状态目录、hook 指向副本；卸载只删自己加的规则', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-home-'));
  const state = path.join(home, 'state');
  const env = { AGENT_KIT_STATE_DIR: state };
  const settings = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  // 用户原本就有一条和 agent-kit 同名的规则
  const original = { permissions: { allow: ['Bash(npm test)'], ask: ['Bash(git reset --hard *)'] }, autoMemoryEnabled: false };
  fs.writeFileSync(settings, JSON.stringify(original));
  const args = extra => [...extra, '--allow-any-branch'];

  assert.equal(quiet(() => main(args([]), home, env)), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), original, '预览不改文件');
  assert.ok(!fs.existsSync(path.join(home, '.codex')));
  assert.ok(!fs.existsSync(path.join(state, 'runtime')));

  assert.equal(quiet(() => main(args(['--apply']), home, env)), 0);
  const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.deepEqual(after.permissions.allow, ['Bash(npm test)']);
  assert.equal(after.autoMemoryEnabled, false);
  assert.deepEqual(after.permissions.ask, ['Bash(git reset --hard *)'], '#27 起不加先问规则，原有的不动');
  assert.ok(after.permissions.deny.includes('Bash(git push --force * main)'));
  assert.equal(after.hooks.PreToolUse.length, 3);
  assert.equal(after.hooks.PreToolUse[2].matcher, 'Edit|Write|MultiEdit|NotebookEdit|ExitPlanMode');
  assert.equal(after.hooks.UserPromptSubmit.length, 1);
  assert.ok(after.hooks.UserPromptSubmit[0].hooks[0].command.endsWith('thinking-review-nudge.mjs"'));
  const cmds = after.hooks.PreToolUse.flatMap(g => g.hooks);
  assert.ok(cmds.every(h => h.command.includes(path.join(state, 'runtime', 'hooks')) && h.timeout === 10));
  assert.ok(fs.existsSync(path.join(state, 'runtime', 'LESSONS.md')));
  assert.ok(fs.existsSync(path.join(state, 'runtime', 'hooks', 'lib', 'common.mjs')));
  assert.equal(fs.readdirSync(path.dirname(settings)).filter(f => f.includes('bak')).length, 0, '备份不留在 ~/.claude 里');
  assert.equal(fs.readdirSync(path.join(state, 'backups')).length, 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(state, 'install-manifest.json'), 'utf8'));
  assert.ok(!manifest.claude.ask.includes('Bash(git reset --hard *)'), '原有的同名规则不记成自己加的');
  const codexHooks = JSON.parse(fs.readFileSync(path.join(home, '.codex', 'hooks.json'), 'utf8'));
  assert.ok(codexHooks.hooks.PreToolUse[0].hooks[0].command.endsWith('guard-git.mjs"'));
  assert.ok(fs.existsSync(path.join(home, '.codex', 'rules', 'agent-kit.rules')));

  // 装好的 hook 照设置里的命令原样跑得起来
  const guard = spawnSync('/bin/sh', ['-c', cmds[0].command], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push -f origin main' } }), encoding: 'utf8' });
  assert.match(guard.stdout, /"deny"/);
  const nudge = spawnSync('/bin/sh', ['-c', after.hooks.UserPromptSubmit[0].hooks[0].command], { input: JSON.stringify({ session_id: 's', hook_event_name: 'UserPromptSubmit', prompt: '这个思维评审一下' }), encoding: 'utf8', env: { ...process.env, ...env } });
  assert.match(nudge.stdout, /thinking-review/);

  assert.equal(quiet(() => main(args(['--apply']), home, env)), 0, '重复安装');
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), after, '重复安装不改设置');

  assert.equal(quiet(() => main(['--uninstall', '--apply'], home, env)), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), original, '卸载后原有的同名规则还在');
  assert.ok(!fs.existsSync(path.join(home, '.codex', 'rules', 'agent-kit.rules')));
  assert.deepEqual(fs.readdirSync(path.join(home, '.codex', 'rules')), [], '规则目录里不留备份');
  assert.ok(!fs.existsSync(path.join(state, 'runtime')));
  assert.ok(!fs.existsSync(path.join(state, 'install-manifest.json')));
});

test('重装：以前装时加的、配置里已去掉的先问规则一并去掉，你自己的不动', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-home-'));
  const state = path.join(home, 'state');
  const settings = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ permissions: { ask: ['Bash(rm *)', 'Bash(gh pr merge *)', 'Bash(git clean *)'] } }));
  fs.writeFileSync(path.join(state, 'install-manifest.json'), JSON.stringify({ claude: { deny: [], ask: ['Bash(gh pr merge *)', 'Bash(git clean *)'] } }));
  assert.equal(quiet(() => main(['--apply', '--only', 'claude', '--allow-any-branch'], home, { AGENT_KIT_STATE_DIR: state })), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')).permissions.ask, ['Bash(rm *)']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state, 'install-manifest.json'), 'utf8')).claude.ask, []);
});

test('settings.json 坏了：不写，报错', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-home-'));
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{ broken');
  assert.throws(() => quiet(() => main(['--apply', '--only', 'claude', '--allow-any-branch'], home, { AGENT_KIT_STATE_DIR: path.join(home, 'state') })), /不是合法 JSON/);
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), '{ broken');
});

test('Homebrew 的 node 换成不随版本变的入口', async () => {
  const { stableNode } = await import('../tools/install.mjs');
  assert.equal(stableNode('/opt/homebrew/Cellar/node/22.9.0/bin/node', p => p === '/opt/homebrew/bin/node'), '/opt/homebrew/bin/node');
  assert.equal(stableNode('/usr/local/bin/node', () => true), '/usr/local/bin/node');
  assert.equal(stableNode('/opt/homebrew/Cellar/node/22.9.0/bin/node', () => false), '/opt/homebrew/Cellar/node/22.9.0/bin/node');
});

test('复制 hook 副本：仓库路径里有点开头的目录（如 .claude/worktrees）也整份复制，只跳过 hooks 里的隐藏文件', () => {
  const kit = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ak-kit-')), '.claude', 'worktrees', 'x');
  fs.mkdirSync(path.join(kit, 'hooks', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'hooks', 'guard-git.mjs'), '');
  fs.writeFileSync(path.join(kit, 'hooks', 'lib', 'common.mjs'), '');
  fs.writeFileSync(path.join(kit, 'hooks', '.DS_Store'), '');
  fs.writeFileSync(path.join(kit, 'LESSONS.md'), '');
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ak-rt-')), 'runtime');
  copyRuntime(dest, kit);
  assert.deepEqual(fs.readdirSync(path.join(dest, 'hooks'), { recursive: true }).sort(), ['guard-git.mjs', 'lib', 'lib/common.mjs']);
  assert.ok(fs.existsSync(path.join(dest, 'LESSONS.md')));
});
