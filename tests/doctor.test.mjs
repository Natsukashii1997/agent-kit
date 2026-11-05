import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkLogTail, extractSection, parseBoottime, parseLaunchctlPrint, runDoctor } from '../tools/doctor.mjs';
import { main as install } from '../tools/install.mjs';

const PRINT_OK = `gui/501/com.x.site = {
	active count = 1
	state = running
	stdout path = /logs/site.out
	stderr path = /logs/site.err
	last exit code = 0
}`;

test('解析 launchctl print / kern.boottime / 日志末行', () => {
  assert.deepEqual(parseLaunchctlPrint(PRINT_OK), { state: 'running', lastExit: '0', stdoutPath: '/logs/site.out', stderrPath: '/logs/site.err' });
  assert.equal(parseLaunchctlPrint('state = not running\n\tlast exit code = 126: Operation not permitted').lastExit, '126: Operation not permitted');
  assert.equal(parseBoottime('{ sec = 1762300000, usec = 12 } Wed Nov  5 08:00:00 2025'), 1762300000000);
  assert.equal(parseBoottime('garbage'), null);
  assert.deepEqual(checkLogTail('开始 2026-11-05 10:00\n...\nexit 0\n'), { finished: true, code: 0 });
  assert.deepEqual(checkLogTail('开始 2026-11-05 10:00\nstep 2'), { finished: false, code: null });
});

test('取一节正文：标题编号不同也能比', () => {
  const a = '# 全局\n\n## 7. 跨项目沉淀\n\n第一行\n第二行  \n\n## 8. 其他\nx';
  const b = '## 跨项目沉淀\n第一行\n第二行\n';
  assert.equal(extractSection(a, '跨项目沉淀'), extractSection(b, '跨项目沉淀'));
  assert.equal(extractSection(a, '不存在'), null);
  assert.equal(extractSection(null, 'x'), null);
});

function fakeHome({ claudeSection = '内容 A', codexSection = '内容 A', installed = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-doc-'));
  fs.mkdirSync(path.join(home, '.claude'));
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), `## 7. 跨项目沉淀\n${claudeSection}\n## 8. 别的\n`);
  fs.writeFileSync(path.join(home, '.codex', 'AGENTS.md'), `## 跨项目沉淀\n${codexSection}\n`);
  if (installed) {
    const log = console.log;
    console.log = () => {};
    install(['--apply'], home, {});
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-state-'));
  const res = runDoctor({ home, env: {}, dir, run: realRun, platform: 'linux', config: {} });
  assert.equal(byName(res, 'Claude 权限规则').status, 'ok');
  assert.equal(byName(res, 'Codex hook').status, 'ok');
  assert.equal(byName(res, 'hook 实跑自检').status, 'ok');
  assert.equal(byName(res, '两份全局指令').status, 'ok');
  assert.equal(byName(res, 'Claude 自动记忆').status, 'info');
});

test('没装、两份指令不一致：分别报警告和失败，并指出哪一行不同', () => {
  const home = fakeHome({ codexSection: '内容 B', installed: false });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-state-'));
  const res = runDoctor({ home, env: {}, dir, run: realRun, platform: 'linux', config: {} });
  assert.equal(byName(res, 'Claude 权限规则').status, 'warn');
  assert.equal(byName(res, 'Codex hook').status, 'warn');
  const sync = byName(res, '两份全局指令');
  assert.equal(sync.status, 'fail');
  assert.ok(sync.detail.some(d => d.includes('内容 B')));
});

test('launchd、重启、日志、仓库、自定义命令（用假命令模拟 macOS）', () => {
  const home = fakeHome();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-state-'));
  const logs = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-logs-'));
  const done = path.join(logs, 'done.log');
  const broken = path.join(logs, 'broken.log');
  fs.writeFileSync(done, '开始 x\nexit 0\n');
  fs.writeFileSync(broken, '开始 x\n第二步\n');
  const now = Date.now();
  const stats = {
    '/logs/site.out': { size: 10, mtimeMs: now - 5e6 },
    '/logs/site.err': { size: 3, mtimeMs: now - 1e6 },
    [done]: { size: 10, mtimeMs: now - 2 * 36e5 },
    [broken]: { size: 10, mtimeMs: now - 3 * 36e5 },
  };
  const run = (cmd, args, opts) => {
    if (cmd === 'launchctl' && args[1].endsWith('com.x.site')) return { code: 0, stdout: PRINT_OK.replace('running', 'not running'), stderr: '' };
    if (cmd === 'launchctl' && args[1].endsWith('com.x.daily')) return { code: 0, stdout: 'state = not running\nlast exit code = 126: Operation not permitted', stderr: '' };
    if (cmd === 'launchctl') return { code: 113, stdout: '', stderr: 'Could not find service' };
    if (cmd === 'sysctl') return { code: 0, stdout: `{ sec = ${Math.floor((now - 2 * 36e5) / 1000)}, usec = 0 }`, stderr: '' };
    if (cmd === 'git' && args.includes('fetch')) return args[1].includes('locked') ? { code: 128, stdout: '', stderr: 'fatal: Operation not permitted' } : { code: 0, stdout: '', stderr: '' };
    if (cmd === 'git' && args.includes('log')) return { code: 0, stdout: 'abc123 别的会话的提交\n', stderr: '' };
    if (cmd === 'git' && args.includes('status')) return { code: 0, stdout: '', stderr: '' };
    if (cmd === 'hermes') return { code: 0, stdout: 'ID  STATE\n12  detected  timeout\n', stderr: '' };
    return realRun(cmd, args, opts);
  };
  const config = {
    launchd: [{ label: 'com.x.site', keepAlive: true }, { label: 'com.x.daily' }, { label: 'com.x.gone' }],
    logs: [{ name: 'done', path: done }, { name: 'broken', path: broken }],
    repos: ['/r/agent-kit', '/r/locked'],
    commands: [{ name: 'Hermes 失败记录', cmd: ['hermes', 'cron', 'incidents'], okWhen: { exitCode: 0, stdoutNotMatch: '\\bdetected\\b' } }],
  };
  const res = runDoctor({ home, env: {}, dir, run, platform: 'darwin', uid: 501, now, config, statFn: f => stats[f] || null });
  const site = byName(res, 'launchd com.x.site');
  assert.equal(site.status, 'fail');
  assert.ok(site.detail.some(d => d.includes('常驻服务没在跑')));
  assert.ok(site.detail.some(d => d.includes('错误日志比正常日志新')));
  const daily = byName(res, 'launchd com.x.daily');
  assert.equal(daily.status, 'warn');
  assert.ok(daily.detail.some(d => d.includes('G-05')));
  assert.equal(byName(res, 'launchd com.x.gone').status, 'fail');
  const boot = byName(res, '开机时间');
  assert.equal(boot.status, 'warn');
  assert.ok(boot.detail.some(d => d.includes('com.x.site')));
  assert.equal(byName(res, '日志 done').status, 'ok');
  assert.equal(byName(res, '日志 broken').status, 'warn');
  const repo = byName(res, '仓库 agent-kit');
  assert.equal(repo.status, 'warn');
  assert.ok(repo.detail.some(d => d.includes('别的会话的提交')));
  assert.ok(byName(res, '仓库 locked').detail[0].includes('G-05'));
  assert.equal(byName(res, 'Hermes 失败记录').status, 'warn');
});

test('命令行跑一次：存报告，第一行开始时间，最后一行 exit N', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-state-'));
  const home = fakeHome();
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-state-'));
  const res = runDoctor({ home, env: {}, dir, run: realRun, platform: 'linux', config: {} });
  assert.equal(byName(res, 'hook 实跑自检').status, 'fail');
});
