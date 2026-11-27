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
// 来由：近 14 天〔等你决定〕只有约 67%、〔等你操作〕只有约 23% 带按钮框，一条命令都没跑的轮带 wrap_up 的只有约 10% 和 2%
//   （2026-11-28 修去重后重算；原报 53%、20%、17%、6% 用的是同一个去重错误，#158）。
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
// 「回复『X』」「回我『X』」「回复我『X』」，后面可带量词（一句 / 一个 / 一下 / 一条 / 一声 / 一段 / 个 / 句话）、冒号，
// 或括号举例（「回（比如『X』）」「回一句（例如『X』）」「回复（可以写『X』）」）；也认「回到这里说一声『X』」「回来说『X』」。
// 「回它」「回信」「回到首页」不算。否定要直接管着这个「回」：否定词和「回」之间只许隔「你」「再」
// 和一个「在……」地点状语（「不要再回复」「无需你回复」「不要在这个会话回复」「不希望你在这里回复」）；
// 「别忘了回复」「不要忘了回复」中间隔着别的动词，「分别回复」「区别」里的「别」不是否定，都算要回话。
// 双重否定（「不是不要回复」）也算要回话。只看「回」所在小句（按标点切）
const REPLY = /(?:回(?:复)?我?(?:[一两几]?[句声个下条段]|一句话)?话?|(?:回到这里|回到本会话|回来)(?:跟我)?说(?:一声|一句)?)\s*(?:[（(]\s*(?:比如|例如|可以写|如)?\s*)?[：:]?\s*[「『“"][^」』”"\n]+[」』”"]/g;
const NEGATED = /(?:不要|不用|不必|无需|无须|不需要|没必要|不想|不希望|勿|(?<![分区特个告离类差识辨级性派])别)你?再?(?:在[^，。；！？,.;!?\n]{1,8})?$/;
const DOUBLE_NEGATION = /不是不|并非不|不能不|不得不|没有不/;
const CLAUSE_END = /[，。；！？,.;!?\n]/;
const OTHER_SESSION = /local_[0-9a-f]{8}/;

// 一轮的开头：不是工具结果的 user 记录（文字、图片、附件都算）
function isTurnStart(d) {
  if (d?.type !== 'user' || d.isSidechain || d.isMeta) return false;
  const c = d.message?.content;
  if (typeof c === 'string') return true;
  return Array.isArray(c) && c.length > 0 && c.some(x => x?.type !== 'tool_result');
}

// 这个会话能不能用 wrap_up：提示词快照的工具列表（attachment.tools）里有它的定义，或调用过 wrap_up 本身。
// 快照的 systemPrompt 正文里提到工具名不算
export function hasWrapTool(lines) {
  return lines.some(l => {
    if (l.includes('"prompt_snapshot"') && l.includes(WRAP)) {
      const a = parseJson(l)?.attachment;
      if (a?.type === 'prompt_snapshot' && Array.isArray(a.tools) && a.tools.some(t => t?.name === WRAP)) return true;
    }
    if (!l.includes(`"name":"${WRAP}"`)) return false;
    const d = parseJson(l);
    return d?.type === 'assistant' && (d.message?.content || []).some(x => x?.type === 'tool_use' && x.name === WRAP);
  });
}

// 「回」所在小句里、它前面那一段
function clauseBefore(text, index) {
  let i = index;
  while (i > 0 && !CLAUSE_END.test(text[i - 1])) i--;
  return text.slice(i, index);
}

// 「下一步」里有没有要常浩在这里回的话（否定说法的不算，双重否定算）
export function asksReply(next) {
  const text = String(next || '');
  return [...text.matchAll(REPLY)].some(m => {
    const before = clauseBefore(text, m.index);
    return DOUBLE_NEGATION.test(before) || !NEGATED.test(before);
  });
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
    // 同一次回复的每个内容块各写一行、共用 message.id、序号都是 0，不能拿它去重：
    // 工具调用按自己的 id；其他块（和缺 id 的工具调用）按这一行的 uuid 加序号加块内容。
    // 没有 uuid 时退回 message.id，带上块内容后，分行写的不同块不会撞键，一字不差的重写仍只算一次
    content.forEach((x, i) => {
      const key = x?.type === 'tool_use' && x.id ? `tool|${x.id}` : `${d.uuid || d.message?.id}|${i}|${JSON.stringify(x)}`;
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
