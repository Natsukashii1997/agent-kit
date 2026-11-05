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

