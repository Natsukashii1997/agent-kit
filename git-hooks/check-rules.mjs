// 通用规则检查（各仓库共用一份）：只查机器能判定的几条（AGENTS.md「规则」；全局坑 G-02、G-07、G-08；LESSONS「升级」行；大改动的改前改后对照）。
// 扫哪些目录、允许哪些依赖、关掉哪几条，写在被检查仓库的 scripts/hooks.json（写法见 config.mjs），不在这里改。
// 推送前由 pre-push.mjs 调用；CI 上要跑的仓库检出 agent-kit 的固定标签后跑：node <agent-kit>/git-hooks/check-rules.mjs <仓库根目录>
// 项目长出自己的硬规矩、且能机检的，先问是不是各仓库都适用：适用的照 RULES 的样子往下加，只一个仓库用的写进那个仓库自己的测试。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, isEntry, readConfig } from './config.mjs';

export const RULES = {
  listen: '本机服务只监听 127.0.0.1（AGENTS.md 规则）',
  deps: `依赖只许白名单里的；要加依赖，先改 ${CONFIG_FILE} 的 checkRules.allowedDeps，并在交接里说明理由（AGENTS.md 规则）`,
  time: '页面上的时间经统一的格式化函数按北京时间显示，不直接截取 ISO 字符串（全局坑 G-02）；截取的确实是北京时间字符串时，在行内注释写「北京时间」',
  origin: '开了本机服务的入口要校验来源（Host 是本机、Origin 同源）再处理写请求，只监听 127.0.0.1 挡不住浏览器里的任意网页（全局坑 G-07）；校验放在别的文件时，在 listen 那一行注释写「来源校验见 xxx」',
  optvar: '带 set -u 的脚本里，可选开关要写成 ${X:-}，裸引用在变量没设时会让整段退出（全局坑 G-08）',
  lessons: 'docs/LESSONS.md 每条坑都要有「- 升级：」一行，开头是〔结构〕〔机检〕〔体检〕〔文字〕〔提醒〕之一，后面写状态和去处，如「- 升级：〔提醒〕未升级。」「- 升级：〔机检〕已升级（2026-11-18，#12）：agent-kit git-hooks/check-rules.mjs 的 xx 规则」；层级怎么选见全局 LESSONS「怎么升级」',
  bigchange: '一次改动 100 个文件及以上（当前分支相对 origin/main，含未提交和未跟踪的），CURRENT.md 的交接里要新增一节「### 改前改后功能对照」：逐项写原有功能、改后还在不在、怎么核对的（docs/templates/handoff.md）',
};
// 截取 *At 字段当日期时间显示，或把 ISO 的 T 换成空格：多半把 UTC 当成了北京时间
const TIME = [/\b\w*(?:At|_at)\.slice\(\s*(?:0\s*,\s*1[06]|5\s*,\s*16|11\s*,\s*16)\s*\)/, /\.replace\(\s*["']T["']\s*,\s*["'] ["']\s*\)/];
const TIME_OK = /\/[/*]\s*北京时间/;
const LISTEN_OK = /\.listen\(\s*[\w.]+\s*,\s*['"]127\.0\.0\.1['"]/;
// 测试文件里临时起的服务（server.listen(0, '127.0.0.1')）不是入口，G-07 的 listen、origin 两条不查（常浩 2026-11-27 定）：
// 文件名带 .test. / .spec.，或在 test/、tests/、__tests__/ 目录下。时间显示等别的规则照查
const TEST_FILE = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
// 同一文件里有这些写法之一，就当做了来源校验（G-07）
const ORIGIN_OK = /headers\s*(?:\.\s*(?:origin|host)\b|\[\s*['"](?:origin|host)['"]\s*\])|getHeader\(\s*['"](?:origin|host)['"]|来源校验见/i;
// set -u / set -eu / set -euo pipefail 之类（G-08）
const SET_U = /^\s*set\s+-[a-z]*u[a-z]*\b/m;
// [ -n "$X" ]、[[ -z $X ]]：判断可选开关是否设置，却没写 ${X:-}
const OPTVAR = /\[\[?\s+-[nz]\s+"?\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))"?/g;
const NAME = /^[A-Za-z_]\w*$/;

// 脚本自己赋过值的变量（不是可选开关，G-08 不报；agent-autoloop 带回，#141 审查后收紧）：
// 命令开头的 X=…（含 if ! X=$(…)、then / do 之后）、local / export / readonly / declare / typeset 后的每个 X=…、for X in、read 读进的变量。
// 注释、echo 里的字符串、env X=1 cmd（只给子进程设）都不算。按引号外的 ; & | ( ) { } ! 切成一段段命令，去掉段首的
// if / then / do / while 等关键字再认。引号里的 && ; # 不切、不当注释（#141 审查 P2-01：echo "x && DEBUG=1" 不算赋值）
export function shellSegments(line) {
  const segs = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"') {
        cur += c + (line[i + 1] ?? '');
        i += 1;
      } else {
        if (c === quote) quote = '';
        cur += c;
      }
    } else if (c === '\\') {
      cur += c + (line[i + 1] ?? '');
      i += 1;
    } else if (c === "'" || c === '"') {
      quote = c;
      cur += c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
    else if (';&|(){}!'.includes(c)) {
      segs.push(cur);
      cur = '';
    } else cur += c;
  }
  segs.push(cur);
  return segs.map(t => t.trim().replace(/^(?:(?:if|then|elif|else|do|while|until)\s+)+/, '')).filter(Boolean);
}

export function assignedNames(src) {
  const names = new Set();
  for (const line of src.split('\n')) {
    for (const t of shellSegments(line)) {
      const decl = t.match(/^(?:local|export|readonly|declare|typeset)((?:\s+-\w+)*)\s+(.*)$/);
      if (decl) for (const m of decl[2].matchAll(/(?:^|\s)([A-Za-z_]\w*)=/g)) names.add(m[1]);
      const lead = t.match(/^([A-Za-z_]\w*)=/);
      if (lead) names.add(lead[1]);
      const loop = t.match(/^(?:for|select)\s+([A-Za-z_]\w*)\s+in\b/);
      if (loop) names.add(loop[1]);
      const read = t.match(/^(?:[A-Za-z_]\w*=\S*\s+)*read\b(.*)$/);
      if (!read) continue;
      const words = read[1].trim().split(/\s+/).filter(Boolean);
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w.startsWith('-')) {
          // 这几个选项后面跟一个参数；-a 的参数是数组名，也算赋值
          if (/^-[adinNptu]$/.test(w)) {
            i += 1;
            if (w === '-a' && NAME.test(words[i] || '')) names.add(words[i]);
          }
          continue;
        }
        if (!NAME.test(w)) break;
        names.add(w);
      }
    }
  }
  return names;
}
// LESSONS「升级」行开头的层级词，口径同全局 LESSONS「怎么升级」（hooks/lessons-remind.mjs 的 LEVELS）
const LEVELS = ['结构', '机检', '体检', '文字', '提醒'];
// 改动文件数到这个数就要写改前改后对照
const BIG_CHANGE = 100;
// 「### 改前改后功能对照」小节，或交接里的「- 改前改后功能对照：」一行
const COMPARE = /^(?:#{2,4} |- )改前改后功能对照/gm;

function files(dir, exts, skipDirs) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return skipDirs.includes(entry.name) ? [] : files(file, exts, skipDirs);
    return exts.includes(path.extname(entry.name)) ? [file] : [];
  });
}

// config 不传就读 <root>/scripts/hooks.json 的 checkRules；checkRules 为 false 时什么都不查
export function checkRules(root, config = readConfig(root, Object.keys(RULES)).checkRules) {
  if (!config) return [];
  const on = kind => !config.off.includes(kind);
  const found = [];
  const hit = (file, line, kind, text) => on(kind) && found.push({ file: path.relative(root, file), line, kind, rule: RULES[kind], text: text.trim() });
  for (const file of config.scan.flatMap(dir => files(path.join(root, dir), config.exts, config.skipDirs))) {
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split('\n');
    const isTest = TEST_FILE.test(path.relative(root, file).split(path.sep).join('/'));
    lines.forEach((text, i) => {
      if (TIME.some(r => r.test(text)) && !TIME_OK.test(text)) hit(file, i + 1, 'time', text);
      if (!isTest && text.includes('.listen(') && !LISTEN_OK.test(text)) hit(file, i + 1, 'listen', text);
    });
    const at = lines.findIndex(text => text.includes('.listen('));
    if (!isTest && at >= 0 && !ORIGIN_OK.test(src)) hit(file, at + 1, 'origin', lines[at]);
  }
  for (const file of config.scanSh.flatMap(dir => files(path.join(root, dir), ['.sh'], config.skipDirs))) {
    const src = fs.readFileSync(file, 'utf8');
    if (!SET_U.test(src)) continue;
    const assigned = assignedNames(src);
    src.split('\n').forEach((text, i) => {
      if (text.trimStart().startsWith('#')) return;
      // 同一行有几个判断时逐个查，同一行只报一次
      if ([...text.matchAll(OPTVAR)].some(m => !assigned.has(m[1] ?? m[2]))) hit(file, i + 1, 'optvar', text);
    });
  }
  const pkgFile = path.join(root, 'package.json');
  if (fs.existsSync(pkgFile)) {
    const text = fs.readFileSync(pkgFile, 'utf8'), pkg = JSON.parse(text), lines = text.split('\n');
    const at = key => lines.findIndex(line => line.includes(`"${key}":`)) + 1;
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(n => !config.allowedDeps.includes(n))) hit(pkgFile, at(name), 'deps', name);
  }
  if (on('lessons')) checkLessons(root, hit);
  if (on('bigchange')) checkBigChange(root, hit);
  return found;
}

// LESSONS 每条 L-xx 都要有以层级词开头的「升级」行；代码块里的格式样例和标题带 <占位> 的不算条目。
// 反引号里的尖括号是真实内容不是占位（如剪藏插件 L-02 标题里的 `<all_urls>`），先去掉再判断
function checkLessons(root, hit) {
  const file = path.join(root, 'docs', 'LESSONS.md');
  if (!fs.existsSync(file)) return;
  let fence = false, cur = null;
  const close = () => { if (cur && !cur.up) hit(file, cur.line, 'lessons', `${cur.id} 缺「- 升级：」一行`); cur = null; };
  fs.readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
    if (/^\s*```/.test(text)) { fence = !fence; return; }
    if (fence) return;
    const head = text.match(/^## (L-\d+) (.*)$/);
    if (head || text.startsWith('## ')) {
      close();
      if (head && !/<[^>]+>/.test(head[2].replace(/`[^`]*`/g, ''))) cur = { id: head[1], line: i + 1, up: false };
      return;
    }
    const up = cur && text.match(/^- 升级：(.*)$/);
    if (!up) return;
    cur.up = true;
    if (!LEVELS.some(level => up[1].startsWith(`〔${level}〕`))) hit(file, i + 1, 'lessons', `${cur.id} 的「升级」没以层级词开头：${text}`);
  });
  close();
}

// 当前分支相对 origin/main 改了很多文件时，CURRENT.md 要比 origin/main 上多一节改前改后对照。
// 只看项目目录（项目在仓库子目录里时只数子目录）；不在 git 仓库、没有 origin/main 或还没有提交时跳过
function checkBigChange(root, hit) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let base;
  try { base = git('merge-base', 'origin/main', 'HEAD').trim(); } catch { return; }
  const changed = new Set([...git('diff', '--name-only', '--relative', base).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean));
  if (changed.size < BIG_CHANGE) return;
  const count = text => (text.match(COMPARE) ?? []).length;
  let before = '';
  try { before = git('show', `${base}:./CURRENT.md`); } catch { /* origin/main 上还没有 CURRENT.md */ }
  const file = path.join(root, 'CURRENT.md');
  if (count(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '') > count(before)) return;
  hit(file, 1, 'bigchange', `本分支相对 origin/main 改了 ${changed.size} 个文件（阈值 ${BIG_CHANGE}），CURRENT.md 没有新增「改前改后功能对照」一节`);
}

// 打印结果，返回退出码。root 是被检查的仓库根目录
export function report(root, log = console) {
  const config = readConfig(root, Object.keys(RULES)).checkRules;
  if (!config) {
    log.log(`本仓库在 ${CONFIG_FILE} 里关掉了规则检查`);
    return 0;
  }
  const found = checkRules(root, config);
  for (const v of found) log.error(`${v.file}:${v.line}  ${v.text}\n  ↳ ${v.rule}`);
  if (found.length) {
    log.error(`通用规则检查未通过：${found.length} 处`);
    return 1;
  }
  log.log('通用规则检查通过');
  return 0;
}

if (isEntry(import.meta.url)) {
  try {
    process.exitCode = report(path.resolve(process.argv[2] || '.'));
  } catch (err) {
    console.error(`规则检查跑不起来：${err.message}`);
    process.exitCode = 1;
  }
}
