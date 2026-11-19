import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { check, hookOutput, run, segments, stripHeredocBodies } from '../hooks/bash-precheck.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, '..', 'hooks', 'bash-precheck.mjs');
// 钩子和 Claude Code 共用环境变量；测试固定一份，免得跟着跑测试的机器变
const ENV = { HOME: '/Users/me', PWD: '/w', TMPDIR: '/var/folders/x/T/' };
const kindOf = cmd => check(cmd, ENV)?.kind ?? null;

test('2026-11-09 让会话断开的 6 条真实命令：全部拦下', () => {
  const { cases } = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'bash-precheck-stalls-2026-11-09.json'), 'utf8'));
  assert.equal(cases.length, 6);
  for (const c of cases) assert.ok(kindOf(c.command), c.what);
});

test('做这个钩子的会话自己也卡了一次：提交说明的 heredoc 里写了 $$( 和 \\\\$(，同样拦下', () => {
  const cmd = "git add -A && git commit -q -F - <<'MSG'\n- 以及 `$$(`、`\\\\$(` 两种解析不了的写法\nMSG\ngit log --oneline -1";
  assert.equal(kindOf(cmd), 'parse-dollar-dollar');
});

// 下面两组用真实的 Claude Code 2.1.317（桌面版自带）在 bypass、不挂任何钩子时实测过：
// 「会被拦」的那组，Claude Code 回「requires explicit approval」；「改写后」的那组都直接跑了。
test('实测会被安全检查拦下的写法：拦下', () => {
  const cases = {
    'cd /elsewhere && O="w7"; mkdir -p "$O"; rm -f "$O"/*.zip; echo done': 'rm-var-glob',
    'cd /elsewhere && mkdir -p shots && rm -f shots/* && echo done': 'rm-whole-dir',
    'source ~/.zshenv; L="$PWD/w9" && mkdir -p $L && rm -f $L/*.log && echo done': 'rm-var-glob',
    'mkdir -p "$TMPDIR/ck" && rm -rf "$TMPDIR/ck/"* && echo done': 'rm-whole-dir',
    "python3 -I - <<'EOF'\ns='''  $$(\".p\").forEach(x => x)'''\nprint(len(s))\nEOF": 'parse-dollar-dollar',
    'printf "x\\n" | grep -c "a\\|\\\\$(" ; echo done': 'parse-escaped-subst',
  };
  for (const [cmd, kind] of Object.entries(cases)) assert.equal(kindOf(cmd), kind, cmd);
});

test('钩子建议的改写写法：放行（否则会被反复拦住）', () => {
  for (const cmd of [
    'cd /elsewhere && O="w7"; mkdir -p "$O"; rm -f "${O:?}"/*.zip; echo done',
    'cd /elsewhere && mkdir -p shots && rm -f shots/*.png && echo done',
    'source ~/.zshenv; L="$PWD/w9" && mkdir -p "$L" && rm -f "${L:?}"/*.log && echo done',
    'L=/x/w5 && mkdir -p "$L" && rm -f "${L:?}"/*.log && echo done',
    'mkdir -p w4/st && rm -rf w4/st && mkdir w4/st && echo done',
    'touch "$TMPDIR/pk.bak" && rm -f "$TMPDIR/pk.bak" && echo done',
    'rm -f "${R:?}"/*/probe.out',
    'python3 -I /path/to/scratchpad/edit.py',
  ])
    assert.equal(kindOf(cmd), null, cmd);
});

test('常见的正常命令：不管', () => {
  for (const cmd of [
    'ls -la',
    'rm -f a.txt b.txt',
    'rm -rf node_modules dist',
    'rm -f shots/*.png',
    'rm -rf "$HOME/Library/Caches/foo"',
    'git rm --cached secret.txt',
    'X=/tmp/a; rm -f "$X"',
    'for f in a b; do rm -f "$f.log"; done',
    'echo "rm -rf $UNSET/*"',
    "cat > s.sh <<'EOF'\nrm -rf $UNSET/*\nEOF",
    'node -e "await p.$$(\'.card\')"',
    'grep -n "\\$(date" run.sh',
    'echo $(date) && rm -f out.txt',
    'cmd 2>&1 | tee log && rm -f tmp.txt',
  ])
    assert.equal(kindOf(cmd), null, cmd);
});

test('变量为空的判断：命令里赋过值、环境里有值、循环和 read 读进来的，都不算可能为空', () => {
  assert.equal(kindOf('rm -rf "$NOPE/x"'), 'rm-unset-var');
  assert.equal(kindOf('rm -rf "${NOPE:?}/x"'), null);
  assert.equal(kindOf('NOPE=/a && rm -rf "$NOPE/x"'), null);
  assert.equal(kindOf('export NOPE=/a; rm -rf "$NOPE/x"'), null);
  assert.equal(kindOf('for d in a b; do rm -rf "$d/x"; done'), null);
  assert.equal(kindOf('ls | while read -r d; do rm -rf "$d/x"; done'), null);
  assert.equal(kindOf('rm -rf "$HOME/x"'), null);
  assert.equal(check('rm -rf "$HOME/x"', {})?.kind, 'rm-unset-var', '环境里没有 HOME 时也算可能为空');
});

test('rm 的目标里有命令替换：拦下', () => {
  assert.equal(kindOf('rm -rf "$(mktemp -d)"/x'), 'rm-substitution');
  assert.equal(kindOf('rm -rf `pwd`/x'), 'rm-substitution');
});

test('分段：引号、$( )、${ } 里的分隔符不切；2>&1 不算分隔符', () => {
  assert.deepEqual(segments('a "x; y" && b'), ['a "x; y"', 'b']);
  assert.deepEqual(segments('rm -f "${S:?}"/*.png; c'), ['rm -f "${S:?}"/*.png', 'c']);
  assert.deepEqual(segments('rm -f ${S:?}/x | d'), ['rm -f ${S:?}/x', 'd']);
  assert.deepEqual(segments('echo $(a; b) && c 2>&1'), ['echo $(a; b)', 'c 2>&1']);
});

test('heredoc 正文不当命令看', () => {
  assert.equal(stripHeredocBodies("cat > a <<'EOF'\nrm -rf $X/*\nEOF\necho ok"), "cat > a <<'EOF'\necho ok");
  assert.equal(stripHeredocBodies('cat <<-END\n\trm x\n\tEND\nls'), 'cat <<-END\nls');
});

test('拒绝说明：写明类别、命中的写法和怎么改', () => {
  const out = JSON.parse(hookOutput(check('cd /x && rm -f "$O"/*.zip', ENV)));
  const h = out.hookSpecificOutput;
  assert.equal(h.hookEventName, 'PreToolUse');
  assert.equal(h.permissionDecision, 'deny');
  assert.match(h.permissionDecisionReason, /rm-var-glob/);
  assert.match(h.permissionDecisionReason, /\$O\/\*\.zip/);
  assert.match(h.permissionDecisionReason, /\$\{变量:\?\}/);
  assert.match(h.permissionDecisionReason, /不是绕过检查/);
  assert.equal(hookOutput(null), '');
});

test('只管 Bash；没有命令时不管', () => {
  process.env.AGENT_KIT_NO_LOG = '1';
  try {
    assert.equal(run({ tool_name: 'Write', tool_input: { command: 'rm -f "$X"/*' } }), '');
    assert.equal(run({ tool_name: 'Bash', tool_input: {} }), '');
    assert.match(run({ tool_name: 'Bash', tool_input: { command: 'rm -f "$X"/*' } }), /"deny"/);
  } finally {
    delete process.env.AGENT_KIT_NO_LOG;
  }
});

test('真跑一次：命中时输出 deny、记一行日志（不记命令内容）；不命中时什么都不输出', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precheck-'));
  const go = command =>
    spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ session_id: 's1', cwd: '/w', tool_name: 'Bash', tool_input: { command } }),
      encoding: 'utf8',
      env: { ...process.env, AGENT_KIT_STATE_DIR: dir },
    });
  const hit = go('cd /x && rm -f "$O"/*.zip');
  assert.equal(hit.status, 0, hit.stderr);
  assert.match(hit.stdout, /"permissionDecision":"deny"/);
  const miss = go('ls -la');
  assert.equal(miss.status, 0, miss.stderr);
  assert.equal(miss.stdout, '');
  const rows = fs.readFileSync(path.join(dir, 'bash-precheck-hits.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['cwd', 'kind', 'session', 'time']);
  assert.equal(rows[0].kind, 'rm-var-glob');
});

test('输入坏了：不报错、不拦', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', env: { ...process.env, AGENT_KIT_NO_LOG: '1' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});

// ---- kill：pkill -f（全局坑 G-32，2026-11-19）----

test('驿窗 L-33、L-37 的原命令：拦下', () => {
  // L-33（#261）：停自己的基线测试，把 #264、#265 正在跑的全量测试也杀了
  assert.equal(kindOf("pkill -f 'pnpm test'; pkill -f 'cargo test'"), 'kill-pkill-broad');
  // L-37（#282）：全量测试那条 Bash 前面先停旧测试，包着命令的 shell 也匹配上
  assert.equal(kindOf("pkill -f 'cargo test --workspace'; cd /w && pnpm run check && pnpm test > /w/t.log 2>&1"), 'kill-pkill-broad');
});

test('宽泛的 pkill -f 各种写法：拦下', () => {
  for (const cmd of [
    'pkill -9f node',
    'pkill -9 -f "vitest run"',
    'pkill -KILL -f vitest',
    'sudo pkill --full chrome',
    'nohup pkill -lf x',
    'pkill -u me -f "cargo test"',
    'sleep 1 && pkill -f -- -weird',
  ])
    assert.equal(kindOf(cmd), 'kill-pkill-broad', cmd);
});

test('不带 -f、模式里有路径或端口或文件名、只是提到 pkill 的命令：不管', () => {
  for (const cmd of [
    'kill 12345',
    // 近 14 天真实记录里按端口、脚本名、路径精确重启自己服务的写法
    'pkill -f "http.server 8791" ; sleep 0.5; echo done',
    'pkill -f "wb_server.py --port 8766"',
    'pkill -f "vite.*--port 5173" 2>/dev/null',
    'pkill -f "/Users/me/Sandbox/worktrees/x/target/debug/postpane"',
    'kill %1',
    'pgrep -fl "/Users/me/Sandbox/worktrees/x/target"',
    'pkill node',
    'pkill -u me -t ttys001 node',
    'pkill -F /w/server.pid',
    'echo "不要用 pkill -f"',
    'git commit -m "拦下 pkill -f"',
    "cat > /w/note.md <<'EOF'\npkill -f 'pnpm test'\nEOF",
  ])
    assert.equal(kindOf(cmd), null, cmd);
});

test('pkill -f 的拒绝说明：讲清为什么、给出 TaskStop 和 pgrep 看清再 kill 的改法', () => {
  const out = JSON.parse(hookOutput(check("pkill -f 'pnpm test'", ENV)));
  const reason = out.hookSpecificOutput.permissionDecisionReason;
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(reason, /G-32/);
  assert.match(reason, /TaskStop/);
  assert.match(reason, /pgrep -fl/);
  assert.doesNotMatch(reason, /危险 rm/);
});

// ---- env：读别的进程的环境变量（全局坑 G-42，2026-11-19）----

test('磁盘瘦身 L-13 第②点的原命令：拦下', () => {
  // 2026-11-18 磁盘瘦身会话（claude/memory 分支）原样：想把会话进程对上桌面版会话，输出里带出了登录令牌明文
  const cmd = `ps eww -o command= -p 1551 | tr ' ' '\\n' | grep -i -E "session|local_|CLAUDE" | cut -c1-160 | head -20`;
  assert.equal(kindOf(cmd), 'env-ps-environment');
});

test('ps 显示环境变量的各种写法、读 /proc/<pid>/environ：拦下', () => {
  for (const cmd of [
    'ps eww -p 3998',
    'ps e -p 1',
    'ps auxe',
    'ps axeww',
    'ps Eww 1',
    'ps -E -o command= -p 94974',
    'ps -axE -ww -o pid,ppid,command | grep abc',
    'ps -wwE -p 1',
    'ps -o command= -E -p 1',
    'sudo ps eww 1',
    '/bin/ps -Eww -p 1',
    'LC_ALL=C ps eww -p 1',
    'PID=$(pgrep -f gateway | head -1); ps eww -p $PID',
    'X=$(ps eww -p 1 | grep -c PATH); echo $X',
    'cat /proc/1/environ',
    "tr '\\0' '\\n' < /proc/$PID/environ",
    'xargs -0 -n1 </proc/self/environ',
  ])
    assert.match(kindOf(cmd) ?? '', /^env-/, cmd);
});

test('平常看进程的写法、只是提到的命令：不管', () => {
  for (const cmd of [
    'ps aux',
    'ps -ef', // macOS 的 -e 是「所有进程」，不是环境变量
    'ps -e -o pid,comm',
    'ps -A | grep electron',
    'ps -axww -o pid,command',
    'ps axo pid,ppid,stat,etime,command',
    'ps -o etime= -p 89175',
    'ps -O etime -p 1',
    'ps -p 1 -o comm=',
    'ps -o pid,lstart,command -p $(pgrep -f "MacOS/PostPane$" | tail -1)',
    'ps -o lstart= -p $(pgrep -x PostPane | head -1)',
    'LC_ALL=en_US.UTF-8 ps -p 1 -o comm=',
    'ps -u me',
    'ps -U root -o pid,command',
    'ps -t ttys001',
    'env | cut -d= -f1',
    'echo "不要用 ps eww"',
    'git commit -m "拦下 ps eww 和 /proc/1/environ"',
    'grep -n environ notes.md',
    "cat > /w/note.md <<'EOF'\nps eww -p 1\nEOF",
  ])
    assert.equal(kindOf(cmd), null, cmd);
});

test('读环境变量的拒绝说明：讲清为什么、给出只看名字和不打印值的改法，不提危险 rm', () => {
  const out = JSON.parse(hookOutput(check('ps eww -p 1', ENV)));
  const reason = out.hookSpecificOutput.permissionDecisionReason;
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(reason, /env-ps-environment/);
  assert.match(reason, /G-42/);
  assert.match(reason, /登录令牌/);
  assert.match(reason, /env \| cut -d= -f1/);
  assert.match(reason, /shasum/);
  assert.doesNotMatch(reason, /危险 rm/);
  const proc = JSON.parse(hookOutput(check('cat /proc/1/environ', ENV))).hookSpecificOutput.permissionDecisionReason;
  assert.match(proc, /env-proc-environ/);
  assert.match(proc, /\/proc\/1\/environ/);
});
