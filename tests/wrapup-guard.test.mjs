import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { asksReply, closing, hasWrapTool, judge, lastTurn, LOG_FILE, OFF_FILE, run } from '../hooks/wrapup-guard.mjs';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'wrapup-guard.mjs');
const WRAP = 'mcp__ccd_turn__wrap_up';
const START = 'mcp__ccd_session__start_session';

// 桌面应用会话开头的提示词快照里带着 wrap_up 的定义
const snapshot = { type: 'attachment', attachment: { type: 'prompt_snapshot', systemPrompt: ['…'], tools: [{ name: 'mcp__ccd_turn__update_plan' }, { name: WRAP }] } };
const user = (content, extra = {}) => ({ type: 'user', entrypoint: 'claude-desktop', message: { content }, ...extra });
const said = (text, id = 'm-text') => ({ type: 'assistant', message: { id, content: [{ type: 'text', text }] } });
const used = (name, input = {}, id = `u-${name}`) => ({ type: 'assistant', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] } });
const result = (id = 'u-x', isError = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: isError }] } });
const close = (status, next = '回复「合并」') => `正文\n\n**本次完成**：x\n**当前状态**：〔${status}〕y\n**下一步**：${next}`;
const buttons = (actions = [{ label: '合并' }]) => used(WRAP, { recap: 'r', ask: '合并吗？', actions }, 'u-wrap');
const lines = records => records.map(r => JSON.stringify(r));
const verdict = (records, opts = {}) => {
  const ls = lines(opts.snapshot === false ? records : [snapshot, ...records]);
  return judge(lastTurn(ls), { capable: hasWrapTool(ls), ...opts }).verdict;
};

test('〔等你决定〕没调 wrap_up：要补', () => {
  assert.equal(verdict([user('合并吗'), said(close('等你决定'))]), 'block');
});

test('wrap_up 要有 ask 和 1–2 个按钮才算（#151-P1-01）', () => {
  const v = input => verdict([user('x'), used(WRAP, input, 'u-wrap'), result('u-wrap'), said(close('等你决定'))]);
  assert.equal(v({ recap: 'r' }), 'block', '没有 ask');
  assert.equal(v({ recap: 'r', ask: '合并吗？' }), 'block', '有 ask 没有 actions');
  assert.equal(v({ recap: 'r', ask: '合并吗？', actions: [] }), 'block', 'actions 是空数组');
  assert.equal(v({ recap: 'r', ask: '合并吗？', actions: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] }), 'block', '超过两个按钮');
  assert.equal(v({ recap: 'r', ask: '合并吗？', actions: [{ label: '  ' }] }), 'block', '按钮没有文字');
  assert.equal(v({ recap: 'r', ask: '合并吗？', actions: [{ label: '合并' }] }), 'pass:has-buttons');
  assert.equal(v({ recap: 'r', ask: '开 PR 吗？', actions: [{ action: 'create_pr' }, { label: '先不开' }] }), 'pass:has-buttons', '应用动作没有文字也算');
  assert.equal(v({ recap: 'r', ask: '合并吗？', actions: JSON.stringify([{ label: '合并' }]) }), 'pass:has-buttons', 'actions 以字符串传入');
});

test('wrap_up 要调用成功才算：报错或没有工具结果都要补（第 2 轮 #151-P1-01）', () => {
  assert.equal(verdict([user('x'), buttons(), result('u-wrap'), said(close('等你决定'))]), 'pass:has-buttons');
  assert.equal(verdict([user('x'), buttons(), result('u-wrap', true), said(close('等你决定'))]), 'block', '工具报错');
  assert.equal(verdict([user('x'), buttons(), said(close('等你决定'))]), 'block', '没有工具结果');
});

test('〔等你操作〕〔受阻〕：写了回话才要按钮；否定说法、长回话（#151-P2-02）', () => {
  assert.equal(verdict([user('x'), said(close('等你操作', '在 chrome://extensions 点刷新，然后回我「已刷新」'))]), 'block');
  assert.equal(verdict([user('x'), said(close('受阻', '回复「先不做」'))]), 'block');
  assert.equal(verdict([user('x'), said(close('等你操作', '开完回我一句「权限开好了」，我重跑自测'))]), 'block', '「回我一句」也认（续审 #151-P2-02）');
  assert.equal(verdict([user('x'), said(close('等你操作', '跑完把最后十几行拍照发我'))]), 'pass:not-needed');
  assert.equal(verdict([user('x'), said(close('受阻', '等 GitHub 恢复后我再推'))]), 'pass:not-needed');
  assert.equal(verdict([user('x'), said(close('等你操作', '在终端跑完就行，不用回复「好了」'))]), 'pass:not-needed', '否定说法不算');
  for (const n of ['不要回复「X」', '不用回一句「X」', '不要再回复「X」', '不必再回我「X」', '无需你回复「X」', '不需要再回复「X」', '跑完别回复「好了」',
    '不要在这个会话回复「X」', '不想回复「X」', '不希望你在这里回复「X」', '无须回复「X」', '不要回复我「X」', '不用回我一句「X」', '不用回复：「好了」', '回它「可以换」', '回协调会话一句「先不换」', '不要回我一个「X」', '回信说「通过」', '回到首页「设置」里看', '回 #368「修完不再审」', '不用回到这里说一声「好了」'])
    assert.equal(asksReply(n), false, n);
  for (const n of ['回复「合并」', '我推荐回复「先做班主任版」', '都不做就回复「先不做」', '到别的地方看完后回复「看过了」', '不用等我，你回复「开始」就行',
    '不是不要回复「X」，是要你现在回', '跑完不用截图。回复「已跑完」', '不要回复「A」；要合并就回复「合并」',
    '别忘了回复「X」', '别忘了回我「X」', '分别回复「X」', '不要回复「A」；别忘了回复「B」', '不要忘了回复「X」', '看完区别再回复「X」',
    '请回复我「X」', '请回我一句「X」', '回复我一句「X」', '回一句话「X」', '回个「X」', '回我一声「X」', '不要回复「A」；请回复我「B」', '开完回我一句「权限开好了」', '你看完回我一句：「已经回了」', '回复：「合并」',
    '回我一个「X」', '开完回我一个「权限开好了」', '回我一下「X」', '回我一条「X」', '回复一下「X」', '回我一段「X」',
    '回（比如「合并」）', '回一句（例如「先不做」）', '回复（可以写「都按推荐」）',
    '收到通知后，回到这里说一声「上游回了」', '回来跟我说一声「好了」', '回到本会话说「已刷新」', '回复：定了就回「定 B′」'])
    assert.equal(asksReply(n), true, n);
  const long = '同意按第二种做法改，P1 两条都按修法返修，改完不再送审，直接交 Hermes 合并并装机，装完把截图发我看一眼';
  assert.ok(long.length > 40);
  assert.equal(verdict([user('x'), said(close('等你操作', `回复「${long}」`))]), 'block', '回话超过 40 字也认');
});

test('〔后台进行中〕〔已结束〕和没写收尾：不管', () => {
  assert.equal(verdict([user('x'), said(close('后台进行中', '回复「好」'))]), 'pass:not-needed');
  assert.equal(verdict([user('x'), said(close('已结束', '本任务已结束，下一步无需任何动作。'))]), 'pass:not-needed');
  assert.equal(verdict([user('x'), said('好的，改完了。')]), 'pass:no-status');
  assert.equal(verdict([user('x'), said('**当前状态**：〔差不多了〕\n**下一步**：回复「好」')]), 'pass:no-status', '不是五个状态词之一');
});

test('只认最后一个收尾状态：正文里引用的不算（#151-P2-01）', () => {
  const quoted = `上一轮写的是 **当前状态**：〔已结束〕\n\n${close('等你决定')}`;
  assert.equal(verdict([user('x'), said(quoted)]), 'block', '正文引用了〔已结束〕，实际收尾是〔等你决定〕');
  const reverse = `子会话写的是 **当前状态**：〔等你决定〕\n\n${close('已结束', '本任务已结束，下一步无需任何动作。')}`;
  assert.equal(verdict([user('x'), said(reverse)]), 'pass:not-needed', '正文引用了〔等你决定〕，实际收尾是〔已结束〕');
  assert.deepEqual(closing(quoted), { status: '等你决定', next: '回复「合并」' });
});

test('只看最后一条消息：中间消息的收尾不拿来判断（#151-P2-01）', () => {
  assert.equal(verdict([user('x'), said(close('等你决定'), 'a1'), said('补一句说明，没有收尾', 'a2')]), 'pass:no-status');
  const turn = lastTurn(lines([snapshot, user('x'), said(close('等你决定'))]));
  assert.equal(judge(turn, { lastMessage: '最后一条没有收尾' }).verdict, 'pass:no-status', 'last_assistant_message 优先，不往前找');
  assert.equal(judge(lastTurn(lines([user('x'), said('中间的话')])), { lastMessage: close('等你决定') }).verdict, 'block');
});

test('只看本轮：上一轮带过按钮，这一轮没带，照样要补', () => {
  const prev = [user('a'), buttons(), result('u-wrap'), said(close('等你决定'), 'p2')];
  assert.equal(verdict([...prev, user('b'), said(close('等你决定'), 'n1')]), 'block');
});

test('纯图片、纯附件也开一轮，工具结果不开（#151-P1-02）', () => {
  const prev = [user('a'), buttons(), result('u-wrap'), said(close('等你决定'), 'p2')];
  const image = user([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }]);
  const file = user([{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' } }]);
  assert.equal(verdict([...prev, image, said(close('等你决定'), 'n1')]), 'block', '只发图片');
  assert.equal(verdict([...prev, file, said(close('等你决定'), 'n1')]), 'block', '只发附件');
  assert.equal(verdict([user('a'), buttons(), result('u-wrap'), said(close('等你决定'), 'n1')]), 'pass:has-buttons', '工具结果不切开本轮');
});

test('子会话回报、驿窗转话开头的轮也算一轮（零工具轮最常漏）', () => {
  const report = user('<system-reminder>\nThe session "x" you started finished a turn…</system-reminder>');
  assert.equal(verdict([user('a'), said('前一轮'), report, said(close('等你决定', '你回复「先不做」，主线到此收住'))]), 'block');
  const relayed = user('The agent-hud plugin sent a message:\n都按推荐');
  assert.equal(verdict([relayed, said(close('等你决定'))]), 'block');
});

test('要去别的会话回话的：本会话不放按钮（#151-P1-03）', () => {
  const next = '到 [托管单接手会话](#local_e96b10a3-2c64-4fae-b133-726914ae5954) 回「修完再送审」';
  assert.equal(verdict([user('x'), said(close('等你决定', next))]), 'pass:other-session');
  assert.equal(verdict([user('x'), said(close('等你操作', '去新协调会话 `local_6ac33625` 回「380 直接合」'))]), 'pass:other-session');
});

test('交接卡：成功创建才放行（#151-P2-04）', () => {
  const card = used(START, { title: '【交接】驿窗｜收尾', initiation: 'own_initiative' }, 'u-card');
  const next = '点交接卡上的 Start';
  assert.equal(verdict([user('x'), card, result('u-card'), said(close('等你决定', next))]), 'pass:handoff-card');
  assert.equal(verdict([user('x'), card, result('u-card', true), said(close('等你决定', next))]), 'block', '工具报错，卡没出来');
  assert.equal(verdict([user('x'), card, said(close('等你决定', next))]), 'block', '没有工具结果');
  const other = used(START, { title: '驿窗｜新任务' }, 'u-other');
  assert.equal(verdict([user('x'), other, result('u-other'), said(close('等你决定'))]), 'block', '不是【交接】卡');
});

test('会话里没有 wrap_up：放行，即使继承了 claude-desktop 入口（#151-P2-05）', () => {
  const records = [user('x', { entrypoint: 'claude-desktop' }), said(close('等你决定'))];
  assert.equal(verdict(records, { snapshot: false }), 'pass:no-wrap-tool');
  assert.equal(verdict([used('mcp__ccd_turn__update_plan', {}, 'u-plan'), ...records], { snapshot: false }), 'pass:no-wrap-tool', '只调用过同族别的工具不算（第 2 轮 #151-P2-05）');
  assert.equal(verdict([used(WRAP, { recap: 'r' }, 'u-old'), result('u-old'), ...records], { snapshot: false }), 'block', '调用过 wrap_up 本身就算有');
  assert.equal(hasWrapTool(lines([user(`常浩贴的一段话里提到 ${WRAP}`)])), false, '只是正文里提到工具名不算');
  const mention = { type: 'attachment', attachment: { type: 'prompt_snapshot', systemPrompt: [`此环境不可用 ${WRAP}`], tools: [{ name: 'Bash' }] } };
  assert.equal(hasWrapTool(lines([mention])), false, '快照正文提到工具名、工具列表里没有它：不算（第 3 轮 #151-P2-05）');
  assert.equal(hasWrapTool(lines([{ type: 'attachment', attachment: { type: 'prompt_snapshot', systemPrompt: [WRAP] } }])), false, '快照没有工具列表：不算');
  assert.equal(hasWrapTool(lines([snapshot])), true, '工具列表里有 wrap_up 的定义');
});

test('找不到本轮开头：记为 indeterminate，不当成正常放行（#151-P2-03）', () => {
  assert.equal(judge(null, { lastMessage: close('等你决定') }).verdict, 'pass:indeterminate');
});

test('同一条消息分块重复写进记录：只算一次，不影响判断', () => {
  const w = buttons();
  assert.equal(verdict([user('x'), w, w, result('u-wrap'), said(close('等你决定'))]), 'pass:has-buttons');
});

test('同一次回复里并行两个工具调用：各写一行、共用 message.id、序号都是 0，两个都要算', () => {
  // 真实记录长这样：Claude Code 把同一次回复的每个内容块各写一行（会话 8ea5dcae 17:09:20 被误拦）
  const block = (uuid, x) => ({ type: 'assistant', uuid, message: { id: 'm-same', content: [x] } });
  const bash = block('a1', { type: 'tool_use', id: 'u-bash', name: 'Bash', input: { command: 'ls' } });
  const wrap = block('a2', { type: 'tool_use', id: 'u-wrap', name: WRAP, input: { recap: 'r', ask: '合并吗？', actions: [{ label: '合并' }] } });
  assert.equal(verdict([user('x'), bash, wrap, result('u-bash'), result('u-wrap'), said(close('等你决定'))]), 'pass:has-buttons');
  // 同一次回复里两段文字（各一行、序号都是 0）：最后那段才是收尾
  const t1 = block('t1', { type: 'text', text: '先说一句' });
  const t2 = block('t2', { type: 'text', text: close('等你决定') });
  const turn = lastTurn(lines([snapshot, user('x'), t1, t2]));
  assert.deepEqual(turn.texts, ['先说一句', close('等你决定')]);
});

test('去重的边界：同一行重写、单行多块、没有 uuid、工具缺 id（#158-R2）', () => {
  const rec = (x, extra = {}) => ({ type: 'assistant', message: { id: 'm-same', content: Array.isArray(x) ? x : [x] }, ...extra });
  const turnOf = records => lastTurn(lines([snapshot, user('x'), ...records]));
  const text = t => ({ type: 'text', text: t });
  // 同一行（同一 uuid）写了两遍：文字只算一次
  const once = rec(text('收尾'), { uuid: 'a1' });
  assert.deepEqual(turnOf([once, once]).texts, ['收尾']);
  // 单行多块：按序号区分，两块都留
  assert.deepEqual(turnOf([rec([text('一'), text('二')], { uuid: 'a1' })]).texts, ['一', '二']);
  // 没有 uuid、分行写、共用 message.id、序号都是 0：不同的块都留，最后一段仍是收尾
  const split = turnOf([rec(text('正文')), rec(text(close('等你决定')))]);
  assert.deepEqual(split.texts, ['正文', close('等你决定')]);
  // 没有 uuid、同一行一字不差写了两遍：只算一次
  assert.deepEqual(turnOf([rec(text('收尾')), rec(text('收尾'))]).texts, ['收尾']);
  // 工具调用缺 id、没有 uuid、分行写：两个都留
  const noId = name => rec({ type: 'tool_use', name, input: {} });
  assert.deepEqual(turnOf([noId('Bash'), noId(WRAP)]).tools.map(t => t.name), ['Bash', WRAP]);
});

function setup(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-wrapup-test-'));
  const transcript = path.join(dir, 't.jsonl');
  fs.writeFileSync(transcript, lines([snapshot, ...records]).join('\n'));
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

test('本轮很长（超过 16MB）：整份读，开头不丢（#151-P2-03）', () => {
  const big = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u-big', content: 'x'.repeat(1024 * 1024) }] } };
  const { dir, transcript, env } = setup([user('跑个大的'), ...Array.from({ length: 17 }, () => big), said(close('等你决定'))]);
  assert.ok(fs.statSync(transcript).size > 16 * 1024 * 1024);
  assert.equal(run({ session_id: 's-big', transcript_path: transcript }, { ...env, AGENT_KIT_NO_LOG: '1' })?.decision, 'block');
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
