import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { haystackOf, LESSONS_FILE, LEVELS, matchLessons, parseLessons } from '../hooks/lessons-remind.mjs';

const lessons = parseLessons(fs.readFileSync(LESSONS_FILE, 'utf8'));
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
  assert.deepEqual(ids('launchctl bootout gui/501/com.x && launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.x.plist').sort(), ['G-05', 'G-18']);
  assert.ok(ids('/usr/libexec/PlistBuddy -c "Print :x" a.plist').includes('G-06'));
  assert.ok(ids('codesign --force --sign - ~/Applications/X.app').includes('G-15'));
  assert.ok(ids('hermes cron incidents').includes('G-14'));
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
  assert.ok(ids('git checkout -- src/crates/host/src/relay.rs').includes('G-40'));
  assert.ok(ids('try FileManager.default.removeItem(at: staging)').includes('G-41'));
  assert.ok(ids('shutil.rmtree(staging)').includes('G-41'));
  assert.ok(ids(`ps eww -o command= -p 1551 | tr ' ' '\\n' | grep -i -E "session|local_|CLAUDE"`).includes('G-42'));
  assert.ok(ids('cat /proc/1/environ').includes('G-42'));
  assert.ok(ids("const OWNER_OPEN_ID = 'ou_77e9a1b2c3d4';").includes('G-43'));
  assert.ok(ids('lark-cli im +messages-send --receive-id-type open_id').includes('G-43'));
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
  const first = run('launchctl list');
  assert.equal(first.status, 0);
  const ctx = JSON.parse(first.stdout).hookSpecificOutput;
  assert.equal(ctx.hookEventName, 'PreToolUse');
  assert.match(ctx.additionalContext, /G-05/);
  assert.equal(ctx.permissionDecision, undefined, '只提醒，不做放行或拦截的决定');
  const second = run('launchctl print gui/501/x');
  assert.equal(second.stdout, '', '同一会话第二次不再提醒');
  const log = fs.readFileSync(path.join(dir, 'lessons-hits.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.ok(fs.existsSync(path.join(dir, 'remind-sessions')), '去重记录放在状态目录，不放 /tmp');
  assert.equal(log.length, 2);
  assert.deepEqual(log[1].reminded, []);
  assert.equal(run('git status').stdout, '');
});
