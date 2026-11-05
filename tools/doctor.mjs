#!/usr/bin/env node
// 第 3 件（含第 5 件的比对）：本机体检。专查「出了事没人发现」的那一类，对应全局坑 G-05、G-12、G-14、G-18。
//   node tools/doctor.mjs              体检，结果打在屏幕上，同时存一份报告
//   node tools/doctor.mjs --json       输出 JSON（给定时任务或别的脚本用）
//   node tools/doctor.mjs --no-save    不存报告
//   node tools/doctor.mjs --config <文件>   指定配置；默认读状态目录里的 doctor.json，没有就只做内置检查
// 报告存在状态目录 doctor/ 下（macOS：~/Library/Application Support/agent-kit/doctor/），
// 第一行写开始时间、最后一行写 exit N（G-12 的写法）。有 ✗ 时退出码为 1。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateDir } from '../hooks/lib/common.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARK = { ok: '✓', warn: '⚠', fail: '✗', info: '·' };

function defaultRun(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 20000, input: opts.input, env: { ...process.env, ...(opts.env || {}) } });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || (r.error ? String(r.error.message) : '') };
}

const readText = file => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

const jsonOr = (text, fallback = {}) => {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
};

// ---------- 解析函数（单独导出，测试直接测） ----------

// launchctl print gui/<uid>/<label> 的输出 → { state, lastExit, stdoutPath, stderrPath }
export function parseLaunchctlPrint(text) {
  const get = re => (text.match(re) || [])[1];
  const lastExit = get(/^\s*last exit code = (.+)$/m);
  return {
    state: get(/^\s*state = (\S+)/m) || null,
    lastExit: lastExit === undefined ? null : lastExit.trim(),
    stdoutPath: get(/^\s*stdout path = (.+)$/m)?.trim() || null,
    stderrPath: get(/^\s*stderr path = (.+)$/m)?.trim() || null,
  };
}

// sysctl -n kern.boottime 的输出（{ sec = 1730000000, usec = 0 } Mon …）→ 毫秒时间戳
export function parseBoottime(text) {
  const m = String(text).match(/sec\s*=\s*(\d+)/);
  return m ? Number(m[1]) * 1000 : null;
}

// 从 Markdown 里取标题含 heading 的那一节正文（不含标题行本身，到下一个同级或更高级标题为止）
export function extractSection(text, heading) {
  if (!text) return null;
  const lines = text.split('\n');
  const start = lines.findIndex(l => /^#{1,6}\s/.test(l) && l.includes(heading));
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .map(l => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

// 长任务日志：最后一个非空行应为 exit N（G-12）
export function checkLogTail(text) {
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  const m = last.match(/^exit\s+(-?\d+)/i);
  return m ? { finished: true, code: Number(m[1]) } : { finished: false, code: null };
}

// ---------- 各项检查：每项返回 { name, status, detail[] } ----------

function checkHooks({ home, run, env }) {
  const results = [];
  const settings = jsonOr(readText(path.join(home, '.claude', 'settings.json')));
  const want = JSON.parse(readText(path.join(KIT, 'config', 'claude-permissions.json'))).ask;
  const have = settings.permissions?.ask || [];
  const missing = want.filter(r => !have.includes(r));
  const hookCmds = (settings.hooks?.PreToolUse || []).flatMap(g => (g.hooks || []).map(h => h.command || ''));
  const hasGuard = hookCmds.some(c => c.includes('hooks/guard-git.mjs'));
  const hasRemind = hookCmds.some(c => c.includes('hooks/lessons-remind.mjs'));
  if (!missing.length && hasGuard && hasRemind) results.push({ name: 'Claude 权限规则与 hook', status: 'ok', detail: [`${want.length} 条先问规则、2 个 hook 都在`] });
  else
    results.push({
      name: 'Claude 权限规则与 hook',
      status: 'warn',
      detail: [
        ...(missing.length ? [`缺 ${missing.length} 条先问规则，例如 ${missing[0]}`] : []),
        ...(!hasGuard ? ['没装 guard-git'] : []),
        ...(!hasRemind ? ['没装 lessons-remind'] : []),
        '装法：node tools/install.mjs --apply',
      ],
    });

  const codexHome = env.CODEX_HOME || path.join(home, '.codex');
  const codexHooks = jsonOr(readText(path.join(codexHome, 'hooks.json')));
  const codexCmds = (codexHooks.hooks?.PreToolUse || []).flatMap(g => (g.hooks || []).map(h => h.command || ''));
  const rulesNow = readText(path.join(codexHome, 'rules', 'agent-kit.rules'));
  const rulesSrc = readText(path.join(KIT, 'config', 'codex', 'agent-kit.rules'));
  const codexProblems = [
    ...(!codexCmds.some(c => c.includes('hooks/guard-git.mjs')) ? ['没装 guard-git'] : []),
    ...(!codexCmds.some(c => c.includes('hooks/lessons-remind.mjs')) ? ['没装 lessons-remind'] : []),
    ...(rulesNow === null ? ['没装 rules/agent-kit.rules'] : rulesNow !== rulesSrc ? ['rules/agent-kit.rules 和仓库里的版本不一致，重跑安装'] : []),
  ];
  results.push(
    codexProblems.length
      ? { name: 'Codex hook 与执行策略', status: 'warn', detail: [...codexProblems, '装法：node tools/install.mjs --apply'] }
      : { name: 'Codex hook 与执行策略', status: 'ok', detail: ['2 个 hook 和 agent-kit.rules 都在'] },
  );

  // 两个 hook 真跑一次（装了但跑不起来，hook 默认放行，平时看不出来）。
  // 装了就原样执行设置里写的那条命令，这样 node 路径失效（比如 Homebrew 升级）也查得出来。
  const installed = file => hookCmds.find(c => c.includes(`hooks/${file}`));
  const runHook = (file, input, extraEnv = {}) => {
    const c = installed(file);
    const opts = { input: JSON.stringify(input), env: extraEnv };
    return c ? run('/bin/sh', ['-c', c], opts) : run(process.execPath, [path.join(KIT, 'hooks', file)], opts);
  };
  const g = runHook('guard-git.mjs', { tool_name: 'Bash', tool_input: { command: 'git push -f origin main' } });
  const r = runHook('lessons-remind.mjs', { session_id: `doctor-${Date.now()}`, tool_name: 'Bash', tool_input: { command: 'launchctl list' } }, { AGENT_KIT_NO_LOG: '1' });
  const okG = g.code === 0 && g.stdout.includes('"deny"');
  const okR = r.code === 0 && r.stdout.includes('G-05');
  results.push(
    okG && okR
      ? { name: 'hook 实跑自检', status: 'ok', detail: [`强推 main 被拦下；launchctl 收到 G-05 提醒（${hasGuard && hasRemind ? '按设置里的命令实跑' : '没装，用仓库里的脚本试跑'}）`] }
      : { name: 'hook 实跑自检', status: 'fail', detail: [...(!okG ? [`guard-git 没拦下强推 main：${g.stderr || g.stdout || `退出码 ${g.code}`}`] : []), ...(!okR ? [`lessons-remind 没提醒：${r.stderr || r.stdout || `退出码 ${r.code}`}`] : [])] },
  );
  return results;
}

function checkInstructionSync({ home, env, config }) {
  const heading = config.instructionSection || '跨项目沉淀';
  const claudeFile = path.join(home, '.claude', 'CLAUDE.md');
  const codexFile = path.join(env.CODEX_HOME || path.join(home, '.codex'), 'AGENTS.md');
  const a = extractSection(readText(claudeFile), heading);
  const b = extractSection(readText(codexFile), heading);
  const name = `两份全局指令「${heading}」一致`;
  if (a === null || b === null)
    return { name, status: 'warn', detail: [`找不到这一节：${[a === null && claudeFile, b === null && codexFile].filter(Boolean).join('、')}`] };
  if (a === b) return { name, status: 'ok', detail: [`${a.split('\n').length} 行逐字相同`] };
  const la = a.split('\n');
  const lb = b.split('\n');
  const i = la.findIndex((l, k) => l !== lb[k]);
  const at = i < 0 ? Math.min(la.length, lb.length) : i;
  return { name, status: 'fail', detail: [`第 ${at + 1} 行起不同`, `Claude：${la[at] ?? '（没有这一行）'}`, `Codex ：${lb[at] ?? '（没有这一行）'}`, '改成一样后再跑一次体检'] };
}

function checkAutoMemory({ home }) {
  const settings = jsonOr(readText(path.join(home, '.claude', 'settings.json')));
  const v = settings.autoMemoryEnabled;
  if (v === false) return { name: 'Claude 自动记忆', status: 'ok', detail: ['已关闭（autoMemoryEnabled: false）'] };
  return {
    name: 'Claude 自动记忆',
    status: 'info',
    detail: [v === true ? '已开启' : '没设置，按官方默认是开启的', '它会不经批准把纠正记成笔记；要关就在 Claude 里打开 /memory 切换，留着就每周整理时看一眼 ~/.claude/projects/*/memory/'],
  };
}

function checkLessonHits({ now, dir }) {
  const text = readText(path.join(dir, 'lessons-hits.jsonl'));
  const since = now - 7 * 864e5;
  const counts = {};
  for (const line of (text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (Date.parse(row.time) < since) continue;
      for (const id of row.ids || []) counts[id] = (counts[id] || 0) + 1;
    } catch {}
  }
  const list = Object.entries(counts).sort((x, y) => y[1] - x[1]);
  return {
    name: '近 7 天坑提醒命中',
    status: 'info',
    detail: list.length ? [list.map(([id, n]) => `${id}×${n}`).join('、')] : ['没有命中（或 hook 还没装）'],
  };
}

function checkLaunchd({ config, run, platform, uid, statFn }) {
  const jobs = config.launchd || [];
  if (!jobs.length || platform !== 'darwin') return [];
  return jobs.map(job => {
    const label = typeof job === 'string' ? job : job.label;
    const keepAlive = typeof job === 'object' && job.keepAlive;
    const name = `launchd ${label}`;
    const r = run('launchctl', ['print', `gui/${uid}/${label}`]);
    if (r.code !== 0) return { name, status: 'fail', detail: ['没加载（launchctl print 查不到）。可能是重装时没装回（G-18）或从没装过'] };
    const p = parseLaunchctlPrint(r.stdout);
    const detail = [];
    let status = 'ok';
    if (keepAlive && p.state !== 'running') {
      status = 'fail';
      detail.push(`常驻服务没在跑（state = ${p.state}）`);
    }
    if (p.lastExit && !/^0\b|never exited/.test(p.lastExit)) {
      status = status === 'fail' ? 'fail' : 'warn';
      detail.push(`上次退出码 ${p.lastExit}${/126/.test(p.lastExit) ? '（126 多半是 G-05：launchd 读不了「文稿」）' : ''}`);
    }
    const out = p.stdoutPath && statFn(p.stdoutPath);
    const err = p.stderrPath && p.stderrPath !== p.stdoutPath && statFn(p.stderrPath);
    if (err && err.size > 0 && (!out || err.mtimeMs > out.mtimeMs)) {
      status = status === 'fail' ? 'fail' : 'warn';
      detail.push(`错误日志比正常日志新，要看：${p.stderrPath}`);
    }
    if (!detail.length) detail.push(`已加载${p.state ? `，state = ${p.state}` : ''}${p.lastExit ? `，上次退出码 ${p.lastExit}` : ''}`);
    return { name, status, detail };
  });
}

function checkLogs({ config, now, statFn }) {
  return (config.logs || []).map(log => {
    const name = `日志 ${log.name || log.path}`;
    const st = statFn(log.path);
    if (!st) return { name, status: 'warn', detail: [`找不到 ${log.path}`] };
    const tail = checkLogTail(readText(log.path) || '');
    const ageH = (now - st.mtimeMs) / 36e5;
    if (log.maxAgeHours && ageH > log.maxAgeHours) return { name, status: 'warn', detail: [`${ageH.toFixed(0)} 小时没更新（应不超过 ${log.maxAgeHours} 小时），可能没跑`] };
    if (!tail.finished) return { name, status: ageH > 1 ? 'warn' : 'info', detail: [ageH > 1 ? '最后一行不是 exit N：可能没跑完或被打断（G-12）' : '还在写，可能正在跑'] };
    if (tail.code !== 0) return { name, status: 'fail', detail: [`上次 exit ${tail.code}`] };
    return { name, status: 'ok', detail: [`exit 0，${ageH.toFixed(0)} 小时前`] };
  });
}

function checkReboot({ config, run, platform, now, uid }) {
  if (platform !== 'darwin') return [];
  const r = run('sysctl', ['-n', 'kern.boottime']);
  const boot = parseBoottime(r.stdout);
  if (!boot) return [{ name: '开机时间', status: 'warn', detail: ['读不到 kern.boottime'] }];
  const hours = (now - boot) / 36e5;
  const windowH = config.rebootWindowHours ?? 24;
  if (hours > windowH) return [{ name: '开机时间', status: 'ok', detail: [`已运行 ${hours.toFixed(0)} 小时`] }];
  const keep = (config.launchd || []).filter(j => typeof j === 'object' && j.keepAlive).map(j => j.label);
  const down = keep.filter(label => parseLaunchctlPrint(run('launchctl', ['print', `gui/${uid}/${label}`]).stdout).state !== 'running');
  return [
    {
      name: '开机时间',
      status: 'warn',
      detail: [
        `${hours.toFixed(1)} 小时前重启过：会话里起的后台任务、等着到点再跑的脚本都已经没了（G-12）`,
        down.length ? `没在跑的常驻服务：${down.join('、')}` : '配置里的常驻服务都在跑',
        '本机预览网站、实验进程不在配置里的，要自己核一遍',
      ],
    },
  ];
}

function checkRepos({ config, run }) {
  return (config.repos || []).map(repo => {
    const name = `仓库 ${path.basename(repo)}`;
    const branch = config.mainBranch || 'main';
    const perm = s => /Operation not permitted|EPERM/i.test(s);
    if (config.fetch !== false) {
      const f = run('git', ['-C', repo, 'fetch', '--quiet', 'origin', branch], { timeout: 30000 });
      if (f.code !== 0)
        return { name, status: 'warn', detail: [perm(f.stderr) ? '没有权限读取这个目录（从 launchd 跑时见 G-05）' : `git fetch 失败：${f.stderr.trim().split('\n')[0]}`] };
    }
    const ahead = run('git', ['-C', repo, 'log', '--format=%h %s', `origin/${branch}..${branch}`]);
    if (ahead.code !== 0) return { name, status: 'warn', detail: [perm(ahead.stderr) ? '没有权限读取（G-05）' : `git log 失败：${ahead.stderr.trim().split('\n')[0]}`] };
    const commits = ahead.stdout.trim().split('\n').filter(Boolean);
    const dirty = run('git', ['-C', repo, 'status', '--porcelain']).stdout.trim().split('\n').filter(Boolean).length;
    const tail = dirty ? `；主目录有 ${dirty} 个没提交的改动` : '';
    if (commits.length)
      return { name, status: 'warn', detail: [`本地 ${branch} 比远端多 ${commits.length} 个提交，推之前按《工程流程》5.1 先列给常浩看${tail}`, ...commits.slice(0, 5)] };
    return { name, status: dirty ? 'info' : 'ok', detail: [`本地 ${branch} 没有未推的提交${tail}`] };
  });
}

// 自定义命令检查（Hermes 等）：okWhen 可写 exitCode、stdoutEmpty、stdoutNotMatch（正则）
function checkCommands({ config, run }) {
  return (config.commands || []).map(c => {
    const r = run(c.cmd[0], c.cmd.slice(1));
    const ok = c.okWhen || { exitCode: 0 };
    const why = [];
    if (r.code === null || (r.stderr && /ENOENT/.test(r.stderr))) return { name: c.name, status: 'warn', detail: [`跑不起来：${c.cmd.join(' ')}`] };
    if (ok.exitCode !== undefined && r.code !== ok.exitCode) why.push(`退出码 ${r.code}`);
    if (ok.stdoutEmpty && r.stdout.trim()) why.push(`有输出：${r.stdout.trim().split('\n').slice(0, 3).join(' / ')}`);
    if (ok.stdoutNotMatch && new RegExp(ok.stdoutNotMatch, 'm').test(r.stdout)) why.push(`输出里有「${ok.stdoutNotMatch}」：${r.stdout.trim().split('\n')[0]}`);
    return why.length ? { name: c.name, status: c.failStatus || 'warn', detail: [...why, ...(c.note ? [c.note] : [])] } : { name: c.name, status: 'ok', detail: ['正常'] };
  });
}

export function runDoctor(deps = {}) {
  const env = deps.env || process.env;
  const home = deps.home || os.homedir();
  const ctx = {
    env,
    home,
    run: deps.run || defaultRun,
    platform: deps.platform || process.platform,
    now: deps.now ?? Date.now(),
    uid: deps.uid ?? (process.getuid ? process.getuid() : 0),
    dir: deps.dir || stateDir(env, deps.platform || process.platform, home),
    statFn:
      deps.statFn ||
      (f => {
        try {
          return fs.statSync(f);
        } catch {
          return null;
        }
      }),
    config: deps.config || {},
  };
  return [
    ...checkHooks(ctx),
    checkInstructionSync(ctx),
    checkAutoMemory(ctx),
    checkLessonHits(ctx),
    ...checkLaunchd(ctx),
    ...checkLogs(ctx),
    ...checkReboot(ctx),
    ...checkRepos(ctx),
    ...checkCommands(ctx),
  ];
}

export function formatReport(results, startedAt) {
  const lines = [`开始 ${startedAt}`];
  for (const r of results) {
    lines.push(`${MARK[r.status]} ${r.name}`);
    for (const d of r.detail) lines.push(`    ${d}`);
  }
  const n = s => results.filter(r => r.status === s).length;
  lines.push(`合计：✓${n('ok')} ⚠${n('warn')} ✗${n('fail')}`);
  return lines;
}

function main(argv = process.argv.slice(2)) {
  const startedAt = new Date().toISOString();
  const dir = stateDir();
  const cfgIdx = argv.indexOf('--config');
  const cfgFile = cfgIdx >= 0 ? argv[cfgIdx + 1] : path.join(dir, 'doctor.json');
  let config = {};
  const cfgText = readText(cfgFile);
  if (cfgText) config = JSON.parse(cfgText);
  else if (cfgIdx >= 0) throw new Error(`读不到配置 ${cfgFile}`);
  const results = runDoctor({ config, dir });
  const code = results.some(r => r.status === 'fail') ? 1 : 0;
  if (argv.includes('--json')) console.log(JSON.stringify({ startedAt, config: cfgText ? cfgFile : null, results, exit: code }, null, 2));
  else console.log([...formatReport(results, startedAt), cfgText ? `配置：${cfgFile}` : `没有配置文件（${cfgFile}），只做了内置检查；样例见 tools/doctor.example.json`].join('\n'));
  if (!argv.includes('--no-save')) {
    const out = path.join(dir, 'doctor');
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, `doctor-${startedAt.replace(/[-:]/g, '').slice(0, 13)}.txt`);
    fs.writeFileSync(file, `${[...formatReport(results, startedAt), `exit ${code}`].join('\n')}\n`);
    const old = fs.readdirSync(out).filter(f => f.startsWith('doctor-')).sort().slice(0, -60);
    for (const f of old) fs.rmSync(path.join(out, f));
  }
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`体检中断：${err.message}`);
    process.exitCode = 2;
  }
}
