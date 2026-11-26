#!/usr/bin/env node
// thinking-review 点名提醒（#35 起；#135 收窄）：只在常浩点名思维评审、或质疑方向和前提时，提醒 Claude 先调用
// thinking-review skill。不判断类别，不调用驿窗接力；判断交给 skill，送不送由 Claude 定。
//   UserPromptSubmit：常浩的消息里提到「思维评审」「送 GPT 想一想」，或短消息里质疑方向、前提（「方向不对」「这个方向对吗」）
// 2026-11-27 批阅单第 7 项（#135）去掉了「第一次改文件」「交来方案」「退出计划模式」「委派」四个时机和随之的改文件拦截：
// 一周提醒 176 个会话、发起评审 0 次；拦截 70 次全部来自「交来方案」。真正的重大决策靠 skill 本身的判断节点，不靠钩子。
// PreToolUse 仍可能装着（install.mjs 归骨架钩子会话），这里一律不提醒、不拦、不记录。
// 用本机规则判断，不调模型、不外发；记录只写时间、会话、节点、信号编码，不写提示词。同一会话同一信号只提醒一次。
// 出任何错都静默放行（退出 0、不输出），不影响会话。状态目录里有 thinking-review-nudge.off 就整个不提醒、不记录。AGENT_KIT_NO_LOG=1 不写记录，AGENT_KIT_NO_DEDUPE=1 不去重（自检用）。
import fs from 'node:fs';
import path from 'node:path';
import { isEntry, parseJson, readStdin, stateDir } from './lib/common.mjs';

export const LOG_FILE = 'thinking-review-nudges.jsonl';
const SEEN_DIR = 'thinking-review-sessions';
export const OFF_FILE = 'thinking-review-nudge.off';

// 不是常浩在说话：后台事件、会话间通知、定时任务、CI 回报、斜杠命令展开；
// 上下文压缩后的续接摘要、驿窗转回来的 GPT 回信（由 skill 第 6 节处理）
const AUTOMATED = /^\s*(?:<(?:side-sessions-event|task-notification|ci-monitor-event|scheduled-task|system-reminder|local-command|command-name|command-message)\b|\[SYSTEM NOTIFICATION|This session is being continued from a previous conversation|The agent-hud plugin sent)/i;
// 别的会话派来的任务说明：不是常浩点名，里面提到思维评审也不提醒
const DELEGATED = /^\s*(?:(?:Background|Task) \(from the session|Please carry out this task)/i;
const OPT_OUT = /(?:不用|不必|别|不要|无需|先不)(?:再)?(?:送审?|送\s*GPT|思维评审|评审)|直接开工/i;
const ASKED = /思维评审|送\s*GPT\s*想/i;
const DOUBT = /方向(?:不对|错了|有问题|是不是错|对吗|对不对|是不是对)|是不是(?:想|搞|做)错了|(?:前提|思路)(?:不对|错了|对吗|对不对)|推翻(?:重来|方案)|重新(?:想|考虑)(?:一下)?(?:方案|方向|思路)|(?:要不要|需不需要)再论证/;
const SHORT_MAX_CHARS = 400;

// 判断一条用户消息带什么信号：'asked' / 'doubt' / null
export function promptSignal(prompt) {
  const text = String(prompt || '');
  if (!text.trim() || AUTOMATED.test(text) || DELEGATED.test(text) || /^\s*\/[\w:-]+/.test(text)) return null;
  const short = text.length <= SHORT_MAX_CHARS;
  // 「不用送 / 直接开工」是常浩的指令，只认短消息
  if (short && OPT_OUT.test(text)) return null;
  if (ASKED.test(text)) return 'asked';
  if (short && DOUBT.test(text)) return 'doubt';
  return null;
}

// 从 hook 输入得出这一次是什么节点：{ event, signal }；只认 UserPromptSubmit，其余返回 null
export function classify(input) {
  if (input?.hook_event_name !== 'UserPromptSubmit') return null;
  const signal = promptSignal(input.prompt);
  return signal && { event: 'prompt', signal };
}

const TAIL = '判断需要≠必须发起：已有有效结论、常浩已拍板、属于 B（工程审查）或 C（执行已定路线、小改、明确的 bug）的，直接继续，不送 GPT，也不用写四行。';
const HEAD = 'thinking-review 检查点（钩子按规则提醒，可能误报）：';

export function message({ signal }) {
  if (signal === 'asked')
    return `${HEAD}常浩提到了思维评审。先调用 thinking-review skill，按它的准入和送审流程做；如果常浩是在说别的事（例如讨论这个 skill 本身），忽略本提醒。`;
  if (signal === 'doubt')
    return `${HEAD}常浩在质疑方向或前提。先调用 thinking-review skill 重新判断当前问题的类别，再决定是改、是送审还是交常浩。${TAIL}`;
  return '';
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

// 记下这个信号；返回 true 表示本会话第一次见（该提醒）
function markSeen(sessionId, key, dir, env) {
  if (!sessionId || env.AGENT_KIT_NO_DEDUPE) return true;
  const file = path.join(dir, SEEN_DIR, `${String(sessionId).replace(/[^\w.-]/g, '_')}.json`);
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
  const fresh = markSeen(input.session_id, node.signal, dir, env);
  if (!env.AGENT_KIT_NO_LOG) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const row = { time: now.toISOString(), session: input.session_id || null, cwd: input.cwd || null, event: node.event, signal: node.signal, nudged: fresh, ...(fresh ? {} : { skip: 'seen' }) };
      fs.appendFileSync(path.join(dir, LOG_FILE), `${JSON.stringify(row)}\n`);
    } catch {}
  }
  if (!fresh) return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: message(node) } });
}

if (isEntry(import.meta.url)) {
  try {
    const out = run(parseJson(readStdin()) || {});
    if (out) process.stdout.write(out);
  } catch {}
  process.exitCode = 0;
}
