#!/usr/bin/env node
// 全局指令进 git（#13）：~/.claude/CLAUDE.md 和 ~/.codex/AGENTS.md 由「仓库版 + 本机个人段」拼成。
//   仓库版：global/claude/CLAUDE.md、global/codex/AGENTS.md，改动走 PR。
//   个人段：状态目录 personal/claude.md、personal/codex.md，不进仓库（《工程流程》第 7 节）。
//     仓库版里写占位 <!-- personal:名字 -->，个人段文件里用
//       <!-- personal:名字 -->
//       正文（可多行）
//       <!-- /personal:名字 -->
//     包起来；拼装时把占位换成正文。占位找不到对应正文就报错，不装半截。
//   node tools/global-instructions.mjs                 只预览会不会变、哪几行变
//   node tools/global-instructions.mjs --apply         写入（先备份到状态目录 backups/<时间>/）
//   --only claude | --only codex                       只处理一边
//   --allow-any-branch                                 允许不在 main 上装（只给测试和有意为之时用）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntry, stateDir } from '../hooks/lib/common.mjs';
import { branchProblem } from './install.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARK = /<!-- personal:([\w-]+) -->/g;

export function targets(home = os.homedir(), env = process.env) {
  return {
    claude: { base: path.join(KIT, 'global', 'claude', 'CLAUDE.md'), personal: 'claude.md', dest: path.join(home, '.claude', 'CLAUDE.md') },
    codex: { base: path.join(KIT, 'global', 'codex', 'AGENTS.md'), personal: 'codex.md', dest: path.join(env.CODEX_HOME || path.join(home, '.codex'), 'AGENTS.md') },
  };
}

export function parsePersonal(text) {
  const blocks = {};
  const re = /<!-- personal:([\w-]+) -->\n([\s\S]*?)\n<!-- \/personal:\1 -->/g;
  for (const m of String(text || '').matchAll(re)) blocks[m[1]] = m[2];
  return blocks;
}

// 返回 { text, missing[] }；missing 非空时 text 不可用
export function compose(base, personalText) {
  const blocks = parsePersonal(personalText);
  const missing = [];
  const text = base.replace(MARK, (all, name) => {
    if (!(name in blocks)) {
      missing.push(name);
      return all;
    }
    return blocks[name];
  });
  return { text, missing: [...new Set(missing)] };
}

// 第一处不同的行，给预览和体检用
export function firstDiff(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  const i = la.findIndex((l, k) => l !== lb[k]);
  const at = i < 0 ? Math.min(la.length, lb.length) : i;
  if (i < 0 && la.length === lb.length) return null;
  return { line: at + 1, installed: lb[at] ?? '（没有这一行）', composed: la[at] ?? '（没有这一行）' };
}

const readText = file => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

// 每一边的状态：{ tool, dest, status: same|changed|missing-personal|no-base, composed, diff, missing }
export function inspect({ home = os.homedir(), env = process.env, dir = stateDir(env, process.platform, home), only = null } = {}) {
  return Object.entries(targets(home, env))
    .filter(([tool]) => !only || only === tool)
    .map(([tool, t]) => {
      const base = readText(t.base);
      if (base === null) return { tool, dest: t.dest, status: 'no-base' };
      const { text, missing } = compose(base, readText(path.join(dir, 'personal', t.personal)));
      if (missing.length) return { tool, dest: t.dest, status: 'missing-personal', missing, personal: path.join(dir, 'personal', t.personal) };
      const installed = readText(t.dest);
      const diff = installed === null ? { line: 1, installed: '（文件不存在）', composed: text.split('\n')[0] } : firstDiff(text, installed);
      return { tool, dest: t.dest, status: diff ? 'changed' : 'same', composed: text, diff };
    });
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

export function main(argv = process.argv.slice(2), home = os.homedir(), env = process.env) {
  const apply = argv.includes('--apply');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;
  const dir = stateDir(env, process.platform, home);
  const why = branchProblem();
  const out = [];
  if (why && !argv.includes('--allow-any-branch')) {
    if (apply) {
      console.error(`不能从这里安装：${why}\n请在 agent-kit 主目录、main 分支、拉到最新后再装。什么都没改。`);
      return 1;
    }
    out.push(`⚠ 不在可安装的状态：${why}（预览照常显示，--apply 会被拒绝）`);
  }
  const rows = inspect({ home, env, dir, only });
  let bad = false;
  const writes = [];
  for (const r of rows) {
    if (r.status === 'no-base') {
      out.push(`✗ ${r.tool}：仓库里没有仓库版文件`);
      bad = true;
    } else if (r.status === 'missing-personal') {
      out.push(`✗ ${r.tool}：个人段缺 ${r.missing.join('、')}（应在 ${r.personal}）`);
      bad = true;
    } else if (r.status === 'same') out.push(`✓ ${r.tool}：${r.dest} 已和「仓库版 + 个人段」一致`);
    else {
      out.push(`→ ${r.tool}：${r.dest} 会变，第 ${r.diff.line} 行起不同`, `    现在：${r.diff.installed}`, `    装后：${r.diff.composed}`);
      writes.push(r);
    }
  }
  if (bad) {
    console.error(`${out.join('\n')}\n有问题，什么都没改。`);
    return 1;
  }
  if (!apply || !writes.length) {
    console.log(`${out.join('\n')}${writes.length ? '\n\n以上只是预览，没有改任何文件。确认后加 --apply 再跑一次。' : ''}`);
    return 0;
  }
  const backups = path.join(dir, 'backups', stamp());
  for (const r of writes) {
    if (fs.existsSync(r.dest)) {
      fs.mkdirSync(backups, { recursive: true });
      const bak = path.join(backups, r.dest.replace(home, '~').replace(/[/\\]/g, '__'));
      // 软链接按内容备份，写入时换成普通文件
      fs.writeFileSync(bak, fs.readFileSync(r.dest));
      out.push(`  已备份 ${r.dest} → ${bak}`);
      fs.rmSync(r.dest);
    }
    fs.mkdirSync(path.dirname(r.dest), { recursive: true });
    fs.writeFileSync(r.dest, r.composed);
  }
  console.log(`${out.join('\n')}\n\n已写入 ${writes.length} 个文件。新开的 Claude Code / Codex 会话才读到新版本；然后跑 node tools/doctor.mjs 核对。`);
  return 0;
}

if (isEntry(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`安装全局指令中断：${err.message}`);
    process.exitCode = 1;
  }
}
