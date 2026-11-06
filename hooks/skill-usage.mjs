#!/usr/bin/env node
// Claude Code PostToolUse hook（#13）：每次调用 Skill 记一行到状态目录 skill-usage.jsonl，
// 字段 { time, session, cwd, skill }，给 my-skills 的月度体检算「谁在用、用了几次」（《工程流程》第 8 节第 1 条）。
// 只记录、不输出、不拦截；出任何错都静默退出 0，不影响会话。AGENT_KIT_NO_LOG=1 时不写（自检用）。
import fs from 'node:fs';
import path from 'node:path';
import { isEntry, parseJson, readStdin, stateDir } from './lib/common.mjs';

export function usageRow(input, now = new Date()) {
  if (!input || input.tool_name !== 'Skill') return null;
  const skill = input.tool_input?.skill;
  if (typeof skill !== 'string' || !skill.trim()) return null;
  return { time: now.toISOString(), session: input.session_id || null, cwd: input.cwd || null, skill: skill.trim() };
}

export function record(input, { env = process.env, now = new Date() } = {}) {
  const row = usageRow(input, now);
  if (!row || env.AGENT_KIT_NO_LOG) return row;
  const dir = stateDir(env);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'skill-usage.jsonl'), `${JSON.stringify(row)}\n`);
  return row;
}

if (isEntry(import.meta.url)) {
  try {
    record(parseJson(readStdin()));
  } catch {}
  process.exitCode = 0;
}
