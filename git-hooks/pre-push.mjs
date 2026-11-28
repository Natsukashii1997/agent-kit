// 推送前的必经检查（各仓库共用一份）：规则检查 + 测试，不过就不推（复盘 P6，常浩 2026-11-20 批；只留一份见 agent-kit#133）。
// 各仓库的 scripts/hooks/pre-push 只是转发；跑哪些测试、扫哪些目录写在那个仓库的 scripts/hooks.json（写法见 config.mjs）。
// 全量测试超过 3 分钟的仓库，prePushTests 只放快的部分；全量照《工程流程》第 5 节，合并前在干净 worktree 跑。
// 不用 --no-verify 绕过（agent-kit 的 guard-git 会拦）；检查本身有问题就在 agent-kit 修这一份。
import { execFileSync, spawnSync } from 'node:child_process';
import { CONFIG_FILE, isEntry, readConfig } from './config.mjs';
import { RULES, checkRules } from './check-rules.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// git 跑钩子时改过的环境，在跑检查和测试前还原成和终端里一样：
// - 从 worktree 推送时，git 把这个仓库的位置（GIT_DIR 等）带进钩子。不清掉的话，测试在临时目录里做的 git 操作
//   （建仓库、提交、推送）会落到这个仓库上：分支多出测试的提交，主目录被改成裸仓库（G-46）。
// - git 还把自己的 libexec/git-core 放在 PATH 最前面并设 GIT_EXEC_PATH。测试里 `command -v git` 会找到那里的 git，换了 PATH
//   再跑它就找不到 git-upload-pack 等子命令（agent-autoloop L-07）。
// - 不是 git 设的、但会让测试悄悄放行的：NODE_TEST_CONTEXT。在 node --test 进程里推送时它会传进钩子，
//   钩子里的 node --test 见到它就跳过所有测试文件、退出 0，测试坏了也推得上去（#141 审查 P1-05）。
export function cleanEnv(env, localVars, execPath) {
  const out = { ...env };
  for (const name of localVars) delete out[name];
  delete out.GIT_EXEC_PATH;
  delete out.NODE_TEST_CONTEXT;
  if (out.PATH && execPath) out.PATH = out.PATH.split(':').filter(p => p !== execPath).join(':');
  return out;
}

function main() {
  const root = git('rev-parse', '--show-toplevel');
  const env = cleanEnv(process.env, git('rev-parse', '--local-env-vars').split('\n').filter(Boolean), git('--exec-path'));
  for (const name of Object.keys(process.env)) if (!(name in env)) delete process.env[name];
  Object.assign(process.env, env);
  process.chdir(root);
  const config = readConfig(root, Object.keys(RULES));
  if (config.checkRules) {
    console.error(`[pre-push] 规则检查：agent-kit git-hooks/check-rules.mjs（本仓库设置见 ${CONFIG_FILE}）`);
    const found = checkRules(root, config.checkRules);
    for (const v of found) console.error(`${v.file}:${v.line}  ${v.text}\n  ↳ ${v.rule}`);
    if (found.length) {
      console.error(`通用规则检查未通过：${found.length} 处`);
      return 1;
    }
    console.error('通用规则检查通过');
  }
  console.error(`[pre-push] 测试：${config.prePushTests}`);
  return spawnSync('sh', ['-c', config.prePushTests], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] }).status ?? 1;
}

if (isEntry(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`[pre-push] 推送前检查跑不起来，推送已拦下：${err.message}`);
    process.exitCode = 1;
  }
}
