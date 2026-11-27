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

test('参数严格解析：--help 只打印用法、不写文件；不认识的参数报错退出（复盘 B1，#154）', async () => {
  const { spawnSync } = await import('node:child_process');
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-cli-'));
  const script = fileURLToPath(new URL('../tools/weekly-review.mjs', import.meta.url));
  const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, AGENT_KIT_WORK_ROOT: state, AGENT_KIT_STATE_DIR: state } });

  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /用法/);
  assert.deepEqual(fs.readdirSync(state), []);

  const typo = run(['--stdot']);
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /不认识的参数：--stdot/);
  assert.deepEqual(fs.readdirSync(state), []);

  const both = run(['--stdout', '--json']);
  assert.equal(both.status, 2);
  assert.deepEqual(fs.readdirSync(state), []);
});

test('修复类提交的认法：和提交检查同口径（#163）', async () => {
  const { isFixSubject } = await import('../tools/weekly-review.mjs');
  const yes = ['fix: 空指针', 'Fix 登录', '修登录页崩溃', '#172 返修：按第 2 轮审查', '接力：重读上限失效（缺陷修复）', '0B-4d L3 第 3 轮返修', 'hotfix 额度读数', '回滚 #88 的侧栏改动'];
  const no = ['修改文案', '修订 PRD', 'feat: 加修复入口', 'docs: 返修记录', 'CURRENT：#153 返修中', 'Merge branch main', 'Revert "修复登录"', 'fixup! 修复登录', '加一个按钮', ''];
  for (const s of yes) assert.equal(isFixSubject(s), true, s);
  for (const s of no) assert.equal(isFixSubject(s), false, s);
  // 共用的提交检查合进来以后（agent-kit#133），两边对同一批标题的判断必须一样
  const shared = new URL('../git-hooks/commit-msg.mjs', import.meta.url);
  if (fs.existsSync(fileURLToPath(shared))) {
    const { checkMessage } = await import(shared.href);
    for (const s of [...yes, ...no]) assert.equal(isFixSubject(s), checkMessage(s) !== '', `和 git-hooks/commit-msg.mjs 判断不一样：${s}`);
  }
});

test('同一处修到第三次：只数修复类提交，变基重复只算一次，文档、测试、锁文件不算，不到 3 次不列（#163）', async () => {
  const { parseFixLog, hotspotsOf } = await import('../tools/weekly-review.mjs');
  const c = (hash, at, subject, files) => `\x1e${hash}\x1f${at}\x1f${subject}\n\n${files.join('\n')}\n`;
  const log = [
    c('a1', 100, '修复回信认不出', ['src/handoff.rs', 'docs/接力.md', 'tests/handoff.test.mjs']),
    c('a2', 200, '#12 返修：回信认不出第二种页面', ['src/handoff.rs', 'src/reader.js']),
    c('a3', 300, 'fix: 回信认不出第三种页面', ['src/handoff.rs', 'src/reader.js', 'package-lock.json']),
    c('b3', 300, 'fix: 回信认不出第三种页面', ['package-lock.json', 'src/reader.js', 'src/handoff.rs']), // a3 变基后的副本：哈希不同，时间、标题、文件相同
    c('a4', 400, 'feat: 加重读按钮', ['src/handoff.rs', 'src/reader.js']),
    c('a5', 500, '修正拼写', ['docs/接力.md']),
    c('a6', 600, '修复文档链接', ['docs/接力.md']),
  ].join('');
  const commits = parseFixLog(log);
  assert.equal(commits.length, 7);
  assert.deepEqual(commits[0].files, ['src/handoff.rs', 'docs/接力.md', 'tests/handoff.test.mjs']);
  const hot = hotspotsOf(commits);
  assert.deepEqual(hot.map(h => [h.file, h.count]), [['src/handoff.rs', 3]]);
  assert.equal(hot[0].latest.subject, 'fix: 回信认不出第三种页面');

  // 同一秒、同标题、改了不同文件的两个真实提交不能被并成一个（#163-P2-04）
  const twin = parseFixLog([
    c('t1', 900, '修复登录页', ['src/login.js', 'src/session.js']),
    c('t2', 900, '修复登录页', ['src/auth.js', 'src/session.js']),
    c('t3', 901, '修复登录页二', ['src/session.js']),
  ].join(''));
  assert.deepEqual(hotspotsOf(twin).map(h => [h.file, h.count]), [['src/session.js', 3]]);

  // 锁文件按文件名排除，名字里带 lock 的真代码照算（#163-P2-05）
  const locks = ['uv.lock', 'poetry.lock', 'Pipfile.lock', 'bun.lock', 'bun.lockb', 'Gemfile.lock', 'composer.lock', 'npm-shrinkwrap.json', 'apps/web/pnpm-lock.yaml', 'go.sum'];
  const withLocks = parseFixLog([1, 2, 3].map(i => c(`l${i}`, 1000 + i, `修复依赖 ${i}`, [...locks, 'src/lock.js', 'src/unlock/index.ts'])).join(''));
  assert.deepEqual(hotspotsOf(withLocks).map(h => h.file).sort(), ['src/lock.js', 'src/unlock/index.ts']);
});

test('同一处修到第三次：真实 git 仓库里跑一遍，按次数排，超过 7 天的不算，worktree 不重复扫（#163）', async () => {
  const { spawnSync } = await import('node:child_process');
  const { summarizeHotspots } = await import('../tools/weekly-review.mjs');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-hot-'));
  const now = Date.parse('2026-11-28T00:00:00Z');
  const repo = path.join(work, 'postpane');
  spawnSync('git', ['init', '-q', '-b', 'main', repo]);
  let n = 0;
  const g = (...args) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8' });
  // committedDaysAgo 不给就和作者时间一样；给了就是「作者时间和提交时间不同」（变基过的提交）
  const commit = (msg, files, daysAgo, committedDaysAgo = daysAgo) => {
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
      fs.writeFileSync(path.join(repo, f), `${n++}\n`);
    }
    const iso = d => new Date(now - d * 86400000).toISOString();
    spawnSync('git', ['-C', repo, 'add', '-A']);
    const r = spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', msg], {
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: iso(daysAgo), GIT_COMMITTER_DATE: iso(committedDaysAgo) },
    });
    assert.equal(r.status, 0, r.stderr);
  };
  commit('修复一', ['src/a.js', 'src/b.js'], 6);
  commit('修复二', ['src/a.js', 'src/b.js'], 5);
  commit('修复三', ['src/a.js', 'src/b.js'], 4);
  commit('修复四', ['src/a.js'], 3);
  commit('修复很久以前', ['src/c.js'], 30);
  commit('修复很久以前二', ['src/c.js'], 20);
  commit('修复最近', ['src/c.js'], 1);
  // 很久以前写的、刚变基过来的：作者时间在窗口外，提交时间在窗口内，不算（#163-P2-03）
  commit('修复旧的甲', ['src/d.js'], 40, 1);
  commit('修复旧的乙', ['src/d.js'], 39, 1);
  commit('修复旧的丙', ['src/d.js'], 38, 1);
  // 提交时间比作者时间晚（窗口内写的，刚刚才变基）：算
  commit('修复新的甲', ['src/e.js'], 6, 0);
  commit('修复新的乙', ['src/e.js'], 5, 0);
  commit('修复新的丙', ['src/e.js'], 4, 0);
  // 提交时间比作者时间早一天以上（时钟不准、导入的历史）：作者时间在窗口内就算，git 不能先按提交时间把它筛掉（#163-P2-03 第 2 轮）
  commit('修复钟慢的甲', ['src/g.js'], 3, 20);
  commit('修复钟慢的乙', ['src/g.js'], 2.5, 20);
  commit('修复钟慢的丙', ['src/g.js'], 2, 20);
  // 只被标签指着、不在任何分支上的提交不算（#163-P2-02）
  assert.equal(g('checkout', '-q', '-b', 'abandoned').status, 0);
  commit('修复弃用一', ['src/f.js'], 3);
  commit('修复弃用二', ['src/f.js'], 2);
  commit('修复弃用三', ['src/f.js'], 1);
  assert.equal(g('tag', 'old-attempt').status, 0);
  assert.equal(g('checkout', '-q', 'main').status, 0);
  assert.equal(g('branch', '-q', '-D', 'abandoned').status, 0);
  spawnSync('git', ['-C', repo, 'worktree', 'add', '-q', path.join(work, 'postpane-wt'), '-b', 'wt']);
  fs.mkdirSync(path.join(work, '不是仓库'));

  const text = summarizeHotspots(work, now).join('\n');
  assert.match(text, /扫了 1 个仓库/);
  assert.match(text, /共 4 个/);
  assert.match(text, /postpane `src\/a\.js`：4 个修复类提交，最近一条「修复四」[\s\S]*postpane `src\/g\.js`：3 个修复类提交，最近一条「修复钟慢的丙」[\s\S]*postpane `src\/b\.js`：3 个修复类提交[\s\S]*postpane `src\/e\.js`：3 个修复类提交/);
  assert.doesNotMatch(text, /src\/c\.js|src\/d\.js|src\/f\.js/);

  // 读不了项目目录要说出来，不能写成「扫了 0 个仓库」
  assert.match(summarizeHotspots(path.join(work, '没有这个目录'), now).join('\n'), /读不了项目目录/);

  // 单个仓库取提交失败：记进「读不了」名单，其余照算，不中断
  const flaky = (dir, args) => (dir.endsWith('postpane') ? { code: 128, stdout: '' } : { code: 0, stdout: '' });
  const partial = summarizeHotspots(work, now, flaky).join('\n');
  assert.match(partial, /读不了提交记录、没算进来的：postpane/);

  const empty = summarizeHotspots(fs.mkdtempSync(path.join(os.tmpdir(), 'wr-hot-empty-')), now).join('\n');
  assert.match(empty, /扫了 0 个仓库/);
  assert.match(empty, /没有被修复类提交改过 3 次以上的文件/);
});
