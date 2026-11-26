import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyError, family, parseReset, paths, record, scan, setConfig, status } from '../tools/session-sweep.mjs';

const NOW = new Date(2026, 10, 27, 12, 0, 0).getTime(); // 本机时区 11-27 12:00
const START = NOW - 48 * 36e5;
const FABLE = "You've hit your Fable limit · resets 2am (Asia/Shanghai). Switch to another model to continue.";

function fake() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-ss-'));
  const env = { AGENT_KIT_STATE_DIR: path.join(home, 'state') };
  const p = paths(env, home);
  fs.mkdirSync(path.join(p.sessions, 'acct', 'org'), { recursive: true });
  fs.mkdirSync(path.join(p.projects, '-Users-x-proj'), { recursive: true });
  return { home, env, p };
}
const configured = (p, backup = 'claude-opus-5-5') => {
  setConfig({ p, args: { backup }, now: START });
  setConfig({ p, args: { 'start-now': true }, now: START });
};

// rows：会话记录里的消息；index：会话索引额外字段
function addSession(p, id, { model = 'claude-fable-5-2', index = {}, rows = [] } = {}) {
  const cli = `cli-${id}`;
  fs.writeFileSync(path.join(p.sessions, 'acct', 'org', `local_${id}.json`), JSON.stringify({ sessionId: `local_${id}`, cliSessionId: cli, model, title: `会话 ${id}`, ...index }));
  const ts = t => new Date(t).toISOString();
  const lines = [{ type: 'user', timestamp: ts(NOW - 50 * 36e5), message: { role: 'user', content: '干活' } }, ...rows.map(r => ({ ...r, timestamp: ts(r.t) }))];
  fs.writeFileSync(path.join(p.projects, '-Users-x-proj', `${cli}.jsonl`), `${lines.map(l => JSON.stringify(l)).join('\n')}\n`);
}
const apiErr = (t, text, error = 'rate_limit') => ({ t, type: 'assistant', isApiErrorMessage: true, error, message: { content: [{ type: 'text', text }] } });
const say = (t, text) => ({ t, type: 'assistant', message: { content: [{ type: 'text', text }] } });
const user = (t, text) => ({ t, type: 'user', message: { role: 'user', content: text } });
const errSession = (p, id, text, at, extra = {}) => addSession(p, id, { ...extra, index: { error: text, errorAt: at, ...(extra.index || {}) }, rows: [apiErr(at, text), ...(extra.rows || [])] });
const byId = (r, id) => r.actions.find(a => a.sessionId === `local_${id}`);

test('报错分类', () => {
  assert.deepEqual(classifyError(FABLE), { kind: 'model_limit', name: 'Fable' });
  assert.deepEqual(classifyError("You've hit your Opus 5.5 limit"), { kind: 'model_limit', name: 'Opus' });
  assert.equal(classifyError("You've hit your 5-hour limit · resets 4:10am").kind, 'account_limit');
  assert.equal(classifyError("You've hit your session limit").kind, 'account_limit');
  assert.equal(classifyError('API Error: Your computer went to sleep mid-response.').kind, 'transient');
  assert.equal(classifyError('API Error: Connection lost mid-response.').kind, 'transient');
  assert.equal(classifyError('Claude Code process exited with code 143', 'process_interrupted').kind, 'transient');
  assert.equal(classifyError('Failed to authenticate. API Error: 403').kind, 'needs_owner');
  assert.equal(classifyError('奇怪的错').kind, 'other_error');
  assert.equal(family('claude-fable-5-2'), 'fable');
});

test('重置时间：当天、跨天、带日期', () => {
  const at = new Date(2026, 10, 27, 1, 0).getTime();
  assert.equal(parseReset("resets 4:10am (Asia/Shanghai)", at), new Date(2026, 10, 27, 4, 10).getTime());
  assert.equal(parseReset("resets 11pm (Asia/Shanghai)", at), new Date(2026, 10, 27, 23, 0).getTime());
  assert.equal(parseReset("resets 12:40am", new Date(2026, 10, 27, 13, 0).getTime()), new Date(2026, 10, 28, 0, 40).getTime());
  assert.equal(parseReset("resets Nov 28 at 2am (Asia/Shanghai)", at), new Date(2026, 10, 28, 2, 0).getTime());
  assert.equal(parseReset('没有时间', at), null);
});

test('没启用（没 startAt）时全部进存量清单，不动', () => {
  const { p } = fake();
  errSession(p, 'a', FABLE, NOW - 600e3);
  const r = scan({ p, now: NOW });
  assert.equal(r.actions.length, 0);
  assert.equal(r.backlog.length, 1);
});

test('各类停下的会话分别怎么处理', () => {
  const { p } = fake();
  configured(p);
  fs.writeFileSync(p.config, JSON.stringify({ ...JSON.parse(fs.readFileSync(p.config, 'utf8')), maxWakePerRun: 10 }));
  errSession(p, 'fable', FABLE, NOW - 600e3);
  errSession(p, 'acctDue', "You've hit your 5-hour limit · resets 10am (Asia/Shanghai)", NOW - 5 * 36e5, { model: 'claude-opus-5-5' });
  errSession(p, 'acctWait', "You've hit your 5-hour limit · resets 3pm (Asia/Shanghai)", NOW - 36e5, { model: 'claude-opus-5-5' });
  errSession(p, 'sleep', 'API Error: Your computer went to sleep mid-response.', NOW - 30 * 60e3, { model: 'claude-opus-5-5' });
  errSession(p, 'auth', 'Failed to authenticate. API Error: 403', NOW - 30 * 60e3, { model: 'claude-opus-5-5' });
  addSession(p, 'bg', { model: 'claude-opus-5-5', rows: [say(NOW - 3 * 36e5, '**当前状态**：〔后台进行中〕等 CI')] });
  addSession(p, 'bgFresh', { model: 'claude-opus-5-5', rows: [say(NOW - 36e5, '〔后台进行中〕等 CI')] });
  addSession(p, 'waiting', { model: 'claude-opus-5-5', rows: [say(NOW - 3 * 36e5, '〔等你决定〕选哪个')] });
  errSession(p, 'replied', FABLE, NOW - 600e3, { rows: [user(NOW - 300e3, '/model')] });
  errSession(p, 'old', FABLE, START - 36e5);
  errSession(p, 'arch', FABLE, NOW - 600e3, { index: { isArchived: true } });
  const r = scan({ p, now: NOW });
  const got = Object.fromEntries(r.actions.map(a => [a.sessionId.slice(6), a.action]));
  assert.deepEqual(got, { fable: 'switch', acctDue: 'continue', sleep: 'continue', auth: 'notify', bg: 'nudge' });
  assert.equal(byId(r, 'fable').to, 'claude-opus-5-5');
  assert.equal(r.skipped.waitingReset, 1);
  assert.equal(r.skipped.backgroundFresh, 1);
  assert.equal(r.skipped.backlog, 1);
  assert.equal(r.backlog[0].sessionId, 'local_old');
});

test('每轮最多叫醒 3 个，最近停下的优先；只通知的不占名额', () => {
  const { p } = fake();
  configured(p);
  for (let i = 1; i <= 5; i++) errSession(p, `s${i}`, 'API Error: Connection lost mid-response.', NOW - i * 600e3, { model: 'claude-opus-5-5' });
  errSession(p, 'auth', 'Failed to authenticate. API Error: 403', NOW - 30 * 60e3, { model: 'claude-opus-5-5' });
  const r = scan({ p, now: NOW });
  assert.deepEqual(r.actions.filter(a => a.action === 'continue').map(a => a.sessionId), ['local_s1', 'local_s2', 'local_s3']);
  assert.ok(byId(r, 'auth'));
  assert.equal(r.skipped.overCap, 2);
});

test('只转一次：备用模型上又撞额度只通知；24 小时内因同一原因接过又停下只通知', () => {
  const { p } = fake();
  configured(p);
  errSession(p, 'b', "You've hit your Opus limit · resets 2am", NOW - 600e3, { model: 'claude-opus-5-5' });
  errSession(p, 'again', 'API Error: Connection lost mid-response.', NOW - 600e3, { model: 'claude-opus-5-5' });
  record({ p, now: NOW - 36e5, args: { session: 'local_again', anchor: String(NOW - 2 * 36e5), kind: 'transient', action: 'continued' } });
  const r = scan({ p, now: NOW });
  assert.equal(byId(r, 'b').action, 'notify');
  assert.equal(byId(r, 'again').action, 'notify');
  assert.match(byId(r, 'again').reason, /已因同一原因接过一次/);
});

test('同一次停下处理过不再处理；失败的下一轮再试，两次放弃；没设备用只通知', () => {
  const { p } = fake();
  configured(p, 'none');
  const at = NOW - 600e3;
  errSession(p, 'c', FABLE, at);
  assert.equal(scan({ p, now: NOW }).actions[0].action, 'notify');
  const fail = () => record({ p, now: NOW, args: { session: 'local_c', anchor: String(at), kind: 'model_limit', action: 'failed', note: 'Network error' } });
  fail();
  assert.equal(scan({ p, now: NOW }).actions.length, 1);
  fail();
  assert.equal(scan({ p, now: NOW }).actions.length, 0);
});

test('留痕、设置、状态', () => {
  const { p } = fake();
  assert.throws(() => record({ p, args: { session: 'x', anchor: '1', kind: 'transient', action: 'whatever' } }));
  assert.throws(() => record({ p, args: { session: 'x', anchor: '2026-11-27', kind: 'transient', action: 'continued' } }), /毫秒/);
  record({ p, now: NOW, args: { session: 'local_d', anchor: '1', kind: 'model_limit', action: 'switched', from: 'claude-fable-5-2', to: 'claude-opus-5-5' } });
  const s = status({ p, now: NOW });
  assert.equal(s.configured, false);
  assert.equal(s.recent[0].to, 'claude-opus-5-5');
  assert.equal(setConfig({ p, args: { 'start-now': true }, now: NOW }).startAt, NOW);
  assert.equal(setConfig({ p, args: { backup: 'none' } }).backupModel, null);
});

test('巡检自己的花费：只算 24 小时内 session-sweep 的运行，同一条消息只算一次', () => {
  const { p } = fake();
  const run = (id, createdAt, usages) => {
    fs.writeFileSync(path.join(p.sessions, 'acct', 'org', `local_${id}.json`), JSON.stringify({ sessionId: `local_${id}`, cliSessionId: `cli-${id}`, scheduledTaskId: 'quota-guard', createdAt }));
    const rows = usages.flatMap(([mid, u]) => [{ type: 'assistant', message: { id: mid, usage: u } }, { type: 'assistant', message: { id: mid, usage: u } }]);
    fs.writeFileSync(path.join(p.projects, '-Users-x-proj', `cli-${id}.jsonl`), rows.map(r => JSON.stringify(r)).join('\n'));
  };
  run('r1', NOW - 36e5, [['m1', { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 10 }], ['m2', { input_tokens: 1, cache_read_input_tokens: 500, output_tokens: 5 }]]);
  run('old', NOW - 25 * 36e5, [['m3', { input_tokens: 9, output_tokens: 9 }]]);
  assert.deepEqual(status({ p, now: NOW }).usage24h, { runs: 1, calls: 2, input: 3, cacheWrite: 100, cacheRead: 1500, output: 15 });
});

test('命令行：scan 输出 JSON、不带存量清单；未知命令退出码 2', () => {
  const { home, env } = fake();
  const bin = path.join(import.meta.dirname, '..', 'tools', 'session-sweep.mjs');
  const e = { ...process.env, ...env, HOME: home, SESSION_SWEEP_SESSIONS_DIR: path.join(home, 'none'), SESSION_SWEEP_PROJECTS_DIR: path.join(home, 'none') };
  const ok = spawnSync(process.execPath, [bin, 'scan'], { env: e, encoding: 'utf8' });
  assert.equal(ok.status, 0);
  const out = JSON.parse(ok.stdout);
  assert.deepEqual(out.actions, []);
  assert.equal(out.backlog, undefined);
  assert.equal(spawnSync(process.execPath, [bin, 'nope'], { env: e, encoding: 'utf8' }).status, 2);
});
