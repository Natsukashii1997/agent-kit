import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RULES, checkRules } from '../git-hooks/check-rules.mjs';
import { DEFAULTS, readConfig } from '../git-hooks/config.mjs';

// 共用的规则检查（git-hooks/check-rules.mjs，agent-kit#133）：用例从 my-skills 骨架 0.5.2 搬来，加上各仓库差异改由 scripts/hooks.json 配置的用例。

function tempRoot(t, prefix = 'check-rules-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  return { root, write };
}
const kinds = root => checkRules(root).map(v => `${v.file}:${v.line} ${v.kind}`);

test('通用规则能抓到违规样本，合规样本不误报', t => {
  const { root, write } = tempRoot(t);
  write('src/a.js', 'show(item.createdAt.slice(0, 16));\nshow(beijingTime(item.createdAt));\nshow(item.updatedAt.slice(11, 16)); // 北京时间\n');
  write('server/index.mjs', "server.listen(port);\nserver.listen(port, '127.0.0.1');\n");
  write('server/safe.mjs', "const ok = req => req.headers.origin === undefined;\nserver.listen(port, '127.0.0.1');\n");
  write('scripts/run.sh', 'set -euo pipefail\nif [ -n "$DRY_RUN" ]; then echo dry; fi\nif [ -n "${VERBOSE:-}" ]; then echo v; fi\n# [ -z "$X" ] 注释不算\n');
  write('scripts/loose.sh', 'if [ -z "$X" ]; then echo x; fi\n');
  write('package.json', JSON.stringify({ dependencies: { 'left-pad': '1.0.0' } }, null, 2));
  assert.deepEqual(kinds(root), ['src/a.js:1 time', 'server/index.mjs:1 listen', 'server/index.mjs:1 origin', 'scripts/run.sh:2 optvar', 'package.json:3 deps']);
});

test('G-07：测试文件里临时起的服务不查 listen、origin，别的规则照查（常浩 2026-11-27 定）', t => {
  const { root, write } = tempRoot(t);
  const server = "await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));\n";
  // postpane src/apps/chrome-extension/test/chromium.test.mjs、trainee-hub server/src/*.test.ts 的写法
  write('src/apps/ext/test/chromium.test.mjs', server);
  write('server/src/auth.test.ts', server);
  write('server/src/views/views.spec.tsx', server);
  write('src/__tests__/a.js', server);
  write('server/src/tests/helper.ts', `${server}show(item.createdAt.slice(0, 16));\n`);
  // 真入口照查；名字里带 test 但不是测试文件的也照查
  write('server/src/index.ts', "server.listen(port, '127.0.0.1');\n");
  write('src/latest.js', 'app.listen(port);\n');
  write('src/contest/main.js', "app.listen(port, '127.0.0.1'); // 来源校验见 app.js\n");
  assert.deepEqual(kinds(root), ['src/latest.js:1 listen', 'src/latest.js:1 origin', 'server/src/index.ts:1 origin', 'server/src/tests/helper.ts:2 time']);
});

test('G-08：同一文件里赋过值的变量是脚本自己的，不当可选开关报（agent-autoloop 带回）', t => {
  const { root, write } = tempRoot(t);
  // agent-autoloop scripts/install-smoke.sh 的写法：骨架 0.5.2 会把这两行都报出来
  write('scripts/smoke.sh', 'set -eu\nup_pid=""\nif [ -n "$up_pid" ]; then kill "$up_pid"; fi\nif ! files=$(git diff) || [ -z "$files" ]; then echo none; fi\nlocal_x() { local mode=a; [ -n "$mode" ]; }\n[ -z "$OPT" ] && echo opt\n');
  assert.deepEqual(kinds(root), ['scripts/smoke.sh:6 optvar']);
});

test('G-08：注释、字符串、env X=1 cmd 里的「X=」不算赋过值；for、read 读进的变量不报；同一行几个判断逐个查（#141 审查）', t => {
  const { root, write } = tempRoot(t);
  write('scripts/a.sh', [
    'set -eu',
    '# 用法：DRY_RUN=1 ./a.sh',
    'if [ -n "$DRY_RUN" ]; then echo dry; fi',
    'echo "设 DEBUG=1 看细节"',
    '[[ -n $DEBUG ]] && echo debug',
    'env FOO=1 node x.mjs',
    '[ -z "$FOO" ] && echo foo',
    'for f in *.txt; do [ -n "$f" ] && echo "$f"; done',
    'while IFS= read -r line; do [ -z "$line" ] && continue; done < list',
    'read -r -a parts first <<< "a b"; [ -n "$first" ] && [ -n "$parts" ]',
    'export A=1 B=2; [ -n "$B" ]',
    '[ -n "${A:-}" ] && [ -n "$OTHER" ]',
  ].join('\n') + '\n');
  assert.deepEqual(kinds(root), ['scripts/a.sh:3 optvar', 'scripts/a.sh:5 optvar', 'scripts/a.sh:7 optvar', 'scripts/a.sh:12 optvar']);
});

test('G-08：引号里的 && ; # 不切、不当注释（#141 审查 P2-01）：echo "x && DEBUG=1" 不算给 DEBUG 赋过值', t => {
  const { root, write } = tempRoot(t);
  write('scripts/a.sh', [
    'set -eu',
    'echo "dummy && DEBUG=1"',
    '[ -n "$DEBUG" ]',
    "echo 'a; QUIET=1'",
    '[ -z "$QUIET" ]',
    'echo "价格 #1"; REAL=1',
    '[ -n "$REAL" ]',
    'echo "转义 \\" && ESC=1"',
    '[ -n "$ESC" ]',
  ].join('\n') + '\n');
  assert.deepEqual(kinds(root), ['scripts/a.sh:3 optvar', 'scripts/a.sh:5 optvar', 'scripts/a.sh:9 optvar']);
});

test('各仓库的差异写在 scripts/hooks.json：扫哪些目录、扩展名、跳过的目录、依赖白名单、关掉的规则', t => {
  const { root, write } = tempRoot(t);
  write('host/a.ts', 'show(item.createdAt.slice(0, 16));\n');
  write('Sources/App.swift', 'let s = item.createdAt.slice(0, 16)\n');
  write('host/dist/b.ts', 'show(item.createdAt.slice(0, 16));\n');
  write('src/c.js', 'server.listen(port);\n');
  write('package.json', JSON.stringify({ devDependencies: { prettier: '3', typescript: '5' } }, null, 2));
  // 默认值：只扫 src、server，白名单为空
  assert.deepEqual(kinds(root), ['src/c.js:1 listen', 'src/c.js:1 origin', 'package.json:3 deps', 'package.json:4 deps']);
  // agent-autoloop 的写法：扫自己的目录、关掉 G-07 两条（中台靠密钥鉴权）；disk-slim 的写法：带上 Swift；postpane 的写法：跳过 dist
  write('scripts/hooks.json', JSON.stringify({
    说明: ['listen、origin 不用：中台入口靠密钥鉴权'],
    checkRules: { scan: ['host', 'src', 'Sources'], exts: ['.ts', '.js', '.swift'], skipDirs: ['node_modules', 'dist'], allowedDeps: ['prettier', 'typescript'], off: ['listen', 'origin'] },
  }));
  assert.deepEqual(kinds(root), ['host/a.ts:1 time', 'Sources/App.swift:1 time']);
  write('scripts/hooks.json', JSON.stringify({ checkRules: false }));
  assert.deepEqual(checkRules(root), [], 'checkRules 写 false 就整个不查');
});

test('hooks.json 写错了直接报错，不悄悄用默认值', t => {
  const { root, write } = tempRoot(t);
  const names = Object.keys(RULES);
  assert.deepEqual(readConfig(root, names), DEFAULTS, '没有 hooks.json 时全用默认值');
  write('scripts/hooks.json', '{"prePushTests": "npm test",}');
  assert.throws(() => readConfig(root, names), /scripts\/hooks\.json 不是合法 JSON/);
  write('scripts/hooks.json', JSON.stringify({ prepushTests: 'npm test' }));
  assert.throws(() => readConfig(root, names), /不认识的键「prepushTests」/);
  write('scripts/hooks.json', JSON.stringify({ checkRules: { scna: ['src'] } }));
  assert.throws(() => readConfig(root, names), /checkRules 里不认识的键「scna」/);
  write('scripts/hooks.json', JSON.stringify({ checkRules: { off: ['G-08'] } }));
  assert.throws(() => readConfig(root, names), /不认识的规则 G-08/);
  write('scripts/hooks.json', JSON.stringify({ checkRules: { scan: 'src' } }));
  assert.throws(() => readConfig(root, names), /checkRules\.scan 要是字符串数组/);
  write('scripts/hooks.json', JSON.stringify({ prePushTests: '' }));
  assert.throws(() => readConfig(root, names), /prePushTests 要是非空字符串/);
  // 写了扫描目录却一个都不在：规则检查等于没查，报错；部分不在照常；写空数组是有意不扫（#141 审查 P2-04）
  write('scripts/hooks.json', JSON.stringify({ checkRules: { scan: ['srcs', 'servr'] } }));
  assert.throws(() => readConfig(root, names), /checkRules\.scan 写的 srcs、servr 一个都不存在/);
  write('scripts/hooks.json', JSON.stringify({ checkRules: { scanSh: ['bin'] } }));
  assert.throws(() => readConfig(root, names), /checkRules\.scanSh 写的 bin 一个都不存在/);
  write('scripts/hooks.json', JSON.stringify({ checkRules: { scan: ['scripts', '没有'], scanSh: [] } }));
  assert.deepEqual(readConfig(root, names).checkRules.scan, ['scripts', '没有']);
  write('scripts/hooks.json', JSON.stringify({ checkRules: { exts: ['ts'] } }));
  assert.throws(() => readConfig(root, names), /checkRules\.exts 每项要是「\.js」这样以点开头的扩展名/);
  write('scripts/hooks.json', JSON.stringify({ 说明: '只跑快测试', prePushTests: 'npm run test:quick', checkRules: { allowedDeps: ['vite'] } }));
  const cfg = readConfig(root, names);
  assert.equal(cfg.prePushTests, 'npm run test:quick');
  assert.deepEqual(cfg.checkRules, { ...DEFAULTS.checkRules, allowedDeps: ['vite'] }, '只写了的项覆盖默认值');
});

test('命令行：node git-hooks/check-rules.mjs <仓库> 检查那个仓库（CI 上就这样跑）', t => {
  const { root, write } = tempRoot(t);
  const run = () => spawnSync(process.execPath, [path.resolve('git-hooks/check-rules.mjs'), root], { encoding: 'utf8' });
  write('src/a.js', 'show(item.createdAt.slice(0, 16));\n');
  const bad = run();
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /src\/a\.js:1 {2}show[\s\S]*G-02[\s\S]*通用规则检查未通过：1 处/);
  write('scripts/hooks.json', JSON.stringify({ checkRules: { off: ['time'] } }));
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /通用规则检查通过/);
  write('scripts/hooks.json', '{');
  const broken = run();
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /规则检查跑不起来：scripts\/hooks\.json 不是合法 JSON/);
});

test('LESSONS 每条要有以层级词开头的「升级」行：真实条目会报错，合规条目和格式样例不误报', t => {
  const { root, write } = tempRoot(t);
  // 前三条摘自 postpane docs/LESSONS.md（2026-11 复盘：50 条里 13 条没有升级行，另有写法不带层级词），只留标题和结构
  const lessons = [
    '# 开发实录与坑', '', '## 怎么写', '', '- 格式样例：', '', '```markdown', '## L-01 <一句话现象>（<YYYY-MM-DD>）', '', '- 升级：未升级。', '```', '', '---', '',
    '## L-01 新目录直接跑 cargo test，桌面程序编译失败（2026-11-04）', '', '- 现象：略。', '- 升级：已写进 AGENTS.md「运行」。', '',
    '## L-16 Chrome 扩展测试 8 条全挂：Playwright 浏览器缓存被本机清理删掉了（2026-11-07）', '', '- 现象：略。', '- 升级：无（环境问题，测试本身的报错已经说清楚了）。', '',
    '## L-29 内置浏览器面板隐藏时截到「卡在半路」的侧栏，误以为布局错乱（2026-11-08）', '', '- 现象：略。', '- 正确做法：略。', '',
    // 剪藏插件 L-02 的真实标题：反引号里的 <all_urls> 不是占位，0.3.0 把整条当格式样例跳过了（漏报）
    '## L-02 声明了 `<all_urls>` 仍无法调用 `captureVisibleTab`（2026-11-02）', '', '- 现象：略。', '',
    '## L-51 合规：未升级的也要带层级词（2026-11-18）', '', '- 现象：略。', '- 升级：〔提醒〕未升级。', '',
    '## L-52 合规：已升级写明去处（2026-11-18）', '', '- 现象：略。', '- 升级：〔机检〕已升级（2026-11-18，#1）：agent-kit git-hooks/check-rules.mjs 的 lessons 规则。', '',
  ].join('\n');
  write('docs/LESSONS.md', lessons);
  assert.deepEqual(checkRules(root).map(v => `${v.file}:${v.line} ${v.kind} ${v.text}`), [
    'docs/LESSONS.md:18 lessons L-01 的「升级」没以层级词开头：- 升级：已写进 AGENTS.md「运行」。',
    'docs/LESSONS.md:23 lessons L-16 的「升级」没以层级词开头：- 升级：无（环境问题，测试本身的报错已经说清楚了）。',
    'docs/LESSONS.md:25 lessons L-29 缺「- 升级：」一行',
    'docs/LESSONS.md:30 lessons L-02 缺「- 升级：」一行',
  ]);
  assert.match(checkRules(root)[0].rule, /〔提醒〕未升级/);
});

test('大改动没写改前改后对照会报错；没到阈值、已新增对照、没有 origin/main 时不报', t => {
  const { root, write } = tempRoot(t, 'check-rules-git-');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  const big = () => checkRules(root).filter(v => v.kind === 'bigchange').map(v => v.text);
  const range = (n, from = 0) => Array.from({ length: n }, (_, i) => `src/m${from + i}.js`);
  git('init', '-q', '-b', 'main');
  // 改前已有一节旧的对照：只有本分支新增的才算
  write('CURRENT.md', '# 当前状态\n\n## 起步（2026-11-01）\n\n- 改前改后功能对照：无。\n');
  for (const f of range(136)) write(f, 'export const v = 1;\n');
  git('add', '-A'); git('commit', '-q', '-m', 'base');
  // 规模照 digiworld 提交 0f03467：改 136 个、新增 624 个，共 760 个文件；其中 24 个还没提交
  for (const f of range(136)) write(f, 'export const v = 2;\n');
  for (const f of range(624, 136)) write(f, 'export const v = 1;\n');
  assert.deepEqual(big(), [], '没有 origin/main 时跳过');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('add', '-A', '--', ...range(600)); git('commit', '-q', '-m', 'big');
  assert.deepEqual(big(), ['本分支相对 origin/main 改了 760 个文件（阈值 100），CURRENT.md 没有新增「改前改后功能对照」一节']);
  write('CURRENT.md', '# 当前状态\n\n## 大改（2026-11-18）\n\n### 改前改后功能对照\n\n| 原有功能 | 改后 | 怎么核对的 |\n|---|---|---|\n| 首页四块 | 还在 | 截图对比 |\n\n## 起步（2026-11-01）\n\n- 改前改后功能对照：无。\n');
  assert.deepEqual(big(), [], '新增了对照就通过');
  // 新的起点：对照已在 origin/main 上，再改 99 个不报，到 100 个报
  git('add', '-A'); git('commit', '-q', '-m', 'all');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  for (const f of range(99, 1000)) write(f, 'export const v = 1;\n');
  assert.deepEqual(big(), [], '99 个文件不报');
  write('src/m1099.js', 'export const v = 1;\n');
  assert.deepEqual(big(), ['本分支相对 origin/main 改了 100 个文件（阈值 100），CURRENT.md 没有新增「改前改后功能对照」一节'], '旧对照不算本次的');
  write('scripts/hooks.json', JSON.stringify({ checkRules: { off: ['bigchange'] } }));
  assert.deepEqual(big(), [], '关掉了就不查');
});
