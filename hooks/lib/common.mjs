// agent-kit 的 hook 和工具共用的小函数：状态目录、读标准输入、粗分 shell 命令。
// 不依赖任何第三方包，Claude Code 和 Codex 的 hook 都用同一份。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

// 按 shell 的命令分隔符（&& || ; | & 换行）粗分成几段。引号里的分隔符会被误切，
// 对「找出 git push 这类命令」够用；拿不准的情况交给权限规则兜底。
export function splitCommands(command) {
  return String(command || '')
    .split(/&&|\|\||;|\||&|\n/)
    .map(s => s.trim())
    .filter(Boolean);
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
    if (t[0] === 'timeout' || t[0] === 'nice') {
      t.shift();
      while (t.length && /^-|^\d/.test(t[0])) t.shift();
      continue;
    }
    return t;
  }
}
