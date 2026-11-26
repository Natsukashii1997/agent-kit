import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classify, LOG_FILE, promptSignal } from '../hooks/thinking-review-nudge.mjs';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'thinking-review-nudge.mjs');
const sig = promptSignal;

// 一份像样的「交来的方案」：长文、带方案类字眼（#135 起不再因此提醒）
const plan = (tag = '') =>
  `# 知识库同步改造方案 V2.0${tag}\n\n## 一、背景与目标\n现有同步靠手工导出，经常漏。本方案把同步改成增量拉取。\n\n## 二、架构\n` +
  '分三层：采集、比对、写入。比对层负责去重，写入层负责回滚。'.repeat(50) +
  '\n\n## 三、验收\n全量测试通过，前后对比无丢失。';

test('点名思维评审：短消息、长消息都提醒', () => {
  for (const p of ['这个思维评审一下', '思维评审', '送 GPT 想一想这个方案', `${plan()}\n\n这份先思维评审一下`]) assert.equal(sig(p), 'asked', p.slice(-20));
});

test('质疑方向或前提：「这个方向对吗」一类都提醒', () => {
  for (const p of ['这个方向对吗', '方向对不对？', '我觉得方向不对，是不是想错了', '前提错了', '思路对吗', '推翻重来吧', '重新考虑一下方案', '这个要不要再论证'])
    assert.equal(sig(p), 'doubt', p);
});

test('交来方案、普通请求、长文都不提醒（#135 去掉了「交来方案」时机）', () => {
  assert.equal(sig(plan()), null, '交来的长方案');
  for (const p of ['按推荐开工', '合并', '把这个按钮改成蓝色', '跑一下测试看看', '已通过，合并', '帮我看下这个报错：TypeError: x is undefined'])
    assert.equal(sig(p), null, p);
  const log = 'Error: ENOENT: no such file or directory, open /x/y.json\n    at Object.openSync (node:fs:573:3)\n'.repeat(30);
  assert.equal(sig(`${log}\n方向不对`), null, '长文里的「方向不对」不算常浩在质疑');
});

test('说「不用送 / 直接开工」不提醒，即使提到思维评审', () => {
  for (const p of ['这个不用送，直接做', '直接开工', '不用思维评审了', '先不评审']) assert.equal(sig(p), null, p);
});

test('别的会话派来的任务（委派）不提醒：里面提到思维评审也不算常浩点名', () => {
  assert.equal(sig(`Background (from the session that started this one):\n${plan()}\n去掉思维评审钩子的泛化提醒`), null);
  assert.equal(sig('Task (from the session that started this one): 这个方向对吗'), null);
  assert.equal(sig(`Please carry out this task for me.\n思维评审`), null);
});

test('后台事件、会话间通知、斜杠命令不提醒', () => {
  assert.equal(sig('<side-sessions-event>思维评审</side-sessions-event>'), null);
  assert.equal(sig('<task-notification>\n<task-id>x</task-id>方向不对'), null);
  assert.equal(sig('[SYSTEM NOTIFICATION - NOT USER INPUT] 思维评审'), null);
  assert.equal(sig('/thinking-review 这个方案'), null);
  assert.equal(sig('This session is being continued from a previous conversation that ran out of context.\n思维评审'), null, '压缩后的续接摘要');
  assert.equal(sig('The agent-hud plugin sent a message.\n思维评审'), null, '驿窗转回的 GPT 回信');
  assert.equal(sig('<command-message>to-spec</command-message>\n思维评审'), null, '斜杠命令展开');
  assert.equal(sig(''), null);
});

test('改文件、Bash 写文件、退出计划模式都不再是节点（#135）', () => {
  const pre = (tool_name, tool_input) => classify({ hook_event_name: 'PreToolUse', tool_name, cwd: '/x/proj', tool_input });
  assert.equal(pre('Edit', { file_path: '/Users/x/proj/a.ts' }), null);
  assert.equal(pre('Write', { file_path: '/Users/x/proj/a.ts', content: 'x' }), null);
  assert.equal(pre('Bash', { command: "sed -i '' 's/a/b/' src/a.js" }), null);
  assert.equal(pre('ExitPlanMode', { plan: '新架构：把同步改成增量拉取' }), null);
  assert.deepEqual(classify({ hook_event_name: 'UserPromptSubmit', prompt: '这个方向对吗' }), { event: 'prompt', signal: 'doubt' });
});

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-trn-'));
  const session = `test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const run = (input, env = {}) => {
    const r = spawnSync(process.execPath, [HOOK], {
      input: typeof input === 'string' ? input : JSON.stringify({ session_id: session, cwd: '/x/proj', ...input }),
      encoding: 'utf8',
      env: { ...process.env, AGENT_KIT_STATE_DIR: dir, ...env },
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
  };
  const log = () => {
    const f = path.join(dir, LOG_FILE);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  };
  return { dir, session, run, log };
}

test('作为 hook 真跑：点名提醒格式对、只提醒不做决定、同一信号一个会话只提醒一次', () => {
  const { run, log } = harness();
  const p = run({ hook_event_name: 'UserPromptSubmit', prompt: '这个方案思维评审一下' });
  assert.equal(p.hookEventName, 'UserPromptSubmit');
  assert.match(p.additionalContext, /thinking-review/);
  assert.match(p.additionalContext, /常浩提到了思维评审/);
  assert.equal(p.permissionDecision, undefined);
  assert.equal(run({ hook_event_name: 'UserPromptSubmit', prompt: '再思维评审一下' }), null, '同一会话第二次点名不重复提醒');
  const d = run({ hook_event_name: 'UserPromptSubmit', prompt: '这个方向对吗' });
  assert.match(d.additionalContext, /质疑方向或前提/);
  assert.match(d.additionalContext, /判断需要≠必须发起/);
  assert.deepEqual(log().map(r => [r.event, r.signal, r.nudged]), [['prompt', 'asked', true], ['prompt', 'asked', false], ['prompt', 'doubt', true]]);
  assert.ok(!JSON.stringify(log()).includes('方案'), '记录里不留提示词');
});

test('作为 hook 真跑：交来方案、普通改文件、退出计划模式、委派都不提醒、不拦、不记录', () => {
  const { run, log } = harness();
  assert.equal(run({ hook_event_name: 'UserPromptSubmit', prompt: plan() }), null, '交来方案');
  assert.equal(run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/x/proj/a.ts' } }), null, '普通改文件');
  assert.equal(run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo x > notes.md' } }), null, 'Bash 写文件');
  assert.equal(run({ hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: 'p' } }), null, '退出计划模式');
  assert.equal(run({ hook_event_name: 'UserPromptSubmit', prompt: `Background (from the session that started this one):\n${plan()}` }), null, '委派');
  assert.deepEqual(log(), []);
});

test('点名之后改文件也不拦（#135 去掉了改文件拦截）', () => {
  const { run } = harness();
  for (const prompt of ['这个思维评审一下', '我觉得方向不对']) {
    run({ hook_event_name: 'UserPromptSubmit', prompt });
    assert.equal(run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/x/proj/a.ts' } }), null, prompt);
  }
});

test('出错一律静默放行：坏输入、状态目录不可写', () => {
  const { run } = harness();
  assert.equal(run('not json'), null);
  assert.equal(run({}), null);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ak-trn-')), 'not-a-dir');
  fs.writeFileSync(file, '');
  assert.equal(run({ hook_event_name: 'UserPromptSubmit', prompt: '思维评审' }, { AGENT_KIT_STATE_DIR: file }), null);
});

test('耗时：单次调用在 1 秒内', () => {
  const { run } = harness();
  const t = Date.now();
  for (let i = 0; i < 5; i++) run({ hook_event_name: 'UserPromptSubmit', prompt: `思维评审${i}` });
  const avg = (Date.now() - t) / 5;
  console.log(`thinking-review-nudge 平均每次 ${avg.toFixed(0)} ms（含 node 启动）`);
  assert.ok(avg < 1000);
});

test('手动关闭：状态目录里有 thinking-review-nudge.off 就不提醒、不记录', () => {
  const { dir, run } = harness();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'thinking-review-nudge.off'), '');
  assert.equal(run({ hook_event_name: 'UserPromptSubmit', prompt: '这个思维评审一下' }), null);
  assert.ok(!fs.existsSync(path.join(dir, LOG_FILE)));
});
