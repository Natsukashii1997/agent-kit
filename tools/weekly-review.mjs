#!/usr/bin/env node
// 第 4 件的一部分：每周整理的输入材料。把几样只有 agent-kit 有的数据汇成一份 Markdown，存在状态目录 weekly/ 下：
//   1. agent-kit 自检结果（tools/doctor.mjs）；
//   2. 近 7 天哪几条全局坑被 hook 碰到了几次（lessons-hits.jsonl），附在哪些项目、几个会话碰到的；
//   3. 再犯（#13）：各项目 docs/LESSONS.md、LESSONS.md、CURRENT.md 里写了「再犯：G-xx」的条目，按坑汇总，附该坑的层级（#57），
//      〔文字〕〔提醒〕层又再犯的单列为升级首选。这是规则写回后的效果数据，
//      每周一份留在 weekly/，前后几期对比就是「改进前后对比」。项目目录默认 ~/Documents/ChatGPT/个人/work，可用 AGENT_KIT_WORK_ROOT 覆盖；
//      worktree 目录（.git 是文件）不算单独的项目，免得同一份 LESSONS 算两遍（#76）。
//   4. 等批的提升（#76）：各项目 LESSONS 里「升级」行写着「可提议提升 / 提议提升 / 未升级」、还没提升为全局 G-xx 的条目，
//      按项目列出；没有「升级」行的单独计数。给「提案 7 天收口」（《工程流程》8.2）当清单用。
// 会话复盘本身用 my-skills 的 session-retro（my-skills#28），这里不重复做。
// 它只汇总、不下结论，也不写任何规则；「哪条该升级、哪个是新坑」由每周整理的人来判断，照 LESSONS「只出提案」。
// 自己不带调度。第 3、4 节另有机器可读输出 --json（#80）：数字分身每周提案收口（digital-twin proposal_digest.py）
// 每周一调起它，把「再犯」和〔提议〕的条目列进待决提案卡片；怎么认这两种条目只在这里做一份，那边只消费结果。
//   node tools/weekly-review.mjs            生成并打印文件路径
//   node tools/weekly-review.mjs --stdout   直接打印内容
//   node tools/weekly-review.mjs --json     只打印第 3、4 节的 JSON（只读：不跑自检、不写 weekly/）
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

// 每个项目要读的文件：LESSONS 两种放法都认（有的仓库放根目录），CURRENT.md 只用来找「再犯」（#76）。
const PROJECT_FILES = ['docs/LESSONS.md', 'LESSONS.md', 'CURRENT.md'];
const isLessons = name => name.endsWith('LESSONS.md');

export function projectFiles(root) {
  let names = [];
  try {
    names = fs
      .readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
      .filter(d => !isWorktree(path.join(root, d.name)))
      .map(d => d.name);
  } catch {
    return [];
  }
  return names.flatMap(project =>
    PROJECT_FILES.map(name => ({ project, name, file: path.join(root, project, name) }))
      .filter(f => fs.existsSync(f.file))
      .map(f => ({ project: f.project, name: f.name, text: fs.readFileSync(f.file, 'utf8') })),
  );
}

// worktree 的 .git 是一个文件（指回主仓库），主目录的是文件夹
function isWorktree(dir) {
  try {
    return fs.statSync(path.join(dir, '.git')).isFile();
  } catch {
    return false;
  }
}

const scanned = files => {
  const projects = new Set(files.map(f => f.project));
  const names = [...new Set(files.map(f => f.name))];
  return `扫了 ${projects.size} 个项目的 ${files.length} 份文件（${names.join('、') || '无'}）。`;
};

// levels：坑 → 层级词（LESSONS「升级」一行开头，#57）。〔文字〕〔提醒〕层又再犯的单列为升级首选。
const WEAK = ['文字', '提醒'];

// 按坑汇总再犯：[[坑, { n: 再犯条目数, projects: Set }]]，条目数多的在前。Markdown 和 --json 共用（#80）。
export function recurrenceRows(files) {
  const by = {};
  for (const f of files) for (const id of findRecurrences(f.text)) {
    by[id] ||= { n: 0, projects: new Set() };
    by[id].n += 1;
    by[id].projects.add(f.project);
  }
  return Object.entries(by).sort((a, b) => b[1].n - a[1].n);
}

// statuses：坑 → 状态词；「部分升级」在层级列里显示「部分」，提醒读者这一层没管全（审查 P2-02）。
export function summarizeRecurrence(files, titles = {}, levels = {}, statuses = {}) {
  const rows = recurrenceRows(files);
  const head = scanned(files);
  if (!rows.length) return [`${head}没有标「再犯：G-xx」的条目。`, '', '口径：踩到已有全局坑时，在项目 LESSONS 的新条目（或 CURRENT.md 的记录）里写「再犯：G-xx」才算；没标的不计，所以这里是下限。'];
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

// 项目 LESSONS 的条目：「## L-01 标题」这类带编号的二级标题，到下一个二级标题为止；代码块里的格式样例不算。
// G-xx 是全局条目（agent-kit 自己的 LESSONS.md），本来就在全局，不算等批。
const PENDING = /提议提升|未升级/; // 「可提议提升」也含「提议提升」
const PROMOTED = /提升[：:]\s*已提升/;

export function findPromotions(text) {
  const entries = [];
  let cur = null;
  let fence = false;
  for (const line of String(text || '').split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence) continue;
    const h = line.match(/^## (.+)$/);
    if (h) {
      const m = h[1].match(/^([A-Z][A-Za-z]*-\d+)\s+(.*)$/);
      cur = m && !m[1].startsWith('G-') ? { id: m[1], title: m[2].replace(/（\d{4}-\d{2}-\d{2}[^）]*）\s*$/, '').trim(), upgrades: [], promoted: false } : null;
      if (cur) entries.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^\s*-\s*升级[：:]/.test(line)) cur.upgrades.push(line);
    if (PROMOTED.test(line)) cur.promoted = true;
  }
  const open = entries.filter(e => !e.promoted);
  return {
    pending: open.filter(e => e.upgrades.some(l => PENDING.test(l))).map(e => ({
      id: e.id,
      title: e.title,
      proposed: e.upgrades.some(l => /提议提升/.test(l)),
      upgrade: e.upgrades.map(l => l.replace(/^\s*-\s*升级[：:]\s*/, '')).join(' / '),
    })),
    noLine: open.filter(e => !e.upgrades.length).map(e => ({ id: e.id, title: e.title })),
  };
}

// 每份项目 LESSONS 的等批和没有「升级」行的条目。Markdown 和 --json 共用（#80）。
export function promotionsByFile(files) {
  return files.filter(f => isLessons(f.name)).map(f => ({ ...f, ...findPromotions(f.text) }));
}

export function summarizePromotions(files) {
  const lessons = files.filter(f => isLessons(f.name));
  const by = promotionsByFile(files);
  const total = by.reduce((n, f) => n + f.pending.length, 0);
  const noLine = by.reduce((n, f) => n + f.noLine.length, 0);
  const lines = [
    `${scanned(lessons)}等批 ${total} 条，另有 ${noLine} 条没有「升级」行。`,
    '',
    '口径：项目 LESSONS 里「升级」行写着「可提议提升」「提议提升」「未升级」、并且没有「提升：已提升为全局 G-xx」的条目；〔提议〕是升级行里明确写了提议提升的。',
    '',
  ];
  for (const f of by.filter(f => f.pending.length).sort((a, b) => b.pending.length - a.pending.length)) {
    lines.push(`### ${f.project}（${f.name}，${f.pending.length} 条）`, '');
    lines.push(...f.pending.map(e => `- ${e.id} ${e.title}${e.proposed ? ' 〔提议〕' : ''}`), '');
  }
  const missing = by.filter(f => f.noLine.length);
  if (missing.length) lines.push(`没有「升级」行：${missing.map(f => `${f.project} ${f.noLine.length} 条（${f.noLine.map(e => e.id).join('、')}）`).join('；')}。`, '');
  lines.push('看法提示：这里只是清单，哪条换个项目也成立、该提议提升为全局 G-xx，由每周整理的人判断；已经写了〔提议〕的，按《工程流程》8.2 要在 7 天内有结论。');
  return lines;
}

const defaultWorkRoot = () => process.env.AGENT_KIT_WORK_ROOT || path.join(os.homedir(), 'Documents', 'ChatGPT', '个人', 'work');

// 全局 LESSONS 里每条坑的标题、层级、状态
function globalLessons(text = fs.readFileSync(LESSONS_FILE, 'utf8')) {
  const lessons = parseLessons(text);
  return {
    titles: Object.fromEntries(lessons.map(e => [e.id, e.title])),
    levels: Object.fromEntries(lessons.filter(e => e.level).map(e => [e.id, e.level])),
    statuses: Object.fromEntries(lessons.map(e => [e.id, e.status])),
  };
}

// --json：第 3、4 节的机器可读版（#80），字段改了要把 schema 加一，消费方（digital-twin proposal_digest.py）按 schema 认。
//   recurrences：按坑汇总的再犯，升级首选（〔文字〕〔提醒〕层又再犯）在前，其余按再犯条目数；
//   promotions：项目 LESSONS 里等批的条目，proposed 为 true 的是升级行明确写了「提议提升」的（Markdown 里的〔提议〕）。
// 只读：不跑自检、不写文件。
export function buildJson({ now = Date.now(), workRoot = defaultWorkRoot(), lessonsText } = {}) {
  const { titles, levels, statuses } = globalLessons(lessonsText);
  const files = projectFiles(workRoot);
  const recurrences = recurrenceRows(files)
    .map(([id, v]) => ({ id, title: titles[id] || '', level: levels[id] || null, status: statuses[id] || null, prime: WEAK.includes(levels[id]), count: v.n, projects: [...v.projects] }))
    .sort((a, b) => b.prime - a.prime || b.count - a.count);
  const byFile = promotionsByFile(files);
  return {
    schema: 1,
    day: new Date(now).toISOString().slice(0, 10),
    scanned: { projects: new Set(files.map(f => f.project)).size, files: files.length },
    recurrences,
    promotions: byFile.flatMap(f => f.pending.map(e => ({ project: f.project, file: f.name, ...e }))),
    noUpgradeLine: byFile.reduce((n, f) => n + f.noLine.length, 0),
  };
}

export function build({ now = Date.now(), dir = stateDir(), workRoot = defaultWorkRoot() } = {}) {
  const day = new Date(now).toISOString().slice(0, 10);
  const lines = [`# 每周整理输入（${day}）`, '', '自动汇总，只是材料，不是结论。新坑、升级都按 LESSONS 只出提案。', ''];

  lines.push('## 1. agent-kit 自检', '', '```', ...formatReport(runDoctor({ dir }), new Date(now).toISOString()), '```', '');

  const { titles, levels, statuses } = globalLessons();
  let hits = '';
  try {
    hits = fs.readFileSync(path.join(dir, 'lessons-hits.jsonl'), 'utf8');
  } catch {}
  lines.push('## 2. 近 7 天全局坑提醒命中', '', ...summarizeHits(hits, now, titles), '');

  const files = projectFiles(workRoot);
  lines.push('## 3. 再犯', '', ...summarizeRecurrence(files, titles, levels, statuses), '');

  lines.push('## 4. 等批的提升', '', ...summarizePromotions(files), '');

  lines.push('## 5. 会话复盘', '', '用 my-skills 的 session-retro（my-skills#28）：纯本地、只出提案。把它的提案和上面第 2 部分对照着看：被 hook 提醒过、复盘里又出了事的坑，是升级的首选。', '');
  return { day, text: `${lines.join('\n')}\n` };
}

if (isEntry(import.meta.url)) {
  try {
    // --json 不用 process.exit 收尾：macOS 上写管道是异步的，提前退出会截断输出
    if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(buildJson(), null, 2)}\n`);
    else {
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
    }
  } catch (err) {
    console.error(`每周汇总中断：${err.message}`);
    process.exitCode = 1;
  }
}
