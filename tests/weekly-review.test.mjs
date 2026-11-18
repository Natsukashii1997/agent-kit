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
  const { findRecurrences, summarizeRecurrence, projectFiles } = await import('../tools/weekly-review.mjs');
  assert.deepEqual(findRecurrences('- 再犯：G-04、G-11\n说明 G-03 再犯了\n无关 G-05'), ['G-04', 'G-11', 'G-03']);
  const out = summarizeRecurrence([{ project: 'a', name: 'docs/LESSONS.md', text: '再犯：G-04' }, { project: 'b', name: 'docs/LESSONS.md', text: 'G-04 再犯' }, { project: 'c', name: 'docs/LESSONS.md', text: '' }], { 'G-04': '并行会话' });
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
  // 部分升级在层级列里显示「部分」（审查 P2-02）
  const part = summarizeRecurrence([{ project: 'a', text: '再犯：G-14' }], { 'G-14': '探针' }, { 'G-14': '体检' }, { 'G-14': '部分升级' }).join('\n');
  assert.match(part, /\| G-14 探针 \| 〔体检〕部分 \| 1 \| a \|/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-root-'));
  fs.mkdirSync(path.join(root, 'p1', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'p1', 'docs', 'LESSONS.md'), '再犯：G-01');
  fs.mkdirSync(path.join(root, '_归档', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, '_归档', 'docs', 'LESSONS.md'), '再犯：G-02');
  assert.deepEqual(projectFiles(root).map(f => f.project), ['p1']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-week2-'));
  const { text } = build({ dir, now: Date.parse('2026-11-07T12:00:00Z'), workRoot: root });
  assert.match(text, /## 3\. 再犯[\s\S]*G-01/);
});

test('再犯：除了 docs/LESSONS.md，也扫根目录 LESSONS.md 和 CURRENT.md；worktree 目录不重复算（#76）', async () => {
  const { projectFiles, summarizeRecurrence } = await import('../tools/weekly-review.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-root3-'));
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write('a/docs/LESSONS.md', '## L-01 x\n- 再犯：G-04\n');
  write('b/LESSONS.md', '## L-01 y\n- 再犯：G-11\n');
  write('c/CURRENT.md', '- 补记：再犯：G-04、G-13\n');
  write('c/README.md', '再犯：G-99');
  write('a-wt-1/docs/LESSONS.md', '## L-01 x\n- 再犯：G-04\n');
  write('a-wt-1/.git', 'gitdir: /x/a/.git/worktrees/a-wt-1\n');
  const files = projectFiles(root);
  assert.deepEqual(files.map(f => `${f.project}/${f.name}`).sort(), ['a/docs/LESSONS.md', 'b/LESSONS.md', 'c/CURRENT.md']);
  const out = summarizeRecurrence(files, {}, {}).join('\n');
  assert.match(out, /^扫了 3 个项目的 3 份文件/);
  assert.match(out, /\| G-04  \| — \| 2 \| a、c \|/, 'worktree 里那份不算，CURRENT.md 里的算');
  assert.match(out, /\| G-11 .*\| b \|/);
  assert.match(out, /\| G-13 .*\| c \|/);
  assert.ok(!out.includes('G-99'));
});

test('等批的提升：按「升级」行认三种写法，跳过已提升、全局条目和代码块里的格式样例（#76）', async () => {
  const { findPromotions, summarizePromotions } = await import('../tools/weekly-review.mjs');
  // 写法取自真实文件：postpane L-02 / L-26 / L-25、disk-slim L-03、chatgpt-clipper 的格式样例、niuma-home 没有「升级」行的条目
  const text = [
    '# 项目 LESSONS',
    '## 怎么写',
    '- 换个项目也成立的：提议提升到全局坑；原条目保留，末尾加一行「提升：已提升为全局 G-xx（日期）」。',
    '```markdown',
    '## L-01 <一句话现象>（<YYYY-MM-DD>）',
    '- 升级：未升级。',
    '```',
    '## L-02 bun 编译出的程序在 macOS 上一运行就被杀（2026-11-04）',
    '- 升级：未升级。换个项目也成立，可提议提升为全局坑。',
    '## L-03 安装时先删旧版（2026-11-04）',
    '- 升级：未升级。',
    '## L-04 macOS 不区分大小写（2026-11-05）',
    '- 升级：同类第 2 次，已写进 AGENTS.md「规则」。换个项目也成立，提议提升为全局 G-xx（待用户批准）。',
    '## L-05 已写成测试的（2026-11-05）',
    '- 升级：已写成测试 `x`。',
    '  - 升级：已写成测试 `y`。',
    '## L-06 共用构建目录（2026-11-08）',
    '- 升级：未写成测试（构建环境问题）。',
    '## L-07 把请求发出当成功（2026-11-07）',
    '- 升级：已写成测试。可提议提升为全局坑。',
    '- 提升：已提升为全局 G-22（2026-11-08，agent-kit#40）。',
    '## L-08 没有升级行的（2026-11-10）',
    '- 现象：x',
    '## L-09 没有升级行、但已提升的（2026-10-24）',
    '- 提升：已提升为全局 G-08（2026-10-24）。',
    '## G-01 全局条目（2026-10-24 提升）',
    '- 升级：〔提醒〕未升级。',
  ].join('\n');
  const r = findPromotions(text);
  assert.deepEqual(r.pending, [
    { id: 'L-02', title: 'bun 编译出的程序在 macOS 上一运行就被杀', proposed: true },
    { id: 'L-03', title: '安装时先删旧版', proposed: false },
    { id: 'L-04', title: 'macOS 不区分大小写', proposed: true },
  ]);
  assert.deepEqual(r.noLine, [{ id: 'L-08', title: '没有升级行的' }]);
  const out = summarizePromotions([
    { project: 'p', name: 'docs/LESSONS.md', text },
    { project: 'q', name: 'LESSONS.md', text: '## L-01 根目录放法（2026-11-01）\n- 升级：未升级。\n' },
    { project: 'q', name: 'CURRENT.md', text: '## L-09 不算（2026-11-01）\n- 升级：未升级。\n' },
  ]).join('\n');
  assert.match(out, /^扫了 2 个项目的 2 份文件（docs\/LESSONS\.md、LESSONS\.md）。等批 4 条，另有 1 条没有「升级」行。/);
  assert.match(out, /### p（docs\/LESSONS\.md，3 条）\n\n- L-02 bun 编译出的程序在 macOS 上一运行就被杀 〔提议〕\n- L-03 安装时先删旧版\n- L-04 macOS 不区分大小写 〔提议〕/);
  assert.match(out, /### q（LESSONS\.md，1 条）\n\n- L-01 根目录放法/);
  assert.match(out, /没有「升级」行：p 1 条（L-08）/);
  assert.ok(!/L-0[5679]|G-01|<一句话/.test(out));
  assert.match(summarizePromotions([]).join('\n'), /等批 0 条，另有 0 条没有「升级」行/);
});

test('整份材料带「等批的提升」一节，会话复盘顺延为第 5 节（#76）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-root4-'));
  fs.mkdirSync(path.join(root, 'p1', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'p1', 'docs', 'LESSONS.md'), '## L-01 某个坑（2026-11-01）\n- 升级：未升级。\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-week4-'));
  const { text } = build({ dir, now: Date.parse('2026-11-18T12:00:00Z'), workRoot: root });
  assert.match(text, /## 4\. 等批的提升[\s\S]*### p1（docs\/LESSONS\.md，1 条）[\s\S]*- L-01 某个坑/);
  assert.match(text, /## 5\. 会话复盘/);
});
