import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { haystackOf, LESSONS_FILE, matchLessons, parseLessons } from '../hooks/lessons-remind.mjs';

const lessons = parseLessons(fs.readFileSync(LESSONS_FILE, 'utf8'));
const ids = haystack => matchLessons(lessons, haystack).map(e => e.id);

test('LESSONS 每条 G-xx 都有「触发」一行，正则能编译', () => {
  assert.ok(lessons.length >= 18);
  for (const e of lessons) assert.ok(Array.isArray(e.triggers), `${e.id} 缺「- 触发：」一行`);
  const text = fs.readFileSync(LESSONS_FILE, 'utf8');
  for (const m of text.matchAll(/^- 触发：(.*)$/gm))
    for (const t of m[1].matchAll(/`([^`]+)`/g))
      if (t[1].startsWith('/') && t[1].endsWith('/') && t[1].length > 2) assert.doesNotThrow(() => new RegExp(t[1].slice(1, -1)), t[1]);
});

test('典型命令命中对应的坑', () => {
  assert.deepEqual(ids('launchctl bootout gui/501/com.x && launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.x.plist').sort(), ['G-05', 'G-18']);
  assert.ok(ids('/usr/libexec/PlistBuddy -c "Print :x" a.plist').includes('G-06'));
  assert.ok(ids('codesign --force --sign - ~/Applications/X.app').includes('G-15'));
  assert.ok(ids('hermes cron incidents').includes('G-14'));
  assert.ok(ids('nohup ./wait.sh &').includes('G-12'));
  assert.ok(ids('const t = row.createdAt.slice(0, 16)').includes('G-02'));
  assert.ok(ids("s.replace('T', ' ')").includes('G-02'));
  assert.ok(ids('#!/bin/bash\nset -euo pipefail').includes('G-08'));
});

test('普通命令不误报', () => {
  for (const cmd of ['git status', 'npm test', 'ls -la', 'node --test tests/', 'git push -u origin claude/x', 'cat README.md'])
    assert.deepEqual(ids(cmd), [], cmd);
});

test('改文件类工具：拿路径和新内容来比', () => {
  const h = haystackOf({ tool_name: 'Edit', tool_input: { file_path: '/p/src/time.js', old_string: 'a', new_string: 'x.updatedAt.slice(0, 16)' } });
  assert.ok(matchLessons(lessons, h).some(e => e.id === 'G-02'));
  assert.equal(haystackOf({}), '');
});

test('作为 hook 真跑：同一会话同一条只提醒一次，并记一行命中日志', () => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'lessons-remind.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-remind-'));
  const session = `test-${process.pid}-${Date.now()}`;
  const run = command =>
    spawnSync(process.execPath, [file], {
      input: JSON.stringify({ session_id: session, tool_name: 'Bash', cwd: '/x/work-desk', tool_input: { command } }),
      encoding: 'utf8',
      env: { ...process.env, AGENT_KIT_STATE_DIR: dir },
    });
  const first = run('launchctl list');
  assert.equal(first.status, 0);
  const ctx = JSON.parse(first.stdout).hookSpecificOutput;
  assert.equal(ctx.hookEventName, 'PreToolUse');
  assert.match(ctx.additionalContext, /G-05/);
  assert.equal(ctx.permissionDecision, undefined, '只提醒，不做放行或拦截的决定');
  const second = run('launchctl print gui/501/x');
  assert.equal(second.stdout, '', '同一会话第二次不再提醒');
  const log = fs.readFileSync(path.join(dir, 'lessons-hits.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(log.length, 2);
  assert.deepEqual(log[1].reminded, []);
  assert.equal(run('git status').stdout, '');
});
