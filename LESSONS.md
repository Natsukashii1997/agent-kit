# 跨项目的坑（全局 LESSONS）

各项目踩过、换个项目也成立的坑，Claude 和 Codex 共用这一份。排障、发布、改脚本、装 launchd 或定时任务之前，先搜一遍：`grep -n 关键词 /Users/nat/Documents/ChatGPT/个人/work/agent-kit/LESSONS.md`，再搜项目自己的 `docs/LESSONS.md`。

## 怎么写

- 只收换个项目也成立的坑：不依赖某个项目的业务、页面或发布脚本。只对某个项目成立的，留在那个项目的 `docs/LESSONS.md`。
- 从项目提升上来：写成 G-xx，编号只增不改；措辞去掉项目专有名词；「来源」写项目名、原条目号和能查的证据。原条目保留，加一行「提升：已提升为全局 G-xx（日期）」。
- 一条一个坑，写现象、根因、正确做法、来源、出现过的项目、升级。证据查不到就写「未核实」，不编。结论被推翻时改条目并注明日期，不删。
- 只出提案、用户批准才写：当轮交接里提，或由项目的每周整理（G 类）提。

## 怎么升级

- 同一条在第二个项目又被踩到：「出现过的项目」补上；把一句话硬约束同时写进 `~/.claude/CLAUDE.md` 和 `~/.codex/AGENTS.md`（同一句，先给 diff 让用户确认），或写进 `~/Documents/ChatGPT/个人/work/my-skills/skills/project-starter/skeleton/`（project-starter 已迁到 my-skills）的模板或检查脚本，条目的「升级」写明去处。
- 能用机器判定的：写进起步骨架的 `scripts/check-rules.mjs`，新项目一起步就带上。

---

## G-01 验证证据放 /tmp，被系统清理（2026-10-24 提升）

- 现象：验证用的备份、日志放在 `/tmp/…`，几天后整批找不到，无法追溯。
- 根因：macOS 会定期清理 `/tmp`。
- 正确做法：证据放项目约定的持久目录（如 `~/Library/Application Support/<项目>/evidence/<目录名>/`），位置写进项目 AGENTS.md；会话临时目录只放用完即弃的文件。
- 来源：work-desk L-02（`docs/history/CURRENT-through-20261022.md` 开头的 2026-10-23 补注）。
- 出现过的项目：work-desk。
- 升级：未升级。

## G-02 页面直接截取 ISO 时间字符串，把 UTC 当本地时间显示（2026-10-24 提升）

- 现象：页面上的时间按 UTC 显示，10:46 录入的显示成 02:46；同一写法在一个项目里先后出现 4 处。
- 根因：直接截取 ISO 字符串里的「月-日 时:分」，或把 `T` 换成空格；后端存 UTC 本身没错。
- 正确做法：显示一律经一个格式化函数按 `Asia/Shanghai` 转换（函数名写进项目 AGENTS.md 的规则），测试覆盖跨日、跨年；能机检就加检查规则。
- 来源：work-desk L-03（提交 `3200d0e`；2026-10-23 每周整理试跑又发现 3 处）。
- 出现过的项目：work-desk。
- 升级：未升级。

## G-03 改了脚本只做语法或单条路径验证，没跑全量测试（2026-10-24 提升）

- 现象：给发布脚本加了完整回读，只做了 bash 验证；另一个会话跑全量测试时才发现 4 项发布流程测试失败。
- 根因：有测试会截取脚本片段、给外部命令打桩后真实执行；新增的外部调用没有桩。
- 正确做法：改 `scripts/` 下任何脚本也跑全量测试；有测试截取脚本执行的，新增外部命令时在测试里补桩和断言。
- 来源：work-desk L-06（提交 `b5c212d` 引入，修复是测试里补的桩）。
- 出现过的项目：work-desk。
- 升级：未升级。

## G-04 并行会话共用一个工作区，测试互相污染、提交带上别人的改动（2026-10-24 提升）

- 现象：跑全量测试带上了另一个会话没提交的半成品；整文件 `git add` 带上了别人几分钟前在同一文件里刚改的几处。
- 根因：两个会话同时在一个目录改代码；`git status` 刚核过是干净的，对方随后又改了。
- 正确做法：并行的会话各开独立 worktree。做不到时：测试记录写明「工作区含他人未提交改动」；提交只含自己的文件（`git commit -- <文件>`）；同一文件里有别人的改动时只暂存自己的块——`git diff -U0 <文件>` 看分块，把自己的块写成补丁 `git apply --cached`，或 `git show HEAD:<文件>` 加上自己的改动后 `git hash-object -w --stdin`、再 `git update-index --cacheinfo 100644,<哈希>,<文件>`；暂存后 `git diff --cached` 再核一遍。不用裸 `git stash`（各 worktree 共用一个 stash 栈）。
- 来源：work-desk L-07（2026-10-23 首次；2026-10-24 提交 `359ac18` 再犯）。
- 出现过的项目：work-desk。
- 升级：未升级。

## G-05 launchd 里用 /bin/bash 读不了「文稿」下的脚本（2026-10-24 提升）

- 现象：任务装进 launchd 后一跑就退出码 126，日志只有一行 `Operation not permitted`；同一个脚本在终端里跑正常。
- 根因：macOS 隐私保护拦住 launchd 直接启动的 `/bin/bash` 读取 `~/Documents`；终端和 AI 会话有文稿访问权限，手动跑看不出来。
- 正确做法：要读 `~/Documents` 等受保护目录的 launchd 任务，借已有文稿权限的程序启动（如应用外壳里的 node），或把脚本和数据放到非受保护目录；装好后一定用 `launchctl kickstart` 真实触发一次再看日志，不能只在终端里试。
- 来源：work-desk L-08（`scripts/health-check.sh` 的 `--install`；证据 `~/Library/Application Support/NiumaHome/evidence/每日巡检-20261023/`）。
- 出现过的项目：work-desk。
- 升级：未升级。

## G-06 PlistBuddy 找不到文件时把提示打到标准输出（2026-10-24 提升）

- 现象：读一个不存在的 plist，读出来的值是「File Doesn't Exist, Will Create: …」这串文字，后面的检查跟着报错。
- 根因：`PlistBuddy -c "Print …"` 遇到不存在的文件不报错退出，而是往标准输出打提示，`2>/dev/null` 挡不住。
- 正确做法：先 `[ -f "$plist" ]` 再读。
- 来源：work-desk L-09（`scripts/health-check.sh` 读数据目录那几行）。
- 出现过的项目：work-desk。
- 升级：未升级。

## G-07 本机服务只监听 127.0.0.1，仍挡不住浏览器里任意网页发来的请求（2026-10-24 提升）

- 现象：Host + Origin 校验只挂在一组接口上；其余 POST 没有校验，浏览器里任何网页都能向本机端口发简单 POST，触发拉外部数据、调模型、写库。
- 根因：横切的保护写在模块里，没有放到入口统一做；只监听 127.0.0.1 挡得住别的机器，挡不住本机浏览器。
- 正确做法：来源校验（Host 是本机、Origin 同源）、正文大小上限、统一错误响应放服务入口，对全部写接口生效；模块里只做自己的业务校验（如配对码）。
- 来源：work-desk L-11（`server/http.mjs` 的 `checkOrigin`、`tests/request-guard.test.mjs`）。
- 出现过的项目：work-desk。
- 升级：未升级。

## G-08 `set -u` 脚本里可选开关裸引用，变量不设就整段退出（2026-10-24 提升）

- 现象：脚本开头 `set -uo pipefail`，可选开关写成 `[ -n "$OPT" ]`；正常运行不带这个变量，前面的检查全过，到这一步报 `unbound variable` 退出，被判成失败。
- 根因：只跑了 `bash -n` 和设了开关的那条路径；`bash -n` 只查语法，查不出 `set -u` 下的未定义引用。
- 正确做法：可选开关一律写 `${OPT:-}`；改带 `set -u` 的脚本后，开关设与不设各跑一遍。
- 来源：work-desk L-12（`~/Library/Application Support/NiumaHome/evidence/全面优化-20261023/release.log`；修复提交 `359ac18`）。
- 出现过的项目：work-desk。
- 升级：未升级。

## G-09 改界面时把原有强调色、状态样式改没了（2026-10-24 提升）

- 现象：改一个组件的高亮条件，连带把另一个状态下的强调色（底线、图标、时间）全改成了默认色，用户明确不满。
- 根因：改条件时没看清它还影响哪些类名、状态和颜色。
- 正确做法：只动用户点名的部分；改已有组件前先看清会影响哪些类名、条件、颜色；改前截图，改完对照截图逐项核对颜色与强调。
- 来源：work-desk L-01（用户 2026-10-18 当面反馈；对应提交未核实）。
- 出现过的项目：work-desk。
- 升级：未升级。

## G-10 外部只读来源每次现读，页面每次打开都要等（2026-10-24 提升）

- 现象：一个读飞书的页面每次打开要等 3.7 秒（其余只读接口都在 30 毫秒内）；另一处解析结果只放内存，服务重启后第一次打开又要等外部读完。
- 根因：读外部来源时没有落库快照，也没有「先回旧数据、后台刷新」。
- 正确做法：接外部只读来源一律落快照：页面先回旧快照，过期了后台刷新；只有用户点「刷新」才现读，不让用户等外部来源。
- 来源：work-desk L-10（`docs/handoff/UI与功能审核-20261023/审核记录.md` 第 3、4 条；`tests/mentor-snapshot.test.mjs`、`tests/reports-persist.test.mjs`）。
- 出现过的项目：work-desk。
- 升级：未升级。

## G-11 无头 Chrome 截图与合成事件不可靠：样式没加载完、焦点事件不发（2026-10-24 提升）

- 现象：用 `--headless=new --screenshot --virtual-time-budget=…` 截图，有的页面 `@import` 进来的样式没生效、有的图没画出来，同一命令重跑结果不一样；用 `el.focus()` + 合成 `KeyboardEvent` 核对键盘交互，页面的 focus 处理根本没触发，截出来的状态和真实按键对不上。
- 根因：`--virtual-time-budget` 只给虚拟时间设上限，不保证 `@import` 链、字体和模块里的异步请求都完成；页面不在前台（`document.hasFocus()` 为假）时，程序调 `focus()` 只改 `activeElement`，不发 focus / focusin 事件。
- 正确做法：要等页面画完再截的图，用调试协议（`--remote-debugging-port` + `Runtime.evaluate` 轮询「目标元素已画出 + `document.fonts.status === "loaded"`」，再 `Page.captureScreenshot` 按元素区域截）；键盘、鼠标交互一律用真实输入（`Input.dispatchKeyEvent` / `Input.dispatchMouseEvent`，或浏览器里的真实按键），不拿合成事件的结果当证据。
- 来源：work-desk L-13（`~/Library/Application Support/NiumaHome/evidence/折线图数值与悬停-20261024/` 的 `cdp-shot.mjs`、`cdp-debug.mjs`）。
- 出现过的项目：work-desk。
- 升级：未升级。

## G-12 电脑重启，会话里等着到点再跑的后台任务落空，也没人发现（2026-10-24 新增）

- 现象：凌晨在 AI 会话里起了一个后台脚本，用 `sleep` 循环等到第二天 10:00，再依次跑三步数据任务；脚本放在会话临时目录（`/private/tmp/…/scratchpad/`）。09:29 电脑重启，进程没了，脚本文件也被清掉。10:00 什么都没跑，一份日志都没写，到 10:20 回头核对才发现，等这批结果的两个会话都白等了。同一次重启还停掉了两个本机预览网站和一个长期运行的实验进程，当时也没人发现。
- 根因：会话里起的后台进程活不过整机重启，加 `nohup`、脱离会话进程组也一样；macOS 重启会清空 `/private/tmp`。等待循环没有“到点没跑”的提醒，日志要等任务真正开始才写，所以从外面分不出“还没到点”和“已经没了”。
- 正确做法：
  - 到点要跑或要跨夜跑的任务用 launchd，重启后和睡眠醒来后都照样触发（装之前先看 G-05）。
  - 脚本和日志放持久目录，不放 `/tmp` 和会话临时目录。
  - 暂时不能装 launchd 时（比如用户决定过几天再装），在交接里写明“几点之后核对哪几份日志”。到点的会话先核对，没跑就照原样补跑，并说明原因。
  - 长任务日志第一行写开始时间，最后一行写 `exit N`，才分得清“没跑”和“没跑完”。
  - 发现电脑重启过（看 `sysctl kern.boottime`），把同一时间停掉的本机服务和实验进程一并查出来，告诉用户。
- 来源：github-center 2026-10-24（`CURRENT.md` 2026-10-24 10:40 条；Issue #11 完成记录的“真实运行”一节）。
- 出现过的项目：github-center。
- 升级：未升级。

## G-13 回退测试用了不存在的模型名，留下长期冷却，辅助任务全部掉到回退模型（2026-10-27 新增）

- 现象：为了验证“主模型出错时能回退”，用一个不存在的模型名跑了一次。回退本身成功了，但从那一刻起，标题生成全部改走回退模型，上下文压缩直接失败，日志一直报“找不到主模型的 OAuth 令牌”；令牌其实有效，主对话也照常走主模型，所以一天多没人发现，最后是长会话压不下去、巡检报回退才查出来。
- 根因：智能体框架（Hermes）把“模型不存在”记成了这个凭证的模型冷却，期限一年，写进本地凭证文件。主对话取凭证时带模型名，只被那个假模型挡住；辅助任务取凭证时不带模型名，框架按“任何一条冷却都挡”的保守规则，把整条凭证判成不可用。
- 正确做法：
  - 测回退不用假模型名、假密钥这类会被记账的错误，改用“只让主模型这一路连不上”：单条命令设一个不通的代理（如 `HTTPS_PROXY=http://127.0.0.1:9`），把回退服务的域名放进 `NO_PROXY` 直连，测完不留任何状态。
  - 任何故障注入测试做完，都回读凭证文件的冷却和报错状态（Hermes 是 `auth.json` 的 `model_cooldowns`、`last_status`），再跑一次正常请求，确认辅助任务也回到主模型。
  - 已经留下冷却的，用框架自己的命令清（Hermes：`hermes auth reset <provider>`，会清模型冷却、不动令牌），不手改凭证文件；清完重启常驻服务。
  - 巡检只查主对话回退时，辅助任务回退是盲区，要看日志里的辅助任务回退记录。
- 来源：digital-twin 2026-10-27（`CURRENT.md`「Hermes 辅助任务改回 Codex」一节；证据 `~/Library/Application Support/DigitalTwin/evidence/hermes-aux-codex-20261027/`）。
- 出现过的项目：digital-twin。
- 升级：未升级。

## G-14 删了一次性探针定时任务，它失败留下的记录还在，巡检第二天误报（2026-10-28 新增）

- 现象：为了验收，在智能体框架（Hermes）里建了几个只跑一次的探针定时任务，其中两个失败。之后任务删了，但第二天巡检仍报「定时任务有未处理的失败记录」；告警文字只截到命令输出的表格边框，看不出是哪条。
- 根因：两层。① 框架把定时任务失败单独记成失败记录（Hermes 是 `hermes cron incidents`），删任务不会删记录，记录要手动确认才关闭。② 巡检跑的是不带筛选的列表命令，已确认关闭的记录也会列出来，巡检把“有输出”当成“有问题”；这条判断规则当初只用“没有记录”的情况测过。
- 正确做法：
  - 删一次性探针或测试任务时，先查它有没有留下失败记录，有就确认关闭（Hermes：`hermes cron incidents ack <id>`），再删任务；验收记录里写明已关闭。
  - 巡检判断“有没有未处理的问题”时，按状态筛选只看未处理的（Hermes：`--state detected`、`--state alerted`），不靠列表命令有没有输出；告警写条数和第一条的报错摘要。
  - 巡检规则的自测要覆盖“只有已处理记录”这种情况，不只测空列表和有问题两种。
- 来源：digital-twin 2026-10-28（`CURRENT.md`「首日运行核对；巡检定时任务误报修复」一节；修复 PR #24 `38a8b7e`）。
- 出现过的项目：digital-twin。
- 升级：未升级。

## G-15 改了 Safari「添加到程序坞」网页应用的包内文件再重签，应用打不开（2026-10-28 新增）

- 现象：想换 macOS 程序坞里某个网页应用的图标，替换 `~/Applications/<名字>.app/Contents/Resources/ApplicationIcon.icns` 后用 `codesign --force --sign -` 重签，`codesign --verify --strict` 也通过，但点开弹「你不能打开应用程序……因为它可能已损坏或不完整」。另外，第一次替换直接报 `Operation not permitted`。
- 根因：两层。① 这种应用是 Safari 生成的模板应用（`LSTemplateApplication`，没有可执行文件），系统登记了它生成时的签名；重签后 CDHash 变了，LaunchServices 报 `-10827 / -10410 Expected signature for template application did not match or was missing`，拒绝启动。② 改任何应用包都受「隐私与安全性 › App 管理」保护（`kTCCServiceSystemPolicyAppBundles`）；在 Claude Code 里，被拦的责任进程是 `~/Library/Application Support/Claude/claude-code/<版本>/<哈希>/claude.app`，不是桌面版 Claude。
- 正确做法：
  - 不改包内文件，也不重签。换图标用「自定义图标」：Finder 显示简介里贴图，或 `NSWorkspace setIcon:forFile:options:`。签名 CDHash 不变，应用照常打开；撤销时在显示简介里选中图标按删除键。
  - 自定义图标会原样显示、系统不再切圆角，要先做成和系统图标一样的版式：1024 画布、824 圆角方形居中、外围留边加阴影，可以直接拿原图标的 alpha 当遮罩。
  - 要彻底换，就改网站清单里的图标并发布，再在 Safari 里删掉旧应用、重新「添加到程序坞」（这个网页应用自己的登录状态和本地存储可能要重来）。
  - 动包之前先整份 `ditto` 备份；改完必须实际打开一次，`codesign --verify` 通过不代表能启动。
- 来源：personal-ai-workbench 2026-10-28（`CURRENT.md`「Claude 程序坞应用图标换成『A 数码夜景』」一节；交接 `docs/agents/handoffs/2026-10-28-claude-app-icon.md`；提交 `60856de`）。
- 出现过的项目：personal-ai-workbench。
- 升级：未升级。

## G-16 Safari「添加到程序坞」网页应用打开时用磁盘里的旧首页：发布换了哈希就黑屏，刷新才好（2026-10-28 新增）

- 现象：打开程序坞里的网页应用是一片空白（只有背景色），按 ⌘R 就正常；两次打开之间没有新发布时不黑。服务正常，普通浏览器冷启动也正常、没有报错。
- 根因：网页应用恢复窗口时直接用磁盘缓存里的旧首页，首页设 `Cache-Control: no-cache`（或干脆不写缓存头）都拦不住；旧首页引用的带哈希 JS/CSS 在发布后已不存在，脚本 404，整页空白。网页应用的缓存目录受 macOS 保护读不到，「直接用了旧首页」是按 WebKit 行为推断的，与发布频率、复现条件一致，未直接证实。
- 正确做法：
  - 首页（含前端路由回落返回的 `index.html`）一律 `Cache-Control: no-store`；带哈希的构建文件不用动。
  - 加一条测试起真实服务查首页响应头，免得以后改静态服务时丢掉。
  - 修好后第一次打开仍可能黑一次（磁盘里还有改前存下的旧首页），之后再发布、打开不黑才算验证。
  - 根治（2026-10-31 补）：程序坞入口改成原生 WKWebView 外壳。外壳每次启动自己加载首页，按正常 HTTP 缓存规则走，不会恢复网页应用磁盘里的旧首页；还能自带图标（不受 G-15 限制），也能用按需下载的系统字体。外壳有自己的网页存储，网页应用里的 localStorage 带不过来，换之前先确认没有未保存草稿。目前只验证过换完后打开不黑，还没经过一次发布，未核实。参考写法：personal-ai-workbench `desktop/app-shell/`（PR #45）、work-desk `desktop/macos/NiumaHome.swift`。
- 来源：personal-ai-workbench 2026-10-28（`CURRENT.md`「Claude 发布到正式 5178（wb-20261028-671）」一节；提交 `dd3b395`）；work-desk L-16（提交 `533cb89`，同为网页应用，未踩到、预防性修改）。
- 出现过的项目：personal-ai-workbench（踩到）；work-desk（同类风险，预防修改）。
- 升级：未升级。

## G-17 WKWebView 窗口壳的「重新载入」菜单被 WKWebView 自己接走，外壳写的处理不执行（2026-10-31 新增）

- 现象：原生窗口壳的「重新载入」（⌘R）菜单项，action 是 `reload:`，target 留空。外壳在 AppDelegate 里写的 `reload(_:)`（例如先做离开确认）从不执行，页面直接刷新了，看起来像功能正常。
- 根因：target 为空时，菜单动作沿响应链找第一个能响应的对象。WKWebView 是第一响应者，它自己就实现了 `reload:`，比 AppDelegate 先接到。
- 正确做法：
  - 要走自己处理的菜单项，显式设 `item.target = self`，或者换一个 WKWebView 不实现的方法名。
  - 加完要实际点一次菜单，确认走到了自己的代码（比如打一行日志），不能只看页面有没有刷新。
  - 相关：WKWebView 退出、关窗时不触发 `beforeunload`，也不替页面弹离开确认（公开 API 没有对应的 UI 代理方法）。要保护页面里没保存的内容，就在 ⌘Q、⌘W、⌘R 之前自己在页面里派发一次 `beforeunload`，看 `defaultPrevented`，拦下了就弹原生确认框。
- 来源：personal-ai-workbench 2026-10-31（`desktop/app-shell/DigitalWorld.swift`，PR #45；交接 `docs/agents/handoffs/2026-10-31-claude-native-app-shell-676.md`。调试实测：未设 target 时，自己的处理执行次数为 0）。
- 出现过的项目：personal-ai-workbench（踩到，已修）；work-desk（`desktop/macos/NiumaHome.swift` 同样写法，未修，未实测）。
- 升级：未升级。
