import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireLock, beat, check, classifyError, collect, done, family, openUnsure, parseReset, paths, record, scan, setConfig, status } from '../tools/session-sweep.mjs';

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

test('重置时间：按报错里的时区算，当天、跨天、带日期；没写时区按本机', () => {
  const at = Date.UTC(2026, 10, 26, 17, 0); // 上海 11-27 01:00
  assert.equal(parseReset('resets 4:10am (Asia/Shanghai)', at), Date.UTC(2026, 10, 26, 20, 10));
  assert.equal(parseReset('resets 11pm (Asia/Shanghai)', at), Date.UTC(2026, 10, 27, 15, 0));
  assert.equal(parseReset('resets 12:40am (Asia/Shanghai)', Date.UTC(2026, 10, 27, 5, 0)), Date.UTC(2026, 10, 27, 16, 40));
  assert.equal(parseReset('resets Nov 28 at 2am (Asia/Shanghai)', at), Date.UTC(2026, 10, 27, 18, 0));
  // 同一时刻，纽约时区（冬令时 UTC-5）：纽约 11-26 12:00 → 当天 4pm
  assert.equal(parseReset('resets 4pm (America/New_York)', at), Date.UTC(2026, 10, 26, 21, 0));
  const local = new Date(2026, 10, 27, 13, 0).getTime();
  assert.equal(parseReset('resets 12:40am', local), new Date(2026, 10, 28, 0, 40).getTime());
  assert.equal(parseReset('resets 4pm (Etc/GMT+8)', at), Date.UTC(2026, 10, 27, 0, 0), '带数字的 IANA 时区（Etc/GMT+8 即 UTC-8）');
  assert.equal(parseReset('resets 3am (Not/AZone)', local), new Date(2026, 10, 28, 3, 0).getTime(), '认不出的时区按本机');
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
  errSession(p, 'acctDue', "You've hit your 5-hour limit · resets 10am", NOW - 5 * 36e5, { model: 'claude-opus-5-5' });
  errSession(p, 'acctWait', "You've hit your 5-hour limit · resets 3pm", NOW - 36e5, { model: 'claude-opus-5-5' });
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

test('分阶段留痕：换好模型没发出消息的，下一轮只补发消息', () => {
  const { p } = fake();
  configured(p);
  const at = NOW - 600e3;
  errSession(p, 'm', FABLE, at, { model: 'claude-opus-5-5' }); // 模型已经换成备用
  assert.equal(scan({ p, now: NOW }).actions.length, 0, '没有 model_set 留痕：算常浩自己换过，跳过');
  record({ p, now: NOW, args: { session: 'local_m', anchor: String(at), kind: 'model_limit', action: 'model_set', from: 'claude-fable-5-2', to: 'claude-opus-5-5' } });
  const a = scan({ p, now: NOW }).actions[0];
  assert.equal(a.action, 'switch');
  assert.equal(a.modelAlreadySet, true);
  assert.equal(a.to, 'claude-opus-5-5');
  record({ p, now: NOW, args: { session: 'local_m', anchor: String(at), kind: 'model_limit', action: 'switched' } });
  assert.equal(scan({ p, now: NOW }).actions.length, 0);
});

test('换模型前记了意图、换完没来得及记 model_set 就崩了：下一轮仍只补发消息', () => {
  const { p } = fake();
  configured(p);
  const at = NOW - 600e3;
  errSession(p, 'cr', FABLE, at, { model: 'claude-opus-5-5' });
  record({ p, now: NOW, args: { session: 'local_cr', anchor: String(at), kind: 'model_limit', action: 'switching', from: 'claude-fable-5-2', to: 'claude-opus-5-5' } });
  const a = scan({ p, now: NOW }).actions[0];
  assert.equal(a.action, 'switch');
  assert.equal(a.modelAlreadySet, true);
});

test('意图记了但换模型失败（模型没变）：照常换模型重试', () => {
  const { p } = fake();
  configured(p);
  const at = NOW - 600e3;
  errSession(p, 'sf', FABLE, at);
  record({ p, now: NOW, args: { session: 'local_sf', anchor: String(at), kind: 'model_limit', action: 'switching' } });
  record({ p, now: NOW, args: { session: 'local_sf', anchor: String(at), kind: 'model_limit', action: 'failed' } });
  const a = scan({ p, now: NOW }).actions[0];
  assert.equal(a.action, 'switch');
  assert.equal(a.modelAlreadySet, false);
});

test('时间边界：报错后 1 秒内人发的消息算接手；最后一条没有时间戳算拿不准', () => {
  const { p } = fake();
  configured(p);
  const at = NOW - 600e3;
  errSession(p, 'q', FABLE, at, { rows: [user(at + 500, '我马上接着说')] });
  assert.equal(check({ p, sessionId: 'local_q', anchor: at }).state, 'taken');
  assert.equal(scan({ p, now: NOW }).actions.length, 0);
  errSession(p, 'nt', FABLE, at);
  fs.appendFileSync(path.join(p.projects, '-Users-x-proj', 'cli-nt.jsonl'), `${JSON.stringify({ type: 'user', message: { content: '没有时间戳' } })}\n`);
  assert.equal(check({ p, sessionId: 'local_nt', anchor: at }).state, 'unknown');
  const r = scan({ p, now: NOW });
  assert.equal(r.actions.length, 0);
  assert.equal(r.skipped.transcriptBusy, 1);
});

test('发送结果不确定是未决事项：不再自动处理，但一直在未决清单里，直到会话被接上或 resolve', () => {
  const { p } = fake();
  configured(p);
  const at = NOW - 600e3;
  errSession(p, 'un', 'API Error: Connection lost mid-response.', at, { model: 'claude-opus-5-5' });
  record({ p, now: NOW - 48 * 36e5, args: { session: 'local_un', anchor: String(at), kind: 'transient', action: 'unsure', note: '发消息报错' } });
  assert.equal(scan({ p, now: NOW }).actions.length, 0, '不自动重发');
  assert.equal(openUnsure(p).length, 1, '超过 24 小时仍在');
  assert.equal(status({ p, now: NOW }).openUnsure.length, 1);
  record({ p, now: NOW, args: { session: 'local_un', anchor: String(at), kind: 'manual', action: 'resolved' } });
  assert.equal(openUnsure(p).length, 0);
  // 没 resolve、但会话后来被人接上了：也算了结
  errSession(p, 'un2', 'API Error: Connection lost mid-response.', at, { model: 'claude-opus-5-5', rows: [user(at + 60e3, '我来')] });
  record({ p, now: NOW, args: { session: 'local_un2', anchor: String(at), kind: 'transient', action: 'unsure' } });
  assert.equal(openUnsure(p).length, 0);
});

test('会话记录末尾半行（正在写入）：不确定，不处理', () => {
  const { p } = fake();
  configured(p);
  errSession(p, 'w', FABLE, NOW - 600e3);
  fs.appendFileSync(path.join(p.projects, '-Users-x-proj', 'cli-w.jsonl'), '{"type":"user","message":{"content":"新消息写了一半');
  const r = scan({ p, now: NOW });
  assert.equal(r.actions.length, 0);
  assert.equal(r.skipped.transcriptBusy, 1);
  assert.equal(check({ p, sessionId: 'local_w', anchor: NOW - 600e3 }).state, 'unknown');
});

test('动手前复核分四种：still、taken、moved、unknown；只有确定有人说过话才算 taken', () => {
  const { p } = fake();
  configured(p);
  const at = NOW - 600e3;
  errSession(p, 'k', FABLE, at);
  const c = (o = {}) => check({ p, sessionId: 'local_k', anchor: at, ...o });
  assert.equal(c().state, 'still');
  assert.equal(c().kind, 'model_limit');
  assert.equal(c({ model: 'claude-fable-5-2' }).state, 'still');
  assert.equal(c({ model: 'claude-opus-5-5' }).state, 'moved');
  assert.equal(c({ anchor: at - 5000 }).state, 'moved', '停在了更晚的地方');
  assert.equal(check({ p, sessionId: 'local_nope', anchor: at }).state, 'unknown');
  const tr = path.join(p.projects, '-Users-x-proj', 'cli-k.jsonl');
  const saved = fs.readFileSync(tr);
  fs.unlinkSync(tr);
  assert.equal(c().state, 'unknown', '找不到会话记录不能当作有人接手');
  fs.writeFileSync(tr, '');
  assert.equal(c().state, 'unknown', '会话记录读不出不能当作有人接手');
  fs.writeFileSync(tr, saved);
  fs.appendFileSync(tr, `${JSON.stringify({ type: 'user', timestamp: new Date(NOW - 60e3).toISOString(), message: { content: '我自己接着说' } })}\n`);
  assert.equal(c().state, 'taken');
});

test('占用：别人占着这一轮跳过；只有持有者能放开；过期的清掉再占；空轮当场放开', () => {
  const { p } = fake();
  configured(p);
  errSession(p, 'l', 'API Error: Connection lost mid-response.', NOW - 600e3, { model: 'claude-opus-5-5' });
  const first = scan({ p, now: NOW, lease: true });
  assert.equal(first.actions.length, 1);
  assert.ok(first.runId);
  const second = scan({ p, now: NOW + 60e3, lease: true });
  assert.equal(second.actions.length, 0);
  assert.equal(second.skipped.leased, 1);
  assert.equal(second.busySince, new Date(NOW).toISOString());
  const before = fs.readFileSync(p.state, 'utf8');
  assert.equal(done({ p, now: NOW + 2 * 60e3, runId: 'someone-else' }).released, false, '不是持有者放不开');
  assert.equal(fs.readFileSync(p.state, 'utf8'), before, '不是持有者也不能记完成时间');
  assert.equal(scan({ p, now: NOW + 3 * 60e3, lease: true }).skipped.leased, 1);
  const third = scan({ p, now: NOW + 31 * 60e3, lease: true });
  assert.equal(third.actions.length, 1, '占用超过 30 分钟算上一轮死掉');
  const mid = fs.readFileSync(p.state, 'utf8');
  assert.equal(done({ p, now: NOW + 32 * 60e3, runId: first.runId }).released, false, '旧持有者不能放开新一轮的占用');
  assert.equal(fs.readFileSync(p.state, 'utf8'), mid, '旧持有者不能把新一轮记成跑完');
  const st = done({ p, now: NOW + 32 * 60e3, runId: third.runId });
  assert.equal(st.released, true);
  assert.equal(st.lastRunCompletedAt, new Date(NOW + 32 * 60e3).toISOString());
  assert.ok(scan({ p, now: NOW + 33 * 60e3, lease: true }).runId);
  const { p: p2 } = fake();
  assert.equal(scan({ p: p2, now: NOW, lease: true }).runId, null);
  const s2 = status({ p: p2, now: NOW });
  assert.equal(s2.state.lastRunCompletedAt, new Date(NOW).toISOString(), '空轮直接算跑完');
  assert.equal(s2.lock, null, '空轮放开占用');
});

// 8 个子进程等到同一时刻，各自 acquireLock 一次；返回抢到的个数
async function race(p, env, now) {
  const mod = path.join(import.meta.dirname, '..', 'tools', 'session-sweep.mjs');
  const go = Date.now() + 1500;
  const code = `import { acquireLock, paths } from ${JSON.stringify(mod)}; const p = paths(process.env, ${JSON.stringify(path.dirname(p.dir))}); while (Date.now() < ${go}); console.log(acquireLock(p${now ? `, ${now}` : ''}) ? 'got' : 'busy');`;
  const one = () => new Promise(resolve => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, ...env } });
    let out = '';
    c.stdout.on('data', d => (out += d));
    c.on('close', () => resolve(out.trim()));
  });
  const got = await Promise.all(Array.from({ length: 8 }, one));
  assert.equal(got.filter(x => x === 'busy').length + got.filter(x => x === 'got').length, 8, got.join(','));
  return got.filter(x => x === 'got').length;
}
const age = (file, ms) => {
  const t = (Date.now() - ms) / 1000;
  fs.utimesSync(file, t, t);
};

test('占用是原子的：8 个进程同一时刻抢空锁，只有 1 个抢到', async () => {
  const { p, env } = fake();
  assert.equal(await race(p, env), 1);
});

test('过期锁接管：8 个进程同时接管同一把过期锁，只有 1 个抢到；空锁文件过期也能回收', async () => {
  const { p, env } = fake();
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.lock, JSON.stringify({ runId: 'dead', at: new Date(Date.now() - 40 * 60e3).toISOString() }));
  age(p.lock, 40 * 60e3);
  assert.equal(await race(p, env), 1);
  assert.notEqual(JSON.parse(fs.readFileSync(p.lock, 'utf8')).runId, 'dead');
  const { p: p2, env: env2 } = fake();
  fs.mkdirSync(p2.dir, { recursive: true });
  fs.writeFileSync(p2.lock, ''); // 创建锁后、写内容前崩掉
  age(p2.lock, 40 * 60e3);
  assert.equal(await race(p2, env2), 1);
});

test('心跳续租：持有者续租后不会被当成过期；接管者死在短锁里的，短锁过期后能回收', () => {
  const { p } = fake();
  const now = Date.now();
  const id = acquireLock(p, now - 40 * 60e3);
  assert.ok(id);
  assert.equal(beat(p, id, now), true);
  assert.equal(acquireLock(p, now), null, '续过租，没过期');
  assert.equal(beat(p, 'other', now), false);
  age(p.lock, 40 * 60e3);
  fs.writeFileSync(p.takeover, '');
  age(p.takeover, 2 * 60e3);
  assert.ok(acquireLock(p, now), '过期锁 + 过期短锁都能回收');
  assert.equal(fs.existsSync(p.takeover), false);
});

test('backlog 只读：不写检查时间、完成时间，不碰占用', () => {
  const { p } = fake();
  configured(p);
  errSession(p, 'old', FABLE, START - 36e5);
  const runId = acquireLock(p, NOW);
  const before = fs.existsSync(p.state) ? fs.readFileSync(p.state, 'utf8') : null;
  assert.equal(collect({ p, now: NOW }).backlog.length, 1);
  assert.equal(fs.existsSync(p.state) ? fs.readFileSync(p.state, 'utf8') : null, before);
  assert.equal(status({ p, now: NOW }).lock.runId, runId);
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
  assert.equal(status({ p, now: NOW }).configState, 'ok');
  fs.writeFileSync(p.config, '{坏了');
  assert.equal(status({ p, now: NOW }).configState, 'broken');
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
