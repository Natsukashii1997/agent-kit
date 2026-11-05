#!/usr/bin/env node
// 第 1 件：不可逆操作的硬闸（命令执行前的 hook，Claude Code 与 Codex 共用）。
// 只做一件事：强推或删除 main / master 时直接拒绝（《工程流程》第 3 节「不 force push main」）。
// 其余要「先问我」的操作（合并 PR、推 main、强推分支、reset --hard 等）交给权限规则：
// Claude 用 config/claude-permissions.json，Codex 用 config/codex/agent-kit.rules。
// 出错时不拦（退出码 1，hook 默认放行），只往 stderr 写原因；`node tools/doctor.mjs` 会自检这个 hook。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJson, readStdin, splitCommands, stripWrappers, tokenize } from './lib/common.mjs';

const PROTECTED = new Set(['main', 'master']);
const isProtected = ref => PROTECTED.has(String(ref).replace(/^refs\/heads\//, ''));

// git 的全局选项：跳过它们才能找到子命令（git -C <目录> push …）
const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);

function gitArgs(tokens) {
  if (!tokens.length || path.basename(tokens[0]) !== 'git') return null;
  let i = 1;
  let dir = null;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    const tok = tokens[i];
    if (tok === '-C') dir = tokens[i + 1];
    if (GIT_OPTS_WITH_VALUE.has(tok)) i += 2;
    else i += 1;
  }
  return { sub: tokens[i], args: tokens.slice(i + 1), dir };
}

function parsePush(args) {
  let force = false;
  let del = false;
  let all = false;
  const positional = [];
  for (const a of args) {
    if (a === '--') continue;
    if (a.startsWith('--')) {
      if (a === '--force' || a.startsWith('--force-with-lease') || a === '--force-if-includes') force = true;
      else if (a === '--delete') del = true;
      else if (a === '--all' || a === '--mirror' || a === '--branches') all = true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (a.slice(1).includes('f')) force = true;
      if (a.slice(1).includes('d')) del = true;
      continue;
    }
    positional.push(a);
  }
  const refspecs = positional.slice(1); // 第一个位置参数是远端名
  return { force, del, all, refspecs };
}

// 返回 { decision: 'deny', reason } 或 null（不管）。currentBranch(dir) 用来判断没写分支名的强推推的是哪个分支。
export function decide(command, { cwd, currentBranch = defaultCurrentBranch } = {}) {
  for (const segment of splitCommands(command)) {
    const git = gitArgs(stripWrappers(tokenize(segment)));
    if (!git || git.sub !== 'push') continue;
    const { force, del, all, refspecs } = parsePush(git.args);
    for (const spec of refspecs) {
      const plus = spec.startsWith('+');
      const body = plus ? spec.slice(1) : spec;
      const dst = body.includes(':') ? body.slice(body.indexOf(':') + 1) : body;
      const deleting = body.startsWith(':') || del;
      if (!isProtected(dst)) continue;
      if (force || plus)
        return { decision: 'deny', reason: `已拦下：强推到 ${dst}。《工程流程》第 3 节规定不 force push main/master；要改 main 请走 PR。确有必要请常浩本人在终端里操作。` };
      if (deleting)
        return { decision: 'deny', reason: `已拦下：删除远端 ${dst} 分支。这是不可逆操作，请常浩本人在终端里操作。` };
    }
    if (force && all)
      return { decision: 'deny', reason: '已拦下：带强推的 --all / --mirror 会一起强推 main/master。请只推当前分支。' };
    if (force && refspecs.length === 0) {
      const branch = currentBranch(git.dir ? path.resolve(cwd || '.', git.dir) : cwd);
      if (branch && isProtected(branch))
        return { decision: 'deny', reason: `已拦下：当前在 ${branch} 分支上强推。《工程流程》第 3 节规定不 force push main/master。` };
    }
  }
  return null;
}

function defaultCurrentBranch(dir) {
  try {
    return execFileSync('git', ['-C', dir || '.', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
  } catch {
    return null;
  }
}

export function hookOutput(result) {
  if (!result) return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: result.reason,
    },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = parseJson(readStdin()) || {};
    const command = input.tool_input?.command;
    if (typeof command === 'string') {
      const out = hookOutput(decide(command, { cwd: input.cwd }));
      if (out) process.stdout.write(out);
    }
  } catch (err) {
    process.stderr.write(`agent-kit guard-git 出错，本次未拦截：${err.message}\n`);
    process.exitCode = 1;
  }
}
