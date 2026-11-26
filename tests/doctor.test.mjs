import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractSection, runDoctor } from '../tools/doctor.mjs';
import { main as install } from '../tools/install.mjs';

test('取一节正文：标题编号不同也能比', () => {
  const a = '# 全局\n\n## 7. 跨项目沉淀\n\n第一行\n第二行  \n\n## 8. 其他\nx';
  const b = '## 跨项目沉淀\n第一行\n第二行\n';
  assert.equal(extractSection(a, '跨项目沉淀'), extractSection(b, '跨项目沉淀'));
  assert.equal(extractSection(a, '不存在'), null);
  assert.equal(extractSection(null, 'x'), null);
});

// 返回假的家目录；状态目录固定在 <home>/state，安装和体检用同一个
const stateOf = home => path.join(home, 'state');
function fakeHome({ claudeSection = '内容 A', codexSection = '内容 A', installed = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-doc-'));
  fs.mkdirSync(path.join(home, '.claude'));
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), `## 7. 跨项目沉淀\n${claudeSection}\n## 8. 别的\n`);
  fs.writeFileSync(path.join(home, '.codex', 'AGENTS.md'), `## 跨项目沉淀\n${codexSection}\n`);
  if (installed) {
    const log = console.log;
    console.log = () => {};
    install(['--apply', '--allow-any-branch'], home, { AGENT_KIT_STATE_DIR: stateOf(home) });
    console.log = log;
  }
  return home;
}

const realRun = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input: opts?.input, env: { ...process.env, ...(opts?.env || {}) } });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};
const byName = (results, prefix) => results.find(r => r.name.startsWith(prefix));

test('装好、两份指令一致：hook 检查和指令比对都通过', () => {
  const home = fakeHome();
  const dir = stateOf(home);
  const res = runDoctor({ home, env: {}, dir, run: realRun, config: {} });
  assert.equal(byName(res, 'Claude 权限规则').status, 'ok');
  assert.equal(byName(res, '已装的 hook 与仓库一致').status, 'ok');
  assert.equal(byName(res, 'Codex hook').status, 'ok');
  assert.equal(byName(res, 'hook 实跑自检').status, 'ok');
  assert.equal(byName(res, '两份全局指令').status, 'ok');
  assert.equal(byName(res, 'Claude 自动记忆').status, 'info');
});

test('没装、两份指令不一致：分别报警告和失败，并指出哪一行不同', () => {
  const home = fakeHome({ codexSection: '内容 B', installed: false });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-state-'));
  const res = runDoctor({ home, env: {}, dir, run: realRun, config: {} });
  assert.equal(byName(res, 'Claude 权限规则').status, 'warn');
  assert.equal(byName(res, 'Codex hook').status, 'warn');
  const sync = byName(res, '两份全局指令');
  assert.equal(sync.status, 'fail');
  assert.ok(sync.detail.some(d => d.includes('内容 B')));
});

test('仓库：本地 main 有没推的提交要报；读不了的目录指向 G-05', () => {
  const home = fakeHome();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-state-'));
  const run = (cmd, args, opts) => {
    if (cmd === 'git' && args.includes('fetch')) return args[1].includes('locked') ? { code: 128, stdout: '', stderr: 'fatal: Operation not permitted' } : { code: 0, stdout: '', stderr: '' };
    if (cmd === 'git' && args.includes('log')) return args[1].includes('clean') ? { code: 0, stdout: '', stderr: '' } : { code: 0, stdout: 'abc123 别的会话的提交\n', stderr: '' };
    if (cmd === 'git' && args.includes('status')) return { code: 0, stdout: '', stderr: '' };
    return realRun(cmd, args, opts);
  };
  const res = runDoctor({ home, env: {}, dir, run, config: { repos: ['/r/agent-kit', '/r/locked', '/r/clean'] } });
  const repo = byName(res, '仓库 agent-kit');
  assert.equal(repo.status, 'warn');
  assert.ok(repo.detail.some(d => d.includes('别的会话的提交')));
  assert.ok(byName(res, '仓库 locked').detail[0].includes('G-05'));
  assert.equal(byName(res, '仓库 clean').status, 'ok');
});

test('已装的副本落后于仓库：提示重装', () => {
  const home = fakeHome();
  const dir = stateOf(home);
  fs.appendFileSync(path.join(dir, 'runtime', 'LESSONS.md'), '\n旧版本\n');
  const res = runDoctor({ home, env: {}, dir, run: realRun, config: {} });
  const r = byName(res, '已装的 hook 与仓库一致');
  assert.equal(r.status, 'warn');
  assert.ok(r.detail[0].includes('LESSONS.md'));
});

test('命令行跑一次：存报告，第一行开始时间，最后一行 exit N', () => {
  const home = fakeHome();
  const dir = stateOf(home);
  const r = spawnSync(process.execPath, [path.resolve('tools/doctor.mjs')], { encoding: 'utf8', env: { ...process.env, AGENT_KIT_STATE_DIR: dir, HOME: home } });
  assert.ok([0, 1].includes(r.status), r.stderr);
  const files = fs.readdirSync(path.join(dir, 'doctor'));
  assert.equal(files.length, 1);
  const lines = fs.readFileSync(path.join(dir, 'doctor', files[0]), 'utf8').trim().split('\n');
  assert.match(lines[0], /^开始 \d{4}-/);
  assert.match(lines.at(-1), /^exit [01]$/);
});

test('首轮整理（#65）：还指向 ~/.claude/hooks 旧位置、或状态目录没有配置，都要报', () => {
  const home = fakeHome();
  const dir = stateOf(home);
  const file = path.join(home, '.claude', 'settings.json');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  const legacy = path.join(home, '.claude', 'hooks');
  for (const g of s.hooks.SessionStart) for (const h of g.hooks) h.command = h.command.replace(path.join(dir, 'runtime', 'hooks'), legacy);
  fs.writeFileSync(file, JSON.stringify(s));
  fs.rmSync(path.join(dir, 'session-organize-once', 'config.json'));
  const r = byName(runDoctor({ home, env: {}, dir, run: realRun, config: {} }), 'Claude 权限规则');
  assert.equal(r.status, 'warn');
  assert.ok(r.detail.some(d => d.includes('首轮整理钩子没装，或还指向')));
  assert.ok(r.detail.some(d => d.includes('session-organize-once/config.json')));
});

test('实跑自检含推送前检查（#76）：装的是新版就通过；装的还是旧副本只给 ⚠ 提示重装', () => {
  const home = fakeHome();
  const dir = stateOf(home);
  const ok = byName(runDoctor({ home, env: {}, dir, run: realRun, config: {} }), 'hook 实跑自检');
  assert.equal(ok.status, 'ok');
  assert.match(ok.detail[0], /带着本地 main 没推的提交推分支被拦下/);
  // 换成推送前检查之前的 guard-git（只拦强推和删除 main/master）
  const old = fs.readFileSync(path.join(dir, 'runtime', 'hooks', 'guard-git.mjs'), 'utf8').replace(/const leak = leakedCommits\([^)]*\);/g, 'const leak = null;');
  assert.ok(old.includes('const leak = null;'));
  fs.writeFileSync(path.join(dir, 'runtime', 'hooks', 'guard-git.mjs'), old);
  const res = runDoctor({ home, env: {}, dir, run: realRun, config: {} });
  assert.equal(byName(res, '已装的 hook 与仓库一致').status, 'warn');
  const stale = byName(res, 'hook 实跑自检');
  assert.equal(stale.status, 'warn');
  assert.ok(stale.detail.some(d => d.includes('旧副本') && d.includes('install.mjs --apply')));
});

test('设置里的 hook 命令失效（node 路径没了）：实跑自检报失败', () => {
  const home = fakeHome();
  const file = path.join(home, '.claude', 'settings.json');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const g of s.hooks.PreToolUse) for (const h of g.hooks) h.command = h.command.replace(/^"[^"]+"/, '"/no/such/node"');
  fs.writeFileSync(file, JSON.stringify(s));
  const dir = stateOf(home);
  const res = runDoctor({ home, env: {}, dir, run: realRun, config: {} });
  assert.equal(byName(res, 'hook 实跑自检').status, 'fail');
});

test('思维评审三层分开计数：提醒的会话、其中调用 skill 的、其中发起接力的', () => {
  const home = fakeHome({ installed: false });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-state-'));
  const now = Date.parse('2026-11-07T12:00:00Z');
  const t = h => new Date(now - h * 3600e3).toISOString();
  const jsonl = rows => `${rows.map(r => JSON.stringify(r)).join('\n')}\n`;
  fs.writeFileSync(path.join(dir, 'thinking-review-nudges.jsonl'), jsonl([
    { time: t(1), session: 'a', event: 'prompt', signal: 'handoff', nudged: true },
    { time: t(1), session: 'a', event: 'edit', signal: 'first-edit', nudged: false, skip: 'judged' },
    { time: t(2), session: 'b', event: 'edit', signal: 'first-edit', nudged: true },
    { time: t(3), session: 'c', event: 'prompt', signal: 'asked', nudged: true },
    { time: t(24 * 9), session: 'old', event: 'prompt', signal: 'handoff', nudged: true },
  ]));
  fs.writeFileSync(path.join(dir, 'skill-usage.jsonl'), jsonl([
    { time: t(1), session: 'a', skill: 'thinking-review' },
    { time: t(3), session: 'c', skill: 'thinking-review' },
    { time: t(3), session: 'd', skill: 'other' },
  ]));
  const handoffs = path.join(dir, 'handoffs.json');
  fs.writeFileSync(handoffs, JSON.stringify([
    { title: '思维评审｜x｜y', claudeSession: 'a', createdAt: String(now - 3600e3) },
    { title: '驿窗｜工程审查', claudeSession: 'b', createdAt: String(now - 3600e3) },
  ]));
  const r = byName(runDoctor({ home, env: { POSTPANE_HANDOFFS: handoffs }, dir, run: realRun, config: {}, now }), '近 7 天思维评审触发');
  assert.equal(r.status, 'info');
  assert.match(r.detail[0], /钩子提醒 3 个会话（handoff×1、first-edit×1、asked×1）；其中调用了 thinking-review 2 个，发起接力 1 个/);
  assert.match(r.detail[1], /调用 thinking-review 2 个，发起「思维评审｜」接力 1 个/);

  fs.writeFileSync(path.join(dir, 'thinking-review-nudge.off'), '');
  const off = byName(runDoctor({ home, env: { POSTPANE_HANDOFFS: handoffs }, dir, run: realRun, config: {}, now }), '近 7 天思维评审触发');
  assert.match(off.detail[0], /已手动关闭/);
});

test('仓库钩子查真生效（#133）：目录不在、不能执行报 ✗，带钩子没设、旧副本报 ⚠；冻结项目不报副本；旧 worktree 按仓库合成一行', () => {
  const home = fakeHome();
  const dir = stateOf(home);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-work-'));
  // 转发找 AGENT_KIT_STATE_DIR 下的运行目录：指向 fakeHome 装好的那份，不碰本机的
  const env = { ...process.env, AGENT_KIT_STATE_DIR: dir, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  const git = (r, ...args) => spawnSync('git', ['-C', r, ...args], { encoding: 'utf8', env });
  const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const repo = (name, { hooks = 'forward', hooksPath = 'scripts/hooks', mode = 0o755, checkRules = false } = {}) => {
    const r = path.join(work, name);
    spawnSync('git', ['init', '-q', '-b', 'main', r], { env });
    git(r, 'commit', '-q', '--allow-empty', '-m', '起点');
    if (hooks) {
      fs.mkdirSync(path.join(r, 'scripts', 'hooks'), { recursive: true });
      for (const h of ['pre-push', 'commit-msg']) {
        const text = hooks === 'forward' ? fs.readFileSync(path.join(KIT, 'git-hooks', 'forward', h), 'utf8') : '#!/bin/sh\nnode scripts/check-rules.mjs\n';
        fs.writeFileSync(path.join(r, 'scripts', 'hooks', h), text, { mode });
        fs.chmodSync(path.join(r, 'scripts', 'hooks', h), mode);
      }
    }
    if (checkRules) fs.writeFileSync(path.join(r, 'scripts', 'check-rules.mjs'), '');
    if (hooksPath) git(r, 'config', 'core.hooksPath', hooksPath);
    return r;
  };
  const good = repo('转发好了');
  git(good, 'add', '-A');
  git(good, 'commit', '-q', '-m', '装转发');
  // 钩子进 main 之前开的 worktree：检出里没有 scripts/hooks（niuma-home claude/32-coverage-calibration 的样子）
  assert.equal(git(good, 'worktree', 'add', '-q', path.join(good, '.claude', 'worktrees', 'old'), '-b', 'old', 'HEAD~1').status, 0);
  assert.equal(git(good, 'worktree', 'add', '-q', path.join(work, 'wt-在项目目录里'), '-b', 'side', 'HEAD').status, 0);
  repo('没设', { hooks: 'copy', hooksPath: '' });
  repo('目录没了', { hooks: false }); // digital-twin 现状：设了 hooksPath，main 上没有这个目录
  repo('不能执行', { mode: 0o644 });
  repo('副本', { hooks: 'copy', checkRules: true });
  const frozen = repo('冻结的副本', { hooks: 'copy', checkRules: true });
  repo('停用', { hooksPath: '/dev/null' });
  repo('不带钩子', { hooks: false, hooksPath: '' });
  fs.mkdirSync(path.join(work, '不是仓库'));
  const projectsFile = path.join(work, 'projects.json');
  fs.writeFileSync(projectsFile, JSON.stringify({ projects: [{ id: 'f', path: frozen, category: '冻结' }, { id: 'g', path: good, category: '活跃' }] }));
  const doctor = (d = dir, run = realRun) => byName(runDoctor({ home, env: {}, dir: d, run, config: { workRoot: work, projectsFile } }), '仓库钩子生效');

  const r = doctor();
  assert.equal(r.status, 'fail');
  const text = r.detail.join('\n');
  assert.match(text, /目录没了：1 处检出设了 core\.hooksPath，检出里却没有那个目录，钩子不跑：主检出/);
  assert.match(text, /转发好了：1 处检出.*\.claude\/worktrees\/old（old）（都是 worktree/);
  assert.match(text, /不能执行：pre-push、commit-msg 没有可执行位/);
  assert.match(text, /没设：带了 scripts\/hooks 却没设 core\.hooksPath.*git -C .*没设.* config core\.hooksPath scripts\/hooks/);
  assert.match(text, /副本：pre-push、commit-msg、scripts\/check-rules\.mjs 还是仓库自己的副本/);
  assert.match(text, /停用：core\.hooksPath 指向 \/dev\/null/);
  assert.doesNotMatch(text, /冻结的副本|不带钩子|不是仓库|wt-在项目目录里：|运行目录/);
  assert.ok(text.indexOf('目录没了') < text.indexOf('没设：'), '✗ 的排在 ⚠ 前面');

  // 运行目录里没有共用实现：转发仓库推送、提交都会被拦下
  const bare = doctor(fs.mkdtempSync(path.join(os.tmpdir(), 'ak-state-')));
  assert.match(bare.detail[0], /运行目录 .*runtime\/git-hooks 缺 pre-push、commit-msg、pre-push\.mjs.*转发到这里的 6 个钩子推送、提交都会被拦下.*node tools\/install\.mjs --apply/);

  // core.hooksPath 写成 ~/ 开头：git 自己会展开，doctor 也要展开，不能误报「没有这个目录」（#141 审查）
  const tilde = repo('波浪线', { hooks: false });
  const hooksHome = fs.mkdtempSync(path.join(home, 'githooks-'));
  fs.writeFileSync(path.join(hooksHome, 'commit-msg'), '#!/bin/sh\n', { mode: 0o755 });
  git(tilde, 'config', 'core.hooksPath', `~/${path.basename(hooksHome)}`);
  const tildeRun = (cmd, args, opts) => realRun(cmd, args, { ...opts, env: { ...(opts?.env || {}), HOME: home } });
  assert.doesNotMatch(doctor(dir, tildeRun).detail.join('\n'), /波浪线：.*没有那个目录/);
  fs.rmSync(tilde, { recursive: true, force: true });

  // 都修好：只剩转发和冻结的副本
  for (const name of ['目录没了', '没设', '不能执行', '副本', '停用']) fs.rmSync(path.join(work, name), { recursive: true, force: true });
  git(good, 'worktree', 'remove', '--force', path.join(good, '.claude', 'worktrees', 'old'));
  const ok = doctor();
  assert.equal(ok.status, 'ok', ok.detail.join('\n'));
  assert.match(ok.detail[0], /3 处设了 core\.hooksPath 的检出都能跑，其中转发 4 个/);

  // CI 检出 agent-kit 固定标签跑规则检查：标签里的共用实现和本仓库当前的不一样就报 ⚠
  const ci = repo('CI仓库');
  fs.mkdirSync(path.join(ci, '.github', 'workflows'), { recursive: true });
  const wf = ref => fs.writeFileSync(path.join(ci, '.github', 'workflows', 'check.yml'), `steps:\n  - uses: actions/checkout@v4\n    with:\n      repository: Natsukashii1997/agent-kit\n      ref: ${ref}\n      path: .agent-kit\n`);
  const withTag = (cmd, args, opts) => (args[2] === 'show' && args[3].startsWith('ak-same:') ? { code: 0, stdout: fs.readFileSync(path.join(KIT, args[3].slice('ak-same:'.length)), 'utf8'), stderr: '' } : realRun(cmd, args, opts));
  const ciCheck = run => byName(runDoctor({ home, env: {}, dir, run, config: { workRoot: work, projectsFile } }), 'CI 用的共用规则检查版本');
  wf('ak-same');
  assert.equal(ciCheck(withTag).status, 'ok');
  wf('ak-no-such-tag');
  const stale = ciCheck(withTag);
  assert.equal(stale.status, 'warn');
  assert.match(stale.detail[0], /CI仓库（\.github\/workflows\/check\.yml）用 agent-kit ak-no-such-tag：git-hooks\/check-rules\.mjs、git-hooks\/config\.mjs 和本仓库当前的不一样/);
  // with: 里键的顺序随意、中间夹别的键也认；没写 ref 的报 ⚠（#141 审查）
  fs.writeFileSync(path.join(ci, '.github', 'workflows', 'check.yml'), 'steps:\n  - uses: actions/checkout@v4\n    with:\n      ref: ak-same\n      token: x\n      repository: Natsukashii1997/agent-kit\n      path: .agent-kit\n');
  assert.equal(ciCheck(withTag).status, 'ok');
  fs.writeFileSync(path.join(ci, '.github', 'workflows', 'check.yml'), 'steps:\n  - uses: actions/checkout@v4\n    with:\n      repository: Natsukashii1997/agent-kit\n      path: .agent-kit\n  - run: echo\n    with:\n      ref: 别的步骤的\n');
  assert.match(ciCheck(withTag).detail.join('\n'), /检出 agent-kit 没写 ref/);
});

test('仓库钩子：还没有仓库用转发时，运行目录缺共用实现只报 ⚠，不报 ✗（#141 审查）', () => {
  const home = fakeHome();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-work-'));
  spawnSync('git', ['init', '-q', path.join(work, '不带钩子')]);
  const r = byName(runDoctor({ home, env: {}, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'ak-state-')), run: realRun, config: { workRoot: work, projectsFile: path.join(work, '没有.json') } }), '仓库钩子生效');
  assert.equal(r.status, 'warn');
  assert.match(r.detail[0], /还没有仓库用转发，换上转发前要装好/);
});

test('近 7 天坑提醒：分开数真正提醒和关键词匹配，按提醒次数排（瘦身提案 M4）', () => {
  const home = fakeHome();
  const dir = stateOf(home);
  const now = Date.parse('2026-11-20T12:00:00Z');
  const t = h => new Date(now - h * 3600e3).toISOString();
  const rows = [
    { time: t(1), session: 'a', ids: ['G-03'], reminded: ['G-03'] },
    { time: t(1), session: 'a', ids: ['G-03'], reminded: [] },
    { time: t(1), session: 'a', ids: ['G-03'], reminded: [] },
    { time: t(2), session: 'b', ids: ['G-03', 'G-04'], reminded: ['G-04'] },
    { time: t(2), session: 'c', ids: ['G-04'], reminded: ['G-04'] },
    { time: t(24 * 9), session: 'old', ids: ['G-03'], reminded: ['G-03'] },
  ];
  fs.writeFileSync(path.join(dir, 'lessons-hits.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const r = byName(runDoctor({ home, env: {}, dir, run: realRun, config: {}, now }), '近 7 天坑提醒');
  assert.equal(r.status, 'info');
  assert.equal(r.detail[0], '一共提醒 3 次，3 个会话，平均每会话 1.0 条');
  assert.equal(r.detail[1], 'G-04 提醒 2 次（2 个会话）/ 匹配 2 次、G-03 提醒 1 次（1 个会话）/ 匹配 4 次');

  // 窗口里重装过、提醒规则变了（#133）：主数只算重装后的，重装前的只给每会话条数作对照
  const manifestFile = path.join(dir, 'install-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, remindChangedAt: t(1.5) }));
  const cut = byName(runDoctor({ home, env: {}, dir, run: realRun, config: {}, now }), '近 7 天坑提醒');
  assert.equal(cut.detail[0], '提醒规则 11-20 18:30 重装后（0.1 天）：一共提醒 1 次，1 个会话，平均每会话 1.0 条');
  assert.equal(cut.detail[1], 'G-03 提醒 1 次（1 个会话）/ 匹配 3 次');
  assert.equal(cut.detail[2], '重装前（同一窗口里的 6.9 天，旧规则）：平均每会话 1.0 条，只作对照');
});
