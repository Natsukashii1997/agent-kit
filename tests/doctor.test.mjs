import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractSection, originSlug, runDoctor } from '../tools/doctor.mjs';
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

test('wrapup-guard（#150）：装好实跑通过；Stop 命令指向别处只报未装；node 路径失效实跑报失败（#151-P2-06）', () => {
  const home = fakeHome();
  const dir = stateOf(home);
  assert.equal(byName(runDoctor({ home, env: {}, dir, run: realRun, config: {} }), 'wrapup-guard 实跑').status, 'ok');
  const file = path.join(home, '.claude', 'settings.json');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  const original = structuredClone(s);
  s.hooks.Stop[0].hooks[0].command = '"/usr/bin/node" "/old/repo/hooks/wrapup-guard.mjs"';
  fs.writeFileSync(file, JSON.stringify(s));
  const moved = runDoctor({ home, env: {}, dir, run: realRun, config: {} });
  assert.equal(byName(moved, 'Claude 权限规则').status, 'warn', '不在 runtime 副本的不算装好');
  assert.ok(byName(moved, 'Claude 权限规则').detail.some(d => d.includes('wrapup-guard')));
  assert.equal(byName(moved, 'wrapup-guard 实跑'), undefined);
  fs.writeFileSync(file, JSON.stringify(original));
  fs.writeFileSync(path.join(dir, 'wrapup-guard.off'), '');
  const off = byName(runDoctor({ home, env: {}, dir, run: realRun, config: {} }), 'wrapup-guard 实跑');
  assert.equal(off.status, 'warn', '真实状态目录里有关闭开关（第 2 轮 #151-P2-06）');
  assert.ok(off.detail.some(d => d.includes('wrapup-guard.off')));
  fs.rmSync(path.join(dir, 'wrapup-guard.off'));
  const echo = structuredClone(original);
  echo.hooks.Stop[0].hooks[0].command = `echo '{"decision":"block"}' # ${path.join(dir, 'runtime', 'hooks', 'wrapup-guard.mjs')}`;
  fs.writeFileSync(file, JSON.stringify(echo));
  const forged = runDoctor({ home, env: {}, dir, run: realRun, config: {} });
  assert.equal(byName(forged, 'wrapup-guard 实跑'), undefined, '脚本路径只在注释里、没被执行：不认作已装，不实跑（第 3 轮 #151-P2-06）');
  assert.equal(byName(forged, 'Claude 权限规则').status, 'warn');
  original.hooks.Stop[0].hooks[0].command = original.hooks.Stop[0].hooks[0].command.replace(/^"[^"]+"/, '"/no/such/node"');
  fs.writeFileSync(file, JSON.stringify(original));
  assert.equal(byName(runDoctor({ home, env: {}, dir, run: realRun, config: {} }), 'wrapup-guard 实跑').status, 'fail');
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
  // 远端标签：测试里不联网，ls-remote 和本机 rev-parse 都给假的；默认两边一致
  const SHA = 'a'.repeat(40);
  let remoteTags = { code: 0, stdout: tag => `${'b'.repeat(40)}\trefs/tags/${tag}\n${SHA}\trefs/tags/${tag}^{}\n` };
  const withTag = (cmd, args, opts) => {
    if (args[2] === 'show' && args[3].startsWith('git-hooks-v9:')) return { code: 0, stdout: fs.readFileSync(path.join(KIT, args[3].slice('git-hooks-v9:'.length)), 'utf8'), stderr: '' };
    if (args[2] === 'ls-remote') return { code: remoteTags.code, stdout: remoteTags.code ? '' : remoteTags.stdout(args[4].slice('refs/tags/'.length)), stderr: '' };
    if (args[2] === 'rev-parse' && /^git-hooks-v\d+\^\{commit\}$/.test(args.at(-1))) return { code: 0, stdout: `${SHA}\n`, stderr: '' };
    return realRun(cmd, args, opts);
  };
  const ciCheck = run => byName(runDoctor({ home, env: {}, dir, run, config: { workRoot: work, projectsFile } }), 'CI 用的共用规则检查版本');
  wf('git-hooks-v9');
  assert.equal(ciCheck(withTag).status, 'ok');
  // GitHub 上的标签被删了重建、指向别的提交：本机比的那版不是 CI 跑的那版（#141 第 3 轮审查 P2-08）
  remoteTags = { code: 0, stdout: tag => `${'c'.repeat(40)}\trefs/tags/${tag}\n` };
  const moved = ciCheck(withTag);
  assert.equal(moved.status, 'warn');
  assert.match(moved.detail.join('\n'), /GitHub 上的标签 git-hooks-v9 指向 ccccccc，本机的指向 aaaaaaa：标签被改过或本机没拉/);
  remoteTags = { code: 0, stdout: () => '' };
  assert.match(ciCheck(withTag).detail.join('\n'), /GitHub 上没有标签 git-hooks-v9：用它的 CI 检出会失败/);
  remoteTags = { code: 128, stdout: () => '' };
  assert.match(ciCheck(withTag).detail.join('\n'), /没核对 GitHub 上的标签 git-hooks-v9 指向哪里.*查不全/);
  remoteTags = { code: 0, stdout: tag => `${SHA}\trefs/tags/${tag}\n` };
  assert.equal(ciCheck(withTag).status, 'ok', '轻量标签：直接比它指的提交');
  // 完整提交号不会动，不去核远端
  let asked = 0;
  const countLs = (cmd, args, opts) => (args[2] === 'ls-remote' ? (asked += 1, { code: 128, stdout: '', stderr: '' }) : args[2] === 'show' && args[3].startsWith(`${SHA}:`) ? { code: 0, stdout: fs.readFileSync(path.join(KIT, args[3].slice(41)), 'utf8'), stderr: '' } : realRun(cmd, args, opts));
  wf(SHA);
  assert.equal(ciCheck(countLs).status, 'ok');
  assert.equal(asked, 0);
  wf('git-hooks-v99');
  const stale = ciCheck(withTag);
  assert.equal(stale.status, 'warn');
  assert.match(stale.detail[0], /CI仓库（\.github\/workflows\/check\.yml）用 agent-kit git-hooks-v99：git-hooks\/check-rules\.mjs、git-hooks\/config\.mjs 和本仓库当前的不一样/);
  // with: 里键的顺序随意、中间夹别的键也认；没写 ref 的报 ⚠（#141 审查）
  fs.writeFileSync(path.join(ci, '.github', 'workflows', 'check.yml'), 'steps:\n  - uses: actions/checkout@v4\n    with:\n      ref: git-hooks-v9\n      token: x\n      repository: Natsukashii1997/agent-kit\n      path: .agent-kit\n');
  assert.equal(ciCheck(withTag).status, 'ok');
  fs.writeFileSync(path.join(ci, '.github', 'workflows', 'check.yml'), 'steps:\n  - uses: actions/checkout@v4\n    with:\n      repository: Natsukashii1997/agent-kit\n      path: .agent-kit\n  - run: echo\n    with:\n      ref: 别的步骤的\n');
  assert.match(ciCheck(withTag).detail.join('\n'), /检出 agent-kit 没写 ref/);
  // 写会动的分支：内容一样也报，CI 用的版本会跟着 main 变（#141 审查 P2-08）
  const onMain = (cmd, args, opts) => (args[2] === 'show' && args[3].startsWith('main:') ? { code: 0, stdout: fs.readFileSync(path.join(KIT, args[3].slice('main:'.length)), 'utf8'), stderr: '' } : realRun(cmd, args, opts));
  wf('main');
  const moving = ciCheck(onMain);
  assert.equal(moving.status, 'warn');
  assert.match(moving.detail.join('\n'), /ref「main」不是固定版本：写成 git-hooks-vN 标签或完整提交号/);
});

test('仓库钩子：pre-push、commit-msg 分别查，只缺一个也报 ✗；worktree 列不出、core.hooksPath 读不出报「查不全」（#141 审查 P1-02、P2-02）', () => {
  const home = fakeHome();
  const dir = stateOf(home);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-work-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const repo = (name, hooks) => {
    const r = path.join(work, name);
    spawnSync('git', ['init', '-q', '-b', 'main', r], { env });
    fs.mkdirSync(path.join(r, 'scripts', 'hooks'), { recursive: true });
    for (const h of hooks) fs.writeFileSync(path.join(r, 'scripts', 'hooks', h), fs.readFileSync(path.join(KIT, 'git-hooks', 'forward', h), 'utf8'), { mode: 0o755 });
    spawnSync('git', ['-C', r, 'config', 'core.hooksPath', 'scripts/hooks'], { env });
    return r;
  };
  repo('缺commit-msg', ['pre-push']);
  repo('缺pre-push', ['commit-msg']);
  const doctor = run => byName(runDoctor({ home, env: {}, dir, run, config: { workRoot: work, projectsFile: path.join(work, '没有.json') } }), '仓库钩子生效');
  const r = doctor(realRun);
  assert.equal(r.status, 'fail');
  const text = r.detail.join('\n');
  assert.match(text, /缺commit-msg：core\.hooksPath=scripts\/hooks，目录里缺 commit-msg，修复提交不查「同类：」/);
  assert.match(text, /缺pre-push：core\.hooksPath=scripts\/hooks，目录里缺 pre-push，推送前不查规则、不跑测试/);

  // 有意只装 commit-msg 的只认 agent-kit 里登记的（digital-twin 2026-11-20 定）；别的仓库自己声明不算（#141 审查 P1-02）
  // 按 origin 认，不按目录名：目录叫 digital-twin、origin 是别的仓库（或没有 origin）照样要两个都装（#141 第 3 轮审查 P1-02）
  const dt = repo('digital-twin', ['commit-msg']);
  assert.match(doctor(realRun).detail.join('\n'), /digital-twin：.*目录里缺 pre-push/, '没有 origin 不给例外');
  spawnSync('git', ['-C', dt, 'remote', 'add', 'origin', 'https://github.com/someone-else/digital-twin.git'], { env });
  assert.match(doctor(realRun).detail.join('\n'), /digital-twin：.*目录里缺 pre-push/, 'origin 是别人的同名仓库不给例外');
  spawnSync('git', ['-C', dt, 'remote', 'set-url', 'origin', 'git@github.com:Natsukashii1997/digital-twin.git'], { env });
  // 登记了只装 commit-msg 的仓库，残留一个没可执行位的 pre-push 也不报（#141 审查 P2-07）
  fs.writeFileSync(path.join(work, 'digital-twin', 'scripts', 'hooks', 'pre-push'), '#!/bin/sh\n', { mode: 0o644 });
  const withDt = doctor(realRun).detail.join('\n');
  assert.doesNotMatch(withDt, /digital-twin：/);
  assert.match(withDt, /缺pre-push：.*目录里缺 pre-push/);
  // 登记的是仓库，不是目录：真 digital-twin 换个目录名也照样认
  fs.renameSync(dt, path.join(work, '数字分身'));
  assert.doesNotMatch(doctor(realRun).detail.join('\n'), /数字分身：/);
  fs.renameSync(path.join(work, '数字分身'), dt);
  fs.rmSync(path.join(work, '缺pre-push'), { recursive: true, force: true });
  fs.rmSync(path.join(work, 'digital-twin'), { recursive: true, force: true });
  fs.writeFileSync(path.join(work, '缺commit-msg', 'scripts', 'hooks', 'commit-msg'), fs.readFileSync(path.join(KIT, 'git-hooks', 'forward', 'commit-msg'), 'utf8'), { mode: 0o755 });
  assert.equal(doctor(realRun).status, 'ok', '两个都在就不报');
  // worktree list 失败：不能退回只查主检出还报 ok
  const noList = (cmd, args, opts) => (args.includes('worktree') ? { code: 128, stdout: '', stderr: 'fatal' } : realRun(cmd, args, opts));
  const partial = doctor(noList);
  assert.equal(partial.status, 'warn');
  assert.match(partial.detail.join('\n'), /缺commit-msg：git worktree list 跑不起来，只查了主检出.*查不全/);
  // core.hooksPath 读不出（退出码不是 0 也不是 1）：不能当成没设
  const noConfig = (cmd, args, opts) => (args.includes('core.hooksPath') ? { code: 128, stdout: '', stderr: 'fatal' } : realRun(cmd, args, opts));
  const unread = doctor(noConfig);
  assert.equal(unread.status, 'warn');
  assert.match(unread.detail.join('\n'), /缺commit-msg：读不出 core\.hooksPath（退出码 128），这处没查（查不全）/);

  // 主检出已换成转发，旧 worktree 还是仓库自己的副本：从那里推送跑的是旧版，也要报（#141 审查 P2-07）
  const genv = { ...env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  const g = (r, ...args) => spawnSync('git', ['-C', r, ...args], { encoding: 'utf8', env: genv });
  const mixed = path.join(work, '主是转发');
  spawnSync('git', ['init', '-q', '-b', 'main', mixed], { env });
  fs.mkdirSync(path.join(mixed, 'scripts', 'hooks'), { recursive: true });
  for (const h of ['pre-push', 'commit-msg']) fs.writeFileSync(path.join(mixed, 'scripts', 'hooks', h), '#!/bin/sh\nnode scripts/check-rules.mjs\n', { mode: 0o755 });
  g(mixed, 'add', '-A');
  g(mixed, 'commit', '-q', '-m', '旧副本');
  for (const h of ['pre-push', 'commit-msg']) fs.writeFileSync(path.join(mixed, 'scripts', 'hooks', h), fs.readFileSync(path.join(KIT, 'git-hooks', 'forward', h), 'utf8'), { mode: 0o755 });
  g(mixed, 'commit', '-q', '-am', '换成转发');
  g(mixed, 'config', 'core.hooksPath', 'scripts/hooks');
  assert.equal(g(mixed, 'worktree', 'add', '-q', path.join(mixed, '.claude', 'worktrees', 'old'), '-b', 'old', 'HEAD~1').status, 0);
  const copies = doctor(realRun);
  assert.match(copies.detail.join('\n'), /主是转发：1 处 worktree 的钩子还是仓库自己的旧副本，从那里推送、提交跑的是旧版：\.claude\/worktrees\/old（old）/);
  assert.doesNotMatch(copies.detail.join('\n'), /主是转发：pre-push、commit-msg 还是仓库自己的副本/, '主检出是转发，不单列');
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

test('驿窗「以我的身份发送」：只有明确读到关着才通过；开着、读不懂、空文件、字段缺失或不是布尔值都报 ⚠；没有设置文件只提示没查（#154）', () => {
  const dirOf = home => path.join(home, 'Library', 'Application Support', 'app.postpane.mac');
  const check = home => byName(runDoctor({ home, env: {}, dir: stateOf(home), run: realRun, config: {} }), '驿窗「以我的身份发送」');
  const withSettings = text => {
    const home = fakeHome();
    fs.mkdirSync(dirOf(home), { recursive: true });
    fs.writeFileSync(path.join(dirOf(home), 'settings.json'), text);
    return check(home);
  };

  const none = check(fakeHome());
  assert.equal(none.status, 'info');
  assert.match(none.detail.join('\n'), /按开着处理/);

  const on = withSettings(JSON.stringify({ settings: { agentMessages: true, agentMessagesAsUser: true } }));
  assert.equal(on.status, 'warn');
  assert.match(on.detail.join('\n'), /问答框/);

  assert.equal(withSettings(JSON.stringify({ settings: { agentMessagesAsUser: false } })).status, 'ok');
  assert.equal(withSettings(JSON.stringify({ agentMessagesAsUser: false })).status, 'ok');

  for (const [label, text] of [
    ['读不懂', '{ 不是 json'],
    ['空文件', '  \n'],
    ['字段缺失', JSON.stringify({ settings: { agentMessages: true } })],
    ['字符串', JSON.stringify({ settings: { agentMessagesAsUser: 'false' } })],
    ['数字', JSON.stringify({ settings: { agentMessagesAsUser: 0 } })],
    ['null', JSON.stringify({ settings: { agentMessagesAsUser: null } })],
    ['settings 不是对象', JSON.stringify({ settings: 'x' })],
    ['settings 不是对象、顶层却写着关', JSON.stringify({ settings: 'x', agentMessagesAsUser: false })],
    ['settings 是 null、顶层却写着关', JSON.stringify({ settings: null, agentMessagesAsUser: false })],
    ['settings 是数组', JSON.stringify({ settings: [], agentMessagesAsUser: false })],
    ['字段只在顶层、settings 里没有', JSON.stringify({ settings: {}, agentMessagesAsUser: false })],
    ['顶层不是对象', '[]'],
  ]) {
    const r = withSettings(text);
    assert.equal(r.status, 'warn', label);
    assert.match(r.detail.join('\n'), /按开着处理/, label);
  }

  // 父目录没权限时查不了文件：不能当成「没有设置文件」
  if (process.getuid?.() !== 0) {
    const locked = fakeHome();
    fs.mkdirSync(dirOf(locked), { recursive: true });
    fs.writeFileSync(path.join(dirOf(locked), 'settings.json'), JSON.stringify({ settings: { agentMessagesAsUser: false } }));
    fs.chmodSync(dirOf(locked), 0o000);
    try {
      const r = check(locked);
      assert.equal(r.status, 'warn');
      assert.match(r.detail.join('\n'), /EACCES/);
    } finally {
      fs.chmodSync(dirOf(locked), 0o755);
    }
  }
});

test('合并了没拉：主目录落后远端 main 的仓库列出来并写落后几个提交；不落后的、不是仓库的、worktree 不列（#163）', () => {
  const home = fakeHome();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-state-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-work-'));
  const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  const commit = (cwd, msg) => git(cwd, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--allow-empty', '-m', msg);
  // 一个裸仓库当远端；本地克隆后，远端再多 n 个提交并 fetch，本地 main 就落后 n 个
  const make = (name, behind) => {
    const bare = path.join(work, `.${name}.git`);
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    const seed = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-seed-'));
    spawnSync('git', ['init', '-q', '-b', 'main', seed]);
    commit(seed, '第一个');
    git(seed, 'push', '-q', bare, 'main');
    const r = path.join(work, name);
    spawnSync('git', ['clone', '-q', bare, r]);
    for (let i = 0; i < behind; i++) commit(seed, `远端新提交 ${i}`);
    git(seed, 'push', '-q', bare, 'main');
    git(r, 'fetch', '-q', 'origin');
    return r;
  };
  const up = make('跟上了', 0);
  make('落后两个', 2);
  make('落后五个', 5);
  fs.mkdirSync(path.join(work, '不是仓库'));
  spawnSync('git', ['init', '-q', '-b', 'trunk', path.join(work, '没有main')]);
  spawnSync('git', ['-C', up, 'worktree', 'add', '-q', path.join(work, '一个worktree'), '-b', 'wt']);

  const r = byName(runDoctor({ home, env: {}, dir, run: realRun, config: { workRoot: work } }), '合并了没拉');
  assert.equal(r.status, 'info');
  const text = r.detail.join('\n');
  assert.match(text, /2 个仓库的主目录落后/);
  assert.match(text, /落后五个：落后 5 个提交[\s\S]*落后两个：落后 2 个提交/);
  assert.doesNotMatch(text, /跟上了|不是仓库|一个worktree/);
  assert.match(text, /查不了的仓库：[^\n]*没有main（[^）]+）/);

  // 都跟上了，但还有一个查不了：不能给 ✓（#163-P2-01）
  for (const name of ['落后两个', '落后五个']) git(path.join(work, name), 'merge', '-q', '--ff-only', 'origin/main');
  const mixed = byName(runDoctor({ home, env: {}, dir, run: realRun, config: { workRoot: work } }), '合并了没拉');
  assert.equal(mixed.status, 'info');
  assert.match(mixed.detail[0], /3 个仓库的主目录都不落后/);
  assert.match(mixed.detail.join('\n'), /查不了的仓库：[^\n]*没有main/);

  // 查不了的那个去掉以后，全部查到且都不落后，才给 ✓
  fs.rmSync(path.join(work, '没有main'), { recursive: true, force: true });
  const ok = byName(runDoctor({ home, env: {}, dir, run: realRun, config: { workRoot: work } }), '合并了没拉');
  assert.equal(ok.status, 'ok');
  assert.equal(ok.detail.length, 1);

  // git 超时或没有输出：归到查不了，不猜成缺分支，也不当成不落后（#163-P3-01）
  const hung = (cmd, args, opts) => (args.includes('rev-list') ? { code: null, stdout: '', stderr: 'spawnSync git ETIMEDOUT' } : realRun(cmd, args, opts));
  const timedOut = byName(runDoctor({ home, env: {}, dir, run: hung, config: { workRoot: work } }), '合并了没拉');
  assert.equal(timedOut.status, 'info');
  assert.match(timedOut.detail.join('\n'), /查不了的仓库：[^\n]*ETIMEDOUT/);
  assert.doesNotMatch(timedOut.detail.join('\n'), /没有 main 或/);
});

test('originSlug：https、ssh、scp 写法都认成「所有者/仓库名」小写，认不出给 null（#141 第 3 轮审查 P1-02）', () => {
  for (const u of ['https://github.com/Natsukashii1997/digital-twin.git', 'https://github.com/Natsukashii1997/digital-twin', 'git@github.com:Natsukashii1997/digital-twin.git', 'ssh://git@github.com/Natsukashii1997/digital-twin.git\n'])
    assert.equal(originSlug(u), 'natsukashii1997/digital-twin', u);
  assert.equal(originSlug('https://github.com/Natsukashii1997/digital-twin-fork.git'), 'natsukashii1997/digital-twin-fork');
  assert.equal(originSlug('/Users/x/digital-twin'), null);
  assert.equal(originSlug(''), null);
});
