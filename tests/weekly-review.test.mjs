import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, summarizeHits } from '../tools/weekly-review.mjs';

test('提醒统计：只算近 7 天，真正提醒和关键词匹配分开写，按提醒次数排，附项目名（和 doctor 同口径）', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const rows = [
    { time: '2026-11-04T10:00:00Z', session: 's1', cwd: '/w/work-desk', ids: ['G-05', 'G-18'], reminded: ['G-05', 'G-18'] },
    { time: '2026-11-04T10:05:00Z', session: 's1', cwd: '/w/work-desk', ids: ['G-05'], reminded: [] },
    { time: '2026-11-04T10:06:00Z', session: 's1', cwd: '/w/work-desk', ids: ['G-05'], reminded: [] },
    { time: '2026-11-04T11:00:00Z', session: 's2', cwd: '/w/github-center', ids: ['G-18'], reminded: ['G-18'] },
    { time: '2026-10-01T11:00:00Z', session: 's0', cwd: '/w/old', ids: ['G-01'], reminded: ['G-01'] },
  ];
  const out = summarizeHits(rows.map(r => JSON.stringify(r)).join('\n') + '\nnot json\n', now, { 'G-05': 'launchd 读不了文稿' });
  assert.equal(out[0], '一共提醒 3 次，2 个会话，平均每会话 1.5 条。同一会话同一条只提醒一次；匹配是关键词比对上的次数，常见词会被放大。');
  assert.equal(out[2], '| 坑 | 提醒次数（会话数） | 匹配次数 | 项目 |');
  assert.equal(out[4], '| G-18  | 2（2） | 2 | work-desk、github-center |');
  assert.equal(out[5], '| G-05 launchd 读不了文稿 | 1（1） | 3 | work-desk |');
  assert.ok(!out.join('\n').includes('G-01'));
  assert.deepEqual(summarizeHits('', now), ['近 7 天没有命中（或 hook 还没装）。']);
});

test('生成整份材料', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-week-'));
  const { text } = build({ dir, now: Date.parse('2026-11-05T12:00:00Z') });
  assert.match(text, /^# 每周整理输入（2026-11-05）/);
  assert.match(text, /## 1\. agent-kit 自检/);
  assert.match(text, /## 2\. 近 7 天全局坑提醒/);
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
  // 关闭的坑（已被代码消除）不进升级首选，层级列显示「关闭」；又再犯的单列，提示先核实关闭依据
  const closed = summarizeRecurrence(
    [{ project: 'a', text: '再犯：G-30、G-09' }],
    { 'G-30': '已消除', 'G-09': '强调色' },
    { 'G-30': '提醒', 'G-09': '提醒' },
    { 'G-30': '关闭', 'G-09': '未升级' },
  ).join('\n');
  assert.match(closed, /\| G-30 已消除 \| 〔提醒〕关闭 \| 1 \| a \|/);
  assert.match(closed, /升级首选.*：G-09。/);
  assert.ok(!/升级首选.*G-30/.test(closed));
  assert.match(closed, /已关闭又再犯：G-30。先核实关闭的依据/);
  assert.ok(!/已关闭又再犯/.test(lv));
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
    // 关闭的条目（写法取自 chatgpt-clipper L-03）：后面保留的旧记录里有「未升级」，也不算等批
    '## L-10 已被代码消除的（2026-11-19）',
    '- 升级：〔提醒〕关闭（2026-11-19，积压清单组 15）：核实测试按数据类型找下载文件。此前：〔提醒〕未升级。',
    '## L-11 已被代码消除、层级是结构的（2026-11-19）',
    '- 升级：〔结构〕关闭（2026-11-19，积压清单组 15）：只留一种做法。此前：未升级，可提议提升为全局坑。',
    '## L-09 没有升级行、但已提升的（2026-10-24）',
    '- 提升：已提升为全局 G-08（2026-10-24）。',
    '## G-01 全局条目（2026-10-24 提升）',
    '- 升级：〔提醒〕未升级。',
  ].join('\n');
  const r = findPromotions(text);
  assert.deepEqual(r.pending, [
    { id: 'L-02', title: 'bun 编译出的程序在 macOS 上一运行就被杀', proposed: true, upgrade: '未升级。换个项目也成立，可提议提升为全局坑。' },
    { id: 'L-03', title: '安装时先删旧版', proposed: false, upgrade: '未升级。' },
    { id: 'L-04', title: 'macOS 不区分大小写', proposed: true, upgrade: '同类第 2 次，已写进 AGENTS.md「规则」。换个项目也成立，提议提升为全局 G-xx（待用户批准）。' },
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
  assert.ok(!/L-0[5679]|L-1[01]|G-01|<一句话/.test(out));
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

test('--json：第 3、4 节的机器可读版，升级首选在前，只读不写文件（#80）', async () => {
  const { buildJson } = await import('../tools/weekly-review.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-json-'));
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  // 四种条目：再犯、提议提升、只写未升级、没有升级行
  write('a/docs/LESSONS.md', [
    '## L-01 又开了并行会话（2026-11-10）',
    '- 再犯：G-04',
    '- 升级：未升级。',
    '## L-02 换个项目也成立的坑（2026-11-11）',
    '- 升级：未升级。换个项目也成立，提议提升为全局 G-xx。',
    '## L-03 只写未升级的（2026-11-12）',
    '- 升级：未升级。',
    '## L-04 没有升级行的（2026-11-13）',
    '- 现象：x',
    '## L-05 已关闭的（2026-11-19）',
    '- 升级：〔提醒〕关闭（2026-11-19，积压清单组 15）：核实坑已被代码消除。此前：〔提醒〕未升级。',
  ].join('\n'));
  write('b/CURRENT.md', '- 补记：再犯：G-02、G-04\n');
  write('c/LESSONS.md', '## L-09 又一次（2026-11-14）\n- 再犯：G-02\n- 再犯：G-02\n- 再犯：G-02\n- 再犯：G-30\n');
  const lessonsText = [
    '## G-02 时间（2026-10-24 提升）', '- 升级：〔机检〕已升级。',
    '## G-04 并行会话（2026-10-24 提升）', '- 升级：〔文字〕已升级。',
    '## G-30 已消除（2026-11-19 提升）', '- 升级：〔提醒〕关闭（2026-11-19，示例）：坑已被代码消除。',
  ].join('\n');
  const before = fs.readdirSync(root).sort();
  const j = buildJson({ now: Date.parse('2026-11-18T02:00:00Z'), workRoot: root, lessonsText });
  assert.equal(j.schema, 1);
  assert.equal(j.day, '2026-11-18');
  assert.deepEqual(j.scanned, { projects: 3, files: 3 });
  // G-02 再犯条目更多（4 > 2），但 G-04 在〔文字〕层，是升级首选，排最前
  assert.deepEqual(j.recurrences, [
    { id: 'G-04', title: '并行会话', level: '文字', status: '已升级', prime: true, count: 2, projects: ['a', 'b'] },
    { id: 'G-02', title: '时间', level: '机检', status: '已升级', prime: false, count: 4, projects: ['b', 'c'] },
    // 关闭的坑在〔提醒〕层，但不算升级首选
    { id: 'G-30', title: '已消除', level: '提醒', status: '关闭', prime: false, count: 1, projects: ['c'] },
  ]);
  assert.deepEqual(j.promotions.map(p => [p.project, p.file, p.id, p.proposed]), [
    ['a', 'docs/LESSONS.md', 'L-01', false],
    ['a', 'docs/LESSONS.md', 'L-02', true],
    ['a', 'docs/LESSONS.md', 'L-03', false],
  ]);
  assert.equal(j.promotions[1].title, '换个项目也成立的坑');
  assert.match(j.promotions[1].upgrade, /提议提升为全局/);
  assert.equal(j.noUpgradeLine, 2, 'a 的 L-04、c 的 L-09 没有「升级」行');
  assert.deepEqual(fs.readdirSync(root).sort(), before);

  // 命令行：只打印 JSON，不写 weekly/，不跑自检
  const { spawnSync } = await import('node:child_process');
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-json-state-'));
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/weekly-review.mjs', import.meta.url)), '--json'], {
    encoding: 'utf8',
    env: { ...process.env, AGENT_KIT_WORK_ROOT: root, AGENT_KIT_STATE_DIR: state },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.schema, 1);
  assert.deepEqual(out.recurrences.map(x => x.id).sort(), ['G-02', 'G-04', 'G-30']);
  assert.deepEqual(fs.readdirSync(state), [], '状态目录里什么都没写');
});

test('--json 和 Markdown 的再犯、等批两节出自同一份汇总（#80）', async () => {
  const { buildJson, summarizeRecurrence, summarizePromotions, projectFiles } = await import('../tools/weekly-review.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-json2-'));
  fs.mkdirSync(path.join(root, 'p', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'p', 'docs', 'LESSONS.md'), '## L-01 x（2026-11-01）\n- 再犯：G-07\n- 升级：未升级，提议提升。\n');
  const j = buildJson({ workRoot: root, lessonsText: '' });
  const files = projectFiles(root);
  assert.match(summarizeRecurrence(files).join('\n'), new RegExp(`\\| ${j.recurrences[0].id} .*\\| ${j.recurrences[0].count} \\| p \\|`));
  assert.match(summarizePromotions(files).join('\n'), /- L-01 x 〔提议〕/);
  assert.equal(j.promotions[0].proposed, true);
  assert.equal(j.recurrences[0].level, null);
});

test('再犯：写的是被并入的旧编号，算到合并后的条目上（瘦身提案 S3、S5、S6）', async () => {
  const { summarizeRecurrence, buildJson } = await import('../tools/weekly-review.mjs');
  const out = summarizeRecurrence([{ project: 'a', text: '再犯：G-23' }, { project: 'b', text: '再犯：G-04' }], { 'G-04': '并行会话' }, { 'G-04': '文字' }, {}, { 'G-23': 'G-04' }).join('\n');
  assert.match(out, /\| G-04 并行会话 \| 〔文字〕 \| 2 \| a、b \|/);
  assert.ok(!out.includes('G-23'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-wr-merged-'));
  fs.mkdirSync(path.join(root, 'p', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'p', 'docs', 'LESSONS.md'), '## L-01 x\n- 再犯：G-47\n');
  const j = buildJson({ workRoot: root });
  assert.deepEqual(j.recurrences.map(r => [r.id, r.count]), [['G-46', 1]]);
});
