import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
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

test('仓库钩子：带 scripts/hooks 的仓库没装 core.hooksPath 要报，并给安装命令；装了的、不带钩子的不报（复盘 P6，2026-11-20）', () => {
  const home = fakeHome();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-state-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-work-'));
  const repo = (name, { hooks = true, hooksPath } = {}) => {
    const r = path.join(work, name);
    spawnSync('git', ['init', '-q', r]);
    if (hooks) {
      fs.mkdirSync(path.join(r, 'scripts', 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(r, 'scripts', 'hooks', 'pre-push'), '#!/bin/sh\n');
    }
    if (hooksPath) spawnSync('git', ['-C', r, 'config', 'core.hooksPath', hooksPath]);
  };
  repo('装好了', { hooksPath: 'scripts/hooks' });
  repo('没装');
  repo('指向别处', { hooksPath: '/dev/null' });
  repo('不带钩子', { hooks: false });
  fs.mkdirSync(path.join(work, '不是仓库'));
  const r = byName(runDoctor({ home, env: {}, dir, run: realRun, config: { workRoot: work } }), '仓库钩子已装');
  assert.equal(r.status, 'warn');
  const text = r.detail.join('\n');
  assert.match(text, /没装[\s\S]*指向别处|指向别处[\s\S]*没装/);
  assert.doesNotMatch(text, /装好了|不带钩子|不是仓库/);
  assert.match(text, /git -C .*没装.* config core\.hooksPath scripts\/hooks/);

  for (const name of ['没装', '指向别处']) spawnSync('git', ['-C', path.join(work, name), 'config', 'core.hooksPath', 'scripts/hooks']);
  const ok = byName(runDoctor({ home, env: {}, dir, run: realRun, config: { workRoot: work } }), '仓库钩子已装');
  assert.equal(ok.status, 'ok');
  assert.match(ok.detail[0], /3 个仓库/);
});
