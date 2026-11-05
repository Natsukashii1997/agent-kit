#!/usr/bin/env node
// 第 1 件：不可逆操作的硬闸（命令执行前的 hook，Claude Code 与 Codex 共用）。
// 强推或删除 main / master 时直接拒绝（《工程流程》第 3 节「不 force push main」）；
// 当前在 main/master 上、没写分支名（或写 HEAD）的 git push，在 Claude 里改成先问（Codex 的 hook 不支持先问）。
// Claude 那边第一层是 config/claude-permissions.json 的 deny 规则（不会出错放行）；这个 hook 兜住规则认不出的写法
// （git -C、参数顺序打乱、组合短参数等），Codex 没有 deny 规则，只靠它。
// 要「先问我」的操作（合并 PR、推 main、强推分支、reset --hard 等）交给权限规则：
// Claude 用 config/claude-permissions.json 的 ask，Codex 用 config/codex/agent-kit.rules。
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

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const RANK = { ask: 1, deny: 2 };
const worse = (a, b) => (!a ? b : !b ? a : RANK[b.decision] > RANK[a.decision] ? b : a);

// 返回 { decision: 'deny' | 'ask', reason } 或 null（不管）。
// deny：强推或删除 main/master。ask：没写分支名（或写 HEAD）的推送、而当前分支是 main/master——权限规则认不出这种写法。
// currentBranch(dir) 用来判断没写分支名、或写 HEAD 时推的是哪个分支。
export function decide(command, { cwd, currentBranch = defaultCurrentBranch, depth = 0 } = {}) {
  let result = null;
  for (const segment of splitCommands(command)) {
    const tokens = stripWrappers(tokenize(segment));
    // bash -c "…"、sh -c "…"：拆出里面那条命令再判断
    if (tokens.length && SHELLS.has(path.basename(tokens[0])) && depth < 3) {
      const i = tokens.findIndex((t, k) => k > 0 && /^-[a-z]*c[a-z]*$/.test(t));
      if (i > 0 && tokens[i + 1] !== undefined) result = worse(result, decide(tokens[i + 1], { cwd, currentBranch, depth: depth + 1 }));
      continue;
    }
    const git = gitArgs(tokens);
    if (!git || git.sub !== 'push') continue;
    const where = git.dir ? path.resolve(cwd || '.', git.dir) : cwd;
    let here;
    const branchHere = () => (here === undefined ? (here = currentBranch(where)) : here);
    const { force, del, all, refspecs } = parsePush(git.args);
    for (const spec of refspecs) {
      const plus = spec.startsWith('+');
      const body = plus ? spec.slice(1) : spec;
      let dst = body.includes(':') ? body.slice(body.indexOf(':') + 1) : body;
      const viaHead = dst === 'HEAD';
      if (viaHead) dst = branchHere() || 'HEAD';
      const deleting = body.startsWith(':') || del;
      if (!isProtected(dst)) continue;
      if (force || plus)
        return { decision: 'deny', reason: `已拦下：强推到 ${dst}。《工程流程》第 3 节规定不 force push main/master；要改 main 请走 PR。确有必要请常浩本人在终端里操作。` };
      if (deleting)
        return { decision: 'deny', reason: `已拦下：删除远端 ${dst} 分支。这是不可逆操作，请常浩本人在终端里操作。` };
      if (viaHead)
        result = worse(result, { decision: 'ask', reason: `当前在 ${dst} 分支上，这条命令会推 ${dst}。按《工程流程》第 5 节，推 main 之前要先查别的会话没推的提交和私人内容，由常浩确认。` });
    }
    if (force && all)
      return { decision: 'deny', reason: '已拦下：带强推的 --all / --mirror 会一起强推 main/master。请只推当前分支。' };
    if (refspecs.length === 0) {
      const branch = branchHere();
      if (branch && isProtected(branch)) {
        if (force) return { decision: 'deny', reason: `已拦下：当前在 ${branch} 分支上强推。《工程流程》第 3 节规定不 force push main/master。` };
        result = worse(result, { decision: 'ask', reason: `当前在 ${branch} 分支上，没写分支名的 git push 会推 ${branch}。按《工程流程》第 5 节，推 main 之前要先查别的会话没推的提交和私人内容，由常浩确认。` });
      }
    }
  }
  return result;
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

// agent 为 codex 时不输出 ask：Codex 的 PreToolUse 不支持 ask（源码 hooks/src/engine/output_parser.rs 会判为无效输出），
// 那一侧的「先问」交给 config/codex/agent-kit.rules。
export function hookOutput(result, agent = 'claude') {
  if (!result || (result.decision === 'ask' && agent === 'codex')) return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.decision,
      permissionDecisionReason: result.reason,
    },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = parseJson(readStdin()) || {};
    const command = input.tool_input?.command;
    if (typeof command === 'string') {
      const agent = process.argv.includes('--agent=codex') ? 'codex' : 'claude';
      const out = hookOutput(decide(command, { cwd: input.cwd }), agent);
      if (out) process.stdout.write(out);
    }
  } catch (err) {
    process.stderr.write(`agent-kit guard-git 出错，本次未拦截：${err.message}\n`);
    process.exitCode = 1;
  }
}
