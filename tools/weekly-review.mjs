#!/usr/bin/env node
// 第 4 件的一部分：每周整理的输入材料。把两样只有 agent-kit 有的数据汇成一份 Markdown，存在状态目录 weekly/ 下：
//   1. agent-kit 自检结果（tools/doctor.mjs）；
//   2. 近 7 天哪几条全局坑被 hook 碰到了几次（lessons-hits.jsonl），附在哪些项目、几个会话碰到的；
//   3. 再犯（#13）：各项目 docs/LESSONS.md 里写了「再犯：G-xx」的条目，按坑汇总，附该坑的层级（#57），
//      〔文字〕〔提醒〕层又再犯的单列为升级首选。这是规则写回后的效果数据，
//      每周一份留在 weekly/，前后几期对比就是「改进前后对比」。项目目录默认 ~/Documents/ChatGPT/个人/work，可用 AGENT_KIT_WORK_ROOT 覆盖。
// 会话复盘本身用 my-skills 的 session-retro（my-skills#28），这里不重复做。
// 它只汇总、不下结论，也不写任何规则；「哪条该升级、哪个是新坑」由每周整理的人来判断，照 LESSONS「只出提案」。
//   node tools/weekly-review.mjs            生成并打印文件路径
//   node tools/weekly-review.mjs --stdout   直接打印内容
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isEntry, stateDir } from '../hooks/lib/common.mjs';
import { parseLessons, LESSONS_FILE } from '../hooks/lessons-remind.mjs';
import { formatReport, runDoctor } from './doctor.mjs';

export function summarizeHits(text, now, titles = {}) {
  const since = now - 7 * 864e5;
  const by = {};
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (Date.parse(row.time) < since) continue;
    for (const id of row.ids || []) {
      by[id] ||= { n: 0, projects: new Set(), sessions: new Set() };
      by[id].n += 1;
      if (row.cwd) by[id].projects.add(path.basename(row.cwd));
      if (row.session) by[id].sessions.add(row.session);
    }
  }
  const rows = Object.entries(by).sort((a, b) => b[1].n - a[1].n);
  if (!rows.length) return ['近 7 天没有命中（或 hook 还没装）。'];
  return [
    '| 坑 | 命中次数 | 会话数 | 项目 |',
    '|---|---|---|---|',
    ...rows.map(([id, v]) => `| ${id} ${titles[id] || ''} | ${v.n} | ${v.sessions.size} | ${[...v.projects].join('、') || '—'} |`),
    '',
    '看法提示：同一条在两个以上项目被碰到，按 LESSONS「怎么升级」考虑升级；命中很多但从没真出过事的，可能是「触发」词太宽，考虑收窄。',
  ];
}

// 一行里认两种写法：「再犯：G-04」「再犯：G-04、G-11」，或「G-04 再犯」
export function findRecurrences(text) {
  const ids = [];
  for (const line of String(text || '').split('\n')) {
    const a = line.match(/再犯[：:]\s*((?:G-\d{2}[\s、，,]*)+)/);
    if (a) ids.push(...a[1].match(/G-\d{2}/g));
    for (const m of line.matchAll(/(G-\d{2})\s*再犯/g)) ids.push(m[1]);
  }
  return ids;
}

export function lessonsFiles(root) {
  let names = [];
  try {
    names = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_')).map(d => d.name);
  } catch {
    return [];
  }
  return names
    .map(name => ({ project: name, file: path.join(root, name, 'docs', 'LESSONS.md') }))
    .filter(f => fs.existsSync(f.file))
    .map(f => ({ project: f.project, text: fs.readFileSync(f.file, 'utf8') }));
}

// levels：坑 → 层级词（LESSONS「升级」一行开头，#57）。〔文字〕〔提醒〕层又再犯的单列为升级首选。
const WEAK = ['文字', '提醒'];

// statuses：坑 → 状态词；「部分升级」在层级列里显示「部分」，提醒读者这一层没管全（审查 P2-02）。
export function summarizeRecurrence(files, titles = {}, levels = {}, statuses = {}) {
  const by = {};
  for (const f of files) for (const id of findRecurrences(f.text)) {
    by[id] ||= { n: 0, projects: new Set() };
    by[id].n += 1;
    by[id].projects.add(f.project);
  }
  const rows = Object.entries(by).sort((a, b) => b[1].n - a[1].n);
  const head = `扫了 ${files.length} 个项目的 docs/LESSONS.md。`;
  if (!rows.length) return [`${head}没有标「再犯：G-xx」的条目。`, '', '口径：踩到已有全局坑时，在项目 LESSONS 的新条目里写「再犯：G-xx」才算；没标的不计，所以这里是下限。'];
  const prime = rows.filter(([id]) => WEAK.includes(levels[id])).map(([id]) => id);
  return [
    head,
    '',
    '| 坑 | 层级 | 再犯条目数 | 项目 |',
    '|---|---|---|---|',
    ...rows.map(([id, v]) => `| ${id} ${titles[id] || ''} | ${levels[id] ? `〔${levels[id]}〕${statuses[id] === '部分升级' ? '部分' : ''}` : '—'} | ${v.n} | ${[...v.projects].join('、')} |`),
    '',
    ...(prime.length ? [`升级首选（〔文字〕〔提醒〕层又再犯）：${prime.join('、')}。按 LESSONS「怎么升级」从〔结构〕往下找第一个做得到的层。`, ''] : []),
    '看法提示：〔结构〕〔机检〕〔体检〕层的坑还在再犯，说明那一层没拦住，要改检查或换层；〔文字〕〔提醒〕层的再犯，就是文字没被遵守，往上升。',
  ];
}

export function build({ now = Date.now(), dir = stateDir(), workRoot = process.env.AGENT_KIT_WORK_ROOT || path.join(os.homedir(), 'Documents', 'ChatGPT', '个人', 'work') } = {}) {
  const day = new Date(now).toISOString().slice(0, 10);
  const lines = [`# 每周整理输入（${day}）`, '', '自动汇总，只是材料，不是结论。新坑、升级都按 LESSONS 只出提案。', ''];

  lines.push('## 1. agent-kit 自检', '', '```', ...formatReport(runDoctor({ dir }), new Date(now).toISOString()), '```', '');

  const lessons = parseLessons(fs.readFileSync(LESSONS_FILE, 'utf8'));
  const titles = Object.fromEntries(lessons.map(e => [e.id, e.title]));
  const levels = Object.fromEntries(lessons.filter(e => e.level).map(e => [e.id, e.level]));
  const statuses = Object.fromEntries(lessons.map(e => [e.id, e.status]));
  let hits = '';
  try {
    hits = fs.readFileSync(path.join(dir, 'lessons-hits.jsonl'), 'utf8');
  } catch {}
  lines.push('## 2. 近 7 天全局坑提醒命中', '', ...summarizeHits(hits, now, titles), '');

  lines.push('## 3. 再犯', '', ...summarizeRecurrence(lessonsFiles(workRoot), titles, levels, statuses), '');

  lines.push('## 4. 会话复盘', '', '用 my-skills 的 session-retro（my-skills#28）：纯本地、只出提案。把它的提案和上面第 2 部分对照着看：被 hook 提醒过、复盘里又出了事的坑，是升级的首选。', '');
  return { day, text: `${lines.join('\n')}\n` };
}

if (isEntry(import.meta.url)) {
  try {
    const dir = stateDir();
    const { day, text } = build({ dir });
    if (process.argv.includes('--stdout')) process.stdout.write(text);
    else {
      const out = path.join(dir, 'weekly');
      fs.mkdirSync(out, { recursive: true });
      const file = path.join(out, `${day}.md`);
      fs.writeFileSync(file, text);
      console.log(file);
    }
  } catch (err) {
    console.error(`每周汇总中断：${err.message}`);
    process.exitCode = 1;
  }
}
