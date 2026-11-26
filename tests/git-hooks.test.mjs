import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMessage } from '../git-hooks/commit-msg.mjs';
import { cleanEnv } from '../git-hooks/pre-push.mjs';

// 共用的 git 钩子（agent-kit#133）：各仓库 scripts/hooks/ 里只放 git-hooks/forward/ 的转发，转发 exec 运行目录里的 git-hooks/。
// 真跑的用例：临时运行目录（AGENT_KIT_STATE_DIR）装一份 git-hooks/，临时仓库装转发，不碰本机运行目录和本项目的 .git。
// commit-msg、pre-push 的用例从 my-skills 骨架 0.5.2 搬来，改成经转发跑。

test('commit-msg：修复类提交没写「同类：」就拒绝，其余不查', () => {
  // 复盘 B 类「修一处，不修同类」样本：agent-autoloop #280 的提交（d26c7f2，只修了插件里的两处截断），说明节选
  const pr280 = "fix(sources): cap an event's words without splitting a character (#280)\n\nThe GitHub and GitLab source plugins cut summary and detail with\nslice(0, 200) and slice(0, 4000) ...\n";
  assert.match(checkMessage(pr280), /缺一行「同类：/);
  assert.match(checkMessage('修：页面时间少了 8 小时\n'), /缺一行「同类：/);
  assert.match(checkMessage('Fix(ui): 表头不齐\n\n同类：\n'), /缺一行「同类：/, '同类后面没写内容也不算');
  assert.equal(checkMessage('fix: 截断\n\n同类：搜了 .slice(0, 数字)，命中 3 处，都改成 fit()\n'), '');
  assert.equal(checkMessage('修复：x\n\n同类: 搜了 toISOString().slice，命中 0 处\n'), '');
  for (const msg of ['feat: 加导出', '修改 README', '修订交接模板', 'Merge branch x', 'Revert "fix: x"', 'fixup! fix: x', 'prefix: 加导出按钮', '# 注释\n文档：补说明'])
    assert.equal(checkMessage(msg), '', msg);
});

test('commit-msg：返修、返工、回滚、hotfix 这类不在开头也算修复，写明别的类型或交接、记录的不查', () => {
  // 0.4.x 只认开头的 fix /「修」，下面这些真实标题（digital-twin、postpane、chatgpt-clipper 等，2026-11）都漏拦了
  for (const subject of [
    '#172 返修：backend 所在默认网络断宿主和外网、关 VCS 集成',
    '0B-1 审查第 1 轮返修：确认码不可覆盖、逐个现读后发',
    '夜跑主控：按 ChatGPT High 第 1 轮审查返修（#92）',
    '按交叉审查返修：预留目录核对身份、暂存回收、失败走下载兜底',
    '安全审计 11-18：修复通道越权、确认误判、日志泄露和并发配置写入',
    '第 2 批审查修正：预览后八格被改不写入',
    '侧栏返工：间距按定稿改回',
    '回滚 #88：撤掉会丢草稿的自动保存',
    'hotfix: 登录页白屏',
    'ui: Bugfix for 表头错位',
  ]) {
    assert.match(checkMessage(`${subject}\n`), /缺一行「同类：/, subject);
    assert.equal(checkMessage(`${subject}\n\n同类：搜了同一写法，命中 0 处\n`), '', subject);
  }
  assert.match(checkMessage('# 请输入提交说明\n#172 返修：x\n#\n'), /缺一行「同类：/, '编辑器模板里的「# 」注释照样跳过，「#172」开头的标题不当注释');
  assert.match(checkMessage('0D：升级、回滚、搬家演练\n'), /确实不是修复.*同类：不适用/s, '被拦的非修复提交，报错里告诉它怎么写');
  assert.equal(checkMessage('0D：升级、回滚、搬家演练\n\n同类：不适用，只是演练记录\n'), '');
  for (const msg of [
    'feat: E4a 可访问性基础修复：焦点框、抽屉与 ⌘K 焦点管理',
    'docs: C 批验收返修记录、浏览器端到端复验脚本与补拍截图',
    'docs(dt-orc): V4.0 按第 1 轮审查返修（#60）',
    'chore!: 回滚依赖版本',
    'CURRENT：0B-4a 第 2 轮返修完成，第 3 轮待常浩授权',
    '交接：#348 第 4 轮返修',
    '记录：第 3 轮复审结果与修复提交号（#92）',
    '文档与交接：#411 L2 第 1 轮返修',
    'feat: 每日巡检补上辅助任务回退检查',
    'ADR-015 草案：底座方向、信任边界、迁移回退',
    'Revert "回滚 #88"',
  ])
    assert.equal(checkMessage(msg), '', msg);
});

test('pre-push 还原 git 改过的环境：去掉本仓库位置、libexec 和 GIT_EXEC_PATH，别的原样', () => {
  const env = { GIT_DIR: '/r/.git/worktrees/w', GIT_INDEX_FILE: 'x', GIT_EXEC_PATH: '/g/libexec/git-core', PATH: '/g/libexec/git-core:/opt/homebrew/bin:/usr/bin', HOME: '/h' };
  assert.deepEqual(cleanEnv(env, ['GIT_DIR', 'GIT_INDEX_FILE'], '/g/libexec/git-core'), { PATH: '/opt/homebrew/bin:/usr/bin', HOME: '/h' });
});

// 这份测试可能在推送前钩子里跑，git 在钩子里带着本项目仓库的位置（GIT_DIR 等）。下面的 git 一律不继承它，只动临时目录。
const LOCAL = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).split('\n').filter(Boolean);
// NODE_TEST_CONTEXT 也不继承：带着它，钩子里的 node --test 会把结果交回本测试进程，自己总是退出 0
const baseEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !LOCAL.includes(name) && name !== 'NODE_TEST_CONTEXT')), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 临时运行目录：照 tools/install.mjs 的 copyRuntime 把 git-hooks/ 放到 <状态目录>/runtime/git-hooks
function tempRuntime(t) {
  const state = mkdtempSync(path.join(tmpdir(), 'git-hooks-state-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  cpSync(path.join(KIT, 'git-hooks'), path.join(state, 'runtime', 'git-hooks'), { recursive: true });
  return { state, hooks: path.join(state, 'runtime', 'git-hooks'), env: { ...baseEnv, AGENT_KIT_STATE_DIR: state } };
}

// 临时仓库：scripts/hooks 里只放两个转发，差异写 scripts/hooks.json
function tempRepo(t, env, hooksJson = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'git-hooks-repo-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env });
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { env });
  cpSync(path.join(KIT, 'git-hooks', 'forward'), path.join(dir, 'scripts', 'hooks'), { recursive: true });
  writeFileSync(path.join(dir, 'scripts', 'hooks.json'), JSON.stringify(hooksJson));
  mkdirSync(path.join(dir, 'tests'));
  writeFileSync(path.join(dir, 'tests', 'ok.test.mjs'), "import { test } from 'node:test'; test('ok', () => {});\n");
  git('config', 'core.hooksPath', 'scripts/hooks');
  const remote = path.join(dir, '..', `${path.basename(dir)}-remote.git`);
  t.after(() => rmSync(remote, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '--bare', remote], { env });
  git('remote', 'add', 'origin', remote);
  return { dir, git, remote };
}

test('转发和共用入口都带可执行位（git 不跑没有可执行位的钩子，只打一行提示）', () => {
  for (const f of ['pre-push', 'commit-msg', 'forward/pre-push', 'forward/commit-msg']) assert.ok(statSync(path.join(KIT, 'git-hooks', f)).mode & 0o111, f);
});

test('commit-msg 真跑：经转发，没写「同类：」的修复提交被拒，写了的通过', t => {
  const { env } = tempRuntime(t);
  const { dir, git } = tempRepo(t, env);
  writeFileSync(path.join(dir, 'a.txt'), '1');
  git('add', '-A');
  const bad = git('commit', '-q', '-m', 'fix: 截断');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /缺一行「同类：/);
  const good = git('commit', '-q', '-m', 'fix: 截断', '-m', '同类：搜了 slice，命中 1 处');
  assert.equal(good.status, 0, good.stderr);
});

test('pre-push 真跑：经转发，规则检查不过就推不上去，过了才推；跑的是 hooks.json 里的测试命令', t => {
  const { env } = tempRuntime(t);
  const { dir, git } = tempRepo(t, env, { prePushTests: 'echo 跑了本仓库的测试 >&2 && node --test tests/*.test.mjs' });
  writeFileSync(path.join(dir, 'tests', 'ok.test.mjs'), "import { test } from 'node:test'; test('ok', () => {});\n");
  mkdirSync(path.join(dir, 'src'));
  writeFileSync(path.join(dir, 'src', 'a.js'), 'show(item.createdAt.slice(0, 16));\n');
  git('add', '-A');
  assert.equal(git('commit', '-q', '-m', 'feat: x').status, 0);
  const blocked = git('push', '-q', 'origin', 'main');
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /src\/a\.js:1[\s\S]*G-02[\s\S]*通用规则检查未通过：1 处/);
  assert.doesNotMatch(blocked.stderr, /跑了本仓库的测试/, '规则检查不过就不跑测试');
  writeFileSync(path.join(dir, 'src', 'a.js'), 'show(beijingTime(item.createdAt));\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'feat: 规则检查过了');
  const ok = git('push', '-q', 'origin', 'main');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /通用规则检查通过[\s\S]*跑了本仓库的测试/);
  // 测试不过也推不上去
  writeFileSync(path.join(dir, 'tests', 'bad.test.mjs'), "import { test } from 'node:test'; test('bad', () => { throw new Error('坏了'); });\n");
  git('add', '-A');
  git('commit', '-q', '-m', 'feat: 测试坏了');
  assert.notEqual(git('push', '-q', 'origin', 'main').status, 0);
});

test('pre-push 真跑：hooks.json 里 checkRules 写 false 就只跑测试；hooks.json 写错了推送被拦下', t => {
  const { env } = tempRuntime(t);
  const { dir, git } = tempRepo(t, env, { checkRules: false, prePushTests: 'true' });
  mkdirSync(path.join(dir, 'src'));
  writeFileSync(path.join(dir, 'src', 'a.js'), 'show(item.createdAt.slice(0, 16));\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'feat: x');
  const ok = git('push', '-q', 'origin', 'main');
  assert.equal(ok.status, 0, ok.stderr);
  assert.doesNotMatch(ok.stderr, /规则检查/);
  writeFileSync(path.join(dir, 'scripts', 'hooks.json'), JSON.stringify({ prepushTests: 'true' }));
  git('commit', '-q', '-am', 'feat: 拼错了');
  const bad = git('push', '-q', 'origin', 'main');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /推送前检查跑不起来，推送已拦下：scripts\/hooks\.json：不认识的键「prepushTests」/);
});

test('运行目录里没有共用钩子：推送和提交都被拦下，并告诉你怎么装', t => {
  const { state, env } = tempRuntime(t);
  const { dir, git } = tempRepo(t, env);
  rmSync(path.join(state, 'runtime'), { recursive: true });
  writeFileSync(path.join(dir, 'a.txt'), '1');
  git('add', '-A');
  const commit = git('commit', '-q', '-m', 'feat: x');
  assert.notEqual(commit.status, 0);
  assert.match(commit.stderr, /\[commit-msg\] 找不到 agent-kit 共用钩子.*提交已拦下.*node tools\/install\.mjs --apply/);
  // 先在有运行目录时提交一次，再看推送
  const { env: env2 } = tempRuntime(t);
  const { dir: dir2, git: git2 } = tempRepo(t, env2);
  writeFileSync(path.join(dir2, 'a.txt'), '1');
  git2('add', '-A');
  assert.equal(git2('commit', '-q', '-m', 'feat: x').status, 0);
  const push = spawnSync('git', ['-C', dir2, 'push', '-q', 'origin', 'main'], { encoding: 'utf8', env });
  assert.notEqual(push.status, 0);
  assert.match(push.stderr, /\[pre-push\] 找不到 agent-kit 共用钩子.*推送已拦下.*node tools\/install\.mjs --apply/);
});

test('只改运行目录里的一份实现，两个仓库的钩子行为一起变，仓库文件一个不动', t => {
  const { hooks, env } = tempRuntime(t);
  const a = tempRepo(t, env);
  const b = tempRepo(t, env);
  for (const r of [a, b]) {
    writeFileSync(path.join(r.dir, 'a.txt'), '1');
    r.git('add', '-A');
    assert.equal(r.git('commit', '-q', '-m', 'feat: 改前能提交').status, 0);
  }
  const before = [a, b].map(r => r.git('status', '--porcelain').stdout);
  // 共用实现改一处：feat 也要求写「同类：」
  const file = path.join(hooks, 'commit-msg.mjs');
  writeFileSync(file, readFileSync(file, 'utf8').replace("if (!isFix) return '';", "if (!isFix && !/^feat/.test(subject)) return '';"));
  for (const r of [a, b]) {
    writeFileSync(path.join(r.dir, 'a.txt'), '2');
    const after = r.git('commit', '-q', '-am', 'feat: 改后被拦');
    assert.notEqual(after.status, 0, r.dir);
    assert.match(after.stderr, /缺一行「同类：/);
  }
  assert.deepEqual([a, b].map(r => r.git('status', '--porcelain', '--', 'scripts').stdout), before.map(() => ''), '仓库里的钩子文件没动');
});

test('pre-push 真跑：从 worktree 推送，测试命令里的 git 操作落不到这个仓库上（G-46）', t => {
  const { env } = tempRuntime(t);
  const scratch = mkdtempSync(path.join(tmpdir(), 'git-hooks-worktree-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const [probe, worktree] = ['probe', 'worktree'].map(name => path.join(scratch, name));
  // 测试命令换成项目测试里常见的两步：在别处新建一个仓库，往里提交。带着这个仓库的 GIT_DIR 跑，两步都会落到这个仓库上
  const { git } = tempRepo(t, env, { checkRules: false, prePushTests: `git init -q "${probe}" && git -C "${probe}" commit -q --allow-empty -m probe` });
  git('add', '-A');
  assert.equal(git('commit', '-q', '-m', 'feat: x').status, 0);
  assert.equal(git('worktree', 'add', '-q', worktree, '-b', 'side').status, 0);
  const pushed = spawnSync('git', ['-C', worktree, 'push', '-q', 'origin', 'side'], { encoding: 'utf8', env });
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.equal(git('rev-list', '--count', 'side').stdout.trim(), '1', '测试命令的提交落到了推送的分支上');
  assert.equal(git('config', '--get', 'core.bare').stdout.trim(), 'false', '推送前钩子把这个仓库改成了裸仓库');
  assert.equal(spawnSync('git', ['-C', probe, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8', env }).stdout.trim(), '1', '测试命令的提交没有落在它自己建的仓库里');
});

test('pre-push 真跑：测试命令找到的 git 和终端里一样，不是 git 自己 libexec 目录里的那份', t => {
  // git 跑钩子时把 libexec/git-core 放在 PATH 最前面并设 GIT_EXEC_PATH。测试用 `command -v git` 找到的就成了 libexec 里的 git，
  // 再换 PATH 跑它，克隆本地仓库时找不到 git-upload-pack（agent-autoloop 的 3 条安装测试只在钩子里失败，2026-11-20，L-07）
  const { env } = tempRuntime(t);
  const tests = 'p=$(command -v git); case "$p" in "$(git --exec-path)"/*) echo "钩子里找到的 git：$p" >&2; exit 1;; esac; [ -z "${GIT_EXEC_PATH:-}" ] || { echo "钩子里还有 GIT_EXEC_PATH" >&2; exit 1; }';
  const { git } = tempRepo(t, env, { checkRules: false, prePushTests: tests });
  git('add', '-A');
  assert.equal(git('commit', '-q', '-m', 'feat: x').status, 0);
  const pushed = git('push', '-q', 'origin', 'main');
  assert.equal(pushed.status, 0, pushed.stderr);
});
