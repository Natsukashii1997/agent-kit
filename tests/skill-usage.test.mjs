import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { usageRow } from '../hooks/skill-usage.mjs';
import { mergeHooks, ourPostGroups } from '../tools/install.mjs';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'skill-usage.mjs');

test('只记 Skill 调用，取 skill 名、会话、目录', () => {
  const now = new Date('2026-11-07T01:00:00Z');
  assert.deepEqual(usageRow({ tool_name: 'Skill', session_id: 's1', cwd: '/w/p', tool_input: { skill: ' hairline-page ' } }, now), {
    time: '2026-11-07T01:00:00.000Z',
    session: 's1',
    cwd: '/w/p',
    skill: 'hairline-page',
  });
  assert.equal(usageRow({ tool_name: 'Bash', tool_input: { command: 'ls' } }), null);
  assert.equal(usageRow({ tool_name: 'Skill', tool_input: {} }), null);
  assert.equal(usageRow(null), null);
});

test('作为 hook 真跑：写一行日志、不输出、坏输入也退出 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-skill-'));
  const run = input => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', env: { ...process.env, AGENT_KIT_STATE_DIR: dir, AGENT_KIT_NO_LOG: '' } });
  const r = run(JSON.stringify({ tool_name: 'Skill', session_id: 's', cwd: '/x', tool_input: { skill: 'excel-aura' } }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const lines = fs.readFileSync(path.join(dir, 'skill-usage.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).skill, 'excel-aura');
  assert.equal(run('not json').status, 0);
});

test('装进 PostToolUse：只给 Claude；重复安装不叠加；卸载只去掉自己的', () => {
  assert.deepEqual(ourPostGroups('codex', '/n'), []);
  const start = { hooks: { PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'other.sh' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'x' }] }] } };
  const once = mergeHooks(start, ourPostGroups('claude', '/n', '/kit'), { event: 'PostToolUse' });
  const twice = mergeHooks(once, ourPostGroups('claude', '/n', '/kit'), { event: 'PostToolUse' });
  assert.deepEqual(once, twice);
  assert.equal(once.hooks.PostToolUse.length, 2);
  assert.equal(once.hooks.PostToolUse[1].matcher, 'Skill');
  assert.deepEqual(once.hooks.PreToolUse, start.hooks.PreToolUse);
  const removed = mergeHooks(once, [], { remove: true, event: 'PostToolUse' });
  assert.deepEqual(removed, start);
});
