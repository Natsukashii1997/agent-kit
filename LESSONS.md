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
