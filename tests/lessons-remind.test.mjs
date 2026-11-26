import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { findHits, haystackOf, LESSONS_FILE, LEVELS, matchLessons, parseLessons } from '../hooks/lessons-remind.mjs';

const LESSONS_TEXT = fs.readFileSync(LESSONS_FILE, 'utf8');
const lessons = parseLessons(LESSONS_TEXT);
const ids = haystack => matchLessons(lessons, haystack).map(e => e.id);

test('LESSONS 每条 G-xx 都有「触发」一行，正则能编译', () => {
  assert.ok(lessons.length >= 18);
  for (const e of lessons) assert.ok(Array.isArray(e.triggers), `${e.id} 缺「- 触发：」一行`);
  const text = fs.readFileSync(LESSONS_FILE, 'utf8');
  for (const m of text.matchAll(/^- 触发：(.*)$/gm))
    for (const t of m[1].matchAll(/`([^`]+)`/g))
      if (t[1].startsWith('/') && t[1].endsWith('/') && t[1].length > 2) assert.doesNotThrow(() => new RegExp(t[1].slice(1, -1)), t[1]);
});

test('LESSONS 每条 G-xx 的「升级」一行以层级词开头（#57）', () => {
  for (const e of lessons) assert.ok(LEVELS.includes(e.level), `${e.id} 的「- 升级：」要以 ${LEVELS.map(l => `〔${l}〕`).join('')} 之一开头`);
  assert.equal(parseLessons('## G-99 例子\n- 升级：已升级。\n')[0].level, null);
  assert.equal(parseLessons('## G-99 例子\n- 升级：〔机检〕起步骨架。\n')[0].level, '机检');
  // 状态：未升级 / 不升级 / 部分升级 / 关闭 照词取，其余算已升级；新旧写法都认（审查 P2-01、P2-02）
  const st = s => parseLessons(`## G-99 例子\n- 升级：${s}\n`)[0].status;
  assert.equal(st('〔提醒〕未升级。'), '未升级');
  assert.equal(st('〔提醒〕不升级（常浩确认）'), '不升级');
  assert.equal(st('〔体检〕部分升级：缺一项'), '部分升级');
  assert.equal(st('〔机检〕机器拦截'), '已升级');
  // 关闭：坑本身已被代码消除，不再需要升级；层级写现在靠什么守住，后面保留的旧记录不影响状态
  assert.equal(st('〔提醒〕关闭（2026-11-19，积压清单组 15）：核实坑已被代码消除。此前：〔提醒〕未升级。'), '关闭');
  assert.equal(parseLessons('## G-99 例子\n- 升级：〔结构〕关闭（2026-11-19，积压清单组 15）：只留一种做法。\n')[0].level, '结构');
  assert.equal(st('未升级。'), '未升级');
  assert.equal(lessons.find(e => e.id === 'G-14').status, '部分升级');
});

test('典型命令命中对应的坑', () => {
  // G-05 只在改文件时提醒（瘦身提案 S4），这条 Bash 只中 G-18
  assert.deepEqual(ids('launchctl bootout gui/501/com.x && launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.x.plist').sort(), ['G-18']);
  assert.ok(ids('hermes cron rm probe-1').includes('G-14'));
  assert.ok(ids('nohup ./wait.sh &').includes('G-12'));
  assert.ok(ids('const t = row.createdAt.slice(0, 16)').includes('G-02'));
  assert.ok(ids("s.replace('T', ' ')").includes('G-02'));
  assert.ok(ids('#!/bin/bash\nset -euo pipefail').includes('G-08'));
  assert.ok(ids('hermes config set skills.disabled obsidian').includes('G-29'));
  assert.ok(ids('# 故意改坏：去掉装配置的锁').includes('G-29'));
  assert.ok(ids('srv.set_timeout(Duration::from_secs(3));').includes('G-30'));
  assert.ok(ids('pub(crate) const APPROVAL_WAIT_ALLOWED_MINUTES = [0, 1, 3];').includes('G-31'));
  assert.ok(ids("pkill -f 'pnpm test'").includes('G-32'));
  // 2026-11-19 并入的几处（积压清单组 13）
  assert.ok(ids("proxy: { '/api': { target: api, changeOrigin: false } }").includes('G-07'));
  assert.ok(ids('[mcp_servers.agent-hud.tools.relay_to_chatgpt]\napproval_mode = "approve"').includes('G-26'));
  assert.ok(ids('grep -n -A8 agent-hud ~/.codex/config.toml').includes('G-26'));
  // 2026-11-19 新增 G-33～G-44（积压清单第二批）
  assert.ok(ids('.initialization_script(include_str!("collapse.js"))').includes('G-33'));
  assert.ok(ids('webView.evaluateJavaScript("window.__collapse()")').includes('G-33'));
  assert.ok(ids('    struct Fake {\n        reaches: bool,').includes('G-34'));
  assert.ok(ids('await browser.runtime.sendMessage({ type: "capture" })').includes('G-35'));
  assert.ok(ids('chrome.runtime.onInstalled.addListener(reinject)').includes('G-35'));
  assert.ok(ids('document.querySelectorAll(\'[data-message-author-role="assistant"]\')').includes('G-36'));
  assert.ok(ids("const units = document.querySelectorAll('[data-chatgpt-search-unit-key$=\":assistant\"]')").includes('G-36'));
  assert.ok(ids('let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)\ndown?.post(tap: .cghidEventTap)').includes('G-37'));
  assert.ok(ids('ps -p "$pid" -o comm= | grep -qx "$want"').includes('G-38'));
  assert.ok(ids('XCTAssertTrue(path.hasPrefix("/var/folders/"))').includes('G-38'));
  assert.ok(ids('struct AlertSettings: Codable, Equatable {').includes('G-39'));
  assert.ok(ids('let s = try? JSONDecoder().decode(Alerts.self, from: data)').includes('G-39'));
  assert.ok(ids("cp src/relay.rs /w/relay.rs.bak && sed -i '' 's/queue(/leave(/' src/relay.rs && cargo test -p host; cp /w/relay.rs.bak src/relay.rs").includes('G-40'));
  assert.ok(ids('try FileManager.default.removeItem(at: staging)').includes('G-41'));
  assert.ok(ids('shutil.rmtree(staging)').includes('G-41'));
  assert.ok(ids(`ps eww -o command= -p 1551 | tr ' ' '\\n' | grep -i -E "session|local_|CLAUDE"`).includes('G-42'));
  assert.ok(ids('cat /proc/1/environ').includes('G-42'));
  assert.ok(ids("const OWNER_OPEN_ID = 'ou_77e9a1b2c3d4';").includes('G-43'));
  assert.ok(ids("import '@fontsource/geist-sans/400.css';").includes('G-44'));
});

test('2026-11-19 新增触发词：平常写法不误报', () => {
  for (const cmd of [
    'ps aux | grep node',
    'ps -ef',
    'ps -o pid,command -p 1',
    'const fake = makeFakeHost()',
    'git checkout main',
    'git checkout -b claude/x origin/main',
    'sed -i "" "s/a/b/" README.md',
    'rm -rf node_modules',
    'cat ~/.codex/AGENTS.md',
    'npm run build',
  ])
    assert.deepEqual(ids(cmd).filter(id => id >= 'G-33'), [], cmd);
});

test('普通命令不误报', () => {
  for (const cmd of ['git status', 'npm test', 'ls -la', 'node --test tests/', 'git push -u origin claude/x', 'cat README.md'])
    assert.deepEqual(ids(cmd), [], cmd);
});

test('改文件类工具：拿路径和新内容来比', () => {
  const h = haystackOf({ tool_name: 'Edit', tool_input: { file_path: '/p/src/time.js', old_string: 'a', new_string: 'x.updatedAt.slice(0, 16)' } });
  assert.ok(matchLessons(lessons, h).some(e => e.id === 'G-02'));
  assert.equal(haystackOf({}), '');
});

test('作为 hook 真跑：同一会话同一条只提醒一次，并记一行命中日志', () => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'lessons-remind.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-remind-'));
  const session = `test-${process.pid}-${Date.now()}`;
  const run = command =>
    spawnSync(process.execPath, [file], {
      input: JSON.stringify({ session_id: session, tool_name: 'Bash', cwd: '/x/work-desk', tool_input: { command } }),
      encoding: 'utf8',
      env: { ...process.env, AGENT_KIT_STATE_DIR: dir },
    });
  const first = run('launchctl bootout gui/501/com.x');
  assert.equal(first.status, 0);
  const ctx = JSON.parse(first.stdout).hookSpecificOutput;
  assert.equal(ctx.hookEventName, 'PreToolUse');
  assert.match(ctx.additionalContext, /G-18/);
  assert.equal(ctx.permissionDecision, undefined, '只提醒，不做放行或拦截的决定');
  const second = run('launchctl bootout gui/501/com.y');
  assert.equal(second.stdout, '', '同一会话第二次不再提醒');
  const log = fs.readFileSync(path.join(dir, 'lessons-hits.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.ok(fs.existsSync(path.join(dir, 'remind-sessions')), '去重记录放在状态目录，不放 /tmp');
  assert.equal(log.length, 2);
  assert.deepEqual(log[1].reminded, []);
  // M3：日志记下是哪个触发词命中的（瘦身提案 M3），只记触发词本身，不记命令内容
  assert.deepEqual(log[0].words, { 'G-18': ['launchctl bootout'] });
  assert.ok(!JSON.stringify(log).includes('com.x'));
  assert.equal(run('git status').stdout, '');
});

// ---------- 瘦身提案（2026-11-20 常浩批 M1、M2、M5、S1～S6、S8） ----------

const sample = parseLessons([
  '## G-98 例子',
  '- 触发（改文件）：`editonly`',
  '- 触发（主目录）：`mainonly`',
  '- 触发：`anywhere`',
  '- 升级：〔提醒〕未升级',
  '## G-97 并入的例子',
  '- 触发：无（已并入 G-98）',
  '- 升级：〔提醒〕并入 G-98（2026-11-20，瘦身提案）。此前：〔提醒〕未升级。',
].join('\n'));
const hitIds = (input, entries = sample) => findHits(entries, input).map(h => h.entry.id);
const bash = (command, cwd = '/w/repo') => ({ tool_name: 'Bash', cwd, tool_input: { command } });
const write = (file_path, content, cwd = '/w/repo') => ({ tool_name: 'Write', cwd, tool_input: { file_path, content } });

test('触发行可以限定范围：「改文件」只在写文件时匹配（M1）', () => {
  assert.deepEqual(hitIds(bash('run editonly')), []);
  assert.deepEqual(hitIds(write('/w/repo/a.sh', 'editonly')), ['G-98']);
  for (const tool of ['Edit', 'MultiEdit', 'NotebookEdit', 'apply_patch'])
    assert.deepEqual(hitIds({ tool_name: tool, cwd: '/w/repo', tool_input: { file_path: '/w/repo/a.sh', new_string: 'editonly' } }), ['G-98'], tool);
});

test('「主目录」只在不是 worktree 的目录匹配（M2）', () => {
  assert.deepEqual(hitIds(bash('mainonly', '/w/repo')), ['G-98']);
  assert.deepEqual(hitIds(bash('mainonly', '/w/repo/.claude/worktrees/x')), []);
  assert.deepEqual(hitIds(bash('mainonly', '/Users/n/Sandbox/worktrees/repo-x')), []);
  assert.deepEqual(hitIds(bash('anywhere', '/w/repo/.claude/worktrees/x')), ['G-98'], '没限定范围的照常匹配');
});

test('改 .md 文件不匹配（M5）；代码文件、apply_patch 里混着代码文件照常匹配', () => {
  assert.deepEqual(hitIds(write('/w/repo/docs/x.md', 'anywhere editonly')), []);
  assert.deepEqual(hitIds(write('/w/repo/x.mjs', 'anywhere')), ['G-98']);
  const patch = files => ({ tool_name: 'apply_patch', cwd: '/w/repo', tool_input: { command: `*** Begin Patch\n${files.map(f => `*** Update File: ${f}\n+anywhere`).join('\n')}\n*** End Patch` } });
  assert.deepEqual(hitIds(patch(['docs/a.md'])), []);
  assert.deepEqual(hitIds(patch(['docs/a.md', 'src/b.js'])), ['G-98']);
  assert.deepEqual(hitIds(bash('cat README.md | grep anywhere')), ['G-98'], 'Bash 命令不看文件后缀');
});

test('命中结果带上是哪个触发词（M3）', () => {
  const h = findHits(sample, bash('anywhere mainonly'));
  assert.deepEqual(h.map(x => x.words), [['mainonly', 'anywhere']]);
});

test('「并入」的条目：状态是并入，记下并到哪条，没有触发词', () => {
  const merged = sample.find(e => e.id === 'G-97');
  assert.equal(merged.status, '并入');
  assert.equal(merged.mergedInto, 'G-98');
  assert.deepEqual(merged.triggers, []);
});

test('真实 LESSONS 按瘦身提案调整后的效果', () => {
  const real = input => findHits(lessons, input).map(h => h.entry.id);
  // S1 G-03：跑脚本不提醒（2026-11-27 起改脚本也不提醒，见下一个测试）
  assert.ok(!real(bash('python3 -B hermes/scripts/health_check.py')).includes('G-03'));
  // S2 G-10：飞书不再触发
  assert.ok(!real(bash('lark-cli feishu docs +fetch x')).includes('G-10'));
  // S3 G-04：worktree 里 git add -A 不提醒，主目录提醒；并进来的 CARGO_TARGET_DIR 在 worktree 里也提醒
  assert.ok(!real(bash('git add -A', '/w/repo/.claude/worktrees/x')).includes('G-04'));
  assert.ok(real(bash('git add -A', '/w/repo')).includes('G-04'));
  assert.ok(real(bash('CARGO_TARGET_DIR=/w/target cargo test', '/w/repo/.claude/worktrees/x')).includes('G-04'));
  // S4 G-05：查看 launchd 不提醒，写 plist 提醒
  assert.ok(!real(bash('launchctl list | grep hermes')).includes('G-05'));
  assert.ok(real(write('/Users/n/Library/LaunchAgents/com.x.plist', '<plist/>')).includes('G-05'));
  // S5 G-15：正常打包签名不提醒（2026-11-27 起整条只查，见下一个测试）
  assert.ok(!real(bash('codesign --force --sign - build/Postpane.app')).includes('G-15'));
  // S8 G-14：只认删除类子命令
  assert.ok(!real(bash('hermes cron list')).includes('G-14'));
  for (const sub of ['remove', 'rm', 'delete']) assert.ok(real(bash(`hermes cron ${sub} probe-1`)).includes('G-14'), sub);
  // S3、S5、S6：被并入的编号还在，状态是并入，指向合并后的条目
  for (const [from, to] of [['G-23', 'G-04'], ['G-16', 'G-15'], ['G-47', 'G-46']]) {
    const e = lessons.find(x => x.id === from);
    assert.equal(e.status, '并入', from);
    assert.equal(e.mergedInto, to, from);
  }
  assert.ok(real(bash('git -C repo config core.hooksPath scripts/hooks')).includes('G-46'), 'G-47 的触发词并进 G-46');
});

test('2026-11-27 批阅单第 7 项（#135）：五条只查、G-40 和 G-43 收窄', () => {
  const real = input => findHits(lessons, input).map(h => h.entry.id);
  // 只查：触发改「无」，条目留着、升级行写依据
  for (const id of ['G-03', 'G-06', 'G-15', 'G-21']) {
    const e = lessons.find(x => x.id === id);
    assert.deepEqual(e.triggers, [], id);
    assert.ok(e.title && e.line, `${id} 的条目留着`);
  }
  assert.ok(!real(write('/w/repo/scripts/release.sh', 'echo hi')).includes('G-03'));
  assert.ok(!real(bash('/usr/libexec/PlistBuddy -c "Print :x" a.plist')).includes('G-06'));
  assert.ok(!real(write('/w/repo/server.mjs', "res.setHeader('Cache-Control', 'no-cache')")).includes('G-15'));
  assert.ok(!real(bash('open "https://applink.feishu.cn/client/chat/open?openChatId=oc_1"')).includes('G-21'));
  assert.equal(lessons.find(x => x.id === 'G-03').level, '机检');
  const g03 = LESSONS_TEXT.split('\n## ').find(b => b.startsWith('G-03 '));
  assert.match(g03, /- 升级：〔机检〕部分升级（2026-11-27 批阅单第 7 项/);
  assert.doesNotMatch(g03.split('此前：')[0], /multi-agent、/, '覆盖名单里不再单列 multi-agent');
  // G-40：改了、测了、又还原写在一条命令里才提醒。样本取自装后 6 天的真实命令（disk-slim、postpane、digiworld）
  for (const c of [
    "cp $F \"$EV/Cleaner.swift.orig\" && { sed -i '' 's/^ persist()$/ \\/\\/ persist()/' $F; scripts/test.sh --filter CleanerJournalTests > \"$EV/red.txt\" 2>&1; cp \"$EV/Cleaner.swift.orig\" $F; }",
    "sed -i '' 's/a/b/' $F; scripts/test.sh 2>&1 | tail -5; sed -i '' 's/b/a/' $F",
    "sed -i '' 's/a/b/' background.js && node --test test/background.test.mjs | grep fail; git checkout -- background.js",
    "sed -i '' 's/a/b/' src/x.ts; npm run test; git restore src/x.ts",
    "cp src/relay.rs /w/relay.rs.bak && sed -i '' 's/queue(/leave(/' src/relay.rs && cargo test -p host; cp /w/relay.rs.bak src/relay.rs",
  ])
    assert.ok(real(bash(c)).includes('G-40'), c);
  for (const c of [
    "sed -i '' 's/a/b/' tests/v3-export.test.mjs && node --test tests/*.test.mjs 2>&1 | grep -E '^ℹ (pass|fail)'",
    "sed -i '' '11s/x/y/' CURRENT.md && node --test tests/*.test.mjs && node scripts/check-rules.mjs",
    "sed -i '' 's/a/b/' x.js && sed -i '' 's/c/d/' y.test.mjs",
    'git checkout -- src/crates/host/src/relay.rs',
    // #135 审查 P2-01：测试后复制普通产物、不是测试命令的 --test-mode，都不算
    "sed -i '' 's/a/b/' x.js && npm test && cp dist/app.js out/app.js",
    "sed -i '' 's/a/b/' x.js && node app.js --test-mode; sed -i '' 's/b/a/' x.js",
  ])
    assert.ok(!real(bash(c)).includes('G-40'), c);
  assert.ok(real(bash("echo '验红：去掉 persist()'")).includes('G-40'), '验红一词照旧');
  // G-43：只认写死的 ou_ 字面量
  assert.ok(real(write('/w/repo/a.mjs', "const OWNER_OPEN_ID = 'ou_77e9a1b2c3d4';")).includes('G-43'));
  assert.ok(!real(bash('lark-cli im +messages-send --receive-id-type open_id')).includes('G-43'));
});
