// agent-kit 的 hook 和工具共用的小函数：状态目录、读标准输入、拆 heredoc、按分隔符切 shell 命令、分词。
// 不依赖任何第三方包，Claude Code 和 Codex 的 hook 都用同一份。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 这个文件是不是被 node 直接运行的入口。两边都取真实路径再比：经符号链接启动时（macOS 的 /var → /private/var），
// 只比字面路径会认不出自己，hook 就什么都不做、等于放行。
export function isEntry(metaUrl) {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

// 持久状态目录（不放 /tmp，见全局坑 G-01）。测试和特殊情况用 AGENT_KIT_STATE_DIR 覆盖。
export function stateDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.AGENT_KIT_STATE_DIR) return env.AGENT_KIT_STATE_DIR;
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'agent-kit');
  return path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'agent-kit');
}

export function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// heredoc 的开头：<<EOF、<<-EOF、<<'EOF'、<<"EOF"；<<< 是 here-string，不算
const HEREDOC = /(?<!<)<<-?(?!<)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;

// 拆出 heredoc：text 是去掉正文（含收尾行）后的命令，bodies 是每段正文和它的开头那一行。
// 正文是给 cat、python 的输入，不是命令；喂给 shell 的（cat <<EOF | bash、bash <<EOF）由调用方自己再判断。
export function splitHeredocs(command) {
  const out = [];
  const bodies = [];
  let pending = [];
  let cur = null;
  for (const line of String(command || '').split('\n')) {
    if (pending.length) {
      if (line.replace(/^\t+/, '') === pending[0].end) {
        bodies.push({ opener: pending[0].opener, body: cur.join('\n') });
        pending.shift();
        cur = [];
      } else cur.push(line);
      continue;
    }
    out.push(line);
    for (const m of line.matchAll(HEREDOC)) pending.push({ end: m[2], opener: line });
    cur = [];
  }
  if (pending.length) bodies.push({ opener: pending[0].opener, body: cur.join('\n') });
  return { text: out.join('\n'), bodies };
}

export const stripHeredocBodies = command => splitHeredocs(command).text;

// 按 shell 分隔符（; 换行 | & && || 括号）切成几段命令。引号里的分隔符不切，
// $( … )、${ … }、` … ` 整段算在当前这个词里，不在里面切；否则提交说明、python -c "a; b" 里的内容会被当成命令。
export function segments(command) {
  command = String(command || '');
  const segs = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"') cur += command[++i] ?? '';
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\') {
      cur += ch + (command[++i] ?? '');
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if ((ch === '$' && (command[i + 1] === '(' || command[i + 1] === '{')) || ch === '`') {
      const end = closeOf(command, ch === '`' ? i : i + 1);
      cur += command.slice(i, end + 1);
      i = end;
      continue;
    }
    // 2>&1、&> 这类重定向里的 & 不是分隔符
    if (ch === '&' && (command[i - 1] === '>' || command[i + 1] === '>')) {
      cur += ch;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '|' || ch === '&' || ch === '(' || ch === ')' || ch === '{' || ch === '}') {
      segs.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  segs.push(cur);
  return segs.map(s => s.trim()).filter(Boolean);
}

// 从 open（指向 ( { 或 `）找到配对的收尾位置；找不到就到末尾。
export function closeOf(s, open) {
  const o = s[open];
  if (o === '`') {
    const j = s.indexOf('`', open + 1);
    return j === -1 ? s.length - 1 : j;
  }
  const c = o === '(' ? ')' : '}';
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (s[j] === o) depth++;
    else if (s[j] === c && --depth === 0) return j;
  }
  return s.length - 1;
}

// 粗略的 shell 分词：认单引号、双引号，不展开变量。
export function tokenize(segment) {
  const tokens = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has || cur) tokens.push(cur);
      cur = '';
      has = false;
      continue;
    }
    cur += ch;
    has = true;
  }
  if (has || cur) tokens.push(cur);
  return tokens;
}

// 去掉开头的环境变量赋值（FOO=bar）和常见包装命令（timeout 30、nohup、command、sudo 等）。
export function stripWrappers(tokens) {
  const t = [...tokens];
  for (;;) {
    if (!t.length) return t;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) {
      t.shift();
      continue;
    }
    if (['nohup', 'command', 'builtin', 'noglob', 'time', 'sudo', 'exec'].includes(t[0])) {
      t.shift();
      continue;
    }
    if (t[0] === 'env') {
      t.shift();
      while (t.length && (/^-/.test(t[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0]))) {
        const opt = t.shift();
        if (opt === '-u' || opt === '--unset' || opt === '-C' || opt === '--chdir') t.shift();
      }
      continue;
    }
    if (t[0] === 'timeout' || t[0] === 'nice') {
      t.shift();
      while (t.length && /^-|^\d/.test(t[0])) t.shift();
      continue;
    }
    return t;
  }
}
