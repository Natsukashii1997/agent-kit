#!/usr/bin/env node
// 第 2 件：LESSONS 按关键词提醒（命令执行前、改文件前的 hook，Claude Code 与 Codex 共用）。
// 读 agent-kit/LESSONS.md 里每条 G-xx 的「触发」行（可限定「改文件」「主目录」），命令或要写的内容里出现触发词时，
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

// 「升级」一行标签后面的状态词；不是这几个开头的都算「已升级」。
// 「关闭」：坑本身已被代码消除，不再需要升级（LESSONS「怎么升级」）。
// 「并入」：条目合并进了另一条（「并入 G-xx」），编号留着，旧的「再犯：G-xx」照样能对上（瘦身提案 S3、S5、S6）。
const STATUSES = ['未升级', '不升级', '部分升级', '关闭', '并入'];

// 触发行可以限定范围（瘦身提案 M1、M2，2026-11-20 常浩批）：「- 触发（改文件）：」只在写文件时匹配，
// 「- 触发（主目录）：」只在不是 worktree 的目录匹配；一条可以有几行触发，各管各的范围。
export const SCOPES = ['改文件', '主目录'];
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'apply_patch']);

// 解析 LESSONS.md：每条 { id, title, line, triggers: [{ word, match: 字符串或正则, scopes: [] }], fix, level: LEVELS 之一或 null, status, mergedInto }
export function parseLessons(text) {
  const entries = [];
  let cur = null;
  text.split('\n').forEach((raw, i) => {
    const head = raw.match(/^## (G-\d+) (.+?)(?:（\d{4}-\d{2}-\d{2}[^）]*）)?\s*$/);
    if (head) {
      cur = { id: head[1], title: head[2].trim(), line: i + 1, triggers: null, fix: '', level: null, status: null, mergedInto: null };
      entries.push(cur);
      return;
    }
    if (!cur) return;
    const trig = raw.match(/^- 触发(?:（([^）]*)）)?：(.*)$/);
    if (trig) {
      const scopes = (trig[1] || '').split(/[、,，\s]+/).filter(Boolean);
      const unknown = scopes.filter(x => !SCOPES.includes(x));
      if (unknown.length) throw new Error(`${cur.id} 的触发范围「${unknown.join('、')}」不认得，只能是 ${SCOPES.join('、')}`);
      cur.triggers = [...(cur.triggers || []), ...[...trig[2].matchAll(/`([^`]+)`/g)].map(m => ({ word: m[1], match: toMatcher(m[1]), scopes }))];
    }
    const fix = raw.match(/^- 正确做法：(.+)$/);
    if (fix) cur.fix = fix[1].trim();
    const up = raw.match(/^- 升级：(?:〔(.+?)〕)?\s*(.*)$/);
    if (up) {
      if (LEVELS.includes(up[1])) cur.level = up[1];
      cur.status = STATUSES.find(s => up[2].startsWith(s)) || '已升级';
      if (cur.status === '并入') cur.mergedInto = up[2].match(/^并入\s*(G-\d+)/)?.[1] || null;
    }
  });
  return entries;
}

function toMatcher(token) {
  if (token.length > 2 && token.startsWith('/') && token.endsWith('/')) return new RegExp(token.slice(1, -1), 'i');
  return token.toLowerCase();
}

const hit = (t, haystack, low) => (t.match instanceof RegExp ? t.match.test(haystack) : low.includes(t.match));

// 只看文字、不分场合地匹配（相当于一条 Bash 命令、在主目录里）。
export function matchLessons(entries, haystack) {
  return findHits(entries, { tool_name: 'Bash', tool_input: { command: haystack } }).map(h => h.entry);
}

// 改的是哪些文件：Claude 的改文件工具看 file_path / notebook_path，Codex 的 apply_patch 看补丁里的文件行。
function editedFiles(input) {
  const ti = input?.tool_input || {};
  const files = [ti.file_path, ti.notebook_path].filter(x => typeof x === 'string');
  for (const m of haystackOf(input).matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) files.push(m[1].trim());
  return files;
}

// 按 hook 输入找命中的坑：[{ entry, words: [命中的触发词] }]（瘦身提案 M1、M2、M3、M5）。
export function findHits(entries, input) {
  const tool = input?.tool_name || 'Bash';
  const editing = EDIT_TOOLS.has(tool);
  // M5：改的全是 .md 文档（写到坑名、命令名是常态），不提醒
  if (editing) {
    const files = editedFiles(input);
    if (files.length && files.every(f => /\.md$/i.test(f))) return [];
  }
  const inWorktree = /\/worktrees?\//.test(String(input?.cwd || ''));
  const haystack = haystackOf(input);
  const low = haystack.toLowerCase();
  const out = [];
  for (const entry of entries) {
    const words = (entry.triggers || [])
      .filter(t => (!t.scopes.includes('改文件') || editing) && (!t.scopes.includes('主目录') || !inWorktree))
      .filter(t => hit(t, haystack, low))
      .map(t => t.word);
    if (words.length) out.push({ entry, words });
  }
  return out;
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

function logHits(input, found, reminded) {
  if (process.env.AGENT_KIT_NO_LOG) return;
  const dir = stateDir();
  fs.mkdirSync(dir, { recursive: true });
  const row = {
    time: new Date().toISOString(),
    session: input.session_id || null,
    tool: input.tool_name || null,
    cwd: input.cwd || null,
    ids: found.map(h => h.entry.id),
    reminded: reminded.map(h => h.id),
    words: Object.fromEntries(found.map(h => [h.entry.id, h.words])), // 命中的触发词（M3），不记命令内容
  };
  fs.appendFileSync(path.join(dir, 'lessons-hits.jsonl'), `${JSON.stringify(row)}\n`);
}

export function run(input, lessonsText) {
  const found = findHits(parseLessons(lessonsText), input);
  if (!found.length) return '';
  const fresh = filterUnseen(input.session_id, found.map(h => h.entry));
  try {
    logHits(input, found, fresh);
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
