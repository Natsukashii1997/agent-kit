import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyError, family, paths, record, scan, setConfig, status } from '../tools/quota-guard.mjs';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const FABLE_ERR = "You've hit your Fable limit · resets 2am (Asia/Shanghai). Switch to another model to continue.";

// 假的家目录：桌面会话索引 + 会话记录 + 状态目录
function fake() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-qg-'));
  const env = { AGENT_KIT_STATE_DIR: path.join(home, 'state') };
  const p = paths(env, home);
  fs.mkdirSync(path.join(p.sessions, 'acct', 'org'), { recursive: true });
  fs.mkdirSync(path.join(p.projects, '-Users-x-proj'), { recursive: true });
  return { home, env, p };
}

function addSession(p, { id, model = 'claude-fable-5-2', error = FABLE_ERR, errorAt = NOW - 600e3, tail = 'error', ...rest }) {
  const cli = `cli-${id}`;
  fs.writeFileSync(path.join(p.sessions, 'acct', 'org', `local_${id}.json`), JSON.stringify({ sessionId: `local_${id}`, cliSessionId: cli, model, error, errorAt, title: `会话 ${id}`, permissionMode: 'bypassPermissions', ...rest }));
  const rows = [
    { type: 'user', message: { role: 'user', content: '干活' } },
    { type: 'assistant', isApiErrorMessage: true, error: 'rate_limit', message: { model: '<synthetic>', content: [{ type: 'text', text: error }] } },
    { type: 'queue-operation' },
  ];
  if (tail === 'replied') rows.push({ type: 'user', message: { role: 'user', content: '继续' } });
  if (tail !== 'none') fs.writeFileSync(path.join(p.projects, '-Users-x-proj', `${cli}.jsonl`), `${rows.map(r => JSON.stringify(r)).join('\n')}\n`);
}

test('分清单模型额度、账户额度和别的报错', () => {
  assert.deepEqual(classifyError(FABLE_ERR), { kind: 'model', name: 'Fable' });
  assert.equal(classifyError("You've hit your 5-hour limit · resets 4:10am").kind, 'account');
  assert.equal(classifyError("You've hit your session limit · resets 1:10am").kind, 'account');
  assert.equal(classifyError("You've hit your weekly limit").kind, 'account');
  assert.equal(classifyError('API Error: Connection lost while your computer was asleep').kind, 'other');
  assert.equal(classifyError(undefined).kind, 'other');
  assert.equal(family('claude-fable-5-2'), 'fable');
  assert.equal(family('claude-opus-5-5'), 'opus');
});

test('没设备用模型：只提醒，不换', () => {
  const { p } = fake();
  addSession(p, { id: 'a' });
  const r = scan({ p, now: NOW });
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].action, 'remind');
  assert.equal(r.actions[0].to, null);
  assert.ok(fs.existsSync(p.state), '记下了检查时间');
});

test('设了备用：卡在 Fable 额度上的换到备用；别的情况都不动', () => {
  const { p } = fake();
  setConfig({ p, args: { backup: 'claude-opus-5-5' } });
  addSession(p, { id: 'stuck' });
  addSession(p, { id: 'acct', model: 'claude-opus-5-5', error: "You've hit your 5-hour limit · resets 4:10am (Asia/Shanghai)" });
  addSession(p, { id: 'net', model: 'claude-opus-5-5', error: 'API Error: Connection lost mid-response.' });
  addSession(p, { id: 'arch', isArchived: true });
  addSession(p, { id: 'sched', scheduledTaskId: 'x' });
  addSession(p, { id: 'old', errorAt: NOW - 13 * 3600e3 });
  addSession(p, { id: 'manual', model: 'claude-opus-5-5' }); // 常浩已手动换走
  addSession(p, { id: 'replied', tail: 'replied' }); // 报错后又说了话
  addSession(p, { id: 'notr', tail: 'none' });
  const r = scan({ p, now: NOW });
  assert.deepEqual(r.actions.map(a => [a.sessionId, a.action, a.to]), [['local_stuck', 'switch', 'claude-opus-5-5']]);
  assert.deepEqual(r.skipped, { account: 1, other: 1, archived: 1, scheduled: 1, tooOld: 1, modelChanged: 1, noTranscript: 1, notLast: 1, handled: 0 });
});

test('只转一次：已经在备用模型上又撞额度，停下报错', () => {
  const { p } = fake();
  setConfig({ p, args: { backup: 'claude-opus-5-5' } });
  addSession(p, { id: 'b', model: 'claude-opus-5-5', error: "You've hit your Opus limit · resets 2am (Asia/Shanghai). Switch to another model to continue." });
  const [a] = scan({ p, now: NOW }).actions;
  assert.equal(a.action, 'alert');
  assert.equal(a.to, null);
});

test('处理过的同一次报错不再处理；失败的再试一次，两次才放弃；新的一次报错照常处理', () => {
  const { p } = fake();
  setConfig({ p, args: { backup: 'claude-opus-5-5' } });
  const errorAt = NOW - 600e3;
  addSession(p, { id: 'c', errorAt });
  const fail = () => record({ p, now: NOW, args: { session: 'local_c', 'error-at': String(errorAt), action: 'failed', from: 'claude-fable-5-2', to: 'claude-opus-5-5', note: 'Network error' } });
  fail();
  assert.equal(scan({ p, now: NOW }).actions.length, 1, '失败一次，下一轮再试');
  fail();
  const r = scan({ p, now: NOW });
  assert.equal(r.actions.length, 0);
  assert.equal(r.skipped.handled, 1);
  addSession(p, { id: 'c', errorAt: NOW - 60e3 });
  assert.equal(scan({ p, now: NOW }).actions.length, 1);
});

test('留痕和设置：record 校验动作，status 读得回来，backup none 清掉', () => {
  const { p } = fake();
  assert.throws(() => record({ p, args: { session: 'x', 'error-at': '1', action: 'whatever' } }));
  record({ p, now: NOW, args: { session: 'local_d', 'error-at': '1', action: 'switched', from: 'claude-fable-5-2', to: 'claude-opus-5-5', note: 'Fable 额度用完' } });
  const s = status({ p });
  assert.equal(s.configured, false);
  assert.equal(s.recent[0].action, 'switched');
  assert.equal(s.recent[0].to, 'claude-opus-5-5');
  assert.equal(setConfig({ p, args: { backup: 'claude-opus-5-5', 'max-age-hours': '6' } }).maxAgeHours, 6);
  assert.equal(setConfig({ p, args: { backup: 'none' } }).backupModel, null);
  assert.throws(() => setConfig({ p, args: { 'max-age-hours': '0' } }));
});

test('命令行：scan 输出 JSON，未知命令退出码 2', () => {
  const { home, env } = fake();
  const bin = path.join(import.meta.dirname, '..', 'tools', 'quota-guard.mjs');
  const e = { ...process.env, ...env, HOME: home, QUOTA_GUARD_SESSIONS_DIR: path.join(home, 'none'), QUOTA_GUARD_PROJECTS_DIR: path.join(home, 'none') };
  const ok = spawnSync(process.execPath, [bin, 'scan'], { env: e, encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.deepEqual(JSON.parse(ok.stdout).actions, []);
  assert.equal(spawnSync(process.execPath, [bin, 'nope'], { env: e, encoding: 'utf8' }).status, 2);
});

test('守护自己的花费：只算 24 小时内 quota-guard 的运行，同一条消息只算一次', () => {
  const { p } = fake();
  const run = (id, createdAt, usages) => {
    fs.writeFileSync(path.join(p.sessions, 'acct', 'org', `local_${id}.json`), JSON.stringify({ sessionId: `local_${id}`, cliSessionId: `cli-${id}`, scheduledTaskId: 'quota-guard', createdAt }));
    const rows = usages.flatMap(([mid, u]) => [{ type: 'assistant', message: { id: mid, usage: u } }, { type: 'assistant', message: { id: mid, usage: u } }]);
    fs.writeFileSync(path.join(p.projects, '-Users-x-proj', `cli-${id}.jsonl`), rows.map(r => JSON.stringify(r)).join('\n'));
  };
  run('r1', NOW - 3600e3, [['m1', { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 10 }], ['m2', { input_tokens: 1, cache_read_input_tokens: 500, output_tokens: 5 }]]);
  run('old', NOW - 25 * 3600e3, [['m3', { input_tokens: 9, output_tokens: 9 }]]);
  addSession(p, { id: 'other' });
  assert.deepEqual(status({ p, now: NOW }).usage24h, { runs: 1, calls: 2, input: 3, cacheWrite: 100, cacheRead: 1500, output: 15 });
});
