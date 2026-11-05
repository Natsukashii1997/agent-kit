import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isOurHook, main, mergeHooks, mergeRules, ourHookGroups, selfTest } from '../tools/install.mjs';

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
  assert.equal(once.hooks.PreToolUse.filter(g => g.hooks.some(isOurHook)).length, 2);
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

test('整套安装：预览不写文件；--apply 写入并备份；--uninstall 还原', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-home-'));
  const env = {};
  const settings = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  const original = { permissions: { allow: ['Bash(npm test)'] }, autoMemoryEnabled: false };
  fs.writeFileSync(settings, JSON.stringify(original));

  assert.equal(quiet(() => main([], home, env)), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), original, '预览不改文件');
  assert.ok(!fs.existsSync(path.join(home, '.codex')));

  assert.equal(quiet(() => main(['--apply'], home, env)), 0);
  const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.deepEqual(after.permissions.allow, ['Bash(npm test)']);
  assert.equal(after.autoMemoryEnabled, false);
  assert.ok(after.permissions.ask.includes('Bash(gh pr merge *)'));
  assert.ok(after.permissions.deny.includes('Bash(git push --force * main)'));
  assert.equal(after.hooks.PreToolUse.length, 2);
  assert.ok(fs.readdirSync(path.dirname(settings)).some(f => f.startsWith('settings.json.bak-agent-kit-')));
  const codexHooks = JSON.parse(fs.readFileSync(path.join(home, '.codex', 'hooks.json'), 'utf8'));
  assert.equal(codexHooks.hooks.PreToolUse.length, 2);
  assert.ok(fs.existsSync(path.join(home, '.codex', 'rules', 'agent-kit.rules')));

  assert.equal(quiet(() => main(['--uninstall', '--apply'], home, env)), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), original);
  assert.ok(!fs.existsSync(path.join(home, '.codex', 'rules', 'agent-kit.rules')));
});

test('settings.json 坏了：不写，报错', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-home-'));
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{ broken');
  assert.throws(() => quiet(() => main(['--apply', '--only', 'claude'], home, {})), /不是合法 JSON/);
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), '{ broken');
});

test('Homebrew 的 node 换成不随版本变的入口', async () => {
  const { stableNode } = await import('../tools/install.mjs');
  assert.equal(stableNode('/opt/homebrew/Cellar/node/22.9.0/bin/node', p => p === '/opt/homebrew/bin/node'), '/opt/homebrew/bin/node');
  assert.equal(stableNode('/usr/local/bin/node', () => true), '/usr/local/bin/node');
  assert.equal(stableNode('/opt/homebrew/Cellar/node/22.9.0/bin/node', () => false), '/opt/homebrew/Cellar/node/22.9.0/bin/node');
});
