#!/usr/bin/env node
// 额度守护：找出「卡在单模型额度报错上」的 Claude 桌面会话，交给桌面版定时任务换到备用模型并发「继续」。
// 本脚本只读桌面版的会话索引和会话记录、只写自己状态目录里的三个文件，不改任何会话；
// 换模型和发消息由定时任务用桌面版的会话管理工具做（launchd 调不到那些工具）。
//   node tools/quota-guard.mjs scan               找要处理的会话，输出 JSON，并记下这次检查的时间
//   node tools/quota-guard.mjs record --session <id> --error-at <毫秒> --action <动作> [--from <模型>] [--to <模型>] [--note <说明>]
//        动作：switched（换了并发了继续）、failed（换或发失败）、reminded（没设备用，只提醒）、alerted（已在备用上又撞额度，停下）、excluded（在「不换」分区里）
//   node tools/quota-guard.mjs status [--json]    当前设置、上次检查时间、最近的留痕
//   node tools/quota-guard.mjs config [--backup <模型 id|none>] [--max-age-hours <小时>]
// 状态目录 quota-guard/ 下：config.json（设置）、log.jsonl（每次处理一行）、state.json（上次检查）。
// 判定规则和来由见 docs/机器执行层.md「额度守护」一节。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isEntry, stateDir } from '../hooks/lib/common.mjs';

export const DEFAULT_CONFIG = { backupModel: null, excludeGroupName: '额度守护·不换', maxAgeHours: 12 };
// 「You've hit your X limit」里 X 是这些的，是账户整体额度，所有模型共用，换模型没用
const ACCOUNT_LIMITS = /^(5-hour|session|weekly|daily|monthly|usage|spend)\b/i;
const MAX_FAILS = 2;

export function paths(env = process.env, home = os.homedir()) {
  const dir = path.join(stateDir(env, process.platform, home), 'quota-guard');
  return {
    dir,
    config: path.join(dir, 'config.json'),
    log: path.join(dir, 'log.jsonl'),
    state: path.join(dir, 'state.json'),
    sessions: env.QUOTA_GUARD_SESSIONS_DIR || path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions'),
    projects: env.QUOTA_GUARD_PROJECTS_DIR || path.join(home, '.claude', 'projects'),
  };
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

export function loadConfig(p) {
  return { ...DEFAULT_CONFIG, ...readJson(p.config, {}) };
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

// claude-fable-5-2 → fable；认不出就原样小写
export const family = model => (String(model || '').match(/^claude-([a-z]+)/i)?.[1] || String(model || '')).toLowerCase();

// 把桌面版记下的报错分成 model（单模型额度）/ account（账户整体额度）/ other
export function classifyError(text) {
  const m = String(text || '').match(/^You've hit your (.+?) limit\b/);
  if (!m) return { kind: 'other' };
  if (ACCOUNT_LIMITS.test(m[1])) return { kind: 'account', name: m[1] };
  return { kind: 'model', name: m[1] };
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

// 会话记录最后一条用户或助手消息：是不是额度报错（之后没人再说话）
export function transcriptEndsInRateLimit(file) {
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
    return false;
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
    if (d.isMeta) continue;
    return d.type === 'assistant' && d.isApiErrorMessage === true && d.error === 'rate_limit';
  }
  return false;
}

export function scan({ p, now = Date.now() }) {
  const config = loadConfig(p);
  // 同一次报错处理过就不再碰；失败（多是桌面版工具偶发的网络错误）允许下一轮再试一次，失败两次才放弃
  const fails = {};
  const handled = new Set();
  for (const r of readLog(p)) {
    const key = `${r.sessionId}@${r.errorAt}`;
    if (r.action !== 'failed') handled.add(key);
    else if ((fails[key] = (fails[key] || 0) + 1) >= MAX_FAILS) handled.add(key);
  }
  const actions = [];
  const skipped = { account: 0, other: 0, archived: 0, scheduled: 0, tooOld: 0, modelChanged: 0, noTranscript: 0, notLast: 0, handled: 0 };
  for (const file of listSessionFiles(p.sessions)) {
    const s = readJson(file, null);
    if (!s?.error || !s.sessionId) continue;
    const c = classifyError(s.error);
    if (c.kind !== 'model') {
      skipped[c.kind === 'account' ? 'account' : 'other']++;
      continue;
    }
    if (s.isArchived) {
      skipped.archived++;
      continue;
    }
    if (s.scheduledTaskId) {
      skipped.scheduled++;
      continue;
    }
    const errorAt = s.errorAt || s.errorRows?.at || 0;
    if (now - errorAt > config.maxAgeHours * 3600e3) {
      skipped.tooOld++;
      continue;
    }
    // 报错里的模型和会话现在的模型不是一家：常浩已经手动换过了
    if (family(s.model) !== c.name.toLowerCase()) {
      skipped.modelChanged++;
      continue;
    }
    if (handled.has(`${s.sessionId}@${errorAt}`)) {
      skipped.handled++;
      continue;
    }
    const tr = findTranscript(p.projects, s.cliSessionId) || findTranscript(p.projects, s.lastAssistantCliSessionId);
    if (!tr) {
      skipped.noTranscript++;
      continue;
    }
    if (!transcriptEndsInRateLimit(tr)) {
      skipped.notLast++;
      continue;
    }
    let action = 'switch';
    let reason = `${c.name} 额度用完`;
    if (!config.backupModel) {
      action = 'remind';
      reason += '；没设备用模型，只提醒';
    } else if (family(config.backupModel) === family(s.model)) {
      action = 'alert';
      reason += '；已经在备用模型上，只转一次，停下';
    }
    actions.push({
      sessionId: s.sessionId,
      title: s.title || '',
      model: s.model,
      to: action === 'switch' ? config.backupModel : null,
      action,
      reason,
      errorText: s.error,
      errorAt,
      permissionMode: s.permissionMode || null,
    });
  }
  const result = { scannedAt: new Date(now).toISOString(), config, actions, skipped };
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.state, `${JSON.stringify({ lastScanAt: result.scannedAt, actions: actions.length, skipped }, null, 2)}\n`);
  return result;
}

const ACTIONS = new Set(['switched', 'failed', 'reminded', 'alerted', 'excluded']);

export function record({ p, now = Date.now(), args }) {
  if (!args.session || !args['error-at'] || !ACTIONS.has(args.action)) {
    throw new Error(`record 要 --session、--error-at，--action 取 ${[...ACTIONS].join(' / ')}`);
  }
  const row = {
    at: new Date(now).toISOString(),
    sessionId: args.session,
    errorAt: Number(args['error-at']),
    action: args.action,
    from: args.from || null,
    to: args.to || null,
    note: args.note || '',
  };
  fs.mkdirSync(p.dir, { recursive: true });
  fs.appendFileSync(p.log, `${JSON.stringify(row)}\n`);
  return row;
}

export function status({ p }) {
  const exists = fs.existsSync(p.config);
  return { configured: exists, config: loadConfig(p), state: readJson(p.state, null), recent: readLog(p).slice(-20) };
}

export function setConfig({ p, args }) {
  const cfg = { ...DEFAULT_CONFIG, ...readJson(p.config, {}) };
  if (args.backup !== undefined) cfg.backupModel = args.backup === 'none' ? null : args.backup;
  if (args['max-age-hours'] !== undefined) {
    const n = Number(args['max-age-hours']);
    if (!(n > 0)) throw new Error('--max-age-hours 要正数');
    cfg.maxAgeHours = n;
  }
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

const SHOW = { switched: '已换', failed: '失败', reminded: '只提醒', alerted: '停下', excluded: '排除' };

export function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const p = paths(env);
  const cmd = args._[0];
  if (cmd === 'scan') {
    console.log(JSON.stringify(scan({ p }), null, 2));
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
      console.log(`备用模型：${s.config.backupModel || '不设（只提醒，不换）'}　不换分区：${s.config.excludeGroupName}　只管 ${s.config.maxAgeHours} 小时内的报错`);
      console.log(`上次检查：${s.state?.lastScanAt || '还没跑过'}`);
      for (const r of s.recent) console.log(`${r.at}  ${SHOW[r.action] || r.action}  ${r.sessionId}  ${r.from || ''}${r.to ? ` → ${r.to}` : ''}  ${r.note}`);
    }
    return 0;
  }
  console.error('用法：quota-guard.mjs scan | record … | status [--json] | config [--backup <模型|none>] [--max-age-hours N]');
  return 2;
}

if (isEntry(import.meta.url)) process.exitCode = main();
