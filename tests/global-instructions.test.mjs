import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compose, firstDiff, inspect, main, parsePersonal } from '../tools/global-instructions.mjs';
import { extractSection, runDoctor } from '../tools/doctor.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = fn => {
  const [log, err] = [console.log, console.error];
  console.log = console.error = () => {};
  try {
    return fn();
  } finally {
    [console.log, console.error] = [log, err];
  }
};

test('拼装：占位换成个人段，可在行内；缺个人段就报出名字', () => {
  const personal = '<!-- personal:role -->\n我是谁\n第二行\n<!-- /personal:role -->\n';
  assert.deepEqual(parsePersonal(personal), { role: '我是谁\n第二行' });
  assert.deepEqual(compose('# 标题\n<!-- personal:role -->其余\n', personal), { text: '# 标题\n我是谁\n第二行其余\n', missing: [] });
  assert.deepEqual(compose('a <!-- personal:goal --> b', personal).missing, ['goal']);
  assert.equal(firstDiff('a\nb', 'a\nb'), null);
  assert.deepEqual(firstDiff('a\nb', 'a\nc'), { line: 2, installed: 'c', composed: 'b' });
});

// 用仓库里真实的 global/ 仓库版，个人段放临时状态目录
function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-gi-home-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-gi-state-'));
  fs.mkdirSync(path.join(dir, 'personal'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'personal', 'codex.md'), '<!-- personal:role -->\n测试角色。\n<!-- /personal:role -->\n');
  return { home, dir, env: { AGENT_KIT_STATE_DIR: dir } };
}

test('预览不写；--apply 写入并备份，再跑一遍就一致；体检报一致', () => {
  const { home, dir, env } = setup();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '旧内容\n');
  assert.equal(quiet(() => main(['--allow-any-branch'], home, env)), 0);
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'), '旧内容\n');
  assert.equal(quiet(() => main(['--apply', '--allow-any-branch'], home, env)), 0);
  const claude = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
  assert.equal(claude, fs.readFileSync(path.join(KIT, 'global', 'claude', 'CLAUDE.md'), 'utf8'));
  const codex = fs.readFileSync(path.join(home, '.codex', 'AGENTS.md'), 'utf8');
  assert.ok(codex.includes('测试角色。'));
  assert.ok(!codex.includes('<!-- personal:'));
  const baks = fs.readdirSync(path.join(dir, 'backups'));
  assert.equal(baks.length, 1);
  assert.ok(inspect({ home, env, dir }).every(r => r.status === 'same'));
  const res = runDoctor({ home, env, dir, run: () => ({ code: 0, stdout: '', stderr: '' }), config: {} });
  assert.ok(res.filter(r => r.name.startsWith('全局指令')).every(r => r.status === 'ok'));
});

test('有人直接改了已装文件：体检报漂移并指出行；缺个人段时 --apply 拒绝且不写', () => {
  const { home, dir, env } = setup();
  quiet(() => main(['--apply', '--allow-any-branch'], home, env));
  fs.appendFileSync(path.join(home, '.claude', 'CLAUDE.md'), '直接加的一行\n');
  const res = runDoctor({ home, env, dir, run: () => ({ code: 0, stdout: '', stderr: '' }), config: {} });
  const c = res.find(r => r.name === '全局指令 claude 与仓库版一致');
  assert.equal(c.status, 'warn');
  assert.match(c.detail.join('\n'), /直接加的一行/);
  fs.rmSync(path.join(dir, 'personal', 'codex.md'));
  const before = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
  assert.equal(quiet(() => main(['--apply', '--allow-any-branch'], home, env)), 1);
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'), before);
});

test('不在 main 上：--apply 拒绝', () => {
  const { home, env } = setup();
  // 测试跑在 worktree 分支上时 branchProblem 非空；在 main 上跑时这条退化为只验预览
  const code = quiet(() => main(['--apply'], home, env));
  assert.ok(code === 1 || fs.existsSync(path.join(home, '.claude', 'CLAUDE.md')));
});

test('仓库版两份全局指令的「跨项目沉淀」逐字相同（#160：原来只在装机后体检里查，#153 改出一字之差没被拦住）', () => {
  const read = rel => fs.readFileSync(path.join(KIT, rel), 'utf8');
  const a = extractSection(read('global/claude/CLAUDE.md'), '跨项目沉淀');
  const b = extractSection(read('global/codex/AGENTS.md'), '跨项目沉淀');
  assert.notEqual(a, null, 'Claude 那份找不到「跨项目沉淀」一节');
  assert.notEqual(b, null, 'Codex 那份找不到「跨项目沉淀」一节');
  assert.equal(a, b, '两段要一字不差（README「怎么接入」）；改一份就同步改另一份');
});
