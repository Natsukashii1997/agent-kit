#!/usr/bin/env node
// 第 1 件：不可逆操作的硬闸（命令执行前的 hook，Claude Code 与 Codex 共用）。
// 强推或删除 main / master 时直接拒绝（《工程流程》第 3 节「不 force push main」）；
// Claude 那边第一层是 config/claude-permissions.json 的 deny 规则（不会出错放行）；这个 hook 兜住规则认不出的写法
// （git -C、参数顺序打乱、组合短参数等），Codex 没有 deny 规则，只靠它。
// 这个 hook 只拒绝、不先问：Claude 侧按常浩 2026-11-07 的决定（#27）不再对 git 操作先问；
// Codex 侧的「先问」在 config/codex/agent-kit.rules。
// 推送前检查（#76）：推的不是 main/master 的 `git push`、`gh pr create`，如果要推的分支带着本地 main 上
// 还没推到 origin/main 的提交，就拒绝（2026-10-27 digital-twin 从本地 main 拉 PR 分支，把别的会话没推的提交一起推上了 GitHub）。
// 只看本机已有的引用、不 fetch；没有 origin/main、分离头指针、不在仓库里、git 出错都不拦。
// 出错时不拦（退出码 1，hook 默认放行），只往 stderr 写原因；`node tools/doctor.mjs` 会自检这个 hook。
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { isEntry, parseJson, readStdin, splitCommands, stripWrappers, tokenize } from './lib/common.mjs';

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
  let tags = false;
  const positional = [];
  for (const a of args) {
    if (a === '--') continue;
    if (a.startsWith('--')) {
      if (a === '--force' || a.startsWith('--force-with-lease') || a === '--force-if-includes') force = true;
      else if (a === '--delete') del = true;
      else if (a === '--all' || a === '--mirror' || a === '--branches') all = true;
      else if (a === '--tags') tags = true;
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
  return { force, del, all, tags, refspecs };
}

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);

// gh pr create 开的是哪个分支：--head / -H 写了就用它（owner:branch 取冒号后面），没写就是当前分支
function prHead(tokens) {
  for (let i = 3; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--head' || t === '-H') return tokens[i + 1] ?? null;
    if (t.startsWith('--head=')) return t.slice('--head='.length);
  }
  return undefined;
}
const branchOf = ref => String(ref).replace(/^refs\/heads\//, '').replace(/^[^:]*:/, '');

// 「cd 目录 && git push」：后面几段在 cd 进去的目录里判断（Claude 常这样写，会话目录未必是要推的仓库）
function cdTarget(tokens, cwd) {
  if (tokens[0] !== 'cd') return undefined;
  const arg = tokens.slice(1).find(t => !t.startsWith('-') || t === '-');
  if (arg === '-') return cwd; // 回上一个目录：不知道是哪，照旧
  if (!arg || arg === '~') return os.homedir();
  return path.resolve(cwd || '.', arg.startsWith('~/') ? path.join(os.homedir(), arg.slice(2)) : arg);
}

function leakReason(verb, src, leak) {
  const list = leak.commits.slice(0, 5).map(c => `  ${c.short} ${c.subject}`);
  if (leak.commits.length > 5) list.push(`  ……另有 ${leak.commits.length - 5} 个`);
  return [
    `已拦下：${verb} ${src} 带着本地 ${leak.base} 上 ${leak.commits.length} 个还没推到 origin/${leak.base} 的提交（本地 ${leak.base} 一共领先 ${leak.unpushed} 个）：`,
    ...list,
    `推上去会把这些提交一起公开；它们多半是别的会话提交了没推的（2026-10-27 就这样把受限内容推上了 GitHub）。《工程流程》第 1 节：分支从 origin/main 拉，不从本地 main 拉。正确做法二选一：`,
    `① 从 origin/${leak.base} 重新拉分支：git fetch origin && git switch -c <新分支> origin/${leak.base}，再把自己的提交 cherry-pick 过去；`,
    `② 先确认这些提交可以公开：把上面的标题列给常浩，他回“推”后先推 ${leak.base}（《工程流程》第 5 节第 1 步），再推这个分支。`,
  ].join('\n');
}

// 返回 { decision: 'deny', reason } 或 null（不管）。deny：强推或删除 main/master；推送会带出本地 main 没推的提交（#76）。
// currentBranch(dir) 用来判断没写分支名、或写 HEAD 时推的是哪个分支；leakedCommits(dir, src) 查 src 带着本地 main 的哪些没推的提交。
export function decide(command, { cwd, currentBranch = defaultCurrentBranch, leakedCommits = defaultLeakedCommits, depth = 0 } = {}) {
  let dirNow = cwd;
  for (const segment of splitCommands(command)) {
    const tokens = stripWrappers(tokenize(segment));
    const cdTo = cdTarget(tokens, dirNow);
    if (cdTo !== undefined) {
      dirNow = cdTo;
      continue;
    }
    // bash -c "…"、sh -c "…"：拆出里面那条命令再判断
    if (tokens.length && SHELLS.has(path.basename(tokens[0])) && depth < 3) {
      const i = tokens.findIndex((t, k) => k > 0 && /^-[a-z]*c[a-z]*$/.test(t));
      const inner = i > 0 && tokens[i + 1] !== undefined ? decide(tokens[i + 1], { cwd: dirNow, currentBranch, leakedCommits, depth: depth + 1 }) : null;
      if (inner) return inner;
      continue;
    }
    // gh pr create：开 PR 的分支带着本地 main 没推的提交就拒绝（gh 会顺手把分支推上去）
    if (tokens.length >= 3 && path.basename(tokens[0]) === 'gh' && tokens[1] === 'pr' && tokens[2] === 'create') {
      const head = prHead(tokens);
      const src = head ? branchOf(head) : currentBranch(dirNow);
      if (!src || src === 'HEAD' || isProtected(src)) continue;
      const leak = leakedCommits(dirNow, src);
      if (leak?.commits.length) return { decision: 'deny', reason: leakReason('要开 PR 的', src, leak) };
      continue;
    }
    const git = gitArgs(tokens);
    if (!git || git.sub !== 'push') continue;
    const where = git.dir ? path.resolve(dirNow || '.', git.dir) : dirNow;
    let here;
    const branchHere = () => (here === undefined ? (here = currentBranch(where)) : here);
    const { force, del, all, tags, refspecs } = parsePush(git.args);
    const sources = []; // 推到非 main/master 的来源，下面查有没有带出本地 main 没推的提交
    for (const spec of refspecs) {
      const plus = spec.startsWith('+');
      const body = plus ? spec.slice(1) : spec;
      let dst = body.includes(':') ? body.slice(body.indexOf(':') + 1) : body;
      const viaHead = dst === 'HEAD';
      if (viaHead) dst = branchHere() || 'HEAD';
      const deleting = body.startsWith(':') || del;
      if (!isProtected(dst)) {
        if (!deleting) sources.push(body.includes(':') ? body.slice(0, body.indexOf(':')) : body);
        continue;
      }
      if (force || plus)
        return { decision: 'deny', reason: `已拦下：强推到 ${dst}。《工程流程》第 3 节规定不 force push main/master；要改 main 请走 PR。确有必要请常浩本人在终端里操作。` };
      if (deleting)
        return { decision: 'deny', reason: `已拦下：删除远端 ${dst} 分支。这是不可逆操作，请常浩本人在终端里操作。` };
    }
    if (force && all)
      return { decision: 'deny', reason: '已拦下：带强推的 --all / --mirror 会一起强推 main/master。请只推当前分支。' };
    if (refspecs.length === 0) {
      const branch = branchHere();
      if (branch && isProtected(branch) && force)
        return { decision: 'deny', reason: `已拦下：当前在 ${branch} 分支上强推。《工程流程》第 3 节规定不 force push main/master。` };
      if (branch && branch !== 'HEAD' && !isProtected(branch) && !all && !tags && !del) sources.push(branch);
    }
    // --all / --mirror 会连 main 一起推，那是「推 main」，不归这一条；分离头指针（HEAD 指不到分支）不拦
    for (const src of all ? [] : sources) {
      if (!src || (src === 'HEAD' && branchHere() === 'HEAD')) continue;
      const leak = leakedCommits(where, src);
      if (leak?.commits.length) return { decision: 'deny', reason: leakReason('要推的', src, leak) };
    }
  }
  return null;
}

function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir || '.', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
  } catch {
    return null;
  }
}

function defaultCurrentBranch(dir) {
  return git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim() ?? null;
}

// 本地 main（没有 main 时看 master）比 origin 多的提交里，src 带着的那些。
// 返回 { base, unpushed, commits: [{ short, subject }] }；没有这个分支或 origin 上没有对应分支、git 出错，返回 null（不拦）。
export function defaultLeakedCommits(dir, src) {
  for (const base of ['main', 'master']) {
    if (git(dir, ['rev-parse', '--verify', '-q', `refs/heads/${base}`]) === null) continue;
    if (git(dir, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${base}`]) === null) return null;
    const ahead = git(dir, ['log', '--format=%H%x09%h%x09%s', `refs/remotes/origin/${base}..refs/heads/${base}`]);
    if (ahead === null) return null;
    const unpushed = ahead.split('\n').filter(Boolean).map(l => {
      const [hash, short, ...rest] = l.split('\t');
      return { hash, short, subject: rest.join('\t') };
    });
    if (!unpushed.length) return { base, unpushed: 0, commits: [] };
    const inSrc = git(dir, ['rev-list', `refs/remotes/origin/${base}..${src}`, '--']);
    if (inSrc === null) return null;
    const set = new Set(inSrc.split('\n').filter(Boolean));
    return { base, unpushed: unpushed.length, commits: unpushed.filter(c => set.has(c.hash)).map(({ short, subject }) => ({ short, subject })) };
  }
  return null;
}

// Claude 和 Codex 输出同一种 deny（hook 只拒绝，不输出 ask；Codex 的 PreToolUse 本来也不支持 ask）。
export function hookOutput(result) {
  if (!result) return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.decision,
      permissionDecisionReason: result.reason,
    },
  });
}

if (isEntry(import.meta.url)) {
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
