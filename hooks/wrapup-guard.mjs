#!/usr/bin/env node
// 收尾按钮框兜底（#150）：Claude 桌面应用里，收尾要常浩拍板或回话，却没有带按钮的 wrap_up，就让模型补一次。
//   Stop：读 transcript_path，看本轮（最后一条进来的消息之后）最后一段助手文字的收尾状态词：
//     〔等你决定〕，或〔等你操作〕〔受阻〕且「下一步」里写了「回复『X』」，而本轮没有带 ask 的 mcp__ccd_turn__wrap_up，
//     就返回 decision=block，让模型补调 wrap_up、再把收尾三项原样重发（收尾三项仍是最后一条消息，驿窗照常读）。
//   跳过：stop_hook_active（补过一次了，不来回）；入口不是 claude-desktop（claude -p、Hermes 派单的 SDK 会话没有 wrap_up）；
//        本轮出了【交接】卡（全局第 5 节：卡就是开始入口，不放按钮）。
// 来由：近 14 天〔等你决定〕只有 53%、〔等你操作〕只有 20% 带按钮框，一条命令都没跑的轮带 wrap_up 的只有 17% 和 6%。
// 用本机规则判断，不调模型、不外发；记录只写时间、会话、状态词、结果，不写正文。
// 出任何错都静默放行（退出 0、不输出）。状态目录里有 wrapup-guard.off 就整个不查。AGENT_KIT_NO_LOG=1 不写记录。
import fs from 'node:fs';
import path from 'node:path';
import { isEntry, parseJson, readStdin, stateDir } from './lib/common.mjs';

export const LOG_FILE = 'wrapup-guard.jsonl';
export const OFF_FILE = 'wrapup-guard.off';
const WRAP = 'mcp__ccd_turn__wrap_up';
const START = 'mcp__ccd_session__start_session';
const TAIL_BYTES = 16 * 1024 * 1024;

const STATUS = /\*\*当前状态\*\*[：:]\s*〔([^〕]+)〕/;
const NEXT = /\*\*下一步\*\*[：:]([\s\S]*)/;
const REPLY = /回(?:复|一句|我)?\s*[「『“"][^」』”"\n]{1,40}[」』”"]/;

// 一条记录是不是「进来的消息」（一轮的开头）：常浩、驿窗、子会话回报、CI、后台通知都算；工具结果不算
function isTurnStart(d) {
  if (d?.type !== 'user' || d.isSidechain || d.isMeta) return false;
  const c = d.message?.content;
  if (typeof c === 'string') return true;
  return Array.isArray(c) && c.some(x => x?.type === 'text');
}

// 从会话记录里取本轮：{ entrypoint, texts[], tools[{name,input}] }
export function lastTurn(lines) {
  let turn = null;
  const seen = new Set();
  for (const line of lines) {
    const d = parseJson(line);
    if (!d) continue;
    if (isTurnStart(d)) {
      turn = { entrypoint: d.entrypoint || null, texts: [], tools: [] };
      seen.clear();
      continue;
    }
    if (!turn || d.type !== 'assistant' || d.isSidechain) continue;
    const content = d.message?.content;
    if (!Array.isArray(content)) continue;
    content.forEach((x, i) => {
      const key = `${d.message?.id}|${i}|${x?.type}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (x?.type === 'tool_use') turn.tools.push({ name: x.name, input: x.input || {} });
      else if (x?.type === 'text' && x.text) turn.texts.push(x.text);
    });
  }
  return turn;
}

// 判断本轮：返回 { status, verdict }，verdict 为 'block' / 'pass:<原因>'
export function judge(turn, { lastMessage, entrypoint } = {}) {
  if (!turn) return { status: null, verdict: 'pass:no-turn' };
  const ep = turn.entrypoint || entrypoint;
  if (ep && ep !== 'claude-desktop') return { status: null, verdict: 'pass:not-desktop' };
  const candidates = [lastMessage, ...[...turn.texts].reverse()].filter(Boolean);
  const text = candidates.find(t => STATUS.test(t));
  if (!text) return { status: null, verdict: 'pass:no-status' };
  const status = text.match(STATUS)[1].trim();
  const next = (text.match(NEXT)?.[1] || '').trim();
  const needs = status.includes('等你决定') || (/等你操作|受阻/.test(status) && REPLY.test(next));
  if (!needs) return { status, verdict: 'pass:not-needed' };
  if (turn.tools.some(t => t.name === WRAP && String(t.input?.ask || '').trim())) return { status, verdict: 'pass:has-ask' };
  if (turn.tools.some(t => t.name === START && String(t.input?.title || '').trim().startsWith('【交接】'))) return { status, verdict: 'pass:handoff-card' };
  return { status, verdict: 'block' };
}

export function reason(status) {
  return [
    `wrapup-guard（agent-kit#150，按规则判断，可能误判）：本轮收尾是〔${status}〕，要常浩拍板或回话，但没有带按钮框的 wrap_up。`,
    '现在调用 mcp__ccd_turn__wrap_up：ask 写要他定的那一件事；actions 的按钮文字取「下一步」里的『X』，一字不差，推荐的放第一个；一次要定几件事就写「都按推荐」。',
    '调完把收尾三项（有主线时连主线行）原样再发一遍，作为本轮最后一条消息，前后不加别的话。',
    '如果这一轮其实不需要他回话（钩子误判），wrap_up 只写 recap，再原样重发收尾三项。',
  ].join('\n');
}

function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    if (size > len) lines.shift(); // 第一行可能被截断
    return lines;
  } finally {
    fs.closeSync(fd);
  }
}

function log(dir, entry, env) {
  if (env.AGENT_KIT_NO_LOG === '1') return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, LOG_FILE), `${JSON.stringify(entry)}\n`);
  } catch {}
}

export function run(input, env = process.env) {
  if (!input || input.stop_hook_active) return null;
  const dir = stateDir(env);
  if (fs.existsSync(path.join(dir, OFF_FILE))) return null;
  if (!input.transcript_path || !fs.existsSync(input.transcript_path)) return null;
  const turn = lastTurn(readTail(input.transcript_path));
  const { status, verdict } = judge(turn, { lastMessage: input.last_assistant_message, entrypoint: env.CLAUDE_CODE_ENTRYPOINT });
  if (!status) return null;
  log(dir, { ts: new Date().toISOString(), session: input.session_id || null, status, verdict }, env);
  return verdict === 'block' ? { decision: 'block', reason: reason(status) } : null;
}

if (isEntry(import.meta.url)) {
  try {
    const out = run(parseJson(readStdin()));
    if (out) process.stdout.write(JSON.stringify(out));
  } catch {}
  process.exit(0);
}
