import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { judge, lastTurn, LOG_FILE, OFF_FILE, run } from '../hooks/wrapup-guard.mjs';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'wrapup-guard.mjs');

const user = (content, extra = {}) => ({ type: 'user', entrypoint: 'claude-desktop', message: { content }, ...extra });
const said = (text, id = 'm-text') => ({ type: 'assistant', message: { id, content: [{ type: 'text', text }] } });
const used = (name, input = {}, id = `m-${name}`) => ({ type: 'assistant', message: { id, content: [{ type: 'tool_use', name, input }] } });
const result = () => ({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } });
const close = (status, next = '回复「合并」') => `正文\n\n**本次完成**：x\n**当前状态**：〔${status}〕y\n**下一步**：${next}`;
const WRAP = 'mcp__ccd_turn__wrap_up';
const lines = records => records.map(r => JSON.stringify(r));
const verdict = records => judge(lastTurn(lines(records))).verdict;

test('〔等你决定〕没调 wrap_up：要补', () => {
  assert.equal(verdict([user('合并吗'), said(close('等你决定'))]), 'block');
});

test('只调了 wrap_up 没带 ask：照样要补', () => {
  assert.equal(verdict([user('x'), used(WRAP, { recap: 'r' }), result(), said(close('等你决定'))]), 'block');
});

test('带 ask 的 wrap_up：放行', () => {
  assert.equal(verdict([user('x'), used(WRAP, { recap: 'r', ask: '合并吗？', actions: [{ label: '合并' }] }), result(), said(close('等你决定'))]), 'pass:has-ask');
});

test('〔等你操作〕〔受阻〕：写了回话才要按钮', () => {
  assert.equal(verdict([user('x'), said(close('等你操作', '在 chrome://extensions 点刷新，然后回我「已刷新」'))]), 'block');
  assert.equal(verdict([user('x'), said(close('受阻', '回复「先不做」'))]), 'block');
  assert.equal(verdict([user('x'), said(close('等你操作', '跑完把最后十几行拍照发我'))]), 'pass:not-needed');
  assert.equal(verdict([user('x'), said(close('受阻', '等 GitHub 恢复后我再推'))]), 'pass:not-needed');
});

test('〔后台进行中〕〔已结束〕和没写收尾：不管', () => {
  assert.equal(verdict([user('x'), said(close('后台进行中', '回复「好」'))]), 'pass:not-needed');
  assert.equal(verdict([user('x'), said(close('已结束', '本任务已结束，下一步无需任何动作。'))]), 'pass:not-needed');
  assert.equal(verdict([user('x'), said('好的，改完了。')]), 'pass:no-status');
});

test('只看本轮：上一轮带过按钮，这一轮没带，照样要补', () => {
  const prev = [user('a'), used(WRAP, { ask: '合并吗？', actions: [{ label: '合并' }] }, 'p1'), result(), said(close('等你决定'), 'p2')];
  assert.equal(verdict([...prev, user('b'), said(close('等你决定'), 'n1')]), 'block');
});

test('子会话回报、驿窗转话开头的轮也算一轮（零工具轮最常漏）', () => {
  const report = user('<system-reminder>\nThe session "x" you started finished a turn…</system-reminder>');
  assert.equal(verdict([user('a'), said('前一轮'), report, said(close('等你决定', '到 [x](#local_1) 回「修完再送审」'))]), 'block');
  const relayed = user('The agent-hud plugin sent a message:\n都按推荐');
  assert.equal(verdict([relayed, said(close('等你决定'))]), 'block');
});

test('交接卡那一轮：照第 5 节不放按钮，放行', () => {
  const card = used('mcp__ccd_session__start_session', { title: '【交接】驿窗｜收尾', initiation: 'own_initiative' });
  assert.equal(verdict([user('x'), card, result(), said(close('等你决定', '点交接卡上的 Start'))]), 'pass:handoff-card');
});

test('不是桌面应用（claude -p、SDK 派单）：放行', () => {
  assert.equal(verdict([user('x', { entrypoint: 'sdk-cli' }), said(close('等你决定'))]), 'pass:not-desktop');
});

test('同一条消息分块重复写进记录：只算一次，不影响判断', () => {
  const wrap = used(WRAP, { ask: '合并吗？', actions: [{ label: '合并' }] }, 'dup');
  assert.equal(verdict([user('x'), wrap, wrap, result(), said(close('等你决定'))]), 'pass:has-ask');
});

test('Stop 传了 last_assistant_message：以它为准', () => {
  const turn = lastTurn(lines([user('x'), said('中间的话')]));
  assert.equal(judge(turn, { lastMessage: close('等你决定') }).verdict, 'block');
});

function setup(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-wrapup-test-'));
  const transcript = path.join(dir, 't.jsonl');
  fs.writeFileSync(transcript, lines(records).join('\n'));
  return { dir, transcript, env: { ...process.env, AGENT_KIT_STATE_DIR: dir } };
}

test('整个钩子：要补时输出 block 和补法，记一行；stop_hook_active 时放行', () => {
  const { dir, transcript, env } = setup([user('合并吗'), said(close('等你决定'))]);
  const out = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's-1', transcript_path: transcript }), encoding: 'utf8', env });
  assert.equal(out.status, 0);
  const res = JSON.parse(out.stdout);
  assert.equal(res.decision, 'block');
  assert.match(res.reason, /mcp__ccd_turn__wrap_up/);
  assert.match(res.reason, /收尾三项/);
  const logged = fs.readFileSync(path.join(dir, LOG_FILE), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(logged.map(l => [l.session, l.status, l.verdict]), [['s-1', '等你决定', 'block']]);
  assert.ok(!JSON.stringify(logged).includes('正文'), '记录不写正文');

  const again = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's-1', transcript_path: transcript, stop_hook_active: true }), encoding: 'utf8', env });
  assert.equal(again.status, 0);
  assert.equal(again.stdout, '', '补过一次就不再拦');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('关掉开关、记录读不到、输入坏了：都静默放行', () => {
  const { dir, transcript, env } = setup([user('x'), said(close('等你决定'))]);
  fs.writeFileSync(path.join(dir, OFF_FILE), '');
  assert.equal(run({ transcript_path: transcript }, env), null, '有 off 文件不查');
  fs.rmSync(path.join(dir, OFF_FILE));
  assert.equal(run({ transcript_path: path.join(dir, 'nope.jsonl') }, env), null);
  const bad = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', env });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, '');
  assert.ok(!fs.existsSync(path.join(dir, LOG_FILE)), '没判出状态词的不记');
  fs.rmSync(dir, { recursive: true, force: true });
});
