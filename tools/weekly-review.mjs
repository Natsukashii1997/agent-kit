#!/usr/bin/env node
// 第 4 件的一部分：每周整理的输入材料。把两样只有 agent-kit 有的数据汇成一份 Markdown，存在状态目录 weekly/ 下：
//   1. agent-kit 自检结果（tools/doctor.mjs）；
//   2. 近 7 天哪几条全局坑被 hook 碰到了几次（lessons-hits.jsonl），附在哪些项目、几个会话碰到的。
// 会话复盘本身用 my-skills 的 session-retro（my-skills#28），这里不重复做。
// 它只汇总、不下结论，也不写任何规则；「哪条该升级、哪个是新坑」由每周整理的人来判断，照 LESSONS「只出提案」。
//   node tools/weekly-review.mjs            生成并打印文件路径
//   node tools/weekly-review.mjs --stdout   直接打印内容
import fs from 'node:fs';
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

export function build({ now = Date.now(), dir = stateDir() } = {}) {
  const day = new Date(now).toISOString().slice(0, 10);
  const lines = [`# 每周整理输入（${day}）`, '', '自动汇总，只是材料，不是结论。新坑、升级都按 LESSONS 只出提案。', ''];

  lines.push('## 1. agent-kit 自检', '', '```', ...formatReport(runDoctor({ dir }), new Date(now).toISOString()), '```', '');

  const titles = Object.fromEntries(parseLessons(fs.readFileSync(LESSONS_FILE, 'utf8')).map(e => [e.id, e.title]));
  let hits = '';
  try {
    hits = fs.readFileSync(path.join(dir, 'lessons-hits.jsonl'), 'utf8');
  } catch {}
  lines.push('## 2. 近 7 天全局坑提醒命中', '', ...summarizeHits(hits, now, titles), '');

  lines.push('## 3. 会话复盘', '', '用 my-skills 的 session-retro（my-skills#28）：纯本地、只出提案。把它的提案和上面第 2 部分对照着看：被 hook 提醒过、复盘里又出了事的坑，是升级的首选。', '');
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
