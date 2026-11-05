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
