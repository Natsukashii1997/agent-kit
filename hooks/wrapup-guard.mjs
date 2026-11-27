#!/usr/bin/env node
// 收尾按钮框兜底（#150）：Claude 桌面应用里，收尾要常浩在本会话拍板或回话，却没有带按钮的 wrap_up，就让模型补一次。
//   Stop：取本轮最后一条助手消息（Stop 输入的 last_assistant_message 优先，没有才用会话记录里本轮最后一段文字），
//     只看其中最后一个「**当前状态**：〔…〕」：〔等你决定〕，或〔等你操作〕〔受阻〕且「下一步」里写了「回复『X』」，
//     而本轮没有合格且调用成功的 mcp__ccd_turn__wrap_up（ask 非空、actions 1–2 个、每个都有按钮文字或应用动作，工具结果不是错误），
//     就返回 decision=block，让模型补调 wrap_up、再把收尾三项原样重发（收尾三项仍是最后一条消息，驿窗照常读）。
//   一轮：从最后一条不是工具结果的 user 记录开始（文字、图片、附件都算），会话记录整份读，不截断。
//   放行：stop_hook_active（补过一次，不来回）；会话没有 wrap_up 工具（记录里看不到它的定义或对它本身的调用，
//        例如 claude -p、Hermes 派单的 SDK 会话，即使继承了 claude-desktop 入口变量）；「下一步」指向别的会话
//        （local_ 会话链接：按钮会把话发回本会话，第 12 节写明这种不放按钮）；本轮成功出了【交接】卡（第 5 节）。
// 来由：近 14 天〔等你决定〕只有 53%、〔等你操作〕只有 20% 带按钮框，一条命令都没跑的轮带 wrap_up 的只有 17% 和 6%。
// 用本机规则判断，不调模型、不外发；记录只写时间、会话、状态词、结论，不写正文。
// 出任何错都静默放行（退出 0、不输出）。状态目录里有 wrapup-guard.off 就整个不查（卸载不删它，重装后仍生效）。
// AGENT_KIT_NO_LOG=1 不写记录。
import fs from 'node:fs';
import path from 'node:path';
import { isEntry, parseJson, readStdin, stateDir } from './lib/common.mjs';

export const LOG_FILE = 'wrapup-guard.jsonl';
export const OFF_FILE = 'wrapup-guard.off';
const WRAP = 'mcp__ccd_turn__wrap_up';
const START = 'mcp__ccd_session__start_session';
const STATES = ['已结束', '等你决定', '等你操作', '后台进行中', '受阻'];

const STATUS = /\*\*当前状态\*\*[：:]\s*〔([^〕]+)〕/g;
const NEXT = /\*\*下一步\*\*[：:]([\s\S]*)/;
// 「回复『X』」「回一句「X」」「回我「X」」；同一句里「回」字前面有否定说法的不算（「不要再回复」「无需你回复」）
const REPLY = /回(?:复|一句|我)?\s*[「『“"][^」』”"\n]+[」』”"]/g;
const NEGATED = /(?:不要|不用|不必|无需|不需要|没必要|别(?![的人处家])|勿)[^，。；、！？,.;!?\n「『“"]{0,4}$/;
const OTHER_SESSION = /local_[0-9a-f]{8}/;

// 一轮的开头：不是工具结果的 user 记录（文字、图片、附件都算）
function isTurnStart(d) {
  if (d?.type !== 'user' || d.isSidechain || d.isMeta) return false;
  const c = d.message?.content;
  if (typeof c === 'string') return true;
  return Array.isArray(c) && c.length > 0 && c.some(x => x?.type !== 'tool_result');
}

// 这个会话能不能用 wrap_up：记录里有它的定义（prompt_snapshot），或调用过 wrap_up 本身（只认这一个工具名）
export function hasWrapTool(lines) {
  return lines.some(l => (l.includes('"prompt_snapshot"') && l.includes(WRAP)) || l.includes(`"name":"${WRAP}"`));
}

// 「下一步」里有没有要常浩在这里回的话（否定说法的不算）
export function asksReply(next) {
  return [...String(next || '').matchAll(REPLY)].some(m => !NEGATED.test(next.slice(Math.max(0, m.index - 12), m.index)));
}

// 从会话记录里取本轮：{ texts[], tools[{id,name,input}], results{id:{isError}} }；找不到开头返回 null
export function lastTurn(lines) {
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"user"')) continue;
    if (isTurnStart(parseJson(lines[i]))) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const turn = { texts: [], tools: [], results: {} };
  const seen = new Set();
  for (const line of lines.slice(start + 1)) {
    const d = parseJson(line);
    if (!d || d.isSidechain) continue;
    const content = d.message?.content;
    if (!Array.isArray(content)) continue;
    if (d.type === 'user') {
      for (const x of content) if (x?.type === 'tool_result' && x.tool_use_id) turn.results[x.tool_use_id] = { isError: Boolean(x.is_error) };
      continue;
    }
    if (d.type !== 'assistant') continue;
    content.forEach((x, i) => {
      const key = `${d.message?.id}|${i}|${x?.type}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (x?.type === 'tool_use') turn.tools.push({ id: x.id, name: x.name, input: x.input || {} });
      else if (x?.type === 'text' && x.text) turn.texts.push(x.text);
    });
  }
  return turn;
}

// 最后一条消息里最后一个合法的收尾状态：{ status, next } 或 null
export function closing(text) {
  const all = [...String(text || '').matchAll(STATUS)].filter(m => STATES.includes(m[1].trim()));
  const m = all.at(-1);
  if (!m) return null;
  const rest = text.slice(m.index);
  return { status: m[1].trim(), next: (rest.match(NEXT)?.[1] || '').trim() };
}

function goodActions(actions) {
  let list = actions;
  if (typeof list === 'string') list = parseJson(list);
  return Array.isArray(list) && list.length >= 1 && list.length <= 2 && list.every(a => String(a?.label || a?.action || '').trim());
}

// 判断本轮：返回 { status, verdict }，verdict 为 'block' / 'pass:<原因>'
export function judge(turn, { lastMessage, capable = true } = {}) {
  const text = lastMessage || turn?.texts.at(-1);
  const c = closing(text);
  if (!c) return { status: null, verdict: 'pass:no-status' };
  const { status, next } = c;
  const needs = status === '等你决定' || ((status === '等你操作' || status === '受阻') && asksReply(next));
  if (!needs) return { status, verdict: 'pass:not-needed' };
  if (!capable) return { status, verdict: 'pass:no-wrap-tool' };
  if (OTHER_SESSION.test(next)) return { status, verdict: 'pass:other-session' };
  if (!turn) return { status, verdict: 'pass:indeterminate' };
  // 工具调用要有结果且不是错误，才算按钮框或交接卡真的出来了
  const ok = t => turn.results[t.id] && !turn.results[t.id].isError;
  if (turn.tools.some(t => t.name === WRAP && String(t.input?.ask || '').trim() && goodActions(t.input?.actions) && ok(t))) return { status, verdict: 'pass:has-buttons' };
  if (turn.tools.some(t => t.name === START && String(t.input?.title || '').trim().startsWith('【交接】') && ok(t))) return { status, verdict: 'pass:handoff-card' };
  return { status, verdict: 'block' };
}

export function reason(status) {
  return [
    `wrapup-guard（agent-kit#150，按规则判断，可能误判）：本轮收尾是〔${status}〕，要常浩在本会话拍板或回话，但没有带按钮框的 wrap_up。`,
    '现在调用 mcp__ccd_turn__wrap_up：ask 写要他定的那一件事；actions 给 1–2 个按钮，按钮文字取「下一步」里的『X』，一字不差，推荐的放第一个；一次要定几件事就写「都按推荐」。',
    '调完把收尾三项（有主线时连主线行）原样再发一遍，作为本轮最后一条消息，前后不加别的话。',
    '如果这一轮其实不需要他回话（钩子误判），wrap_up 只写 recap，再原样重发收尾三项。',
  ].join('\n');
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
  const lines = fs.readFileSync(input.transcript_path, 'utf8').split('\n');
  const { status, verdict } = judge(lastTurn(lines), { lastMessage: input.last_assistant_message, capable: hasWrapTool(lines) });
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
