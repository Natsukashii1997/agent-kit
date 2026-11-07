#!/usr/bin/env node
// thinking-review 准入提醒（#35，thinking-review 1.1.0）：在几个关键节点提醒 Claude 先按 thinking-review 判断
// 当前问题属于 A / B / A+B / C。只提醒，不判断、不拦截，也不调用驿窗接力；判断交给 skill，送不送由 Claude 定。
//   UserPromptSubmit：像是交来一份已形成的方案（长文 + 方案类字眼），或常浩点名要思维评审、质疑方向时
//   PreToolUse Edit/Write 类：本会话第一次改项目文件前（常浩基本不用计划模式，这才是「准备动手」的节点）
//   PreToolUse ExitPlanMode：退出计划模式前
// 用本机规则判断，不调模型、不外发；记录只写时间、会话、节点、信号编码，不写提示词和文件内容。
// 同一会话同一节点只提醒一次，同一份方案只提醒一次；本会话已经调用过 thinking-review 的，不再提醒动手前的两个节点。
// 出任何错都静默放行（退出 0、不输出），不影响会话。状态目录里有 thinking-review-nudge.off 就整个不提醒、不记录。AGENT_KIT_NO_LOG=1 不写记录，AGENT_KIT_NO_DEDUPE=1 不去重（自检用）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isEntry, parseJson, readStdin, stateDir } from './lib/common.mjs';

export const LOG_FILE = 'thinking-review-nudges.jsonl';
const SEEN_DIR = 'thinking-review-sessions';
export const OFF_FILE = 'thinking-review-nudge.off';

// 不是常浩在交代事情：后台事件、会话间通知、定时任务、CI 回报、斜杠命令展开；
// 上下文压缩后的续接摘要、别的会话派来的任务说明（派出的会话已经判断过）、驿窗转回来的 GPT 回信（由 skill 第 6 节处理）
const AUTOMATED = /^\s*(?:<(?:side-sessions-event|task-notification|ci-monitor-event|scheduled-task|system-reminder|local-command|command-name|command-message)\b|\[SYSTEM NOTIFICATION|This session is being continued from a previous conversation|(?:Background|Task) \(from the session|Please carry out this task|The agent-hud plugin sent)/i;
const OPT_OUT = /(?:不用|不必|别|不要|无需|先不)(?:再)?(?:送审?|送\s*GPT|思维评审|评审)|直接开工/i;
const ASKED = /思维评审/;
const DOUBT = /方向(?:不对|错了|有问题|是不是错)|是不是(?:想|搞|做)错了|(?:前提|思路)(?:不对|错了)|推翻(?:重来|方案)|重新(?:想|考虑)(?:一下)?(?:方案|方向|思路)/;
const PLAN_WORDS = ['方案', '任务书', '需求', '交接', '架构', '设计', '路线', '策略', '规划', '验收', 'PRD', 'spec', 'roadmap'];
// 一页像样的中文方案约 500–900 字（实测样例 585、871 字），1200 会漏掉
export const HANDOFF_MIN_CHARS = 500;
const SHORT_MAX_CHARS = 400;

// 判断一条用户消息带什么信号；没有信号返回 null
export function promptSignal(prompt) {
  const text = String(prompt || '');
  if (!text.trim() || AUTOMATED.test(text) || /^\s*\/[\w:-]+/.test(text)) return null;
  const short = text.length <= SHORT_MAX_CHARS;
  // 「不用送 / 直接开工」是常浩的指令，只认短消息；长文（贴来的方案）里出现这些字眼不算
  if (short && OPT_OUT.test(text)) return { signal: 'optout' };
  if (text.length >= HANDOFF_MIN_CHARS) {
    const low = text.toLowerCase();
    const words = PLAN_WORDS.filter(w => low.includes(w.toLowerCase()));
    if (words.length >= 2) return { signal: 'handoff', key: `handoff:${digest(text)}` };
  }
  if (ASKED.test(text)) return { signal: 'asked' };
  if (short && DOUBT.test(text)) return { signal: 'doubt' };
  return null;
}

const digest = text => crypto.createHash('sha256').update(String(text).slice(0, 4000)).digest('hex').slice(0, 12);

// 不算「动手做项目」的写入：临时目录、会话草稿、Claude 自己的记忆和计划文件
export function isScratchPath(file, home = os.homedir(), tmp = os.tmpdir()) {
  if (!file) return false;
  const p = path.resolve(String(file));
  const roots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmp, path.join(home, '.claude')];
  return roots.some(r => p === r || p.startsWith(`${path.resolve(r)}${path.sep}`));
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// 从 hook 输入得出这一次是什么节点：{ event, signal, key }，不是检查节点返回 null
export function classify(input) {
  const ev = input?.hook_event_name;
  if (ev === 'UserPromptSubmit') {
    const s = promptSignal(input.prompt);
    return s && { event: 'prompt', key: s.key || s.signal, ...s };
  }
  if (ev === 'PreToolUse' && input.tool_name === 'ExitPlanMode') {
    return { event: 'plan', signal: 'plan', key: `plan:${digest(JSON.stringify(input.tool_input || {}))}` };
  }
  if (ev === 'PreToolUse' && EDIT_TOOLS.has(input.tool_name)) {
    const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
    if (isScratchPath(file)) return null;
    return { event: 'edit', signal: 'first-edit', key: 'first-edit' };
  }
  return null;
}

const TAIL = '判断需要≠必须发起：已有有效结论、常浩已拍板、属于 B（工程审查）或 C（执行已定路线、小改、明确的 bug）的，直接继续，不送 GPT，也不用写四行。';
const HEAD = 'thinking-review 检查点（钩子按规则提醒，可能误报）：';

export function message({ signal }) {
  switch (signal) {
    case 'asked':
      return `${HEAD}常浩提到了思维评审。先调用 thinking-review skill，按它的准入和送审流程做；如果常浩是在说别的事（例如讨论这个 skill 本身），忽略本提醒。`;
    case 'handoff':
      return `${HEAD}这条消息像是交来一份已形成的方案或任务书。如果确实是，动手前先调用 thinking-review skill，判断当前问题属于 A / B / A+B / C；接手别人的方案先独立分析，只送增量。${TAIL}`;
    case 'doubt':
      return `${HEAD}常浩在质疑方向或前提。先调用 thinking-review skill 重新判断当前问题的类别，再决定是改、是送审还是交常浩。${TAIL}`;
    case 'plan':
      return `${HEAD}计划写好、准备退出计划模式。如果计划要按一个尚未论证的方向大量实施（新架构、业务方法论、关键前提未验证），先调用 thinking-review skill 做准入判断。${TAIL}`;
    case 'first-edit':
      return `${HEAD}这是本会话第一次改项目文件。如果是在按一个尚未论证的方向投入较大实施（新架构、业务方法论、关键前提未验证，或刚接手别人的方案），先调用 thinking-review skill 做准入判断；否则直接继续。${TAIL}`;
    default:
      return '';
  }
}

// 本会话是否已经调用过 thinking-review（读 skill-usage.jsonl 末尾，由 skill-usage hook 记）
export function judgedInSession(sessionId, dir = stateDir()) {
  if (!sessionId) return false;
  try {
    const file = path.join(dir, 'skill-usage.jsonl');
    const size = fs.statSync(file).size;
    const len = Math.min(size, 256 * 1024);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    return buf.toString('utf8').split('\n').some(l => l.includes(`"session":"${sessionId}"`) && /"skill":"[^"]*thinking-review"/.test(l));
  } catch {
    return false;
  }
}

function seenFile(sessionId, dir) {
  return path.join(dir, SEEN_DIR, `${String(sessionId).replace(/[^\w.-]/g, '_')}.json`);
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

// 记下这个 key；返回 true 表示第一次见（该提醒）
function markSeen(sessionId, key, dir, env) {
  if (!sessionId || env.AGENT_KIT_NO_DEDUPE) return true;
  const file = seenFile(sessionId, dir);
  let seen = [];
  try {
    seen = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    prune(path.dirname(file));
  }
  if (seen.includes(key)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([...seen, key]));
  return true;
}

// 主流程：返回要写到标准输出的文字（不提醒时是空串）
export function run(input, { env = process.env, now = new Date() } = {}) {
  const node = classify(input);
  if (!node) return '';
  const dir = stateDir(env);
  // 手动关闭：状态目录里放一个 thinking-review-nudge.off 文件，立即生效、不用重装
  if (fs.existsSync(path.join(dir, OFF_FILE))) return '';
  let reason = null;
  if (node.signal === 'optout') reason = 'optout';
  else if ((node.event === 'edit' || node.event === 'plan') && judgedInSession(input.session_id, dir)) reason = 'judged';
  else if (!markSeen(input.session_id, node.key, dir, env)) reason = 'seen';
  if (!env.AGENT_KIT_NO_LOG) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const row = { time: now.toISOString(), session: input.session_id || null, cwd: input.cwd || null, event: node.event, signal: node.signal, nudged: !reason, ...(reason ? { skip: reason } : {}) };
      fs.appendFileSync(path.join(dir, LOG_FILE), `${JSON.stringify(row)}\n`);
    } catch {}
  }
  if (reason) return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: message(node) } });
}

if (isEntry(import.meta.url)) {
  try {
    const out = run(parseJson(readStdin()) || {});
    if (out) process.stdout.write(out);
  } catch {}
  process.exitCode = 0;
}
