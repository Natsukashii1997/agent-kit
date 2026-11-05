import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { decide, hookOutput } from '../hooks/guard-git.mjs';

const onBranch = b => ({ currentBranch: () => b });
const denied = (cmd, opts = onBranch('feature')) => decide(cmd, opts)?.decision === 'deny';

test('强推或删除 main/master：拦下', () => {
  for (const cmd of [
    'git push --force origin main',
    'git push -f origin master',
    'git push origin main --force',
    'git push origin +main',
    'git push origin +HEAD:main',
    'git push --force-with-lease origin main',
    'git push -fu origin main',
    'git push origin HEAD:refs/heads/main -f',
    'git -C ../repo push --force origin main',
    'cd repo && git push -f origin main',
    'FOO=1 timeout 30 git push --force origin main',
    'git push origin --delete main',
    'git push origin :main',
    'git push --force --all origin',
    'env X=1 git push -f origin main',
    'bash -c "git push -f origin main"',
    'sh -lc "cd repo && git push --force origin master"',
  ])
    assert.ok(denied(cmd), cmd);
});

test('当前在 main 上、没写分支名的强推：拦下', () => {
  assert.ok(denied('git push -f', onBranch('main')));
  assert.ok(denied('git push -f origin HEAD', onBranch('main')));
  assert.ok(!denied('git push -f', onBranch('feature')));
  assert.ok(!denied('git push -f', onBranch(null)));
});

test('当前在 main 上、没写分支名或写 HEAD 的普通推送：先问（规则认不出这种写法）', () => {
  const asked = (cmd, br) => decide(cmd, onBranch(br))?.decision === 'ask';
  for (const cmd of ['git push', 'git push origin', 'git push origin HEAD', 'git push -u origin HEAD', 'bash -c "git push"']) assert.ok(asked(cmd, 'main'), cmd);
  assert.ok(asked('git push origin HEAD:master', 'feature') === false, '写死 HEAD:master 的交给权限规则');
  for (const cmd of ['git push', 'git push -u origin HEAD']) assert.ok(!asked(cmd, 'claude/9-x'), cmd);
});

test('先问在 Codex 里不输出（Codex 的 hook 不支持 ask），拒绝照常输出', () => {
  assert.equal(hookOutput({ decision: 'ask', reason: 'x' }, 'codex'), '');
  assert.match(hookOutput({ decision: 'ask', reason: 'x' }, 'claude'), /"permissionDecision":"ask"/);
  assert.match(hookOutput({ decision: 'deny', reason: 'x' }, 'codex'), /"permissionDecision":"deny"/);
});

test('正常操作：不管（要问的交给权限规则）', () => {
  for (const cmd of [
    'git push origin main',
    'git push -u origin claude/9-report',
    'git push --force-with-lease origin claude/9-report',
    'git push -f origin feature/main-page',
    'git push origin domain',
    'git status',
    'echo "git push -f origin main" > notes.txt',
    'gh pr merge 9 --squash',
    'git log origin/main..main',
  ])
    assert.ok(!denied(cmd), cmd);
});

test('输出是 PreToolUse 的 deny JSON；不拦时不输出', () => {
  const out = JSON.parse(hookOutput({ decision: 'deny', reason: 'x' }));
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(hookOutput(null), '');
});

test('作为 hook 真跑：读标准输入、输出 JSON、退出码 0', () => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard-git.mjs');
  const run = command => spawnSync(process.execPath, [file], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8' });
  const bad = run('git push -f origin main');
  assert.equal(bad.status, 0);
  assert.match(bad.stdout, /"permissionDecision":"deny"/);
  const fine = run('git status');
  assert.equal(fine.status, 0);
  assert.equal(fine.stdout, '');
  const garbage = spawnSync(process.execPath, [file], { input: 'not json', encoding: 'utf8' });
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout, '');
});
