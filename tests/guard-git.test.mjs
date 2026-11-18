import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { decide, hookOutput } from '../hooks/guard-git.mjs';
import { pushLeakFixture } from '../tools/doctor.mjs';

// 只测命令解析的用例不碰真仓库：推送前检查（#76）换成「没带出提交」的桩，结果不随本机仓库状态变
const onBranch = b => ({ currentBranch: () => b, leakedCommits: () => null });
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

test('当前在 main 上、没写分支名或写 HEAD 的普通推送：不管（#27 起 Claude 侧不再先问）', () => {
  for (const cmd of ['git push', 'git push origin', 'git push origin HEAD', 'git push -u origin HEAD', 'bash -c "git push"'])
    assert.equal(decide(cmd, onBranch('main')), null, cmd);
});

test('正常操作：不管', () => {
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

test('经符号链接的路径启动也照样拦（macOS 的 /var 就是指向 /private/var 的链接）', () => {
  const hooks = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks');
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ak-link-')), 'hooks');
  fs.symlinkSync(hooks, link);
  const r = spawnSync(process.execPath, [path.join(link, 'guard-git.mjs')], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push -f origin main' } }), encoding: 'utf8' });
  assert.match(r.stdout, /"permissionDecision":"deny"/, '入口判断认不出自己时，hook 什么都不做、直接放行');
});

// ---------- 推送前检查（#76）：本地 main 有没推的提交，要推的分支带着它们 ----------

const run = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input: opts?.input, env: { ...process.env, ...(opts?.env || {}) } });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};
const withFixture = fn => {
  const fx = pushLeakFixture(run);
  try {
    fn(fx);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
};

test('重现 2026-10-27：本地 main 领先 origin/main 3 个提交，从它拉分支再推，拦下并写清原因和做法', () => {
  withFixture(({ root, work }) => {
    const r = decide('git push -u origin claude/probe', { cwd: work });
    assert.equal(r?.decision, 'deny');
    assert.match(r.reason, /要推的 claude\/probe 带着本地 main 上 3 个还没推到 origin\/main 的提交/);
    for (const i of [1, 2, 3]) assert.match(r.reason, new RegExp(`别的会话没推的提交 ${i}`));
    assert.ok(!r.reason.includes('分支自己的提交'), '只列本地 main 上没推的，不列分支自己的');
    assert.match(r.reason, /git switch -c <新分支> origin\/main/);
    assert.match(r.reason, /先推 main（《工程流程》第 5 节第 1 步）/);
    // 各种写法都认：git -C、参数乱序、cd 进去再推、不写分支名、写 HEAD、换个远端分支名、bash -c、gh pr create。
    // 认不出：bash -c "cd 别处 && git push"（公共分词先按 && 切开，引号不起作用，见 docs/机器执行层.md「已知漏洞」）
    for (const [cmd, cwd] of [
      [`git -C ${work} push origin claude/probe`, root],
      [`git -C work push origin claude/probe`, root],
      ['git push origin claude/probe -u', work],
      ['git push --set-upstream origin claude/probe', work],
      [`cd ${work} && git push -u origin claude/probe`, root],
      [`cd work && git push`, root],
      ['git push', work],
      ['git push origin HEAD', work],
      ['git push origin HEAD:refs/heads/claude/other', work],
      ['git push origin main:claude/other', work],
      ['git push --force-with-lease origin claude/probe', work],
      [`bash -c "git -C ${work} push -u origin claude/probe"`, root],
      ['gh pr create --fill', work],
      ['gh pr create --base main --head claude/probe --title x', work],
      ['gh pr create -H someone:claude/probe', work],
    ])
      assert.equal(decide(cmd, { cwd })?.decision, 'deny', cmd);
    const prReason = decide('gh pr create --fill', { cwd: work }).reason;
    assert.match(prReason, /要开 PR 的 claude\/probe/);
  });
});

test('推送前检查：作为 hook 真跑也拦（输出 deny JSON、退出码 0）', () => {
  withFixture(({ work }) => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard-git.mjs');
    const r = spawnSync(process.execPath, [file], { input: JSON.stringify({ tool_name: 'Bash', cwd: work, tool_input: { command: 'git push -u origin claude/probe' } }), encoding: 'utf8' });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    assert.equal(out.permissionDecision, 'deny');
    assert.match(out.permissionDecisionReason, /origin\/main/);
  });
});

test('推送前检查不该拦的：从 origin/main 拉的分支、推 main 本身、main 推上去以后、强推规则照旧优先', () => {
  withFixture(({ work, git }) => {
    // 正确做法：从 origin/main 重新拉分支
    git('-C', work, 'switch', '-q', '-c', 'claude/clean', 'origin/main');
    git('-C', work, 'commit', '-q', '--allow-empty', '-m', '只有自己的提交');
    for (const cmd of ['git push -u origin claude/clean', 'git push', 'git push origin HEAD', 'gh pr create --fill'])
      assert.equal(decide(cmd, { cwd: work }), null, cmd);
    // 推 main 本身归《工程流程》5.1 管，不归这一条；--all / --tags / 删除远端分支也不归
    for (const cmd of ['git push origin main', 'git push origin HEAD:main', 'git push --all origin', 'git push --tags', 'git push origin --delete claude/probe', 'git push origin :claude/probe'])
      assert.equal(decide(cmd, { cwd: work }), null, cmd);
    // 在 main 上 gh pr create：不管（gh 自己会拒）
    git('-C', work, 'switch', '-q', 'main');
    assert.equal(decide('gh pr create --fill', { cwd: work }), null);
    // 强推 main 仍按原规则拦，理由是强推
    assert.match(decide('git push -f origin main', { cwd: work }).reason, /强推到 main/);
    // 常浩同意后先推了 main：分支不再带着没推的提交，放行
    git('-C', work, 'push', '-q', 'origin', 'main');
    assert.equal(decide('git push -u origin claude/probe', { cwd: work }), null);
    assert.equal(decide('gh pr create --head claude/probe', { cwd: work }), null);
  });
});

test('推送前检查不该拦的：分离头指针、没有 origin/main、没有远端、不在仓库里、分支不存在', () => {
  withFixture(({ root, work, git }) => {
    git('-C', work, 'switch', '-q', '--detach', 'claude/probe');
    for (const cmd of ['git push', 'git push origin HEAD:refs/heads/claude/x', 'gh pr create --fill'])
      assert.equal(decide(cmd, { cwd: work }), null, `分离头指针：${cmd}`);
    git('-C', work, 'switch', '-q', 'claude/probe');
    assert.equal(decide('git push origin claude/nope', { cwd: work }), null, '分支不存在：git 出错就不拦');
    // 有远端、但从没取到 origin/main（引用删掉）
    git('-C', work, 'update-ref', '-d', 'refs/remotes/origin/main');
    assert.equal(decide('git push -u origin claude/probe', { cwd: work }), null, '没有 origin/main');
    // 没有远端
    git('-C', work, 'remote', 'remove', 'origin');
    assert.equal(decide('git push -u origin claude/probe', { cwd: work }), null, '没有远端');
    // 不在仓库里
    const plain = fs.mkdtempSync(path.join(root, 'plain-'));
    assert.equal(decide('git push -u origin claude/probe', { cwd: plain }), null, '不在仓库里');
    assert.equal(decide('gh pr create --fill', { cwd: plain }), null, '不在仓库里');
  });
});

test('推送前检查：用桩确认解析出的来源分支和所在目录', () => {
  const calls = [];
  const opts = { cwd: '/w/repo', currentBranch: () => 'claude/x', leakedCommits: (dir, src) => (calls.push([dir, src]), null) };
  for (const cmd of ['git push -u origin claude/x', 'git -C ../other push origin feat:claude/y', 'cd /w/b && git push', 'gh pr create -H me:claude/z', 'git push origin +claude/x'])
    assert.equal(decide(cmd, opts), null, cmd);
  assert.deepEqual(calls, [
    ['/w/repo', 'claude/x'],
    ['/w/other', 'feat'],
    ['/w/b', 'claude/x'],
    ['/w/repo', 'claude/z'],
    ['/w/repo', 'claude/x'],
  ]);
  // 带出了提交就拦，理由里列提交，超过 5 个只列前 5 个
  const leak = { base: 'main', unpushed: 7, commits: Array.from({ length: 7 }, (_, i) => ({ short: `c${i}`, subject: `提交 ${i}` })) };
  const r = decide('git push -u origin claude/x', { ...opts, leakedCommits: () => leak });
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /c4 提交 4/);
  assert.ok(!r.reason.includes('c5 提交 5'));
  assert.match(r.reason, /另有 2 个/);
});
