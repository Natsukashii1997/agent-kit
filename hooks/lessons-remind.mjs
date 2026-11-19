#!/usr/bin/env node
// 第 2 件：LESSONS 按关键词提醒（命令执行前、改文件前的 hook，Claude Code 与 Codex 共用）。
// 读 agent-kit/LESSONS.md 里每条 G-xx 的「触发：」一行，命令或要写的内容里出现触发词时，
// 把这几条坑的标题和正确做法的第一句提示给模型。只提醒，从不拦截；同一会话同一条只提醒一次。
// 每次命中都追加一行到状态目录的 lessons-hits.jsonl，供每周整理统计「哪条坑被碰到了几次」。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntry, parseJson, readStdin, stateDir } from './lib/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LESSONS_FILE = path.resolve(HERE, '..', 'LESSONS.md');

// 「升级」一行开头的层级词，从强到弱（LESSONS「怎么升级」，#57）
export const LEVELS = ['结构', '机检', '体检', '文字', '提醒'];

// 「升级」一行标签后面的状态词；不是这四个开头的都算「已升级」。
// 「关闭」：坑本身已被代码消除，不再需要升级（LESSONS「怎么升级」）。
const STATUSES = ['未升级', '不升级', '部分升级', '关闭'];

// 解析 LESSONS.md：每条 { id, title, line, triggers: [字符串或正则], fix, level: LEVELS 之一或 null, status }
export function parseLessons(text) {
  const entries = [];
  let cur = null;
  text.split('\n').forEach((raw, i) => {
    const head = raw.match(/^## (G-\d+) (.+?)(?:（\d{4}-\d{2}-\d{2}[^）]*）)?\s*$/);
    if (head) {
      cur = { id: head[1], title: head[2].trim(), line: i + 1, triggers: null, fix: '', level: null, status: null };
      entries.push(cur);
      return;
    }
    if (!cur) return;
    const trig = raw.match(/^- 触发：(.*)$/);
    if (trig) cur.triggers = [...trig[1].matchAll(/`([^`]+)`/g)].map(m => toMatcher(m[1]));
    const fix = raw.match(/^- 正确做法：(.+)$/);
    if (fix) cur.fix = fix[1].trim();
    const up = raw.match(/^- 升级：(?:〔(.+?)〕)?\s*(.*)$/);
    if (up) {
      if (LEVELS.includes(up[1])) cur.level = up[1];
      cur.status = STATUSES.find(s => up[2].startsWith(s)) || '已升级';
    }
  });
  return entries;
}

function toMatcher(token) {
  if (token.length > 2 && token.startsWith('/') && token.endsWith('/')) return new RegExp(token.slice(1, -1), 'i');
  return token.toLowerCase();
}

export function matchLessons(entries, haystack) {
  const low = haystack.toLowerCase();
  return entries.filter(e =>
    (e.triggers || []).some(t => (t instanceof RegExp ? t.test(haystack) : low.includes(t))),
  );
}

// 从 hook 输入里取要比对的文字：Bash 取命令；改文件类工具取路径和要写入的全部文字。
export function haystackOf(input) {
  const ti = input?.tool_input;
  if (!ti) return '';
  if (typeof ti.command === 'string') return ti.command;
  const parts = [];
  const walk = v => {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(ti);
  return parts.join('\n');
}

const firstSentence = s => {
  const m = s.match(/^.*?[。；]/);
  const t = (m ? m[0] : s).trim();
  return t.length > 140 ? `${t.slice(0, 140)}…` : t;
};

export function formatReminder(hits, file = LESSONS_FILE) {
  const lines = hits.map(e => `- ${e.id} ${e.title}（${file} 第 ${e.line} 行）${e.fix ? `：${firstSentence(e.fix)}` : ''}`);
  return `agent-kit 全局坑提醒（按关键词自动匹配，可能误报）：这一步可能碰到下面几条坑，动手前先读对应条目的「正确做法」。\n${lines.join('\n')}`;
}

// 「本会话已提醒过哪几条」记在状态目录 remind-sessions/ 下（不放 /tmp，G-01），7 天前的顺手清掉
function seenFile(sessionId) {
  return path.join(stateDir(), 'remind-sessions', `${String(sessionId).replace(/[^\w.-]/g, '_')}.json`);
}

function prune(dir) {
  try {
    const cutoff = Date.now() - 7 * 864e5;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full);
    }
  } catch {}
}

function filterUnseen(sessionId, hits) {
  if (!sessionId || process.env.AGENT_KIT_NO_DEDUPE) return hits;
  const file = seenFile(sessionId);
  let seen = [];
  try {
    seen = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    prune(path.dirname(file));
  }
  const fresh = hits.filter(h => !seen.includes(h.id));
  if (fresh.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify([...seen, ...fresh.map(h => h.id)]));
  }
  return fresh;
}

function logHits(input, hits, reminded) {
  if (process.env.AGENT_KIT_NO_LOG) return;
  const dir = stateDir();
  fs.mkdirSync(dir, { recursive: true });
  const row = {
    time: new Date().toISOString(),
    session: input.session_id || null,
    tool: input.tool_name || null,
    cwd: input.cwd || null,
    ids: hits.map(h => h.id),
    reminded: reminded.map(h => h.id),
  };
  fs.appendFileSync(path.join(dir, 'lessons-hits.jsonl'), `${JSON.stringify(row)}\n`);
}

export function run(input, lessonsText) {
  const hits = matchLessons(parseLessons(lessonsText), haystackOf(input));
  if (!hits.length) return '';
  const fresh = filterUnseen(input.session_id, hits);
  try {
    logHits(input, hits, fresh);
  } catch {}
  if (!fresh.length) return '';
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: formatReminder(fresh) },
  });
}

if (isEntry(import.meta.url)) {
  try {
    const input = parseJson(readStdin()) || {};
    const out = run(input, fs.readFileSync(LESSONS_FILE, 'utf8'));
    if (out) process.stdout.write(out);
  } catch (err) {
    process.stderr.write(`agent-kit lessons-remind 出错，本次未提醒：${err.message}\n`);
    process.exitCode = 1;
  }
}
