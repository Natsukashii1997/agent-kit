import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classify, isScratchPath, LOG_FILE, promptSignal } from '../hooks/thinking-review-nudge.mjs';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'thinking-review-nudge.mjs');
const sig = p => promptSignal(p)?.signal ?? null;

// 一份像样的「交来的方案」：长文、带方案类字眼
const plan = (tag = '') =>
  `# 知识库同步改造方案 V2.0${tag}\n\n## 一、背景与目标\n现有同步靠手工导出，经常漏。本方案把同步改成增量拉取。\n\n## 二、架构\n` +
  '分三层：采集、比对、写入。比对层负责去重，写入层负责回滚。'.repeat(50) +
  '\n\n## 三、验收\n全量测试通过，前后对比无丢失。';

test('交来的长方案：判为 handoff，同一份只算一个 key', () => {
  assert.ok(plan().length >= 1200);
  const a = promptSignal(plan());
  assert.equal(a.signal, 'handoff');
  assert.equal(promptSignal(plan()).key, a.key);
  assert.notEqual(promptSignal(plan('（第二版）')).key, a.key);
});

test('一页长度的中文方案（约 600 字）也算交来方案', () => {
  const page = `这是 GPT 给的任务书，按这个实施。\n# 同步状态持久化任务书\n## 目标\n${'推送中途被打断时清单会写坏，下次整库重传。'.repeat(14)}\n## 方案\n${'引入事务性存储，每推送成功一个文件就更新状态。'.repeat(8)}\n## 验收\n中断后不整库重传。`;
  assert.ok(page.length >= 500 && page.length < 900, String(page.length));
  assert.equal(sig(page), 'handoff');
});

test('常浩的短指令和普通请求不提醒', () => {
  for (const p of ['按推荐开工', '合并', '把这个按钮改成蓝色', '跑一下测试看看', '已通过，合并', '帮我看下这个报错：TypeError: x is undefined'])
    assert.equal(sig(p), null, p);
});

test('长文但不是方案（报错日志、普通长问题）不提醒', () => {
  const log = 'Error: ENOENT: no such file or directory, open /x/y.json\n    at Object.openSync (node:fs:573:3)\n'.repeat(30);
  assert.equal(sig(log), null);
  assert.equal(sig(`${log}\nsee spec.ts`), null, '只有一个方案类字眼不够');
});

test('点名思维评审、质疑方向、说不用送', () => {
  assert.equal(sig('这个思维评审一下'), 'asked');
  assert.equal(sig('我觉得方向不对，是不是想错了'), 'doubt');
  assert.equal(sig('这个不用送，直接做'), 'optout');
  assert.equal(sig('直接开工'), 'optout');
  assert.equal(sig(`${plan()}\n不要再评审了`), 'handoff', '长文里的「不要评审」不当成常浩的指令');
});

test('后台事件、会话间通知、斜杠命令不提醒', () => {
  assert.equal(sig(`<side-sessions-event>${plan()}</side-sessions-event>`), null);
  assert.equal(sig(`<task-notification>\n<task-id>x</task-id>${plan()}`), null);
  assert.equal(sig('[SYSTEM NOTIFICATION - NOT USER INPUT] 思维评审'), null);
  assert.equal(sig('/thinking-review 这个方案'), null);
  assert.equal(sig(`This session is being continued from a previous conversation that ran out of context.\n${plan()}`), null, '压缩后的续接摘要');
  assert.equal(sig(`Background (from the session that started this one):\n${plan()}`), null, '别的会话派来的任务说明');
  assert.equal(sig(`The agent-hud plugin sent a message.\n${plan()}`), null, '驿窗转回的 GPT 回信');
  assert.equal(sig(`<command-message>to-spec</command-message>\n${plan()}`), null, '斜杠命令展开');
  assert.equal(sig(''), null);
});

test('改文件节点：草稿、临时目录、Claude 自己的记忆不算', () => {
  const home = os.homedir();
  assert.ok(isScratchPath('/tmp/x.md'));
  assert.ok(isScratchPath('/private/tmp/claude-501/s/scratchpad/a.html'));
  assert.ok(isScratchPath(path.join(home, '.claude/projects/p/memory/a.md')));
  assert.ok(!isScratchPath(path.join(home, 'Documents/proj/src/a.ts')));
  assert.ok(!isScratchPath('/tmpfoo/a.ts'));
  const e = f => classify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: f } });
  assert.equal(e('/Users/x/proj/a.ts').signal, 'first-edit');
  assert.equal(e('/tmp/a.ts'), null);
  assert.equal(classify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }), null);
  assert.equal(classify({ hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: 'x' } }).signal, 'plan');
});

test('Bash 里改文件也算第一次改文件；只读命令、写到草稿和 /dev/null 的不算', () => {
  const b = (command, cwd = '/x/proj') => classify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command } })?.signal ?? null;
  for (const c of [
    "sed -i '' 's/#3366cc/#2f7d5b/' src/ui/status.html",
    'sed -i.bak -e s/a/b/ a.txt',
    "perl -pi -e 's/a/b/' x.js",
    'echo hi > notes.md',
    'cat >> src/a.js <<EOF\nx\nEOF',
    'npm test | tee test.log',
    'git apply fix.patch',
    "python3 - <<'EOF'\nopen('a.py','w').write(s)\nEOF",
  ])
    assert.equal(b(c), 'first-edit', c);
  for (const c of [
    'git status',
    'grep -rn x . 2>/dev/null',
    'npm test 2>&1 | tail -5',
    'ls > /dev/null',
    'node a.mjs >&2',
    'echo x > /tmp/a.txt',
    "cat > /private/tmp/claude-501/s/scratchpad/a.md <<'EOF'\nx\nEOF",
    "python3 - <<'EOF'\nprint(len(open('a').read()))\nEOF",
    "sed -n 1,20p a.js",
  ])
    assert.equal(b(c), null, c);
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
  const log = () => fs.readFileSync(path.join(dir, LOG_FILE), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  return { dir, session, run, log };
}

test('作为 hook 真跑：提醒格式对、只提醒不做决定、同一节点只提醒一次', () => {
  const { run, log } = harness();
  const p = run({ hook_event_name: 'UserPromptSubmit', prompt: plan() });
  assert.equal(p.hookEventName, 'UserPromptSubmit');
  assert.match(p.additionalContext, /thinking-review/);
  assert.match(p.additionalContext, /判断需要≠必须发起/);
  assert.equal(p.permissionDecision, undefined);
  assert.equal(run({ hook_event_name: 'UserPromptSubmit', prompt: plan() }), null, '同一份方案第二次不提醒');
  assert.ok(run({ hook_event_name: 'UserPromptSubmit', prompt: plan('（V3）') }), '新的一份方案再提醒');

  const edit = { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/x/proj/a.ts', content: 'secret' } };
  const first = run(edit);
  assert.equal(first.hookEventName, 'PreToolUse');
  assert.match(first.additionalContext, /第一次改项目文件/);
  assert.equal(first.permissionDecision, undefined);
  assert.equal(run(edit), null);
  assert.equal(run({ ...edit, tool_name: 'Edit', tool_input: { file_path: '/x/proj/b.ts' } }), null);

  const rows = log();
  assert.deepEqual(rows.map(r => [r.event, r.signal, r.nudged]), [
    ['prompt', 'handoff', true], ['prompt', 'handoff', false], ['prompt', 'handoff', true],
    ['edit', 'first-edit', true], ['edit', 'first-edit', false], ['edit', 'first-edit', false],
  ]);
  const raw = JSON.stringify(rows);
  assert.ok(!raw.includes('知识库') && !raw.includes('secret') && !raw.includes('a.ts'), '记录里不留提示词、文件内容和路径');
});

test('本会话已调用过 thinking-review：动手前两个节点不再提醒，新方案照样提醒', () => {
  const { dir, session, run, log } = harness();
  fs.writeFileSync(path.join(dir, 'skill-usage.jsonl'), `${JSON.stringify({ time: 't', session, cwd: '/x', skill: 'thinking-review' })}\n`);
  assert.equal(run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/x/proj/a.ts' } }), null);
  assert.equal(run({ hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: 'p' } }), null);
  assert.ok(run({ hook_event_name: 'UserPromptSubmit', prompt: plan() }));
  assert.deepEqual(log().map(r => r.skip ?? 'nudged'), ['judged', 'judged', 'nudged']);
});

test('说「不用送」：记一行 optout，不提醒', () => {
  const { run, log } = harness();
  assert.equal(run({ hook_event_name: 'UserPromptSubmit', prompt: '这个不用送，直接做' }), null);
  assert.deepEqual(log().map(r => r.skip), ['optout']);
});

test('出错一律静默放行：坏输入、状态目录不可写', () => {
  const { run } = harness();
  assert.equal(run('not json'), null);
  assert.equal(run({}), null);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ak-trn-')), 'not-a-dir');
  fs.writeFileSync(file, '');
  assert.equal(run({ hook_event_name: 'UserPromptSubmit', prompt: plan() }, { AGENT_KIT_STATE_DIR: file }), null);
});

test('耗时：单次调用在 1 秒内', () => {
  const { run } = harness();
  const t = Date.now();
  for (let i = 0; i < 5; i++) run({ hook_event_name: 'UserPromptSubmit', prompt: `${plan()}${i}` });
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
