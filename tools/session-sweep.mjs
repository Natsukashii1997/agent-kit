#!/usr/bin/env node
// 会话续跑巡检：找出「停下了、没人接」的 Claude 桌面会话，交给桌面版定时任务按原因接上。
// 本脚本只读桌面版的会话索引和会话记录、只写自己状态目录里的文件，不改任何会话；
// 换模型、发消息由定时任务用桌面版的会话管理工具做（launchd 调不到那些工具）。
//   node tools/session-sweep.mjs scan               找这一轮要处理的会话，输出 JSON，并记下检查时间
//   node tools/session-sweep.mjs record --session <id> --anchor <毫秒> --kind <类别> --action <动作> [--from <模型>] [--to <模型>] [--note <说明>]
//   node tools/session-sweep.mjs backlog [--json]   巡检启用前就停着的、或超出时间窗的会话清单（只列不动，给常浩过目）
//   node tools/session-sweep.mjs status [--json]    设置、上次检查、自身花费、最近留痕
//   node tools/session-sweep.mjs config [--backup <模型 id|none>] [--start-now]
// 状态目录 session-sweep/ 下：config.json、log.jsonl、state.json。判定规则见 docs/机器执行层.md「会话续跑巡检」。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isEntry, stateDir } from '../hooks/lib/common.mjs';

export const DEFAULT_CONFIG = {
  backupModel: null, // 单模型额度用完时换到哪个模型；null = 不换，只通知
  excludeGroupName: '续跑巡检·不碰',
  startAt: null, // 巡检启用时间（毫秒）；这之前停下的算存量，只进清单
  maxAgeDays: 7, // 停下超过这么多天的不自动接
  nudgeAfterHours: 2, // 「后台进行中」静止多久后去核对
  maxWakePerRun: 3, // 每轮最多叫醒几个会话
  taskId: 'quota-guard', // 跑巡检的桌面版定时任务 id（沿用额度守护建的那个，改 id 要删了重建、会丢 bypass 模式）
};
const WAKE = new Set(['switch', 'continue', 'nudge']);
const ACCOUNT_LIMITS = /^(5-hour|session|weekly|daily|monthly|usage|spend)\b/i;
const MAX_FAILS = 2;

export function paths(env = process.env, home = os.homedir()) {
  const dir = path.join(stateDir(env, process.platform, home), 'session-sweep');
  return {
    dir,
    config: path.join(dir, 'config.json'),
    log: path.join(dir, 'log.jsonl'),
    state: path.join(dir, 'state.json'),
    sessions: env.SESSION_SWEEP_SESSIONS_DIR || path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions'),
    projects: env.SESSION_SWEEP_PROJECTS_DIR || path.join(home, '.claude', 'projects'),
  };
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

export const loadConfig = p => ({ ...DEFAULT_CONFIG, ...readJson(p.config, {}) });

export function readLog(p) {
  let text = '';
  try {
    text = fs.readFileSync(p.log, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').filter(Boolean).flatMap(l => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}

// claude-fable-5-2 → fable
export const family = model => (String(model || '').match(/^claude-([a-z]+)/i)?.[1] || String(model || '')).toLowerCase();

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// 「resets 4:10am (…)」「resets Nov 28 at 2am (…)」→ 报错之后的那个重置时刻（按本机时区）；认不出返回 null
export function parseReset(text, errorAt) {
  const m = String(text || '').match(/resets (?:([A-Z][a-z]{2}) (\d{1,2}) at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return null;
  let h = Number(m[3]) % 12;
  if (m[5].toLowerCase() === 'pm') h += 12;
  const base = new Date(errorAt);
  const d = new Date(base);
  d.setHours(h, Number(m[4] || 0), 0, 0);
  if (m[1]) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon === undefined) return null;
    d.setMonth(mon, Number(m[2]));
    if (d.getTime() < errorAt - 864e5) d.setFullYear(d.getFullYear() + 1);
  } else if (d.getTime() <= errorAt) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// 按桌面版记下的报错，分出停下的原因
export function classifyError(text, category) {
  const t = String(text || '');
  const m = t.match(/^You've hit your (.+?) limit\b/);
  if (m) return ACCOUNT_LIMITS.test(m[1]) ? { kind: 'account_limit' } : { kind: 'model_limit', name: m[1].split(/\s+/)[0] };
  if (category === 'process_interrupted' || /went to sleep|asleep|Connection|connect|stalled|closed mid|overloaded|Overloaded|stopped responding|API Error: 5\d\d|Internal server error/i.test(t)) return { kind: 'transient' };
  if (/authenticate|subscription|401|403|payment|organization/i.test(t)) return { kind: 'needs_owner' };
  return { kind: 'other_error' };
}

function listSessionFiles(root) {
  const out = [];
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3) walk(full, depth + 1);
      else if (e.isFile() && /^local_.+\.json$/.test(e.name)) out.push(full);
    }
  };
  walk(root, 0);
  return out;
}

function findTranscript(projectsDir, cliId) {
  if (!cliId) return null;
  let dirs = [];
  try {
    dirs = fs.readdirSync(projectsDir);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const f = path.join(projectsDir, d, `${cliId}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

const textOf = e => {
  const c = e.message?.content;
  if (typeof c === 'string') return c;
  return (Array.isArray(c) ? c : []).filter(b => b?.type === 'text').map(b => b.text).join('\n');
};
const isToolResult = e => Array.isArray(e.message?.content) && e.message.content.length > 0 && e.message.content.every(b => b?.type === 'tool_result');

// 会话记录末尾最后一条「真的」消息：人说的话、助手的文字或报错（跳过工具结果、元信息）
export function lastEntry(file) {
  let text;
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let d;
    try {
      d = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (d.type !== 'user' && d.type !== 'assistant') continue;
    if (d.isMeta || isToolResult(d)) continue;
    if (d.type === 'assistant' && !d.isApiErrorMessage && !textOf(d).trim()) continue;
    return { type: d.type, at: Date.parse(d.timestamp) || 0, apiError: d.isApiErrorMessage === true ? d.error || 'api' : null, text: textOf(d) };
  }
  return null;
}

// 一个会话现在是不是「停下了、没人接」；是的话返回原因和锚点（停下的时刻）
export function stoppedState(s, last) {
  if (s.error) {
    const errorAt = s.errorAt || s.errorRows?.at || 0;
    // 报错之后有人说过话（含 /model 这类命令）：已经有人接手了
    if (!last || (last.type === 'user' && last.at > errorAt + 1000)) return null;
    if (last.type === 'assistant' && !last.apiError && last.at > errorAt + 1000) return null;
    return { ...classifyError(s.error, s.errorCategory), anchor: errorAt, errorText: s.error };
  }
  if (last?.type === 'assistant' && !last.apiError && /〔后台进行中〕/.test(last.text)) return { kind: 'background', anchor: last.at, errorText: null };
  return null;
}

const keyOf = (sessionId, anchor) => `${sessionId}@${anchor}`;

export function scan({ p, now = Date.now() }) {
  const config = loadConfig(p);
  const log = readLog(p);
  const fails = {};
  const handled = new Set();
  for (const r of log) {
    const k = keyOf(r.sessionId, r.anchor);
    if (r.action !== 'failed') handled.add(k);
    else if ((fails[k] = (fails[k] || 0) + 1) >= MAX_FAILS) handled.add(k);
  }
  // 只接一次：同一个会话 24 小时内已经因为同一类原因被叫醒过，又停在这类原因上，就不再叫醒，改为通知
  const wokeRecently = new Set(log.filter(r => ['switched', 'continued', 'nudged'].includes(r.action) && now - Date.parse(r.at) < 864e5).map(r => `${r.sessionId}#${r.kind}`));
  const candidates = [];
  const skipped = {};
  const skip = k => (skipped[k] = (skipped[k] || 0) + 1);
  const backlog = [];
  for (const file of listSessionFiles(p.sessions)) {
    const s = readJson(file, null);
    if (!s?.sessionId || s.isArchived || s.scheduledTaskId) continue;
    const tr = findTranscript(p.projects, s.cliSessionId) || findTranscript(p.projects, s.lastAssistantCliSessionId);
    const last = tr ? lastEntry(tr) : null;
    const st = stoppedState(s, last);
    if (!st) continue;
    const item = { sessionId: s.sessionId, title: s.title || '', model: s.model, kind: st.kind, anchor: st.anchor, errorText: st.errorText, stoppedHoursAgo: Math.round((now - st.anchor) / 36e5) };
    if (!config.startAt || st.anchor < config.startAt || now - st.anchor > config.maxAgeDays * 864e5) {
      backlog.push(item);
      skip('backlog');
      continue;
    }
    if (handled.has(keyOf(s.sessionId, st.anchor))) {
      skip('handled');
      continue;
    }
    let action = 'notify';
    let reason = '';
    if (st.kind === 'model_limit') {
      reason = `${st.errorText.match(/hit your (.+?) limit/)?.[1] || ''} 额度用完`;
      if (family(s.model) !== st.name.toLowerCase()) {
        skip('modelChanged');
        continue;
      }
      if (!config.backupModel) reason += '；没设备用模型，只通知';
      else if (family(config.backupModel) === family(s.model)) reason += '；已经在备用模型上，只转一次';
      else action = 'switch';
    } else if (st.kind === 'account_limit') {
      const resetAt = parseReset(st.errorText, st.anchor) ?? st.anchor + 5 * 36e5;
      if (now < resetAt + 3 * 60e3) {
        skip('waitingReset');
        continue;
      }
      action = 'continue';
      reason = '账户额度已重置';
    } else if (st.kind === 'transient') {
      if (now - st.anchor < 2 * 60e3) {
        skip('tooFresh');
        continue;
      }
      action = 'continue';
      reason = '临时故障（睡眠、断线、进程中断）';
    } else if (st.kind === 'background') {
      if (now - st.anchor < config.nudgeAfterHours * 36e5) {
        skip('backgroundFresh');
        continue;
      }
      action = 'nudge';
      reason = `〔后台进行中〕已静止 ${item.stoppedHoursAgo} 小时`;
    } else reason = st.kind === 'needs_owner' ? '认证或订阅问题，要常浩处理' : '认不出的报错';
    if (WAKE.has(action) && wokeRecently.has(`${s.sessionId}#${st.kind}`)) {
      action = 'notify';
      reason += '；24 小时内已因同一原因接过一次，又停下了，不再自动接';
    }
    candidates.push({ ...item, action, to: action === 'switch' ? config.backupModel : null, reason });
  }
  // 每轮最多叫醒 maxWakePerRun 个，最近停下的优先；其余下一轮再说
  candidates.sort((a, b) => b.anchor - a.anchor);
  let wakes = 0;
  const actions = candidates.filter(c => {
    if (!WAKE.has(c.action)) return true;
    if (wakes >= config.maxWakePerRun) {
      skip('overCap');
      return false;
    }
    wakes++;
    return true;
  });
  const result = { scannedAt: new Date(now).toISOString(), config, actions, skipped };
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.state, `${JSON.stringify({ lastScanAt: result.scannedAt, actions: actions.length, skipped }, null, 2)}\n`);
  return { ...result, backlog };
}

const ACTIONS = new Set(['switched', 'continued', 'nudged', 'notified', 'failed', 'excluded']);

export function record({ p, now = Date.now(), args }) {
  if (!args.session || !(Number(args.anchor) > 0) || !ACTIONS.has(args.action) || !args.kind) {
    throw new Error(`record 要 --session、--anchor（毫秒数）、--kind，--action 取 ${[...ACTIONS].join(' / ')}`);
  }
  const row = { at: new Date(now).toISOString(), sessionId: args.session, anchor: Number(args.anchor), kind: args.kind, action: args.action, from: args.from || null, to: args.to || null, note: args.note || '' };
  fs.mkdirSync(p.dir, { recursive: true });
  fs.appendFileSync(p.log, `${JSON.stringify(row)}\n`);
  return row;
}

// 巡检自己花了多少：巡检的定时任务在 hours 小时内的每次运行，按消息去重累加 token
export function selfUsage({ p, now = Date.now(), hours = 24, taskId = loadConfig(p).taskId }) {
  const since = now - hours * 36e5;
  const total = { runs: 0, calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  for (const file of listSessionFiles(p.sessions)) {
    const s = readJson(file, null);
    if (s?.scheduledTaskId !== taskId || !(s.createdAt >= since)) continue;
    const tr = findTranscript(p.projects, s.cliSessionId);
    if (!tr) continue;
    total.runs++;
    const seen = new Map();
    for (const line of fs.readFileSync(tr, 'utf8').split('\n')) {
      if (!line.includes('"usage"')) continue;
      try {
        const d = JSON.parse(line);
        if (d.type === 'assistant' && d.message?.usage) seen.set(d.message.id, d.message.usage);
      } catch {}
    }
    for (const u of seen.values()) {
      total.calls++;
      total.input += u.input_tokens || 0;
      total.cacheWrite += u.cache_creation_input_tokens || 0;
      total.cacheRead += u.cache_read_input_tokens || 0;
      total.output += u.output_tokens || 0;
    }
  }
  return total;
}

export function status({ p, now = Date.now() }) {
  return { configured: fs.existsSync(p.config), config: loadConfig(p), state: readJson(p.state, null), usage24h: selfUsage({ p, now }), recent: readLog(p).slice(-20) };
}

export function setConfig({ p, args, now = Date.now() }) {
  const cfg = loadConfig(p);
  if (args.backup !== undefined) cfg.backupModel = args.backup === 'none' ? null : args.backup;
  if (args['start-now']) cfg.startAt = now;
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.config, `${JSON.stringify(cfg, null, 2)}\n`);
  return cfg;
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
      else {
        out[a.slice(2)] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

const KIND = { model_limit: '单模型额度', account_limit: '账户额度', transient: '临时故障', needs_owner: '认证/订阅', other_error: '其他报错', background: '后台进行中' };
const SHOW = { switched: '换模型续跑', continued: '已续跑', nudged: '已催核对', notified: '只通知', failed: '失败', excluded: '排除' };

export function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const p = paths(env);
  const cmd = args._[0];
  if (cmd === 'scan') {
    const { backlog, ...r } = scan({ p });
    console.log(JSON.stringify(r, null, 2));
    return 0;
  }
  if (cmd === 'backlog') {
    const { backlog } = scan({ p });
    if (args.json) console.log(JSON.stringify(backlog, null, 2));
    else {
      console.log(`巡检启用前就停着、或停了超过 ${loadConfig(p).maxAgeDays} 天的会话：${backlog.length} 个（只列不动）`);
      for (const b of backlog.sort((a, c) => a.stoppedHoursAgo - c.stoppedHoursAgo)) console.log(`${String(b.stoppedHoursAgo).padStart(4)} 小时前｜${KIND[b.kind] || b.kind}｜${b.title}｜${b.sessionId}`);
    }
    return 0;
  }
  if (cmd === 'record') {
    console.log(JSON.stringify(record({ p, args })));
    return 0;
  }
  if (cmd === 'config') {
    console.log(JSON.stringify(setConfig({ p, args }), null, 2));
    return 0;
  }
  if (cmd === 'status') {
    const s = status({ p });
    if (args.json) console.log(JSON.stringify(s, null, 2));
    else {
      const c = s.config;
      console.log(`备用模型：${c.backupModel || '不设（单模型额度用完只通知）'}　不碰分区：${c.excludeGroupName}　启用于：${c.startAt ? new Date(c.startAt).toISOString() : '未启用'}　每轮最多叫醒 ${c.maxWakePerRun} 个`);
      console.log(`上次检查：${s.state?.lastScanAt || '还没跑过'}`);
      const u = s.usage24h;
      const w = n => `${(n / 1e4).toFixed(1)} 万`;
      console.log(`最近 24 小时巡检自己的花费：运行 ${u.runs} 次、调模型 ${u.calls} 次；输入 ${w(u.input + u.cacheWrite + u.cacheRead)} token（其中缓存读 ${w(u.cacheRead)}），输出 ${w(u.output)}`);
      for (const r of s.recent) console.log(`${r.at}  ${SHOW[r.action] || r.action}  ${KIND[r.kind] || r.kind}  ${r.sessionId}  ${r.from || ''}${r.to ? ` → ${r.to}` : ''}  ${r.note}`);
    }
    return 0;
  }
  console.error('用法：session-sweep.mjs scan | backlog [--json] | record … | status [--json] | config [--backup <模型|none>] [--start-now]');
  return 2;
}

if (isEntry(import.meta.url)) process.exitCode = main();
