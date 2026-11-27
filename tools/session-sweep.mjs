#!/usr/bin/env node
// 会话续跑巡检：找出「停下了、没人接」的 Claude 桌面会话，交给桌面版定时任务按原因接上。
// 本脚本只读桌面版的会话索引和会话记录、只写自己状态目录里的文件，不改任何会话；
// 换模型、发消息由定时任务用桌面版的会话管理工具做（launchd 调不到那些工具）。
//   node tools/session-sweep.mjs scan [--track]     找这一轮要处理的会话，输出 JSON，并记下检查时间；--track 给这一轮开一份运行记录（输出 runId）
//   node tools/session-sweep.mjs check --session <id> --anchor <毫秒> [--model <模型>]   动手前复核：still（仍停在原处）/ taken（有人接手）/ moved（停在了别处）/ unknown（拿不准）
//   node tools/session-sweep.mjs claim --session <id> --anchor <毫秒>   动手前认领这一次停下（原子；别的一轮正在处理就认领不到）
//   node tools/session-sweep.mjs done --run <runId>   这一轮处理完，记进它自己的运行记录
//   node tools/session-sweep.mjs resolve --session <id> --anchor <毫秒>   常浩确认「发送结果不确定」的那一项已经处理过
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
const CLAIM_STALE_MS = 30 * 60e3; // 认领后这么久没有任何进展（留痕），算认领的那一轮死掉，允许下一次认领
const RUN_UNFINISHED_MS = 30 * 60e3; // 一轮开始后这么久还没 done，体检报没跑完

export function paths(env = process.env, home = os.homedir()) {
  const dir = path.join(stateDir(env, process.platform, home), 'session-sweep');
  return {
    dir,
    config: path.join(dir, 'config.json'),
    log: path.join(dir, 'log.jsonl'),
    state: path.join(dir, 'state.json'),
    claims: path.join(dir, 'claims'),
    runs: path.join(dir, 'runs'),
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
// 设置文件三种状态：missing 没有、broken 有但读不出（此时按默认值跑，等于不换模型、全部进存量）、ok
export function configState(file) {
  if (!fs.existsSync(file)) return 'missing';
  return readJson(file, undefined) && typeof readJson(file, undefined) === 'object' ? 'ok' : 'broken';
}

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

// 某个时区里的「墙上时间」各部分；tz 为空用本机时区
function wallParts(t, tz) {
  if (!tz) {
    const d = new Date(t);
    return { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate() };
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t)).map(x => [x.type, Number(x.value)]));
  return { y: parts.year, mo: parts.month - 1, d: parts.day, h: parts.hour, mi: parts.minute, s: parts.second };
}
// 时区 tz 里的 y-mo-d h:mi → 时间戳；tz 为空用本机时区
function fromWall(y, mo, d, h, mi, tz) {
  if (!tz) return new Date(y, mo, d, h, mi, 0, 0).getTime();
  const guess = Date.UTC(y, mo, d, h, mi);
  const off = t => {
    const p = wallParts(t, tz);
    return Date.UTC(p.y, p.mo, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
  };
  let t = guess - off(guess);
  t = guess - off(t);
  return t;
}
const validTz = tz => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// 「resets 4:10am (Asia/Shanghai)」「resets Nov 28 at 2am (…)」→ 报错之后的那个重置时刻。
// 按报错括号里的时区算；没写或认不出时区，按本机时区。认不出时间返回 null
export function parseReset(text, errorAt) {
  const m = String(text || '').match(/resets (?:([A-Z][a-z]{2}) (\d{1,2}) at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?/i);
  if (!m) return null;
  const tz = m[6] && validTz(m[6].trim()) ? m[6].trim() : null;
  let h = Number(m[3]) % 12;
  if (m[5].toLowerCase() === 'pm') h += 12;
  const mi = Number(m[4] || 0);
  const base = wallParts(errorAt, tz);
  if (m[1]) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon === undefined) return null;
    let t = fromWall(base.y, mon, Number(m[2]), h, mi, tz);
    if (t < errorAt - 864e5) t = fromWall(base.y + 1, mon, Number(m[2]), h, mi, tz);
    return t;
  }
  let t = fromWall(base.y, base.mo, base.d, h, mi, tz);
  if (t <= errorAt) t = fromWall(base.y, base.mo, base.d + 1, h, mi, tz);
  return t;
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

// 会话记录末尾最后一条「真的」消息：人说的话、助手的文字或报错（跳过工具结果、元信息）。
// 最后一行没写完（解析不了）时返回 { uncertain: true }：可能正有新消息在写入，不能拿更早的报错当最后一条。
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
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  for (let i = lines.length - 1; i >= 0; i--) {
    let d;
    try {
      d = JSON.parse(lines[i]);
    } catch {
      // 读取窗口第一行通常是被截断的半行，跳过；末尾那行读不出则说明状态不确定
      if (i === lines.length - 1) return { uncertain: true };
      continue;
    }
    if (d.type !== 'user' && d.type !== 'assistant') continue;
    if (d.isMeta || isToolResult(d)) continue;
    if (d.type === 'assistant' && !d.isApiErrorMessage && !textOf(d).trim()) continue;
    const at = Date.parse(d.timestamp);
    return { type: d.type, at: Number.isNaN(at) ? null : at, apiError: d.isApiErrorMessage === true ? d.error || 'api' : null, text: textOf(d) };
  }
  return null;
}

// 一个会话现在是不是「停下了、没人接」；是的话返回原因和锚点（停下的时刻）
export function stoppedState(s, last) {
  // 状态不确定（末尾半行、最后一条没有时间戳）：不当作停下，也不当作有人接手
  if (last?.uncertain || (last && last.at == null)) return null;
  if (s.error) {
    const errorAt = s.errorAt || s.errorRows?.at || 0;
    // 报错之后有人说过话（含 /model 这类命令）：已经有人接手了。
    // 人发的消息只要晚于报错就算；助手文字留 1 秒容差（报错前那一轮的文字时间戳可能略晚于索引里的报错时间）
    if (!last || (last.type === 'user' && last.at > errorAt)) return null;
    if (last.type === 'assistant' && !last.apiError && last.at > errorAt + 1000) return null;
    return { ...classifyError(s.error, s.errorCategory), anchor: errorAt, errorText: s.error };
  }
  if (last?.type === 'assistant' && !last.apiError && /〔后台进行中〕/.test(last.text)) return { kind: 'background', anchor: last.at, errorText: null };
  return null;
}

const keyOf = (sessionId, anchor) => `${sessionId}@${anchor}`;

// 认领一次停下：claims/ 下独占创建（open 'wx'）「<sessionId>@<anchor>#<序号>」，建好就不删。
// 同一个序号只有一个进程能建成，所以同一次停下同时只有一轮在处理；不需要删文件，也就没有「先检查、后删除」的竞态。
// 上一个序号已经结束（认领之后有了处理完的留痕）或认领后 30 分钟没有任何新留痕（那一轮死掉），才能认领下一个序号。
export function claim({ p, sessionId, anchor, now = Date.now() }) {
  const key = keyOf(sessionId, anchor);
  fs.mkdirSync(p.claims, { recursive: true });
  const name = n => path.join(p.claims, `${key}#${n}`);
  let gen = 0;
  for (const f of fs.readdirSync(p.claims)) {
    if (f.startsWith(`${key}#`)) gen = Math.max(gen, Number(f.slice(key.length + 1)) || 0);
  }
  if (gen) {
    let at;
    try {
      at = fs.statSync(name(gen)).mtimeMs;
    } catch {
      at = now;
    }
    const after = readLog(p).filter(r => keyOf(r.sessionId, r.anchor) === key && Date.parse(r.at) >= at); // 只看这个序号认领之后的留痕：上一个序号的终态留痕不能算成这一个处理完了
    // switching、model_set 是处理途中的留痕；其余（switched、continued、failed、unsure……）说明认领的那一轮已经处理完这一项
    const ended = after.some(r => r.action !== 'switching' && r.action !== 'model_set');
    const lastMove = Math.max(at, ...after.map(r => Date.parse(r.at)));
    if (!ended && !(now - lastMove > CLAIM_STALE_MS)) return { claimed: false, gen, reason: '另一轮正在处理这一次停下' };
  }
  try {
    const fd = fs.openSync(name(gen + 1), 'wx');
    fs.writeSync(fd, JSON.stringify({ at: new Date(now).toISOString(), pid: process.pid }));
    fs.closeSync(fd);
    fs.utimesSync(name(gen + 1), now / 1000, now / 1000);
    return { claimed: true, gen: gen + 1 };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    return { claimed: false, gen: gen + 1, reason: '另一轮刚认领了这一次停下' };
  }
}

// 每一轮各写各的运行记录 runs/<runId>.json，互不覆盖；体检看最近开始的一轮跑没跑完
function writeRun(p, runId, data) {
  fs.mkdirSync(p.runs, { recursive: true });
  const file = path.join(p.runs, `${runId}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...readJson(file, {}), ...data }));
  fs.renameSync(tmp, file);
}
export function latestRuns(p) {
  let files = [];
  try {
    files = fs.readdirSync(p.runs).filter(f => f.endsWith('.json'));
  } catch {
    return { started: null, done: null };
  }
  const runs = files.map(f => readJson(path.join(p.runs, f), null)).filter(r => r?.startedAt);
  const by = k => runs.filter(r => r[k]).sort((a, b) => Date.parse(b[k]) - Date.parse(a[k]))[0] || null;
  return { started: by('startedAt'), done: by('doneAt') };
}
function pruneRuns(p, now) {
  try {
    for (const f of fs.readdirSync(p.runs)) {
      const full = path.join(p.runs, f);
      if (now - fs.statSync(full).mtimeMs > 3 * 864e5) fs.unlinkSync(full);
    }
  } catch {}
}

// 纯读：找出这一轮要处理的会话和存量，不写任何文件
export function collect({ p, now = Date.now() }) {
  const config = loadConfig(p);
  const log = readLog(p);
  const fails = {};
  const handled = new Set();
  // 换模型的意图（switching，换之前记）或已换好（model_set）、还没发出续跑消息的
  const modelSet = new Set();
  for (const r of log) {
    const k = keyOf(r.sessionId, r.anchor);
    if (r.action === 'model_set' || r.action === 'switching') modelSet.add(k);
    else if (r.action === 'resolved') continue;
    else if (r.action !== 'failed') handled.add(k);
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
    if (last?.uncertain || (last && last.at == null)) {
      skip('transcriptBusy');
      continue;
    }
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
    let modelAlreadySet = false;
    if (st.kind === 'model_limit') {
      reason = `${st.errorText.match(/hit your (.+?) limit/)?.[1] || ''} 额度用完`;
      const key = keyOf(s.sessionId, st.anchor);
      if (modelSet.has(key) && config.backupModel && family(s.model) === family(config.backupModel)) {
        // 上一轮记过换模型的意图、会话现在已在备用模型上（换模型生效了，留痕或消息没跟上）：这一轮只补发消息，不再换模型
        candidates.push({ ...item, action: 'switch', to: s.model, modelAlreadySet: true, reason: `${reason}；上一轮已换到 ${s.model}，补发续跑消息` });
        continue;
      }
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
    candidates.push({ ...item, action, to: action === 'switch' ? config.backupModel : null, modelAlreadySet, reason });
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
  return { scannedAt: new Date(now).toISOString(), config, actions, skipped, backlog };
}

// 巡检的一轮：collect 之后记下检查时间。track 时给这一轮开一份运行记录；没事可做的当场记跑完，有事的由任务处理完后 done
export function scan({ p, now = Date.now(), track = false }) {
  const r = collect({ p, now });
  const runId = track ? `${now.toString(36)}-${process.pid}-${Math.random().toString(36).slice(2, 6)}` : null;
  if (runId) {
    writeRun(p, runId, { runId, startedAt: r.scannedAt, actions: r.actions.length, ...(r.actions.length ? {} : { doneAt: r.scannedAt }) });
    pruneRuns(p, now);
  }
  const state = { ...(readJson(p.state, {}) || {}), lastScanAt: r.scannedAt, actions: r.actions.length, skipped: r.skipped };
  delete state.leaseUntil;
  if (!r.actions.length) state.lastRunCompletedAt = r.scannedAt;
  writeState(p, state);
  return { ...r, runId: r.actions.length ? runId : null };
}

// 先写临时文件再换名，读的一方不会读到半个文件
function writeState(p, state) {
  fs.mkdirSync(p.dir, { recursive: true });
  const tmp = `${p.state}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, p.state);
}

// 这一轮处理完：记进它自己的运行记录（别的轮写不到这份记录上），顺带更新 status 里显示的完成时间
export function done({ p, now = Date.now(), runId = null }) {
  const at = new Date(now).toISOString();
  if (runId) writeRun(p, runId, { doneAt: at });
  const state = { ...(readJson(p.state, {}) || {}), lastRunCompletedAt: at };
  writeState(p, state);
  return { runId, doneAt: at };
}

// 还没了结的「发送结果不确定」：没被 resolve，会话也还没被人接上（复核仍是 still 或 unknown）。不随时间过期
export function openUnsure(p) {
  const log = readLog(p);
  const resolved = new Set(log.filter(r => r.action === 'resolved').map(r => keyOf(r.sessionId, r.anchor)));
  const seen = new Map();
  for (const r of log) if (r.action === 'unsure' && !resolved.has(keyOf(r.sessionId, r.anchor))) seen.set(keyOf(r.sessionId, r.anchor), r);
  return [...seen.values()].filter(r => ['still', 'unknown'].includes(check({ p, sessionId: r.sessionId, anchor: r.anchor }).state));
}

// 动手前复核：按文件现状重新判断这个会话是否仍停在同一个锚点、没人接手。state 四选一：
//   still   仍停在原处，可以动手
//   taken   锚点之后有人说过话（常浩或会话自己）：不用再发。它不能证明巡检这次的消息送到了（也可能是常浩自己接手）
//   moved   已归档、模型被换成别的、或停在了别处：这次停下已经不用管
//   unknown 拿不准（找不到索引或记录、记录正在写入）：不动手，也不当作处理完，下一轮再看
// model：这个会话此刻应有的模型（换模型之后复核时传备用模型）；不传就不比模型。
// 桌面版没有「带条件修改」，复核只能缩小竞态窗口，不能完全消除。
export function check({ p, sessionId, anchor, model }) {
  const res = (state, reason, extra = {}) => ({ state, still: state === 'still', reason, ...extra });
  const file = listSessionFiles(p.sessions).find(f => path.basename(f) === `${sessionId}.json`);
  const s = file ? readJson(file, null) : null;
  if (!s) return res('unknown', '找不到或读不出会话索引');
  if (s.isArchived) return res('moved', '已归档');
  if (model && s.model !== model) return res('moved', `模型已变成 ${s.model}`);
  const tr = findTranscript(p.projects, s.cliSessionId) || findTranscript(p.projects, s.lastAssistantCliSessionId);
  if (!tr) return res('unknown', '找不到会话记录');
  const last = lastEntry(tr);
  if (!last) return res('unknown', '会话记录读不出');
  if (last.uncertain) return res('unknown', '会话记录正在写入');
  if (last.at == null) return res('unknown', '最后一条消息没有时间戳，分不清先后');
  // 人发的消息晚于锚点就算接手；助手文字留 1 秒容差（同 stoppedState）
  if (!last.apiError && (last.type === 'user' ? last.at > Number(anchor) : last.at > Number(anchor) + 1000)) return res('taken', '锚点之后有人说过话');
  const st = stoppedState(s, last);
  if (!st) return res('unknown', '不再像停下，但也看不出有人接手');
  if (st.anchor !== Number(anchor)) return res(st.anchor > Number(anchor) ? 'moved' : 'unknown', `停在了别处（锚点 ${st.anchor}）`);
  return res('still', '仍停在原处', { kind: st.kind });
}

// model_set：已换好模型、续跑消息还没发（不算处理完，下一轮只补发消息）
// switching：换模型之前记的意图（换完来不及记 model_set 就崩了，下一轮也知道是巡检换的）
// unsure：消息发送报错、又看不出送没送到。不自动重发（可能已送到）；是未决事项，体检一直报，直到会话被接上或 resolve
// taken：发送报错，但复核看到锚点之后已有人说话（不等于本次消息送到），不用再发
// resolved：常浩确认 unsure 那一项处理过了
const ACTIONS = new Set(['switched', 'continued', 'nudged', 'notified', 'failed', 'excluded', 'switching', 'model_set', 'unsure', 'taken', 'resolved']);

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
  return { configured: fs.existsSync(p.config), configState: configState(p.config), config: loadConfig(p), state: readJson(p.state, null), runs: latestRuns(p), openUnsure: openUnsure(p), usage24h: selfUsage({ p, now }), recent: readLog(p).slice(-20) };
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
const SHOW = { switched: '换模型续跑', continued: '已续跑', nudged: '已催核对', notified: '只通知', failed: '失败', excluded: '排除', switching: '准备换模型', model_set: '已换模型待续跑', unsure: '发送结果不确定', taken: '已有人接手', resolved: '已确认处理' };

export function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const p = paths(env);
  const cmd = args._[0];
  if (cmd === 'scan') {
    const { backlog, ...r } = scan({ p, track: args.track === true });
    console.log(JSON.stringify(r, null, 2));
    return 0;
  }
  if (cmd === 'check') {
    if (!args.session || !(Number(args.anchor) > 0)) throw new Error('check 要 --session 和 --anchor（毫秒数）');
    console.log(JSON.stringify(check({ p, sessionId: args.session, anchor: Number(args.anchor), model: typeof args.model === 'string' ? args.model : undefined })));
    return 0;
  }
  if (cmd === 'done') {
    console.log(JSON.stringify(done({ p, runId: typeof args.run === 'string' ? args.run : null })));
    return 0;
  }
  if (cmd === 'claim') {
    if (!args.session || !(Number(args.anchor) > 0)) throw new Error('claim 要 --session 和 --anchor（毫秒数）');
    const c = claim({ p, sessionId: args.session, anchor: Number(args.anchor) });
    console.log(JSON.stringify(c));
    return c.claimed ? 0 : 1;
  }
  if (cmd === 'resolve') {
    console.log(JSON.stringify(record({ p, args: { ...args, kind: args.kind || 'manual', action: 'resolved', note: args.note || '常浩确认已处理' } })));
    return 0;
  }
  if (cmd === 'backlog') {
    const { backlog } = collect({ p });
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
      if (s.configState === 'broken') console.log('⚠ 设置文件读不出，正按默认值跑（不换模型、全部进存量）：重新运行 config 写一份');
      console.log(`上次检查：${s.state?.lastScanAt || '还没跑过'}　上次跑完：${s.state?.lastRunCompletedAt || '没有记录'}${s.runs.started && !s.runs.started.doneAt ? `　正在跑：自 ${s.runs.started.startedAt} 起（run ${s.runs.started.runId}）` : ''}`);
      const u = s.usage24h;
      const w = n => `${(n / 1e4).toFixed(1)} 万`;
      console.log(`最近 24 小时巡检自己的花费：运行 ${u.runs} 次、调模型 ${u.calls} 次；输入 ${w(u.input + u.cacheWrite + u.cacheRead)} token（其中缓存读 ${w(u.cacheRead)}），输出 ${w(u.output)}`);
      if (s.openUnsure.length) {
        console.log(`⚠ 发消息结果不确定、还没了结的 ${s.openUnsure.length} 项（去看一眼；处理过就运行 resolve --session <id> --anchor <毫秒>）：`);
        for (const r of s.openUnsure) console.log(`  ${r.at}  ${r.sessionId}  anchor ${r.anchor}  ${r.note}`);
      }
      for (const r of s.recent) console.log(`${r.at}  ${SHOW[r.action] || r.action}  ${KIND[r.kind] || r.kind}  ${r.sessionId}  ${r.from || ''}${r.to ? ` → ${r.to}` : ''}  ${r.note}`);
    }
    return 0;
  }
  console.error('用法：session-sweep.mjs scan [--track] | check --session <id> --anchor <毫秒> [--model <模型>] | claim --session <id> --anchor <毫秒> | done --run <runId> | resolve --session <id> --anchor <毫秒> | backlog [--json] | record … | status [--json] | config [--backup <模型|none>] [--start-now]');
  return 2;
}

if (isEntry(import.meta.url)) process.exitCode = main();
