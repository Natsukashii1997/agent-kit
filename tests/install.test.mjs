import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { branchProblem, copyRuntime, ensureHandoffConfig, ensureOrganizeConfig, isOurHook, main, mergeHooks, mergeRules, ourHookGroups, ourPromptGroups, ourStartGroups, remindChangedAt, selfTest } from '../tools/install.mjs';

const quiet = fn => {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = err;
  }
};

test('合并 hook：保留别人的 hook，重复安装不会叠加', () => {
  const theirs = { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-own-check.sh' }] };
  const start = { model: 'x', hooks: { PreToolUse: [theirs], Stop: [{ hooks: [{ type: 'command', command: 'notify' }] }] } };
  const once = mergeHooks(start, ourHookGroups('claude', '/n'));
  const twice = mergeHooks(once, ourHookGroups('claude', '/n'));
  assert.deepEqual(twice, once);
  assert.equal(once.model, 'x');
  assert.deepEqual(once.hooks.Stop, start.hooks.Stop);
  assert.deepEqual(once.hooks.PreToolUse[0], theirs);
  assert.equal(once.hooks.PreToolUse.filter(g => g.hooks.some(isOurHook)).length, 4, 'guard-git、lessons-remind、thinking-review-nudge、bash-precheck');
  assert.equal(mergeHooks(start, ourHookGroups('codex', '/n')).hooks.PreToolUse.filter(g => g.hooks.some(isOurHook)).length, 2, 'Codex 没有 thinking-review 和 bash-precheck');
  const removed = mergeHooks(once, [], { remove: true });
  assert.deepEqual(removed, start);
});

test('合并先问规则：去重，卸载只去掉自己加的', () => {
  const start = { permissions: { allow: ['Bash(npm test)'], ask: ['Bash(rm *)'] } };
  const once = mergeRules(start, 'ask', ['Bash(gh pr merge *)', 'Bash(rm *)']);
  assert.deepEqual(once.permissions.ask, ['Bash(rm *)', 'Bash(gh pr merge *)']);
  assert.deepEqual(mergeRules(once, 'ask', ['Bash(gh pr merge *)']), once);
  assert.deepEqual(mergeRules(once, 'ask', ['Bash(gh pr merge *)'], { remove: true }), start);
  const denied = mergeRules(once, 'deny', ['Bash(git push --force * main)']);
  assert.deepEqual(denied.permissions.deny, ['Bash(git push --force * main)']);
  assert.deepEqual(denied.permissions.allow, ['Bash(npm test)']);
});

test('自检能在本机跑通', () => {
  assert.deepEqual(selfTest(), []);
});

test('不在 main 上：预览照常，--apply 拒绝且不写文件', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-home-'));
  const env = { AGENT_KIT_STATE_DIR: path.join(home, 'state') };
  if (!branchProblem()) return; // 本仓库此刻就在 main 上时跳过
  assert.equal(quiet(() => main([], home, env)), 0);
  assert.equal(quiet(() => main(['--apply'], home, env)), 1);
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'settings.json')));
});

test('整套安装：预览不写；--apply 写入、备份到状态目录、hook 指向副本；卸载只删自己加的规则', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-home-'));
  const state = path.join(home, 'state');
  const env = { AGENT_KIT_STATE_DIR: state };
  const settings = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  // 用户原本就有一条和 agent-kit 同名的规则
  const original = { permissions: { allow: ['Bash(npm test)'], ask: ['Bash(git reset --hard *)'] }, autoMemoryEnabled: false };
  fs.writeFileSync(settings, JSON.stringify(original));
  const args = extra => [...extra, '--allow-any-branch'];

  assert.equal(quiet(() => main(args([]), home, env)), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), original, '预览不改文件');
  assert.ok(!fs.existsSync(path.join(home, '.codex')));
  assert.ok(!fs.existsSync(path.join(state, 'runtime')));

  assert.equal(quiet(() => main(args(['--apply']), home, env)), 0);
  const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.deepEqual(after.permissions.allow, ['Bash(npm test)']);
  assert.equal(after.autoMemoryEnabled, false);
  assert.deepEqual(after.permissions.ask, ['Bash(git reset --hard *)'], '#27 起不加先问规则，原有的不动');
  assert.ok(after.permissions.deny.includes('Bash(git push --force * main)'));
  assert.equal(after.hooks.PreToolUse.length, 4);
  assert.equal(after.hooks.PreToolUse[2].matcher, 'Bash|Edit|Write|MultiEdit|NotebookEdit|ExitPlanMode');
  assert.equal(after.hooks.PreToolUse[3].matcher, 'Bash');
  assert.ok(after.hooks.PreToolUse[3].hooks[0].command.endsWith('bash-precheck.mjs"'));
  assert.equal(after.hooks.UserPromptSubmit.length, 3, 'thinking-review-nudge、首轮整理和上下文提醒');
  assert.ok(after.hooks.UserPromptSubmit[0].hooks[0].command.endsWith('thinking-review-nudge.mjs"'));
  // 首轮整理（#65）：两处都指向 runtime 副本，配置和运行记录在状态目录
  const organizeDir = path.join(state, 'session-organize-once');
  const organizeCmd = `"${path.join(state, 'runtime', 'hooks', 'session-organize-once', 'session_organize_once.py')}" --config "${path.join(organizeDir, 'config.json')}" --state-dir "${path.join(organizeDir, 'state')}"`;
  const [promptOrganize] = after.hooks.UserPromptSubmit[1].hooks;
  assert.ok(promptOrganize.command.endsWith(organizeCmd), promptOrganize.command);
  assert.equal(after.hooks.SessionStart.length, 1);
  assert.equal(after.hooks.SessionStart[0].matcher, 'startup|fork');
  assert.deepEqual(after.hooks.SessionStart[0].hooks, [promptOrganize]);
  assert.equal(promptOrganize.timeout, 5);
  assert.equal(promptOrganize.statusMessage, '整理新会话');
  assert.ok(fs.existsSync(path.join(state, 'runtime', 'hooks', 'session-organize-once', 'session_organize_once.py')));
  assert.ok(!fs.existsSync(path.join(state, 'runtime', 'hooks', 'session-organize-once', '__pycache__')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(organizeDir, 'config.json'), 'utf8')), JSON.parse(fs.readFileSync(new URL('../config/session-organize-once.example.json', import.meta.url), 'utf8')), '没有旧配置时拷示例');
  const cmds = after.hooks.PreToolUse.flatMap(g => g.hooks);
  assert.ok(cmds.every(h => h.command.includes(path.join(state, 'runtime', 'hooks')) && h.timeout === 10));
  assert.ok(fs.existsSync(path.join(state, 'runtime', 'LESSONS.md')));
  assert.ok(fs.existsSync(path.join(state, 'runtime', 'hooks', 'lib', 'common.mjs')));
  assert.equal(fs.readdirSync(path.dirname(settings)).filter(f => f.includes('bak')).length, 0, '备份不留在 ~/.claude 里');
  assert.equal(fs.readdirSync(path.join(state, 'backups')).length, 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(state, 'install-manifest.json'), 'utf8'));
  assert.ok(!manifest.claude.ask.includes('Bash(git reset --hard *)'), '原有的同名规则不记成自己加的');
  const codexHooks = JSON.parse(fs.readFileSync(path.join(home, '.codex', 'hooks.json'), 'utf8'));
  assert.ok(codexHooks.hooks.PreToolUse[0].hooks[0].command.endsWith('guard-git.mjs"'));
  assert.ok(fs.existsSync(path.join(home, '.codex', 'rules', 'agent-kit.rules')));

  // 装好的 hook 照设置里的命令原样跑得起来
  const guard = spawnSync('/bin/sh', ['-c', cmds[0].command], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push -f origin main' } }), encoding: 'utf8' });
  assert.match(guard.stdout, /"deny"/);
  const nudge = spawnSync('/bin/sh', ['-c', after.hooks.UserPromptSubmit[0].hooks[0].command], { input: JSON.stringify({ session_id: 's', hook_event_name: 'UserPromptSubmit', prompt: '这个思维评审一下' }), encoding: 'utf8', env: { ...process.env, ...env } });
  assert.match(nudge.stdout, /thinking-review/);
  const precheck = spawnSync('/bin/sh', ['-c', cmds.at(-1).command], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'cd /x && rm -f "$O"/*.zip' } }), encoding: 'utf8', env: { ...process.env, ...env, AGENT_KIT_NO_LOG: '1' } });
  assert.match(precheck.stdout, /"deny"/);
  // 首轮整理照设置里的命令原样跑：新会话先登记，首条消息再注入整理规则
  const desktop = { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', CLAUDE_CODE_HOST_SESSION_ID: 'local_test-1', CLAUDE_CODE_SESSION_ATTENDED: '1' };
  const runOrganize = event => spawnSync('/bin/sh', ['-c', promptOrganize.command], { input: JSON.stringify(event), encoding: 'utf8', env: desktop });
  assert.equal(runOrganize({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'org-1' }).status, 0);
  const organized = runOrganize({ hook_event_name: 'UserPromptSubmit', session_id: 'org-1', prompt_id: 'p-1', cwd: home, prompt: '做点事' });
  assert.match(organized.stdout, /additionalContext/);
  assert.match(fs.readFileSync(path.join(organizeDir, 'state', 'decisions.log'), 'utf8'), /armed[\s\S]*dispatched/);
  // 上下文提醒（#105）：发消息和工具调用后两处同一条命令，指向 runtime 副本；照设置里的命令原样跑，越过 50% 给提醒
  const handoffDir = path.join(state, 'context-handoff');
  const [promptHandoff] = after.hooks.UserPromptSubmit[2].hooks;
  assert.ok(promptHandoff.command.endsWith(`"${path.join(state, 'runtime', 'hooks', 'context-handoff', 'context_handoff.py')}" --config "${path.join(handoffDir, 'config.json')}" --state-dir "${path.join(handoffDir, 'state')}"`), promptHandoff.command);
  assert.equal(promptHandoff.statusMessage, '检查上下文用量');
  const postHandoff = after.hooks.PostToolUse.at(-1).hooks[0];
  assert.equal(postHandoff.command, promptHandoff.command);
  assert.equal(postHandoff.statusMessage, undefined, '工具调用后不显示状态，免得刷屏');
  const transcript = path.join(home, 't.jsonl');
  fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 600000 } } })}\n`);
  const reminded = spawnSync('/bin/sh', ['-c', postHandoff.command], { input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 'h-1', transcript_path: transcript }), encoding: 'utf8' });
  assert.match(reminded.stdout, /交接卡是唯一的开始入口/);
  assert.equal(fs.readdirSync(path.join(handoffDir, 'state')).length, 1, '提醒记录写在状态目录');

  assert.equal(quiet(() => main(args(['--apply']), home, env)), 0, '重复安装');
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), after, '重复安装不改设置');

  assert.equal(quiet(() => main(['--uninstall', '--apply'], home, env)), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), original, '卸载后原有的同名规则还在，SessionStart 和 UserPromptSubmit 也一并去掉');
  assert.ok(fs.existsSync(path.join(organizeDir, 'config.json')), '卸载不删首轮整理配置');
  assert.ok(fs.existsSync(path.join(handoffDir, 'config.json')), '卸载不删上下文提醒配置');
  assert.ok(!fs.existsSync(path.join(home, '.codex', 'rules', 'agent-kit.rules')));
  assert.deepEqual(fs.readdirSync(path.join(home, '.codex', 'rules')), [], '规则目录里不留备份');
  assert.ok(!fs.existsSync(path.join(state, 'runtime')));
  assert.ok(!fs.existsSync(path.join(state, 'install-manifest.json')));
});

test('首轮整理：旧路径（~/.claude/hooks 下）的条目重装时换成 runtime 副本，同组里别人的 hook 保留', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-home-'));
  const state = path.join(home, 'state');
  const settings = path.join(home, '.claude', 'settings.json');
  const legacy = path.join(home, '.claude', 'hooks', 'session-organize-once');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'config.json'), JSON.stringify({ schema: 1, mine: true }));
  const legacyCmd = `/usr/bin/python3 "${path.join(legacy, 'session_organize_once.py')}" --config "${path.join(legacy, 'config.json')}" --state-dir "${path.join(legacy, 'state')}"`;
  const handoff = { type: 'command', command: 'node ~/.claude/hooks/context_handoff.mjs' };
  const theirStart = { matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] };
  fs.writeFileSync(settings, JSON.stringify({ hooks: {
    SessionStart: [theirStart, { matcher: 'startup|fork', hooks: [{ type: 'command', command: legacyCmd, timeout: 5 }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: legacyCmd, timeout: 5 }, handoff] }],
  } }));
  const run = extra => quiet(() => main([...extra, '--only', 'claude', '--allow-any-branch'], home, { AGENT_KIT_STATE_DIR: state }));

  assert.equal(run(['--apply']), 0);
  const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
  const all = ev => after.hooks[ev].flatMap(g => g.hooks.map(h => h.command));
  for (const ev of ['SessionStart', 'UserPromptSubmit']) {
    assert.ok(!all(ev).some(c => c.includes(legacy)), `${ev} 里旧路径已去掉`);
    assert.equal(all(ev).filter(c => c.includes(path.join(state, 'runtime', 'hooks', 'session-organize-once'))).length, 1, `${ev} 里只有一条新的`);
  }
  assert.deepEqual(after.hooks.SessionStart[0], theirStart, '别人的 SessionStart 保留');
  assert.deepEqual(after.hooks.UserPromptSubmit[0].hooks, [handoff], '同组里的 context_handoff 保留');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state, 'session-organize-once', 'config.json'), 'utf8')), { schema: 1, mine: true }, '真实配置从旧位置迁过来');
  assert.ok(fs.existsSync(path.join(legacy, 'config.json')), '旧配置不删');

  assert.equal(run(['--uninstall', '--apply']), 0);
  const removed = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.deepEqual(removed.hooks.SessionStart, [theirStart], '卸载后 SessionStart 只剩别人的');
  assert.deepEqual(removed.hooks.UserPromptSubmit, [{ hooks: [handoff] }]);
});

test('首轮整理配置：已有不动、从旧位置迁移、拷示例；预览不写', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-home-'));
  const sd = path.join(home, 'state');
  const dest = path.join(sd, 'session-organize-once', 'config.json');
  const example = fs.readFileSync(new URL('../config/session-organize-once.example.json', import.meta.url), 'utf8');

  assert.match(ensureOrganizeConfig(sd, home), /拷示例/);
  assert.ok(!fs.existsSync(dest), '预览不写');
  ensureOrganizeConfig(sd, home, { write: true });
  assert.equal(fs.readFileSync(dest, 'utf8'), example);

  fs.writeFileSync(dest, '{"schema":1,"edited":true}');
  const legacy = path.join(home, '.claude', 'hooks', 'session-organize-once');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'config.json'), '{"schema":1,"legacy":true}');
  assert.match(ensureOrganizeConfig(sd, home, { write: true }), /不动/);
  assert.equal(fs.readFileSync(dest, 'utf8'), '{"schema":1,"edited":true}', '已有的不被旧配置或示例覆盖');

  fs.rmSync(dest);
  assert.match(ensureOrganizeConfig(sd, home, { write: true }), /迁移/);
  assert.equal(fs.readFileSync(dest, 'utf8'), '{"schema":1,"legacy":true}');
});

test('首轮整理只装 Claude；命令带 --config 和 --state-dir', () => {
  assert.deepEqual(ourStartGroups('codex', '/py', '/s/runtime'), []);
  assert.deepEqual(ourPromptGroups('codex', '/n', '/s/runtime', '/py'), []);
  const [start] = ourStartGroups('claude', '/py', '/s/runtime');
  assert.equal(start.hooks[0].command, '"/py" "/s/runtime/hooks/session-organize-once/session_organize_once.py" --config "/s/session-organize-once/config.json" --state-dir "/s/session-organize-once/state"');
  assert.ok(isOurHook(start.hooks[0]));
  assert.deepEqual(ourPromptGroups('claude', '/n', '/s/runtime', '/py')[1].hooks, start.hooks);
});

test('Python 换成不随版本变的入口', async () => {
  const { stablePython } = await import('../tools/install.mjs');
  assert.equal(stablePython(p => p.includes('Versions/Current') || p === '/opt/homebrew/bin/python3'), '/Library/Frameworks/Python.framework/Versions/Current/bin/python3');
  assert.equal(stablePython(p => p === '/usr/bin/python3'), '/usr/bin/python3');
  assert.equal(stablePython(() => false), 'python3');
});

test('重装：以前装时加的、配置里已去掉的先问规则一并去掉，你自己的不动', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-home-'));
  const state = path.join(home, 'state');
  const settings = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ permissions: { ask: ['Bash(rm *)', 'Bash(gh pr merge *)', 'Bash(git clean *)'] } }));
  fs.writeFileSync(path.join(state, 'install-manifest.json'), JSON.stringify({ claude: { deny: [], ask: ['Bash(gh pr merge *)', 'Bash(git clean *)'] } }));
  assert.equal(quiet(() => main(['--apply', '--only', 'claude', '--allow-any-branch'], home, { AGENT_KIT_STATE_DIR: state })), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')).permissions.ask, ['Bash(rm *)']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state, 'install-manifest.json'), 'utf8')).claude.ask, []);
});

test('settings.json 坏了：不写，报错', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-home-'));
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{ broken');
  assert.throws(() => quiet(() => main(['--apply', '--only', 'claude', '--allow-any-branch'], home, { AGENT_KIT_STATE_DIR: path.join(home, 'state') })), /不是合法 JSON/);
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), '{ broken');
});

test('Homebrew 的 node 换成不随版本变的入口', async () => {
  const { stableNode } = await import('../tools/install.mjs');
  assert.equal(stableNode('/opt/homebrew/Cellar/node/22.9.0/bin/node', p => p === '/opt/homebrew/bin/node'), '/opt/homebrew/bin/node');
  assert.equal(stableNode('/usr/local/bin/node', () => true), '/usr/local/bin/node');
  assert.equal(stableNode('/opt/homebrew/Cellar/node/22.9.0/bin/node', () => false), '/opt/homebrew/Cellar/node/22.9.0/bin/node');
});

test('复制 hook 副本：仓库路径里有点开头的目录（如 .claude/worktrees）也整份复制，只跳过 hooks 里的隐藏文件和 __pycache__', () => {
  const kit = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ak-kit-')), '.claude', 'worktrees', 'x');
  fs.mkdirSync(path.join(kit, 'hooks', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'hooks', 'guard-git.mjs'), '');
  fs.writeFileSync(path.join(kit, 'hooks', 'lib', 'common.mjs'), '');
  fs.writeFileSync(path.join(kit, 'hooks', '.DS_Store'), '');
  fs.mkdirSync(path.join(kit, 'hooks', 'session-organize-once', '__pycache__'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'hooks', 'session-organize-once', 'session_organize_once.py'), '');
  fs.writeFileSync(path.join(kit, 'hooks', 'session-organize-once', '__pycache__', 'x.pyc'), '');
  fs.writeFileSync(path.join(kit, 'LESSONS.md'), '');
  // 共用 git 钩子（#133）：整份复制，入口不管原来有没有可执行位都给上
  fs.mkdirSync(path.join(kit, 'git-hooks', 'forward'), { recursive: true });
  for (const f of ['pre-push', 'commit-msg', 'forward/pre-push', 'forward/commit-msg', 'pre-push.mjs']) fs.writeFileSync(path.join(kit, 'git-hooks', f), '', { mode: 0o644 });
  fs.writeFileSync(path.join(kit, 'git-hooks', '.DS_Store'), '');
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ak-rt-')), 'runtime');
  copyRuntime(dest, kit);
  assert.deepEqual(fs.readdirSync(path.join(dest, 'hooks'), { recursive: true }).sort(), ['guard-git.mjs', 'lib', 'lib/common.mjs', 'session-organize-once', 'session-organize-once/session_organize_once.py']);
  assert.ok(fs.existsSync(path.join(dest, 'LESSONS.md')));
  assert.deepEqual(fs.readdirSync(path.join(dest, 'git-hooks'), { recursive: true }).sort(), ['commit-msg', 'forward', 'forward/commit-msg', 'forward/pre-push', 'pre-push', 'pre-push.mjs']);
  for (const f of ['pre-push', 'commit-msg', 'forward/pre-push', 'forward/commit-msg']) assert.equal(fs.statSync(path.join(dest, 'git-hooks', f)).mode & 0o777, 0o755, f);
});

test('坑提醒规则的变化时间（#133）：LESSONS.md 或 lessons-remind.mjs 和已装副本不同才更新，相同就沿用', () => {
  const kit = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-kit-'));
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-rt-'));
  for (const root of [kit, runtime]) {
    fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, 'LESSONS.md'), '- 触发：`/tmp/`\n');
    fs.writeFileSync(path.join(root, 'hooks', 'lessons-remind.mjs'), 'v1');
  }
  const now = '2026-11-27T10:00:00.000Z';
  assert.equal(remindChangedAt(runtime, { remindChangedAt: '2026-11-21T09:00:00.000Z', installedAt: '2026-11-26T00:00:00.000Z' }, now, kit), '2026-11-21T09:00:00.000Z', '没变就沿用');
  assert.equal(remindChangedAt(runtime, { installedAt: '2026-11-26T00:00:00.000Z' }, now, kit), '2026-11-26T00:00:00.000Z', '旧记录没有这一项，退回上次安装时间');
  fs.writeFileSync(path.join(kit, 'LESSONS.md'), '- 触发：无\n');
  assert.equal(remindChangedAt(runtime, { remindChangedAt: '2026-11-21T09:00:00.000Z' }, now, kit), now, 'LESSONS 变了');
  fs.writeFileSync(path.join(kit, 'LESSONS.md'), '- 触发：`/tmp/`\n');
  fs.writeFileSync(path.join(kit, 'hooks', 'lessons-remind.mjs'), 'v2');
  assert.equal(remindChangedAt(runtime, { remindChangedAt: '2026-11-21T09:00:00.000Z' }, now, kit), now, '提醒钩子变了');
  assert.equal(remindChangedAt(path.join(runtime, '没有'), {}, now, kit), now, '第一次装');
});

test('上下文提醒（#105）：旧路径条目重装时换成 runtime 副本；配置和提醒记录从旧位置迁移，已有的不覆盖、旧目录不删', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-home-'));
  const state = path.join(home, 'state');
  const settings = path.join(home, '.claude', 'settings.json');
  const legacy = path.join(home, '.claude', 'hooks', 'context-handoff');
  fs.mkdirSync(path.join(legacy, 'state'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'config.json'), '{"context_window":200000,"thresholds":[0.6]}');
  fs.writeFileSync(path.join(legacy, 'state', 'aaa.json'), '[0.5]');
  fs.writeFileSync(path.join(legacy, 'state', 'bbb.json'), '[0.5, 0.7]');
  const legacyCmd = `/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 ${path.join(legacy, 'context_handoff.py')}`;
  const theirs = { type: 'command', command: 'echo theirs' };
  fs.writeFileSync(settings, JSON.stringify({ hooks: {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: legacyCmd, timeout: 5, statusMessage: '检查上下文用量' }, theirs] }],
    PostToolUse: [{ hooks: [{ type: 'command', command: legacyCmd, timeout: 5 }] }],
  } }));
  // 状态目录里已有一条同名记录：不被旧的覆盖
  fs.mkdirSync(path.join(state, 'context-handoff', 'state'), { recursive: true });
  fs.writeFileSync(path.join(state, 'context-handoff', 'state', 'bbb.json'), '[0.5]');
  const run = extra => quiet(() => main([...extra, '--only', 'claude', '--allow-any-branch'], home, { AGENT_KIT_STATE_DIR: state }));

  assert.match(ensureHandoffConfig(state, home), /迁移[\s\S]*1 条提醒记录/);
  assert.equal(run(['--apply']), 0);
  const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
  const all = ev => after.hooks[ev].flatMap(g => g.hooks.map(h => h.command));
  for (const ev of ['UserPromptSubmit', 'PostToolUse']) {
    assert.ok(!all(ev).some(c => c.includes(legacy)), `${ev} 里旧路径已去掉`);
    assert.equal(all(ev).filter(c => c.includes(path.join(state, 'runtime', 'hooks', 'context-handoff'))).length, 1, `${ev} 里只有一条新的`);
  }
  assert.deepEqual(after.hooks.UserPromptSubmit[0].hooks, [theirs], '同组里别人的 hook 保留');
  const dir = path.join(state, 'context-handoff');
  assert.equal(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'), '{"context_window":200000,"thresholds":[0.6]}', '配置从旧位置迁过来');
  assert.equal(fs.readFileSync(path.join(dir, 'state', 'aaa.json'), 'utf8'), '[0.5]', '旧记录拷过来');
  assert.equal(fs.readFileSync(path.join(dir, 'state', 'bbb.json'), 'utf8'), '[0.5]', '已有的同名记录不覆盖');
  assert.ok(fs.existsSync(path.join(legacy, 'state', 'aaa.json')) && fs.existsSync(path.join(legacy, 'config.json')), '旧目录不删');
  assert.match(ensureHandoffConfig(state, home), /已在[^；]*，不动$/, '再装一次：配置不动，没有要拷的记录');

  assert.equal(run(['--uninstall', '--apply']), 0);
  const removed = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.deepEqual(removed.hooks.UserPromptSubmit, [{ hooks: [theirs] }]);
  assert.equal(removed.hooks.PostToolUse, undefined, '卸载会一并去掉上下文提醒');
});

test('上下文提醒配置：没有旧位置时拷示例；预览不写', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-home-'));
  const sd = path.join(home, 'state');
  const dest = path.join(sd, 'context-handoff', 'config.json');
  assert.match(ensureHandoffConfig(sd, home), /拷示例/);
  assert.ok(!fs.existsSync(dest), '预览不写');
  ensureHandoffConfig(sd, home, { write: true });
  assert.equal(fs.readFileSync(dest, 'utf8'), fs.readFileSync(new URL('../config/context-handoff.example.json', import.meta.url), 'utf8'));
});
