// 各仓库的钩子差异只写在 scripts/hooks.json，共用实现（pre-push.mjs、check-rules.mjs）从这里读。
// 写法（全部可省，省了就用下面的默认值）：
// {
//   "说明": "给人看的备注，字符串或字符串数组，程序不读",
//   "hooks": ["commit-msg"],                    本仓库装哪些入口，默认两个都装；有意只装一个的写在这里，doctor 按它查缺没缺（#141 审查）
//   "prePushTests": "npm test",                 推送前跑的测试命令，交给 sh -c；全量超过 3 分钟的只放快的部分
//   "checkRules": false,                        不跑规则检查；或写成下面的对象，只写和默认值不同的项
//   "checkRules": {
//     "scan": ["src", "server"],                扫 G-02、G-07 的源码目录，不存在的跳过
//     "scanSh": ["scripts", "bin"],             扫 G-08 的 shell 脚本目录
//     "exts": [".js", ".ts"],                   源码扩展名
//     "skipDirs": ["node_modules"],             目录名等于这些的整个跳过
//     "allowedDeps": ["@playwright/test"],      package.json 依赖白名单，要加依赖先改这里并在交接里说明理由
//     "off": ["listen", "origin"]               关掉的规则（名字见 check-rules.mjs 的 RULES），在「说明」里写为什么
//   }
// }
// 拼错的键直接报错：写错一个字母就悄悄用默认值，比报错更难查。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 是不是被直接运行（node xxx.mjs）。比真实路径：临时目录在 macOS 上经过软链接（/var → /private/var）
export function isEntry(metaUrl) {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

export const CONFIG_FILE = path.join('scripts', 'hooks.json');

export const HOOK_NAMES = ['pre-push', 'commit-msg'];

export const DEFAULTS = {
  hooks: HOOK_NAMES,
  prePushTests: 'node --test tests/*.test.mjs',
  checkRules: {
    scan: ['src', 'server'],
    scanSh: ['scripts', 'bin'],
    exts: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'],
    skipDirs: ['node_modules'],
    allowedDeps: [],
    off: [],
  },
};

const NOTE = '说明';
const isNote = v => typeof v === 'string' || (Array.isArray(v) && v.every(x => typeof x === 'string'));
const isList = v => Array.isArray(v) && v.every(x => typeof x === 'string');

// 读 <root>/scripts/hooks.json，和默认值合并。没有这个文件就全用默认值；写错了抛出带文件名的错误。
// ruleNames：check-rules 的规则名，用来查 off 里有没有写错的
export function readConfig(root, ruleNames = []) {
  const file = path.join(root, CONFIG_FILE);
  let raw = {};
  if (fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`${CONFIG_FILE} 不是合法 JSON：${err.message}`);
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${CONFIG_FILE} 要是一个 JSON 对象`);
  const bad = msg => new Error(`${CONFIG_FILE}：${msg}`);
  for (const [key, value] of Object.entries(raw)) {
    if (key === NOTE) {
      if (!isNote(value)) throw bad('「说明」要是字符串或字符串数组');
    } else if (key === 'hooks') {
      if (!isList(value) || !value.length || value.some(h => !HOOK_NAMES.includes(h))) throw bad(`hooks 要是非空数组，只能写 ${HOOK_NAMES.join('、')}`);
    } else if (key === 'prePushTests') {
      if (typeof value !== 'string' || !value.trim()) throw bad('prePushTests 要是非空字符串（交给 sh -c 跑的命令）');
    } else if (key === 'checkRules') {
      if (value !== false && (!value || typeof value !== 'object' || Array.isArray(value))) throw bad('checkRules 要是 false 或对象');
    } else throw bad(`不认识的键「${key}」，能写的只有 说明、hooks、prePushTests、checkRules`);
  }
  let checkRules = false;
  if (raw.checkRules !== false) {
    checkRules = { ...DEFAULTS.checkRules };
    for (const [key, value] of Object.entries(raw.checkRules || {})) {
      if (key === NOTE) continue;
      if (!(key in DEFAULTS.checkRules)) throw bad(`checkRules 里不认识的键「${key}」，能写的只有 ${Object.keys(DEFAULTS.checkRules).join('、')}`);
      if (!isList(value)) throw bad(`checkRules.${key} 要是字符串数组`);
      // 写了扫描目录却一个都不在（多是拼错，如 srcs）：规则检查等于没查还报通过，直接报错。写空数组是有意不扫，照常（#141 审查 P2-04）
      if ((key === 'scan' || key === 'scanSh') && value.length && !value.some(d => fs.existsSync(path.join(root, d))))
        throw bad(`checkRules.${key} 写的 ${value.join('、')} 一个都不存在，规则检查等于没查：改成实际的目录，有意不扫写 []`);
      if (key === 'exts' && value.some(e => !/^\.\w+$/.test(e))) throw bad(`checkRules.exts 每项要是「.js」这样以点开头的扩展名，现在是 ${value.join('、')}`);
      checkRules[key] = value;
    }
    const unknown = checkRules.off.filter(name => ruleNames.length && !ruleNames.includes(name));
    if (unknown.length) throw bad(`checkRules.off 里有不认识的规则 ${unknown.join('、')}，能关的只有 ${ruleNames.join('、')}`);
  }
  return { hooks: raw.hooks ?? DEFAULTS.hooks, prePushTests: raw.prePushTests ?? DEFAULTS.prePushTests, checkRules };
}
