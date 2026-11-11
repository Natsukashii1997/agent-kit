import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build, summarizeHits } from '../tools/weekly-review.mjs';

test('命中统计：只算近 7 天，按次数排序，附项目名', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const rows = [
    { time: '2026-11-04T10:00:00Z', session: 's1', cwd: '/w/work-desk', ids: ['G-05', 'G-18'] },
    { time: '2026-11-04T11:00:00Z', session: 's2', cwd: '/w/github-center', ids: ['G-05'] },
    { time: '2026-10-01T11:00:00Z', session: 's0', cwd: '/w/old', ids: ['G-01'] },
  ];
  const out = summarizeHits(rows.map(r => JSON.stringify(r)).join('\n') + '\nnot json\n', now, { 'G-05': 'launchd 读不了文稿' });
  assert.match(out[2], /^\| G-05 launchd 读不了文稿 \| 2 \| 2 \| work-desk、github-center \|$/);
  assert.match(out[3], /^\| G-18/);
  assert.ok(!out.join('\n').includes('G-01'));
  assert.deepEqual(summarizeHits('', now), ['近 7 天没有命中（或 hook 还没装）。']);
});

test('生成整份材料', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-week-'));
  const { text } = build({ dir, now: Date.parse('2026-11-05T12:00:00Z') });
  assert.match(text, /^# 每周整理输入（2026-11-05）/);
  assert.match(text, /## 1\. agent-kit 自检/);
  assert.match(text, /## 2\. 近 7 天全局坑提醒命中/);
  assert.match(text, /session-retro/);
});


test('再犯：两种写法都认，按坑汇总并附项目；没有就说明口径', async () => {
  const { findRecurrences, summarizeRecurrence, lessonsFiles } = await import('../tools/weekly-review.mjs');
  assert.deepEqual(findRecurrences('- 再犯：G-04、G-11\n说明 G-03 再犯了\n无关 G-05'), ['G-04', 'G-11', 'G-03']);
  const out = summarizeRecurrence([{ project: 'a', text: '再犯：G-04' }, { project: 'b', text: 'G-04 再犯' }, { project: 'c', text: '' }], { 'G-04': '并行会话' });
  assert.match(out.join('\n'), /\| G-04 并行会话 \| — \| 2 \| a、b \|/);
  assert.ok(!out.join('\n').includes('升级首选'));
  assert.match(summarizeRecurrence([]).join('\n'), /没有标「再犯：G-xx」/);
  // #57：带层级列；〔文字〕〔提醒〕层又再犯的单列为升级首选，〔机检〕的不进首选
  const lv = summarizeRecurrence(
    [{ project: 'a', text: '再犯：G-04、G-02、G-09' }],
    { 'G-04': '并行会话', 'G-02': '时间', 'G-09': '强调色' },
    { 'G-04': '文字', 'G-02': '机检', 'G-09': '提醒' },
  ).join('\n');
  assert.match(lv, /\| G-04 并行会话 \| 〔文字〕 \| 1 \| a \|/);
  assert.match(lv, /\| G-02 时间 \| 〔机检〕 \| 1 \| a \|/);
  assert.match(lv, /升级首选.*G-04、G-09/);
  assert.ok(!/升级首选.*G-02/.test(lv));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-root-'));
  fs.mkdirSync(path.join(root, 'p1', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'p1', 'docs', 'LESSONS.md'), '再犯：G-01');
  fs.mkdirSync(path.join(root, '_归档', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, '_归档', 'docs', 'LESSONS.md'), '再犯：G-02');
  assert.deepEqual(lessonsFiles(root).map(f => f.project), ['p1']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-week2-'));
  const { text } = build({ dir, now: Date.parse('2026-11-07T12:00:00Z'), workRoot: root });
  assert.match(text, /## 3\. 再犯[\s\S]*G-01/);
});
