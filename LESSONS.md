# 跨项目的坑（全局 LESSONS）

各项目踩过、换个项目也成立的坑，Claude 和 Codex 共用这一份。排障、发布、改脚本、装 launchd 或定时任务之前，先搜一遍：`grep -n 关键词 /Users/nat/Documents/ChatGPT/个人/work/agent-kit/LESSONS.md`，再搜项目自己的 `docs/LESSONS.md`。

## 怎么写

- 只收换个项目也成立的坑：不依赖某个项目的业务、页面或发布脚本。只对某个项目成立的，留在那个项目的 `docs/LESSONS.md`。
- 从项目提升上来：写成 G-xx，编号只增不改；措辞去掉项目专有名词；「来源」写项目名、原条目号和能查的证据。原条目保留，加一行「提升：已提升为全局 G-xx（日期）」。
- 一条一个坑，写现象、根因、正确做法、来源、出现过的项目、升级（开头带层级词，见「怎么升级」）、触发。证据查不到就写「未核实」，不编。结论被推翻时改条目并注明日期，不删。
- 「触发」写碰到这条坑时命令或代码里会出现的词，每个词用反引号括起来、用顿号隔开；前后带 `/` 的按正则匹配（不分大小写）。装了 agent-kit 的 hook 后（见 [docs/机器执行层.md](docs/机器执行层.md)），Claude 和 Codex 执行的命令或要写的内容里出现这些词，就会自动收到这条坑的提醒。想不出可靠的词就写「无」并说明原因；词太宽会天天误报，宁缺毋滥。`node --test tests/*.test.mjs` 会检查每条都有「触发」一行、正则能编译。
- 踩到已有全局坑：在项目 `docs/LESSONS.md` 的新条目里写一行「再犯：G-xx」（多条用顿号隔开），全局条目的「出现过的项目」补上。每周汇总（`tools/weekly-review.mjs`）按这一行统计再犯，用来看升级后有没有起作用。
- 只出提案、用户批准才写：当轮交接里提，或由项目的每周整理（G 类）提。

## 怎么升级

文字被跳过时什么都不会失败，所以升级从最硬的一层往下找，文字放最后（借鉴 pstack 的 `/correct`，#57）。

- **什么时候升级**：同一条在第二个项目又被踩到（「出现过的项目」补上）；或者标着〔文字〕〔提醒〕的条目出现了「再犯」，每周汇总会把这类单列为「升级首选」。〔结构〕〔机检〕〔体检〕层的条目又再犯：先查现有机制有没有执行、为什么没拦住，能在同一层修好的先修；修不好再按下面重新选。
- **升到哪一层**：按下面顺序找第一个做得到的层，不要求逐级往上升（〔文字〕能直接做成〔结构〕就直接做）；条目的「升级」写明去处，没选更高的层时写一句为什么做不到。
  1. 〔结构〕让错误写不出来：改目录或接口边界、只留一种官方做法、删掉会被照抄的旧写法。
  2. 〔机检〕在命令执行、提交、合并或发布生效之前自动报错，报错里写出正确做法。测试只有接进必经的 CI、提交前或运行前检查才算这一层，只能手动跑的不算。去处：跨项目的写进起步骨架 `~/Documents/ChatGPT/个人/work/my-skills/skills/project-starter/skeleton/scripts/check-rules.mjs`（新项目一起步就带上）；执行命令时就能拦的写进 agent-kit 的 hook（见 [docs/机器执行层.md](docs/机器执行层.md)）；项目里的检查脚本、CI 测试也算。已经很常见的写法只拦新增的。
  3. 〔体检〕事后能被发现，适合「出事了没人发现」一类（定时任务没跑、失败记录没关、服务停了）：写进本机体检（launchd、Hermes 定时任务归 my-skills 的 automation-checkup；agent-kit 自己装的东西归 `tools/doctor.mjs`），写明哪一项检查。
  4. 〔文字〕只有机器判不了的判断题才停在这层：一句话硬约束同时写进 `~/.claude/CLAUDE.md` 和 `~/.codex/AGENTS.md`（同一句，先给 diff 让用户确认，仓库版在 `global/`），或写进起步骨架的模板。
- 〔提醒〕只有关键词提醒（「触发」一行）：每条都有的底线，不算升级；未升级和确认不升级的条目都标这个。
- **「升级」一行的写法**：开头是这五个层级词之一，后面写状态（未升级 / 不升级 / 部分升级 / 已升级 / 关闭）、日期、编号和去处；层级变了就改标签，原来的记录保留。`tests/lessons-remind.test.mjs` 会检查标签。层级只说明用什么机制，不说明管得多全：〔结构〕〔机检〕〔体检〕要写清范围（哪些项目、哪些写法）和不覆盖的部分；没管住这条坑的关键情形就写「部分升级」并写明缺口，每周汇总会把它显示成「部分」。
- **关闭**：坑本身已被代码消除（出错的写法、路径或接口已经不存在），不再需要升级时，状态写「关闭」。写法「〔层级〕关闭（日期，依据）：证据」：层级写现在靠什么守住——代码结构让它写不出来写〔结构〕，靠接进必经检查的测试守住写〔机检〕，靠回归测试守住、但测试没接进必经检查的写〔提醒〕；依据写常浩批准的出处（如「积压清单组 15」）；证据写核实到的文件、行号或测试名。原来的升级记录保留在后面（「此前：…」），不写「已升级，关闭」「部分升级，关闭」这类叠写。关闭的条目不进每周汇总的「升级首选」和「等批的提升」；关闭后又再犯的会单列出来，先核实关闭的依据还成不成立，不成立就撤回关闭，按上面重新选层。
- **新增机检要证明有用**：拿一次真实的历史错误让它报一次错，样本留在测试里；找不到真实样本就用构造样本，并在「升级」里注明「构造样本」。确有理由放过的，在出问题的那一行写豁免，带理由、到期日和常浩的批准。
- **升上去之后**：原来是〔文字〕的条目被〔结构〕或〔机检〕覆盖后，全局指令里那句缩成一行指针（同样先给 diff 让用户确认）。

---

## G-01 验证证据放 /tmp，被系统清理（2026-10-24 提升）

- 现象：验证用的备份、日志放在 `/tmp/…`，几天后整批找不到，无法追溯。
- 根因：macOS 会定期清理 `/tmp`。
- 正确做法：证据放项目约定的持久目录（如 `~/Library/Application Support/<项目>/evidence/<目录名>/`），位置写进项目 AGENTS.md；会话临时目录只放用完即弃的文件。
- 来源：work-desk L-02（`docs/history/CURRENT-through-20261022.md` 开头的 2026-10-23 补注）。
- 出现过的项目：work-desk。
- 升级：〔文字〕已升级（2026-11-07，#15）：全局指令「跨项目沉淀」的「全局坑硬约束」一句（`~/.claude/CLAUDE.md` 与 `~/.codex/AGENTS.md` 同一句，仓库版在 `global/`）。
- 触发：`/(^|[^\w/])\/tmp\//`（只认直接写到 /tmp/ 的路径；Claude 自己的临时目录 /private/tmp/claude-… 和 os.tmpdir() 不算）

## G-02 页面直接截取 ISO 时间字符串，把 UTC 当本地时间显示（2026-10-24 提升）

- 现象：页面上的时间按 UTC 显示，10:46 录入的显示成 02:46；同一写法在一个项目里先后出现 4 处。
- 根因：直接截取 ISO 字符串里的「月-日 时:分」，或把 `T` 换成空格；后端存 UTC 本身没错。
- 正确做法：显示一律经一个格式化函数按 `Asia/Shanghai` 转换（函数名写进项目 AGENTS.md 的规则），测试覆盖跨日、跨年；能机检就加检查规则。
- 来源：work-desk L-03（提交 `3200d0e`；2026-10-23 每周整理试跑又发现 3 处）。
- 出现过的项目：work-desk。
- 升级：〔机检〕已升级：起步骨架 `scripts/check-rules.mjs` 的 time 规则（project-starter 早已带上；2026-11-07 #15 补记）。范围：用了起步骨架 `check-rules.mjs` 的项目；只认已定义的写法，写法变体和没装这条规则的存量项目不覆盖。
- 触发：`/\.slice\(\s*(0\s*,\s*1[06]|5\s*,\s*16|11\s*,\s*16)\s*\)/`、`/replace\(\s*['"]T['"]\s*,\s*['"] ['"]/`

## G-03 改了脚本只做语法或单条路径验证，没跑全量测试（2026-10-24 提升）

- 现象：给发布脚本加了完整回读，只做了 bash 验证；另一个会话跑全量测试时才发现 4 项发布流程测试失败。
- 根因：有测试会截取脚本片段、给外部命令打桩后真实执行；新增的外部调用没有桩。
- 正确做法：改 `scripts/` 下任何脚本也跑全量测试；有测试截取脚本执行的，新增外部命令时在测试里补桩和断言。
- 来源：work-desk L-06（提交 `b5c212d` 引入，修复是测试里补的桩）。
- 出现过的项目：work-desk。
- 升级：〔文字〕已升级（2026-11-07，#15）：全局指令「跨项目沉淀」的「全局坑硬约束」一句（`~/.claude/CLAUDE.md` 与 `~/.codex/AGENTS.md` 同一句，仓库版在 `global/`）。
- 触发：`/scripts\/[^\s]+\.(sh|mjs|js|py)/`

## G-04 并行会话共用一个工作区，测试互相污染、提交带上别人的改动（2026-10-24 提升）

- 现象：跑全量测试带上了另一个会话没提交的半成品；整文件 `git add` 带上了别人几分钟前在同一文件里刚改的几处。
- 根因：两个会话同时在一个目录改代码；`git status` 刚核过是干净的，对方随后又改了。
- 正确做法：并行的会话各开独立 worktree。做不到时：测试记录写明「工作区含他人未提交改动」；提交只含自己的文件（`git commit -- <文件>`）；同一文件里有别人的改动时只暂存自己的块——`git diff -U0 <文件>` 看分块，把自己的块写成补丁 `git apply --cached`，或 `git show HEAD:<文件>` 加上自己的改动后 `git hash-object -w --stdin`、再 `git update-index --cacheinfo 100644,<哈希>,<文件>`；暂存后 `git diff --cached` 再核一遍。不用裸 `git stash`（各 worktree 共用一个 stash 栈）。
- 来源：work-desk L-07（2026-10-23 首次；2026-10-24 提交 `359ac18` 再犯）。
- 出现过的项目：work-desk。
- 升级：〔文字〕已升级（2026-11-07，#15）：全局指令「跨项目沉淀」的「全局坑硬约束」一句（`~/.claude/CLAUDE.md` 与 `~/.codex/AGENTS.md` 同一句，仓库版在 `global/`）。
- 触发：`git stash`、`git add -A`、`git add --all`、`git add .`

## G-05 launchd 里用 /bin/bash 读不了「文稿」下的脚本（2026-10-24 提升）

- 现象：任务装进 launchd 后一跑就退出码 126，日志只有一行 `Operation not permitted`；同一个脚本在终端里跑正常。
- 根因：macOS 隐私保护拦住 launchd 直接启动的 `/bin/bash` 读取 `~/Documents`；终端和 AI 会话有文稿访问权限，手动跑看不出来。
- 正确做法：要读 `~/Documents` 等受保护目录的 launchd 任务，借已有文稿权限的程序启动（如应用外壳里的 node），或把脚本和数据放到非受保护目录；装好后一定用 `launchctl kickstart` 真实触发一次再看日志，不能只在终端里试。
- 来源：work-desk L-08（`scripts/health-check.sh` 的 `--install`；证据 `~/Library/Application Support/NiumaHome/evidence/每日巡检-20261023/`）。
- 出现过的项目：work-desk。
- 升级：〔体检〕已升级：本机体检 automation-checkup 早已覆盖（程序在「文稿」等受保护文件夹时提示、退出码 126 解释；2026-11-07 #15 补记）。
- 触发：`launchctl`、`LaunchAgents`、`/\.plist\b/`

## G-06 PlistBuddy 找不到文件时把提示打到标准输出（2026-10-24 提升）

- 现象：读一个不存在的 plist，读出来的值是「File Doesn't Exist, Will Create: …」这串文字，后面的检查跟着报错。
- 根因：`PlistBuddy -c "Print …"` 遇到不存在的文件不报错退出，而是往标准输出打提示，`2>/dev/null` 挡不住。
- 正确做法：先 `[ -f "$plist" ]` 再读。
- 来源：work-desk L-09（`scripts/health-check.sh` 读数据目录那几行）。
- 出现过的项目：work-desk。
- 升级：〔提醒〕不升级（2026-11-07，#15，常浩确认）：平台或写法上的个例，只保留关键词提醒；同一条在第二个项目再踩到时重新评估。
- 触发：`PlistBuddy`

## G-07 本机服务只监听 127.0.0.1，仍挡不住浏览器里任意网页发来的请求；加了来源校验，开发代理又会让本机开发页被误拦（2026-10-24 提升，2026-11-19 并入 work-desk L-18）

- 现象：
  - Host + Origin 校验只挂在一组接口上；其余 POST 没有校验，浏览器里任何网页都能向本机端口发简单 POST，触发拉外部数据、调模型、写库。
  - 校验放到入口后，开发页（Vite）发出的写请求全部被拒（`ORIGIN_REJECTED`）；同一份构建由服务端口直接托管时正常。读接口不受影响，只看页面显示发现不了（work-desk L-18）。
- 根因：横切的保护写在模块里，没有放到入口统一做；只监听 127.0.0.1 挡得住别的机器，挡不住本机浏览器。开发代理写成字符串简写（`proxy: { "/api": api }`）时，Vite 把它展开成 `changeOrigin: true`，转发时 Host 被改成服务端口，和 Origin（开发页端口）对不上；服务里「开发代理会保留页面 Host」的注释与实际不符。
- 正确做法：
  - 来源校验（Host 是本机、Origin 同源）、正文大小上限、统一错误响应放服务入口，对全部写接口生效；模块里只做自己的业务校验（如配对码）。
  - 有开发代理的，代理写成对象并 `changeOrigin: false`，让 Host 保留页面的端口；改不了代理时，在开发页测写入流程前先用 `curl -X POST -H 'Origin: http://127.0.0.1:<开发端口>' http://127.0.0.1:<开发端口>/api/…` 确认不被拦，被拦就改用构建后由服务端口直接打开页面（同源）来测。不要为开发页放宽来源校验。
- 来源：work-desk L-11（`server/http.mjs` 的 `checkOrigin`、`tests/request-guard.test.mjs`）；work-desk L-18（2026-11-08，#30，`b25c138`；`CURRENT.md`「批 1·1d 策略页」一节「验证」行有 `curl` 复现）。
- 出现过的项目：work-desk（2 次）。
- 升级：〔机检〕已升级（2026-11-07，#15）：起步骨架 `scripts/check-rules.mjs` 新增 origin 规则（开了 `.listen(` 的文件里找不到 Origin/Host 校验就报），见 my-skills#49 / PR #50。范围：用了起步骨架 `check-rules.mjs` 的项目；只认已定义的写法，写法变体和没装这条规则的存量项目不覆盖。有 Origin/Host 相关代码，不等于每个写接口都校验对了。2026-11-19 并入的开发代理改写 Host（work-desk L-18）不在这条规则范围内，只有关键词提醒（`changeOrigin`）；work-desk 的 `vite.config.js` 改不改另问常浩。
- 触发：`.listen(`、`createServer(`、`changeOrigin`

## G-08 `set -u` 脚本里可选开关裸引用，变量不设就整段退出（2026-10-24 提升）

- 现象：脚本开头 `set -uo pipefail`，可选开关写成 `[ -n "$OPT" ]`；正常运行不带这个变量，前面的检查全过，到这一步报 `unbound variable` 退出，被判成失败。
- 根因：只跑了 `bash -n` 和设了开关的那条路径；`bash -n` 只查语法，查不出 `set -u` 下的未定义引用。
- 正确做法：可选开关一律写 `${OPT:-}`；改带 `set -u` 的脚本后，开关设与不设各跑一遍。
- 来源：work-desk L-12（`~/Library/Application Support/NiumaHome/evidence/全面优化-20261023/release.log`；修复提交 `359ac18`）。
- 出现过的项目：work-desk。
- 升级：〔机检〕已升级（2026-11-07，#15）：起步骨架 `scripts/check-rules.mjs` 新增 optional-var 规则（带 `set -u` 的脚本里 `[ -n "$X" ]` / `[ -z "$X" ]` 没写 `${X:-}` 就报），见 my-skills#49 / PR #50。范围：用了起步骨架 `check-rules.mjs` 的项目；只认已定义的写法，写法变体和没装这条规则的存量项目不覆盖。
- 触发：`/\bset -[a-z]*u/`

## G-09 改界面时把原有强调色、状态样式改没了（2026-10-24 提升）

- 现象：改一个组件的高亮条件，连带把另一个状态下的强调色（底线、图标、时间）全改成了默认色，用户明确不满。
- 根因：改条件时没看清它还影响哪些类名、状态和颜色。
- 正确做法：只动用户点名的部分；改已有组件前先看清会影响哪些类名、条件、颜色；改前截图，改完对照截图逐项核对颜色与强调。
- 来源：work-desk L-01（用户 2026-10-18 当面反馈；对应提交未核实）。
- 出现过的项目：work-desk。
- 升级：〔提醒〕不升级（2026-11-07，#15，常浩确认）：平台或写法上的个例，只保留关键词提醒；同一条在第二个项目再踩到时重新评估。
- 触发：无（界面改动太泛，靠人记）

## G-10 外部只读来源每次现读，页面每次打开都要等（2026-10-24 提升）

- 现象：一个读飞书的页面每次打开要等 3.7 秒（其余只读接口都在 30 毫秒内）；另一处解析结果只放内存，服务重启后第一次打开又要等外部读完。
- 根因：读外部来源时没有落库快照，也没有「先回旧数据、后台刷新」。
- 正确做法：接外部只读来源一律落快照：页面先回旧快照，过期了后台刷新；只有用户点「刷新」才现读，不让用户等外部来源。
- 来源：work-desk L-10（`docs/handoff/UI与功能审核-20261023/审核记录.md` 第 3、4 条；`tests/mentor-snapshot.test.mjs`、`tests/reports-persist.test.mjs`）。
- 出现过的项目：work-desk。
- 升级：〔提醒〕不升级（2026-11-07，#15，常浩确认）：平台或写法上的个例，只保留关键词提醒；同一条在第二个项目再踩到时重新评估。
- 触发：`feishu`、`larksuite`

## G-11 无头 Chrome、隐藏的浏览器面板里，截图与合成事件不可靠：样式没加载完、动画停在半路、焦点事件不发（2026-10-24 提升，2026-11-19 并入 postpane L-29）

- 现象：
  - 用 `--headless=new --screenshot --virtual-time-budget=…` 截图，有的页面 `@import` 进来的样式没生效、有的图没画出来，同一命令重跑结果不一样；用 `el.focus()` + 合成 `KeyboardEvent` 核对键盘交互，页面的 focus 处理根本没触发，截出来的状态和真实按键对不上。
  - AI 会话内置的浏览器面板隐藏时（会话没在窗口里打开，人在手机上），截到的组件停在动画半路，像是位置和尺寸算错了，读元素的实际位置却是对的；按截图坐标点击落在按钮外，像是按钮没反应；脚本里等 `requestAnimationFrame` 超时，性能观察器也不报（postpane L-29）。
- 根因：`--virtual-time-budget` 只给虚拟时间设上限，不保证 `@import` 链、字体和模块里的异步请求都完成；页面不在前台（`document.hasFocus()` 为假）时，程序调 `focus()` 只改 `activeElement`，不发 focus / focusin 事件。隐藏的面板按后台页处理，`requestAnimationFrame` 被节流甚至完全暂停，动画停在中途；截图的坐标框架和模拟视口对不上。
- 正确做法：
  - 要等页面画完再截的图，用调试协议（`--remote-debugging-port` + `Runtime.evaluate` 轮询「目标元素已画出 + `document.fonts.status === "loaded"`」，再 `Page.captureScreenshot` 按元素区域截）；键盘、鼠标交互一律用真实输入（`Input.dispatchKeyEvent` / `Input.dispatchMouseEvent`，或浏览器里的真实按键），不拿合成事件的结果当证据。
  - 用 AI 会话内置的浏览器面板验证时，先看面板是否隐藏（Claude 的 `tabs_context` 会写 hidden）。隐藏时不用截图判断位置、尺寸和动画结果，改读 `getBoundingClientRect()`（它本身会强制排版，不用等帧；要等就用 `setTimeout`，不等 rAF）；点击先用 `find` 拿元素引用再按引用点，不按截图坐标；不在隐藏面板里测性能。能把面板显示出来就先显示。
- 来源：work-desk L-13（`~/Library/Application Support/NiumaHome/evidence/折线图数值与悬停-20261024/` 的 `cdp-shot.mjs`、`cdp-debug.mjs`）；postpane L-29（2026-11-08，#243 `a392686`，补充 #247、#259、#264；证据 `~/Library/Application Support/postpane/evidence/2026-11-08-narrow-tag/`、`evidence/2026-11-08-go-start/preview-check.md`）。
- 出现过的项目：work-desk、postpane。
- 升级：〔文字〕已升级（2026-11-07，#15）：全局指令「跨项目沉淀」的「全局坑硬约束」一句（`~/.claude/CLAUDE.md` 与 `~/.codex/AGENTS.md` 同一句，仓库版在 `global/`）。2026-11-19 并入的隐藏面板一点只写在本条：全局指令那句「截图验证要等页面画完」大体覆盖，没改它；浏览器面板的操作不经过 Bash 和改文件，关键词提醒也看不到。
- 触发：`--headless`、`--screenshot`、`virtual-time-budget`、`new KeyboardEvent`

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
- 升级：〔文字〕已升级（2026-11-07，#15）：全局指令「跨项目沉淀」的「全局坑硬约束」一句（`~/.claude/CLAUDE.md` 与 `~/.codex/AGENTS.md` 同一句，仓库版在 `global/`）。
- 触发：`nohup`、`disown`、`/sleep\s+\d{4,}/`、`kern.boottime`

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
- 另见：G-29（测试、故障注入、反向验证碰到正式环境的总条目，2026-11-18）；本条是其中「故障注入在正式凭证里留下状态」的一种。
- 升级：〔体检〕已升级：数字分身每日巡检 `ops/health_check.py` 的回退模型与 Codex 凭证检查早已覆盖，提示里直接指向本条（2026-11-07 #15 补记）。
- 触发：`hermes auth`、`model_cooldowns`

## G-14 删了一次性探针定时任务，它失败留下的记录还在，巡检第二天误报（2026-10-28 新增）

- 现象：为了验收，在智能体框架（Hermes）里建了几个只跑一次的探针定时任务，其中两个失败。之后任务删了，但第二天巡检仍报「定时任务有未处理的失败记录」；告警文字只截到命令输出的表格边框，看不出是哪条。
- 根因：两层。① 框架把定时任务失败单独记成失败记录（Hermes 是 `hermes cron incidents`），删任务不会删记录，记录要手动确认才关闭。② 巡检跑的是不带筛选的列表命令，已确认关闭的记录也会列出来，巡检把“有输出”当成“有问题”；这条判断规则当初只用“没有记录”的情况测过。
- 正确做法：
  - 删一次性探针或测试任务时，先查它有没有留下失败记录，有就确认关闭（Hermes：`hermes cron incidents ack <id>`），再删任务；验收记录里写明已关闭。
  - 巡检判断“有没有未处理的问题”时，按状态筛选只看未处理的（Hermes：`--state detected`、`--state alerted`），不靠列表命令有没有输出；告警写条数和第一条的报错摘要。
  - 巡检规则的自测要覆盖“只有已处理记录”这种情况，不只测空列表和有问题两种。
- 来源：digital-twin 2026-10-28（`CURRENT.md`「首日运行核对；巡检定时任务误报修复」一节；修复 PR #24 `38a8b7e`）。
- 出现过的项目：digital-twin。
- 升级：〔体检〕部分升级（2026-11-07，#15）：数字分身每日巡检会报未处理的失败记录，但不区分是否属于已删除的任务；补这一项见 digital-twin#62。
- 触发：`hermes cron`

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
- 升级：〔提醒〕不升级（2026-11-07，#15，常浩确认）：平台或写法上的个例，只保留关键词提醒；同一条在第二个项目再踩到时重新评估。
- 触发：`codesign`、`.app/Contents`、`ApplicationIcon`

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
- 升级：〔提醒〕不升级（2026-11-07，#15，常浩确认）：平台或写法上的个例，只保留关键词提醒；同一条在第二个项目再踩到时重新评估。
- 触发：`Cache-Control`、`no-cache`

## G-17 WKWebView 窗口壳的「重新载入」菜单被 WKWebView 自己接走，外壳写的处理不执行（2026-10-31 新增）

- 现象：原生窗口壳的「重新载入」（⌘R）菜单项，action 是 `reload:`，target 留空。外壳在 AppDelegate 里写的 `reload(_:)`（例如先做离开确认）从不执行，页面直接刷新了，看起来像功能正常。
- 根因：target 为空时，菜单动作沿响应链找第一个能响应的对象。WKWebView 是第一响应者，它自己就实现了 `reload:`，比 AppDelegate 先接到。
- 正确做法：
  - 要走自己处理的菜单项，显式设 `item.target = self`，或者换一个 WKWebView 不实现的方法名。
  - 加完要实际点一次菜单，确认走到了自己的代码（比如打一行日志），不能只看页面有没有刷新。
  - 相关：WKWebView 退出、关窗时不触发 `beforeunload`，也不替页面弹离开确认（公开 API 没有对应的 UI 代理方法）。要保护页面里没保存的内容，就在 ⌘Q、⌘W、⌘R 之前自己在页面里派发一次 `beforeunload`，看 `defaultPrevented`，拦下了就弹原生确认框。
- 来源：personal-ai-workbench 2026-10-31（`desktop/app-shell/DigitalWorld.swift`，PR #45；交接 `docs/agents/handoffs/2026-10-31-claude-native-app-shell-676.md`。调试实测：未设 target 时，自己的处理执行次数为 0）。
- 出现过的项目：personal-ai-workbench（踩到，已修）；work-desk（`desktop/macos/NiumaHome.swift` 同样写法，未修，未实测）。
- 升级：〔提醒〕不升级（2026-11-07，#15，常浩确认）：平台或写法上的个例，只保留关键词提醒；同一条在第二个项目再踩到时重新评估。
- 触发：`WKWebView`、`reload:`

## G-18 launchctl bootout 返回时任务还没卸完，马上 bootstrap 报「Bootstrap failed: 5」，任务没装回去（2026-11-03 新增）

- 现象：重装 launchd 任务的脚本先 `launchctl bootout gui/<uid>/<label>`，紧接着 `launchctl bootstrap gui/<uid> <plist>`，偶尔报 `Bootstrap failed: 5: Input/output error`；脚本开了 `set -e` 就此停下，任务处于「已卸下、没装回」状态。常驻服务（KeepAlive 的网站等）因此停掉，`launchctl print` 显示 `Could not find service`。手动再 bootstrap 一次就好，所以容易当成偶发。
- 根因：bootout 是异步的，命令返回时旧任务（尤其要等进程退出的常驻服务）可能还在卸载中，这时 bootstrap 同一个 label 会失败。
- 正确做法：
  - bootout 之后用 `launchctl print gui/<uid>/<label>` 轮询，等它查不到了再 bootstrap（例如每 0.5 秒查一次，最多 10 秒）。
  - bootstrap 失败隔几秒重试几次；都失败就非零退出，并写明 plist 已写好、怎么手动 bootstrap，别让服务悄悄停着。
  - 重装完 `launchctl print` 看每个任务都在、常驻服务 state = running，再真实触发一次（同 G-05）。
- 来源：github-center 2026-11-03（`scripts/schedule.sh install` 重装时网站任务没装回、停了几十秒，手动 bootstrap 恢复；修复 PR #45，用假 launchctl 复现旧脚本失败、新脚本通过）。
- 出现过的项目：github-center（踩到，已修）。
- 升级：〔体检〕已升级：本机体检 automation-checkup 的「没加载，不会运行」检查早已覆盖结果（任务没装回会被报出；2026-11-07 #15 补记）。
- 触发：`launchctl bootout`、`launchctl bootstrap`

## G-19 launchd 起的服务读不到终端里的代理变量，直连被 DNS 污染，请求一直超时（2026-11-05 新增）

- 现象：同一个智能体框架（Hermes）的两个常驻网关，一个正常回复，另一个（后来新建的 profile）收到飞书消息后一直不回；日志里卡在调用模型接口（chatgpt.com），先是长时间无响应再报 `APITimeoutError` 反复重试。在终端里 `curl` 同一个地址却很快返回，容易误判成模型服务抽风。查进程连接能看到它在连 Facebook / Twitter 的 IP（`2a03:2880:…`、`199.16.156.11`）。2026-11-07 又踩一次：另一个会话执行 `hermes gateway restart` 后，猛鬼兽网关的 plist 被重写、代理丢失，主模型连接超时（`ConnectTimeout`），对话回退到 deepseek-flash；Codex 额度其实充足。
- 根因：launchd 任务不继承终端 shell 的 `HTTPS_PROXY` 等变量，只认 plist 里 `EnvironmentVariables` 写的。正常那个网关的 plist 是手动加过代理变量的；新 profile 的 plist 由框架自动生成，没有代理变量，于是直连，而系统 DNS 把被墙域名解析成了污染地址。终端里有代理变量，所以手测是好的。另外，`hermes gateway restart/start/install` 和 `hermes update` 每次都会把现有 plist 和 Hermes 模板比对，只忽略 PATH，不一致就整份重写（`hermes_cli/gateway_launchd.py` 的 `refresh_launchd_plist_if_needed`），所以手工加进 plist 的变量一定会被冲掉。
- 正确做法：
  - 排查「终端里好、常驻服务里不好」的网络问题，先比两边的环境：看服务 plist 的 `EnvironmentVariables` 里有没有代理变量，只列变量名（`/usr/bin/python3 -c 'import plistlib,sys; print(sorted((plistlib.load(open(sys.argv[1],"rb")).get("EnvironmentVariables") or {})))' <plist>`），不用 `ps eww`、`launchctl print` 看进程或服务的环境（会连值一起打出登录令牌，G-42）；`lsof -nP -a -p <pid> -i TCP` 看它实际连到哪个 IP。
  - 需要走代理的 launchd 服务，在 plist 的 `EnvironmentVariables` 里写全大小写两套：`HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` 和 `https_proxy`/`http_proxy`/`no_proxy`；国内直连的域名（如 `.feishu.cn`）放进 `NO_PROXY`。改完先 `plutil -lint`，再重装（按 G-18 等 bootout 卸完再 bootstrap）。
  - 框架自动生成或重装 plist（新建 profile、`gateway install` 之类）后，回读一遍代理变量还在不在；同一台机器上多个同类服务的环境变量要对齐。
  - Hermes 网关的代理同时写进对应 profile 的 `.env`（`~/.hermes/.env`、`~/.hermes/profiles/<名>/.env`），以 `.env` 为准：网关启动时会把它读进进程环境并覆盖已有值，plist 被重写也不丢。只想重启进程、不想动 plist 时，用 `launchctl kickstart -k gui/<uid>/<label>`，不用 `hermes gateway restart`。
- 来源：Hermes 亚古兽网关 2026-11-05（本机服务，没有项目仓库；改前备份 `~/.hermes/backups/ai.hermes.gateway-agumon.plist.bak-20261105`；补代理变量并重启后，那条卡住的消息 4.6 秒回复成功）。
- 出现过的项目：Hermes 本机网关（踩到 2 次，都已修；第 2 次见 #17，改前备份 `~/.hermes/backups/ai.hermes.gateway.plist.bak-20261107`，`.env` 备份在同一目录）。
- 升级：〔体检〕部分升级（2026-11-20，复盘提案 P9，#101；digital-twin#249、my-skills#113）：digital-twin 每日巡检 `ops/health_check.py` 每天 09:45 查猛鬼兽、亚古兽两只 Hermes 网关 plist 的 `EnvironmentVariables` 里大小写两套代理变量齐不齐，缺了发飞书，并说明对应 `.env` 有没有兜底；my-skills `automation-checkup` 对配置里 `proxy_labels`（默认 `ai.hermes.gateway*`）列的服务做同样检查。范围：只核对 plist 里的变量名，不读值、不读进程环境（G-42）。缺口：别的要走代理的 launchd 服务要加进 `proxy_labels` 才查；不验证代理本身通不通；`hermes gateway restart` 重写 plist 这个动作本身拦不住，要等第二天巡检才发现。此前：〔文字〕已升级（2026-11-07，#15）：全局指令「跨项目沉淀」的「全局坑硬约束」一句（`~/.claude/CLAUDE.md` 与 `~/.codex/AGENTS.md` 同一句，仓库版在 `global/`）。
- 触发：`HTTPS_PROXY`、`https_proxy`、`EnvironmentVariables`、`gateway install`

## G-20 Mac 睡眠时定时任务照样“在跑”，但慢到被自己的超时或租约强制中断（2026-11-07 新增）

- 现象：每周一 07:45 的 Hermes 周报定时任务晚了半小时才派发，跑起来后每次调用模型都显示等 5–7 分钟（模型实际只回几十个字），最后一次等了 934 秒，报 `Operation interrupted: waiting for model response` 失败；日志里紧挨着一行 `Session turn lease refresh stayed locked through its lifetime`。同一周的日报第一次调用模型也等了 15–17 分钟，只是调用次数少，侥幸跑完。看起来像模型服务或网络抽风，换个时间手动跑又一切正常。
- 根因：Mac 当时用电池（电量 10%）处于睡眠，只在系统每隔约 5 分钟的维护唤醒（`DarkWake`）里醒几秒。进程只在这几秒里往前走，于是每次网络请求、每次计时都被拉长到几分钟；框架给会话的租约每 300 秒要续一次，睡眠期间续不上，过期后框架为保护对话记录强制中断。这台机器的电源设置是插电不睡、用电池 1 分钟没操作就睡，所以只在没插电的早上出事。
- 正确做法：
  - 定时任务报超时、调用耗时成倍变长、派发明显晚点时，先看失败时段机器醒没醒：`pmset -g log | grep -E "^<日期> <小时>:" | grep -E "Sleep|Wake|DarkWake"`，有成串的 `DarkWake` / `Maintenance Sleep` 就是在睡，不用再查模型和网络。
  - 当前电源设置看 `pmset -g custom`（分电池、插电两套），定时唤醒看 `pmset -g sched`。
  - 要在固定时间可靠跑完的任务，要求那个时间机器插着电、没合盖；做不到时由用户自己设定时唤醒（如 `sudo pmset repeat wakeorpoweron M 07:40:00`，改系统设置要用户亲手执行），但电量低时唤醒后很快又会睡，插电仍是最稳的办法。
  - 交给智能体跑的长任务尽量减少来回调用次数：同样被睡眠拖慢，调用少的任务能跑完，调用多的会撞上租约或超时。
  - 失败后别只等下一期：这一期漏掉的产出要么补跑，要么在记录里写明不补，避免以为已经有了。
- 来源：Hermes 本机定时任务 2026-11-02（本机服务，没有项目仓库；`~/.hermes/logs/agent.log` 当天 08:30–09:14 的 API 调用耗时与租约中断记录，`~/.hermes/cron/output/6a976baa2632/2026-11-02_09-14-00.md`，`pmset -g log` 当天 07:00–09:14 的睡眠记录；租约时长见 `hermes-agent/agent/turn_facade_lease.py` 的 `LEASE_TTL_SECONDS = 300`）。agent-kit#31。
- 出现过的项目：Hermes 本机定时任务。
- 升级：〔体检〕已升级（2026-11-20，复盘提案 P9，#101；digital-twin#249、my-skills#113）：my-skills `automation-checkup` 报 launchd 任务「X 天 / 小时没跑」、Hermes 定时任务失败、过点没跑、晚点 ≥ 10 分钟时，脚本自动读 `pmset -g log`，附那段时间睡着多久、最长一段和维护唤醒次数，睡着占一半以上就把「怎么办」换成睡眠的说法，读不到时写明；digital-twin 每日巡检 `ops/health_check.py` 对两只机器人 `jobs.json` 里最近 24 小时晚点 ≥ 10 分钟或失败的定时任务附同样的记录。范围：本机 launchd 和 Hermes 定时任务；关机期间的仍要 `last shutdown` 人工查。digital-twin 另把唤醒后的网络等待收成共用模块 `netwait`（项目坑 L-03），定时任务开跑前先等代理通。此前：〔提醒〕未升级。
- 触发：`pmset`、`DarkWake`、`/waiting for model response/`、`/turn lease/`

## G-21 从程序里跳去本机另一个应用，用 https 链接被默认浏览器在后台接走，目标应用不出来（2026-11-07 提升）

- 现象：程序里给一行加了「点一下跳到某应用里的某个聊天 / 文档」，自查页里点击送出的参数全对，实机点了却「没反应」：前台还是原来的应用，目标应用没出来。
- 根因：跳转用的是那个应用官方的 https 链接（如 `https://applink.feishu.cn/client/chat/open?openChatId=…`），`open` 把它交给系统默认浏览器（这台是 Chrome），浏览器在后台开了个标签页，目标应用根本没被叫起来。同一个应用注册的不同协议表现也不同：飞书的 `lark://` 也没把它叫到前台，`feishu://applink.feishu.cn/…` 才会，并且打开到了对的聊天。只看「送出了什么」的测试验不出这一层。
- 正确做法：
  - 跳去本机应用，优先用它自己注册的协议：查 `plutil -extract CFBundleURLTypes json -o - "/Applications/<应用>.app/Contents/Info.plist"` 里的 `CFBundleURLSchemes`，挨个用 `open "<协议>://…"` 试，选能把应用叫到前台并打开到位的那个。
  - 代码里先确认这个协议有人认领（macOS 用 `LSCopyDefaultApplicationURLForURL`），没装这个应用时才退回 https 链接。
  - 验收「跳转」要看目标应用有没有到前台、打开到哪里：`osascript -e 'tell application "System Events" to get frontmost of (first process whose bundle identifier is "<bundle id>")'` 看到前台；打开到哪个页面请用户目视，或拿到该应用的截图授权。
- 来源：postpane L-22（`docs/LESSONS.md`，#198；本机三次实测：`open https://…`、`open lark://…` 后前台仍是原应用，`open feishu://…` 后飞书 `frontmost` 为 `true`，常浩确认打开的是那个群）。
- 出现过的项目：postpane。
- 升级：〔提醒〕未升级。
- 触发：`applink`、`CFBundleURLSchemes`、`LSCopyDefaultApplicationURLForURL`、`/deep ?link/`

## G-22 把「请求发出去了」当成「成功」，界面随即改状态，用户没到那里也拿不回来（2026-11-08 提升）

- 现象：点「跳到会话」「回答审批」「把话发出去」这类按钮，界面立刻收起提醒、删掉草稿或标成已送达，可目标应用没切过去、客户端没收到、对方没拿到。东西没了，用户以为是卡了。
- 根因：成功判定对准的是「请求已经交出去」：命令退出码为 0、消息投进了通道、后台线程已开始。真正的结果（目标到了前台、回答进了客户端、话进了对话）没人核对。几种常见变体：找不到真正目标时退一步只叫起应用，照样报成功；先返回成功、再在后台线程里慢慢做；超时后对方的迟到确认被丢掉；连接对不处理的请求无声断开，对端把它当成服务退出而反复重连。界面上的失败提示组件没挂在出错的那个窗口里，更难发现。
- 正确做法：
  - 「做完就改界面状态」的动作，成功判定对准用户可见的结果；只确认了请求发出的，一律按未成功处理：保留原状态、在原地写明原因、几秒后允许重试。
  - 找不到真正目标时报原因，不用「至少把应用叫起来」凑成功。
  - 异步做完的事，先报「进行中」，做完再改状态；迟到的确认要能对回原请求。
  - 对外连接要么给回应，要么只在自己确实退出时才无声断开。
  - 失败提示放在用户正在看的那个窗口里。验收时照 G-21 看目标有没有真的到前台、打开到哪里。
- 来源：postpane L-25（`docs/LESSONS.md`，postpane#227、#228、#230；全操作审核汇总在本机 `~/Library/Application Support/postpane/evidence/2026-11-07-ops-audit/汇总.md`，本机最近 100 个会话里 57 个会走「只叫起应用算成功」）。
- 出现过的项目：postpane。
- 升级：〔提醒〕未升级。
- 触发：无（这类坑出现在任何「做完就改状态」的代码里，没有可靠的固定词，宁缺毋滥）。

## G-23 几个 worktree 共用 CARGO_TARGET_DIR，测试跑的是别的 worktree 编出的代码（2026-11-08 提升）

- 现象：几个 worktree 并行改同一个 Rust 工作区，为省磁盘共用一个构建目录。测试照样全绿，但通过总数没算上自己新加的测试；或者红测试报 `running 0 tests`；或者编译报找不到自己刚加的函数。
- 根因：同名 crate 在不同目录编出的产物文件名哈希相同，cargo 判断要不要重编只看 dep-info 里记的源文件路径和修改时间，记的是上一次编译它的那个 worktree 的路径。于是一个 worktree 的改动被当成「已编」，测试跑的是别人的代码。
- 正确做法：
  - 并行 worktree 各用自己的构建目录。
  - 磁盘不够非共用不可时，每次跑测试前把本 worktree 的 `.rs`、`Cargo.toml` 修改时间改到未来（`find . \( -name '*.rs' -o -name Cargo.toml \) -not -path './target/*' -exec touch -t <未来时间> {} +`），并核对三件事：输出里有本 worktree 路径的 `Compiling` 行、新测试名出现且通过、通过总数等于基线加新增条数。
  - 多个 PR 连着合并后，在主目录用 main 自己的构建目录跑一次全量再发布。
- 来源：postpane L-26（`docs/LESSONS.md`，postpane#235；`~/Library/Application Support/postpane/evidence/2026-11-07-fix-220/main-f441f73-cargo-test.log` 主目录补验 765 = 761 + 4，而共享目录那次报 761）。
- 出现过的项目：postpane。
- 升级：〔提醒〕未升级。
- 触发：`CARGO_TARGET_DIR`

## G-24 Claude 桌面版回收空闲会话的进程，打开会话也不会重新跑起来（2026-11-09 提升）

- 现象：程序往 Claude 桌面版的某个会话留话（插件队列、待发送目录），会话空闲一会儿后话就再也没人领：插件签到停了或写着已结束，排队的话一直不动。去桌面版里点开这个会话、或打开它的 `claude://…/local_…` 链接，界面出来了，话还是没被领走。
- 根因：两层。① 内存紧张时桌面版主动停掉空闲会话的 Claude Code 进程，日志 `~/Library/Logs/Claude/main.log` 记 `[CliGovernor] pressure evicting local_… (idle Ns)` 和 `Pausing session … (governor_evict)`；空闲超时（1800 秒）也会断开。后台任务在跑也算空闲。② 点开会话或打开链接，桌面版只做 `Warming session`（预热），不重启进程；要有一条消息发进去，它才重启进程（`Resuming session`），插件才重新签到、领话。
- 正确做法：
  - 不要指望「会话还开着」或「让人点开会话」：先看插件签到，写着已结束或很久没签到，就当进程已停。
  - 要让它接着干活，就用 `claude -p --resume <CLI 会话号> --permission-mode <会话自己的模式>` 在后台续接。工作目录、模型、思考强度、权限模式从桌面版的会话记录 `~/Library/Application Support/Claude/claude-code-sessions/**/local_*.json`（`cliSessionId` 对上）取。只在不需要人点允许的模式（auto、acceptEdits、bypassPermissions）下续接，其余交还给人。之后桌面版接着用同一个会话号，看得到续接的那一轮。
  - 先撤回已排队的话再续接，撤回不了（已被领走）就不续接，防止同一段话送两遍。
- 来源：postpane L-14 补正（`docs/LESSONS.md`，postpane#175、PR #177）；证据 `~/Library/Application Support/postpane/evidence/2026-11-07-{bg-wait,link-wake,headless-resume}/`（日志摘录、打开链接只预热、后台续接 12 秒完成），实机全流程 `~/Library/Application Support/postpane/evidence/2026-11-09-wake-live/watch.log`（停进程后 ChatGPT 判需修改，后台续接改完交回复审，通过）。
- 出现过的项目：postpane。
- 升级：〔提醒〕未升级。
- 触发：`CliGovernor`、`governor_evict`、`claude-code-sessions`、`/claude -p --resume/`

## G-25 Claude 桌面版里 Bash 被内置「危险 rm」检查要求批准，批准没地方点，约 16 分钟后会话被判 stopped responding（2026-11-09 提升）

- 现象：bypass 模式的会话里，一条 Bash 一直不返回，约 16 分钟后弹「Claude Code stopped responding」，只能点 Try again。命令一行都没执行。`~/Library/Logs/Claude/main.log` 里是 `timed out after 960~1016s of inactivity … last_tool_name=Bash … outstanding_host_request=none`。
- 根因：三环。
  - ① Claude Code 内置的危险 rm 检查在 bypass 下也要求人工批准。会触发它的写法有两类：rm 的目标拿不准（变量加通配符、整目录通配、可能为空的变量、命令替换；先 `cd` 到工作目录外或有 `source` 时更容易被拦，同样的写法其他时候能过）；命令里有它解析不了的写法（两个美元符加左括号、两个反斜杠加美元符加左括号）。
  - ② 本机配了 PermissionRequest 钩子（如驿窗）时，批准请求先交给钩子，桌面版窗口不弹；钩子一直不回，就没地方能批。
  - ③ 桌面版对一轮对话约 960 秒没动静就掐断。
- 正确做法：
  - rm 目标里的变量写成 `"${X:?}"`（变量为空时 shell 直接报错、不去删）；通配收窄到文件类型或写明文件名；确实要清空目录就按字面路径删目录再重建。
  - 要嵌代码或长文本，先用 Write 写成文件再执行，不放进 heredoc 或引号。
  - 不要绕过检查（拆开删、换别的工具删）；改写后删的范围不能变大。
  - 弹了「stopped responding」，先在 `main.log` 搜 `timed out after`，看 `last_tool_name` 和 `outstanding_host_request`。
- 来源：postpane L-37、L-41；agent-kit#49（PR #50）。近 14 天会话记录 66280 条 Bash，30 条被这个检查拦、11 条卡到会话断开；证据 `~/Library/Application Support/agent-kit/evidence/2026-11-09-49-bash-precheck/`（26 条真实 Claude Code 探针、装机前后两次端到端记录、语料评估）。
- 出现过的项目：postpane、carvomoto；语料里 work-desk、github-center、my-skills、personal-ai-workbench 的会话也被拦过。
- 升级：〔机检〕机器拦截，`hooks/bash-precheck.mjs`（#49）在执行前当场拒绝这几类写法并给出改写；`tools/doctor.mjs` 查装没装、实跑一次。
- 触发：`stopped responding`、`timed out after`、`outstanding_host_request`

## G-26 改了 AI 工具的人设或配置（Hermes 的 SOUL、Codex 的 MCP 批准配置），重启后已在进行的会话仍用旧的（2026-11-12 提升，2026-11-19 并入 postpane L-38）

- 现象：
  - 给 Hermes 的 profile 装了新的 `SOUL.md`、`workspace/HERMES.md`，`launchctl kickstart -k` 重启网关、日志里飞书已连上，在飞书私聊发一句话实测，回答还是旧人设的样子，容易误判成「装上了、生效了」或「新人设没用」。
  - 在 `~/.codex/config.toml` 给一个 MCP 工具加了 `approval_mode = "approve"`，已经开着的 Codex 线程调这个工具照样要批准；用 `codex exec` 新开进程做对照，设成什么都直接执行，分不出差别（postpane L-38）。
- 根因：
  - Hermes 为了命中模型的提示缓存，对还在继续的会话直接沿用这个会话第一次存下的系统提示（`agent/conversation_loop.py` 的 `_restore_or_build_system_prompt`；存在 `state.db` 的 `system_prompts` 表，`sessions.system_prompt_hash` 指过去），不重新读 SOUL 和规程。飞书私聊长期落在同一个会话里（这次那个会话从 11-02 开到 11-12），所以重启网关也不换。只有新会话（`/new`、`/reset`，或按重置策略过期）才按新文件重建。
  - Codex 按线程记下 MCP 工具的配置，已开的线程不重读；app-server 进程不用重启，在它里面新开线程就生效。`codex exec` 没有交互批准，不论怎么设都直接执行，拿它做对照没有意义。
- 正确做法：
  - 改完人设、规程或工具配置，验收前先开新会话或新线程（Hermes 在对应渠道发 `/new`；Codex 新开一个线程），再用真实的工作问题测，不用「你好」这类测不出差别的话。对照组也在同类会话里做，不拿 `codex exec` 这类没有交互的入口当对照。
  - 判断某个会话用的是哪版人设，查它存下的系统提示里有没有新版独有的标题：`sqlite3 <profile>/state.db "select instr(sp.prompt,'<新版独有的标题>')>0 from sessions s join system_prompts sp on sp.hash=s.system_prompt_hash where s.id='<会话号>';"`。会话号看 `logs/agent.log` 里 `conversation turn: session=`。
  - 交接或通知里写清「新人设只对新会话生效」，提醒常浩发 `/new`。
- 来源：digital-twin 2026-11-12（`CURRENT.md`「记忆日报重试修复和亚古兽人设 V4 已合并并安装」一节，`0e0421c`）：亚古兽老会话 `20261102_180956_56cddf01` 存的系统提示仍是旧版「性格与表达」；发 `/new` 后新会话 `20261112_112402_fd35aaa1` 含新版「思维内核」，回答随之变短。postpane L-38（2026-11-09，#286，`694e108`；证据 `~/Library/Application Support/postpane/evidence/2026-11-09-codex-relay-approval/`：老线程 13:22 调用仍触发批准钩子，同一 app-server 里 13:28 新开的线程 0.02 秒直接执行）。
- 出现过的项目：digital-twin、postpane。
- 升级：〔提醒〕未升级。要更硬可以在人设安装步骤里加一步，自动给常浩私聊发「已更新人设，发 /new 生效」；现在人设安装是手工拷文件，没有安装脚本可挂，先不做。2026-11-19 并入的 Codex 一例同样只有关键词提醒（`approval_mode`、`.codex/config.toml`）；「改的是不是已开会话会缓存的配置」机器判不了。
- 触发：`/\.hermes\/(profiles\/[^\/]+\/)?SOUL\.md/`、`/workspace\/HERMES\.md/`、`approval_mode`、`/\.codex\/config\.toml/`

## G-27 在没走代理的终端里登录命令行 AI 工具：浏览器显示授权成功，命令行却没登上（2026-11-14 新增）

- 现象：本机 `claude` 的登录过期，常驻服务（Hermes 网关）调它报 `OAuth session expired and could not be refreshed`，悄悄回退到备用模型，连续三天的日报都降级了。常浩在终端跑 `claude auth login`，浏览器显示「You're all set up for Claude Code」，以为登好了；`claude auth status` 仍是 `loggedIn: false`，钥匙串凭据也没更新。在 Claude 桌面应用的终端面板里再跑一次，浏览器授权后终端才看到 `Login failed: Request failed with status code 403`。
- 根因：浏览器授权走的是系统代理，能成功；最后一步「用授权码换凭据」由命令行自己发请求，它只认进程环境里的 `HTTPS_PROXY`，而交互终端（包括桌面应用的终端面板）默认没有代理变量，直连被拒（403）。浏览器页面只说明授权这一半成功了，不说明凭据已经写进本机。和 G-19 是同一类问题，方向相反：G-19 是常驻服务缺代理，这条是交互终端缺代理。另外，在 Claude 桌面应用的 Bash 里验证时，会继承桌面应用的 `ANTHROPIC_BASE_URL` 等变量，Hermes 的 Claude 插件见到它就拒绝走登录态（`OAuth provider refuses conflicting native auth/backend overrides`）并回退，看着像还没修好，其实是测试环境不对。
- 正确做法：
  - 登录命令行 AI 工具（`claude auth login`、`codex login`、`gh auth login` 这一类）时带上代理：`HTTPS_PROXY=http://127.0.0.1:8086 HTTP_PROXY=http://127.0.0.1:8086 NO_PROXY=localhost,127.0.0.1,::1 claude auth login`。
  - 以终端里出现 `Login successful.` 加 `claude auth status` 为 `loggedIn: true` 算登上，不以浏览器页面为准。终端报 403 或超时，先查 `env | grep -i proxy`，不要原样重试。
  - 验证常驻服务能不能用，要在和服务相同的环境里测：`env -i HOME=$HOME USER=$USER PATH=… HTTPS_PROXY=… <命令>`，代理按服务 plist 或 `.env` 里的写；不要在带桌面应用变量的 shell 里直接测。
- 来源：digital-twin 2026-11-14（`CURRENT.md`「个人项目日报连续三期降级查因」一节，`8ec5a5d`）：带代理重登后 `Login successful.`；干净环境下 `hermes chat -Q` 的会话 `20261114_094741_dec7f3` 用回 `claude-opus-5-5[1m]`。
- 出现过的项目：digital-twin（Hermes 网关的 Claude 登录）。
- 升级：〔体检〕部分升级（2026-11-14，digital-twin #180 / PR #181 `7b425af`）：digital-twin 工程自检每天 10:00 随个人项目日报跑 `ai_access.py status`，Hermes 主模型走本机 Claude 而 Claude 不可用时，在日报卡片报后果和带代理的登录命令。范围：只管 Hermes 用的本机 Claude 登录；不覆盖 codex、gh 等其他命令行工具的登录，也拦不住在没代理的终端里登录这个动作本身（那一步靠「触发」提醒和本条的正确做法）。
- 触发：`auth login`、`setup-token`、`codex login`

## G-28 Artifact 网页里脚本声明了全局变量 `claude`，发布后整页空白，本机打开却正常（2026-11-14 新增）

- 现象：用 Artifact 工具发布的预览页，本机浏览器打开一切正常；发布后在 claude.ai 打开，只剩静态的标题和空框，脚本画的内容全没有。
- 根因：页面脚本顶层写了 `const claude = …`。Artifact 宿主会在页面里预先放一个不可删的 `window.claude`（运行时接口），经典脚本顶层的 `const` / `let` 和它重名，浏览器直接报 `SyntaxError: Identifier 'claude' has already been declared`，整段脚本一行都不执行。本机预览没有宿主，所以测不出来。
- 正确做法：
  - Artifact 页面脚本不用 `claude` 当变量名或函数名（宿主占用），整段代码包进 `(() => { … })();` 自己的作用域，不往全局放东西。
  - 本机自查时模拟宿主：在页面最前面加 `<script>Object.defineProperty(window,"claude",{value:{},configurable:false})</script>` 再打开，看控制台有没有报错、内容有没有画出来。
  - 发布后打不开时，先看是不是脚本整段没执行（标签、卡片全空），再查重名。
- 来源：postpane 2026-11-14 #341 三版预览页（https://claude.ai/artifact/3Ya3jFccSdcF7GPFkgfqiz 第 1、2 版空白，第 3 版改名包作用域后正常）；本机模拟宿主复现到 `Identifier 'claude' has already been declared`。postpane `CURRENT.md`「#341」一节「与授权不一致之处」有记录。
- 出现过的项目：postpane（设计预览页）。
- 升级：〔提醒〕未升级（2026-11-14）：只有写出 `const claude` 这类声明时的关键词提醒。〔机检〕要在 Artifact 发布前检查页面脚本，发布走的是宿主工具，agent-kit 拦不到那一步；〔结构〕做不到，页面每次都是新写的。
- 触发：`/\b(const|let|var|function|class)\s+claude\b/`

## G-29 测试、故障注入、反向验证读写了正式环境的目录、凭证或配置（2026-11-18 新增）

- 现象：以为在「测」，实际作用在本机正式环境上，事后才发现。已有四起：
  - 「故意改坏」的反向验证里，一项让单测直接跑了安装，写进本机正式中台的配置、载入两条规则；另一项签出了一把正式钥匙。
  - 测回退时用了不存在的模型名，正式凭证文件里留下一年的模型冷却，辅助任务一天多全走回退模型（G-13）。
  - 核查正式配置时用设置命令改一个列表，命令是整份替换，两个本该禁用的技能被启用了 32 秒。
  - 跑全量测试会清掉 Mac 的系统剪贴板。
- 根因：被测代码的目录、凭证、配置位置和外部命令写死或默认指向正式环境（家目录、正式配置、系统剪贴板），测试只隔离了一部分（那次单测只把锁文件指到了临时目录，中台目录、名册、钥匙都没指）；「故意改坏」让平时被挡住的分支真的跑起来；在正式环境上核查时，用了以为是「读」、其实会写的命令。没有任何一步在测试前后检查正式环境变没变。
- 正确做法：测试和验证默认碰不到正式环境，正式环境变了就算失败。
  - 被测脚本读写的目录、凭证、配置路径和外部命令一律可注入（参数或环境变量），测试入口（共用的测试夹具、测试启动脚本）统一指到临时目录，外部命令换成桩、网络默认不通；不在单个用例里零散地只隔离一两样。
  - 「故意改坏」、故障注入这类验证：开始前对正式目录（配置、凭证、钥匙清单）取摘要，每跑一项比对一次，变了立刻停下并判失败。故障注入不用会被记账的错误（假模型名、假密钥，见 G-13）。
  - 必须在正式环境做的核查：先备份，只读命令优先；要写时先读出全量再写（设列表的命令常是整份替换）；做完和备份比对，结果写进记录。
  - 测试离不开系统级共享资源的（如 Playwright 在 Mac 上用系统剪贴板），在测试说明里写明会动到什么，跑前提醒。
  - 发现已经写进正式环境：先按备份恢复、回读核对，再报告。
- 来源：
  - digital-twin `971f714`（2026-11-17，`CURRENT.md`「事故：0B-2 反向验证误装到本机正式中台，已恢复」）；根因修复随 PR #200 `9f3f3ca` 合并。
  - G-13（digital-twin 2026-10-27，假模型名留下长期冷却）。
  - digital-twin `8e3890a`（2026-11-11，`CURRENT.md`「猛鬼兽优化」一节的「更正」：00:24:58～00:25:30 技能禁用列表被覆盖，已恢复且逐字核对）。
  - chatgpt-clipper L-17（`docs/LESSONS.md`，2026-11-07，`e0c9e1f`，跑测试清空系统剪贴板；原条目的「提升」行 2026-11-19 补上，积压清单组 13）。
- 出现过的项目：digital-twin（3 次）、chatgpt-clipper。
- 升级：〔提醒〕未升级（2026-11-18，agent-kit#76；2026-11-20 核对更新）：全局只有关键词提醒。digital-twin 项目内已是〔机检〕：PR #200（`9f3f3ca`）先给出事的那一个测试模块补了隔离；digital-twin#212 已由 PR #213（`11ed330`，2026-11-19 合并）做完，`hermes/scripts/tests` 每个模块第一句 `import _isolation`（临时家目录、清掉指向正式环境的变量、默认禁网、拦下 `launchctl` 等命令），守护测试 `test_isolation_guard.py` 发现漏写就失败，随 CI 的 `test`（main 的必需检查）必跑；同一 PR 加了反向验证核对工具 `prod_snapshot.py`。不覆盖：`hermes/scripts/tests` 以外的测试目录和其他项目。〔结构〕的候选去处是起步骨架给测试入口一个「临时目录、默认禁网」的默认写法；原定「等 #212 做完再评估」，#212 已做完，评估还没做。
- 触发：`故意改坏`、`hermes config set`

## G-30 测试里起子进程的等待和要验的时限共用一个短超时，机器一忙就偶发失败（2026-11-19 提升）

- 现象：测试要验「某操作 N 秒内截止 / 超时」，替身程序的启动和握手也算在这 N 秒里。平时全过；全量并行跑、刚打完包、新 worktree 首轮时偶发超时，单独重跑又过，看起来像被测代码坏了。驿窗两次：
  - `StdioServer` 写入截止测试，时限 3 秒，单独跑 3 次 1 败（#357）。
  - 替身引擎晚到输出测试，时限 1.5 秒，新 worktree 首轮两次都败：第一个替身还没起来就被杀，第二个被当成第一个，45 秒后才报超时（#393）。
- 根因：在 macOS 上起一个新写出的程序本来就要 0.4～0.6 秒（`/usr/bin/python3` 是 xcrun 垫片），系统同时首次执行大量新程序时会排到几秒。启动和要验的时限共用一个超时，启动一慢就吃掉了要验的时间。只把 CPU 打满复现不出来。
- 正确做法：
  - 起替身、握手那一步单给长超时（几十秒；正常情况立即返回，不拖慢测试），握手完成后再设要验的短时限。被测代码要能分开设（如仅测试用的 `set_timeout`）。
  - 用「标记文件分角色」的替身：先等第一个真的跑起来（回一次话或写出标记），再往下走。
  - 复现这类偶发超时：一边批量新建并执行几百个程序一边跑，不只用 CPU 压；压完按压测脚本的绝对路径停掉压测进程（不按命令名，见 G-32）。
- 来源：postpane L-48（`docs/LESSONS.md`，#357 2026-11-14、#393 2026-11-18）；同类：postpane L-47（MCP 测试起进程偶发超时）。
- 出现过的项目：postpane（2 次）。
- 升级：〔提醒〕未升级（2026-11-19，跨项目复盘积压清单组 1，常浩批）：全局只有关键词提醒。postpane 项目内已改完（2026-11-20 核对）：#415（`0e5083c`，2026-11-19 合并）让 MCP 测试的替身引擎先单独启动、给 120 秒，`pnpm test` 改成五套依次跑完再汇总（postpane L-47〔结构〕）。跨项目〔结构〕的候选，是在起步骨架里给「测试里起子进程」一个启动和时限分开的默认写法；原定「等 postpane 改完再评估」，postpane 已改完，评估还没做。
- 触发：`StdioServer`、`set_timeout`、`/spawn\w*\([^)]*timeout/`

## G-31 同一组取值或规则在几处各写一份，加新值时漏改一份，测试只走了改过的那条路（2026-11-19 提升）

- 现象：加了新取值、改了行为，界面和文件回读都对，实际却不生效，或者过一会儿变回旧值；测试全过。驿窗两次：
  - 「等待回答：一直等」（值 0）：允许的分钟数在启动、设置校验、每次请求都跑的重读设置里各写一份。只改了前两份，第一次请求后就退回 10 分钟（L-19，#181）。
  - 小人导演 TS、Rust 各一份，实机走 Rust：只改了 TS，预览台里对，实机不生效（L-49，#358）。
- 根因：同一份知识有几个副本，没有任何东西把它们绑在一起。测试直接操作内部对象，没走「写设置 → 新建 → 发一次请求 → 看效果」这条真实路径；跨语言的对拍只单向回放录好的用例，另一边改了不会红。
- 正确做法：
  - 同一组取值、同一条规则只定义一次，各处引用它。跨语言做不到时，两边读同一份用例文件互相对拍，哪边改了另一边的测试都会红。
  - 改设置类功能，测试走真实路径：写设置文件 → 新建实例 → 发一次请求 → 再看效果。
  - 查「改了没生效」，先 `grep -rn` 旧取值，看有没有漏网的副本。
- 来源：postpane L-19（2026-11-07，#181；修复后收成 `settings::APPROVAL_WAIT_MINUTES` 一份）、L-49（2026-11-14，#358）。
- 出现过的项目：postpane（2 次）。
- 升级：〔提醒〕未升级（2026-11-19，积压清单组 2，常浩批）：只有关键词提醒。postpane L-19 已在项目内收成一份常量，并写了走真实路径的测试；L-49 的双向对拍已在 #415（`0e5083c`，2026-11-19）做完：TS 回放测试 `director-cases.test.ts` 和 Rust 回放读同一份 `director-cases.json`；这些测试不在 postpane 推送前钩子（#465，只跑 `tests/*.test.mjs`）的范围内，靠合并前手动跑全量（2026-11-20 核对）。跨项目没有机器能判「同一份知识写了两份」的通用检查，停在这层。
- 触发：`reload_preferences`、`director-cases.json`、`/\b[A-Z][A-Z0-9_]*(ALLOWED|CHOICES|OPTIONS)[A-Z0-9_]*\s*[:=]/`

## G-32 按命令名 `pkill -f` 广撒，杀掉别的会话的进程（2026-11-19 提升）

- 现象：多个会话或子 agent 并行用一台机器：
  - 一个会话为停掉自己的测试，执行 `pkill -f 'pnpm test'; pkill -f 'cargo test'`，别人正在跑的全量测试以 143 / 144 退出，只能重跑（驿窗 #261 中断了 #264、#265）。
  - 另一次在启动全量测试的同一条命令里先 `pkill -f 'cargo test --workspace'`，工具调用一直不返回，会话被判停止响应（驿窗 #282）。主因大概率是 G-25 那条链，包着命令的 shell 被自己匹配上的可能没能排除。
- 根因：`-f` 匹配本机所有进程的完整命令行，不分是谁开的；同名的测试、构建命令，每个会话都在跑。
- 正确做法：
  - 停自己开的后台任务，用任务 ID（Claude Code 的 TaskStop，shell 里记下的 `$!`）。
  - 确实要按进程停：模式写到只认得出自己（本 worktree 的绝对路径、自己的端口号、脚本文件名），或先 `pgrep -fl` 看清 PID 再 `kill <PID>`。
- 来源：postpane L-33（2026-11-09，#261、#265 子 agent 报告）、L-37（2026-11-09，#282，`~/Library/Logs/Claude/main.log` 第 61278、62034 行）。
- 出现过的项目：postpane（2 次）。
- 升级：〔机检〕已升级（2026-11-19，积压清单组 5，常浩批）：`hooks/bash-precheck.mjs` 的 `kill-pkill-broad` 在 Claude 执行前拒绝「模式里没有路径、4 位以上数字、带扩展名的文件名」的 `pkill -f`。样本是 L-33、L-37 的原命令（`tests/bash-precheck.test.mjs`）。近 14 天 95583 条真实 Bash 里，`pkill -f` 有 320 条，按这个口径拦 76 条，多是 `'pnpm test'`、`'cargo test --workspace'`、`'node --test'`、`'tauri build'`；按端口或脚本名精确重启自己服务的放行。覆盖不到：Codex（执行策略只能按前缀匹配，分不出宽泛和精确，只靠「触发」提醒）；模式里带了锚点、但锚点本身是多个会话共用的（如共用的端口）。
- 触发：`pkill -f`、`pkill -9f`、`pkill --full`

## G-33 只在 Chromium 里验过的页面改动，进 WKWebView 窗口才出问题（2026-11-19 提升）

- 现象：页面或注入脚本在 Chrome、内置浏览器面板、无头 Chrome 里测过都好，装进用 WKWebView 的原生窗口后才坏。驿窗两次：
  - 往别人的页面注入脚本接住「收起」：浏览器里对真实页面测过，装机后连续三版失败，窗口一片空白、网页进程 CPU 85% 卡死（L-10，#154）。
  - 移植上游的性能优化（隐藏测量副本改成 `useDeferredValue` 延后重画）后，侧栏动画小人全变成静态图标；Chromium、Safari 加载同一份前端都正常，测量也是用无头 Chrome 做的，所以没发现（L-35，#264 / #273，已撤回）。
- 根因：两套引擎的微任务、MutationObserver 投递和渲染节奏不同。第一例查实：WebKit 把 MutationObserver 的记录一轮轮投递到没有新记录为止，回调里点按钮、改标题这类会改 DOM 的事让回调无限重入，React 排在微任务里的重绘永远轮不到，Chromium 测不出来；另外脚本写在元素上的行内样式在 React 换类名后还留着，面板在、却看不见。第二例的具体机制没查清。两次都只在 Chromium 系环境里验过，真实运行环境一次没跑。
- 正确做法：
  - 目标是 WKWebView 窗口（原生壳、macOS 上的 Tauri、Safari「添加到程序坞」）的页面改动，合并前要在同一套 WebKit 里跑一次：最快是 `swiftc` 写个最小 WKWebView 探针加载页面，几秒出结果；最终在装好的真实窗口里看。浏览器预览、无头 Chrome 只验逻辑，不当验收。
  - 注入到别人页面的脚本只观察：不在 MutationObserver 回调里改 DOM（也不改 `document.title`）；要藏元素用按类名生效的样式表（`document.adoptedStyleSheets`），不写行内样式；要页面做事时，由壳在回调之外调页面自带的接口。
  - 装机后拿不到开发者工具时用「标题通道」诊断：页面把状态写进 `document.title`，壳监听标题变化落盘。页面有 `connect-src 'self'` 时往本机端口上报会被拦。
  - 动画、渲染类改动装机后隔 2 秒截两张图对比，确认在动，并和改前对比。
- 和 G-17 的关系：G-17 也是 WKWebView，讲原生菜单的动作被 WKWebView 接走，是壳的问题；本条讲同一份页面在两套引擎里行为不同，不重复。
- 来源：postpane L-10（2026-11-06，#154，`3887e4a`；诊断日志 `~/Library/Application Support/postpane/evidence/2026-11-06-notes-collapse/`）、L-35（2026-11-09，#264 / #273，撤回提交 `09c0c13`；截图 `evidence/2026-11-09-bots-static/`）。
- 出现过的项目：postpane（2 次）。
- 升级：〔提醒〕未升级（2026-11-19，积压清单组 3，常浩批）：只有关键词提醒。postpane 项目内，L-35 有装后冒烟（`install.sh` 必走的 `smoke.mjs`，侧栏看不出在动就报错，#405 `a342c1c`），只管侧栏小人，L-10 那类注入脚本没有检查。跨项目做不到〔机检〕：「在 WebKit 里跑没跑过」机器判不了。〔结构〕候选：起步骨架给 WKWebView 壳项目带一个最小探针脚本；等第二个 WKWebView 项目（personal-ai-workbench、work-desk 的原生壳）也踩到再评估。
- 触发：`initialization_script`、`WKUserScript`、`evaluateJavaScript`、`addUserScript`

## G-34 测试替身比真实实现宽松，兜底路径一直绿却从没生效（2026-11-19 提升）

- 现象：给「第一条路失败后走的路」（兜底、重试、排队）写了测试，全绿，交接写了「已装机」，实机却从没走通过。驿窗一个消息投递功能的排队兜底，过了几天对照上游代码时才读出来：那一步在要兜底的场景里必被拒。
- 根因：替身只模仿了真实实现的一部分检查。替身的「可达」能设成不在线，「投递」却不管在不在线都成功；真实实现在会话没签到时直接拒收。测试又用一个方便的替代原因（写入失败）去模拟要兜底的场景（会话不在线），于是替身放行了真实实现会拒的那条路。
- 正确做法：
  - 写兜底测试前，先列出真实实现在这个场景下每一步会做的检查，替身逐条照做：同一个开关同时影响替身的每个方法（「不在线」时可达、回复、投递都失败）。
  - 模拟场景用真实的失败原因，不用方便的替代原因。
  - 至少再加一条用真实组件的测试（临时目录里的真实通道、真实文件），确认兜底那一步在该场景下真的能成。
  - 新写的兜底测试先让它红一次：把替身改成照真实规则拒收，看测试会不会红。
- 来源：postpane L-30（2026-11-09，#255 / #256，`8e93cca`；替身改成照真实规则拒收后，`handoff::tests::words_back_to_a_claude_session_that_ended_wait_in_its_queue` 先红，改走排队后变绿，全量日志 `~/Library/Application Support/postpane/evidence/2026-11-09-queue-back/test.log`）。
- 出现过的项目：postpane。
- 升级：〔提醒〕未升级（2026-11-19，积压清单组 3，常浩批）：只有关键词提醒。「替身和真实实现差在哪」机器判不了。〔结构〕候选：替身和真实实现共用同一份前置检查代码，替身只换掉读写那一层；只有一个项目踩过，等第二次再评估。
- 触发：`/\b(struct|class)\s+Fake\w*/`

## G-35 Chrome 插件重载或更新后，已开标签页里的旧脚本和后台断开（2026-11-19 提升）

- 现象：插件刚更新、或在扩展页重新加载过，已经开着的页面上功能失灵，像是代码坏了：
  - 收藏卡在「入库」一直转圈（chatgpt-clipper L-13）；请用户复验，结果和修前一模一样，其实浏览器里跑的还是旧构建（L-10）。
  - 用户自己开的 ChatGPT 标签页一条都不上报，只有插件自己新开的标签页正常，看起来像「只认名单里的会话」（postpane L-23）。
- 根因：MV3 插件装上、更新、重新加载时，Chrome 不给已开的标签页换新内容脚本；旧脚本和新后台断了联系，`runtime.sendMessage` 同步抛错（不进 `.catch`），被吞掉，或让流程停在半路。单页应用里新建对话也不重装脚本，这个标签页就一直是坏的。测试会自动重建插件，但用户浏览器里装的还是上次手动刷新时的构建。
- 正确做法：
  - 插件后台在 `runtime.onInstalled` 里用 `chrome.scripting.executeScript` 给已开的目标标签页补装脚本；内容脚本要能重复装（旧的一份让位），和后台断开后（`chrome.runtime?.id` 为空）自己停下，并提示「插件刚更新过，刷新页面再试」。
  - 调后台的流程整体包一层 `catch`，没做完的步骤标失败，不卡在半路。
  - 请用户复验插件改动时写明「先在扩展页刷新插件，再刷新要用的页面」；复验结果和预期不符，先确认浏览器里跑的是新构建，再动代码。
  - 查「插件那边没报」先比两组：插件自己开的标签页能报、用户自己开的不能报，就是这一类；刷新那个标签页后能报就坐实。
- 来源：chatgpt-clipper L-10（2026-11-03，`bca79c4`）、L-13（2026-11-04，`80d4acf`；测试 `tests/snapshot.test.mjs`「插件刷新后没刷新页面…」，去掉兜底时报红）；postpane L-23（2026-11-07，#206，`6f8fcb4`）。
- 出现过的项目：chatgpt-clipper（2 次）、postpane。
- 升级：〔提醒〕未升级（2026-11-19，积压清单组 7，常浩批）：只有关键词提醒。postpane 已在 `onInstalled` 里补装脚本并写了测试（`src/apps/chrome-extension/test/`）；chatgpt-clipper 照驿窗做法补装脚本已在 #14（`73ea2de`，2026-11-19）做完，兜底和补装的测试在 `tests/snapshot.test.mjs`。两个项目 11-20 都装了推送前钩子（postpane#465、chatgpt-clipper#16），但这几条测试不在钩子跑的范围内（postpane 只跑 `tests/*.test.mjs`，chatgpt-clipper 排除了 snapshot），仍靠合并前手动跑，不算〔机检〕（2026-11-20 核对）。〔结构〕候选：起步骨架给浏览器插件项目带「补装脚本、断开后自停」的默认写法；本机只有这两个插件项目，先不做。
- 触发：`runtime.sendMessage`、`runtime.onInstalled`、`chrome.runtime.reload`

## G-36 第三方聊天页先出容器、内容后到：把「出现」当成「就绪 / 答完」（2026-11-19 提升）

- 现象：程序读写 ChatGPT 这类第三方聊天页时，读到的内容是空的或不全，过一会儿再读又对了。三个项目各踩过：
  - 按「输入框出现」判断页面就绪，读历史第一次拿到 0 条，紧接着再读是 10 条；按回复条数定位新回复，把旧回复当成新的。第 2 次：消息出来了，回复里只有读屏用的隐藏标题，正文还没到（work-desk L-17）。
  - 回答节点先出来、内容后填，节点一出现就算指纹查「收藏过没有」，已收藏的显示成未收藏（chatgpt-clipper L-04）。
  - 先出一个空的回复占位块，答案随后写进同一个块、同一个编号；插件把空块报成「答完」，真回复写进来后因为编号相同不再报，回信丢了（postpane L-18）。
- 根因：这类页面是单页应用，容器（输入框、消息节点、回复块）先渲染，内容分几次流进来，同一个节点、同一个编号前后内容不同；代码把「某个元素出现」当成「内容就绪」或「回复完成」。测试用的是静态页，内容一开始就在，测不出来。
- 正确做法：
  - 以内容本身为准：要读的正文非空、而且一段时间（如 600 毫秒）没再变化，才算就绪或答完；内容变了，就重做依赖它的判断（重算指纹、重查状态）。
  - 认新回复按结构关系（提问多了一条、最后一条是回复），不按条数下标；同一编号的块内容变了要能再报。
  - 等待用 MutationObserver，不用定时轮询（后台标签页的计时器会被放慢）。取文字时想清楚隐藏标题、折叠状态对 `textContent` 和 `innerText` 的影响。
  - 测试里模拟「容器先到、内容晚到」（先清空、过一会儿再放回去），以及「只有标题、正文未到」「空占位块后填」。
- 和 G-22 的关系：同属「把中间信号当最终结果」。G-22 讲请求发出当成功，本条讲页面元素出现当就绪，现象和做法不同。
- 来源：work-desk L-17（2026-11-04，issue #15，`af80272`；第 2 次 2026-11-07）、chatgpt-clipper L-04（2026-11-02，`b1891f2`）、postpane L-18（2026-11-07，`d119785`；证据 `~/Library/Application Support/postpane/evidence/2026-11-07-chatgpt-reply-lost/`）。
- 出现过的项目：work-desk（2 次）、chatgpt-clipper、postpane。
- 升级：〔提醒〕未升级（2026-11-19，积压清单组 8，常浩批）：只有关键词提醒。chatgpt-clipper「内容晚到」、postpane「空占位块」各有复现测试（`tests/snapshot.test.mjs`、`src/apps/chrome-extension/test/`），都不在各自推送前钩子跑的范围内，仍靠合并前手动跑，不算〔机检〕（2026-11-20 核对）；chatgpt-clipper 的测试模拟不到「只有标题、正文未到」（积压清单第 4 节）。页面换了结构，旧选择器的测试也拦不住，跨项目没有机检去处。〔结构〕候选：给读第三方聊天页的插件一份共用的「等正文稳定」读取函数；跨三个项目，没做。
- 触发：`data-chatgpt-search-unit-key`、`data-message-author-role`、`prompt-textarea`

## G-37 电脑控制或程序发的点击，结果不能当真（2026-11-19 提升）

- 现象：用电脑控制（computer-use）或脚本发的点击实测原生窗口，结果和真人用鼠标不一样，容易误判成控件坏了或好了：
  - 悬停面板里点按钮，后台点击、全屏点击都只让面板收起，动作没执行；有一次点击穿到下面别的应用窗口（postpane L-09）。
  - 自绘的悬浮球：后台点击能打开面板，全屏点击打不开，球还被当成拖动挪走；电脑控制自己的浮窗正好挡在球上（disk-slim L-11）。
  - 用 CGEvent 发真实点击测到一半，屏幕锁了、外接显示器拔了，按旧坐标点到别的应用，Esc 也发给了它（postpane L-11）；面板出了滚动条、菜单栏读数变窄，目标整体挪了十几点，固定坐标点空（disk-slim L-12 第③点）。
- 根因：电脑控制的后台点击走无障碍「按下」，绕过控件自己的鼠标处理和全局点击监听；全屏点击会瞬移指针、点完挪回，可能被控件当成拖动；它自己的浮窗、截图时隐藏未授权应用，都会改变遮挡和前台应用。CGEvent 不管屏幕状态，照样发给当时光标下的应用；坐标是按开测前的屏幕和布局写死的。
- 正确做法：
  - 自绘控件、悬停面板、点击穿透的窗口，点击、拖动和焦点不靠电脑控制下结论：逻辑在浏览器预览或单元测试里用真实组件点；实机这一步先退出全屏控制，用 CGEvent 往 `.cghidEventTap` 发按下、拖动、松开，或请常浩亲手点，交接里写明哪些是常浩点的。普通窗口里的普通按钮不受影响。
  - 每组真实点击前回读并核对：没锁屏（`CGSessionCopyCurrentDictionary` 里的 `CGSSessionScreenIsLocked` 为空），显示器和窗口位置（`CGGetActiveDisplayList`、`CGWindowListCopyWindowInfo`）和写坐标时一致，目标位置当场截图定位、不写死；任一不符就停。「点外面」点菜单栏空白处，不点别的应用窗口。动鼠标前先问常浩能不能接管约 1 分钟。
  - 结果用状态回读判断（窗口位置、前台应用 `lsappinfo front`、应用自己的日志），截图只留作证据。
- 和 G-11 的关系：G-11 讲无头 Chrome、隐藏面板里的合成事件和截图；本条讲原生窗口上电脑控制和 CGEvent 的点击，不重复。
- 来源：postpane L-09（2026-11-06，`602cb73`；截图 `~/Library/Application Support/postpane/evidence/2026-11-06-merge-all/screens/`）、L-11（2026-11-06，#155，`9bebdf3`；`evidence/2026-11-06-disk-pendant/`）；disk-slim L-11（2026-11-06，`evidence/2026-11-06-floating-ball-realscreen/`）、L-12 第③点（2026-11-18，#6，`28f3e49`；`evidence/2026-11-18-minimize/`）。
- 出现过的项目：postpane（2 次）、disk-slim（2 次）。
- 升级：〔文字〕部分升级（2026-11-20，agent-kit#98，PR #99 `5f635b1`；2026-11-20 核对补标）：Claude 全局指令第 11 节「验收先自己做完」写了「电脑控制得出的结论算不算数，按 G-37 判：自绘控件、悬停面板上的点击和悬停不靠它下结论；结果用状态回读判断」（`~/.claude/CLAUDE.md`，仓库版 `global/claude/CLAUDE.md`）。缺口：Codex 版全局指令（`global/codex/AGENTS.md`）没有这一句。此前：〔提醒〕未升级（2026-11-19，积压清单组 9，常浩批）：只有关键词提醒，而且只在写 CGEvent 脚本时提醒；电脑控制的点击不经过 Bash 和改文件，预检和提醒都看不到。「这次点击的结论算不算数」是判断题。〔文字〕候选：全局指令加一句「自绘控件、悬停面板的实机点击结论，要有 CGEvent 或常浩亲手点的证据」；要改全局指令，没做。
- 触发：`cghidEventTap`、`CGEventCreateMouseEvent`、`CGEventPost`、`CGSSessionScreenIsLocked`

## G-38 macOS 上拿路径当字符串比较：符号链接、大小写不分、中文被转义（2026-11-19 提升）

- 现象：两条路径做字符串比较，明明是同一个地方却对不上，或者不同的名字落进同一个地方。磁盘瘦身三次：
  - `ps` 输出里有某个 worktree 的路径，测试拼出来的却对不上：一边是 `/var/folders/…`，一边是 `/private/var/folders/…`（L-02）。
  - 写到 `Tests/` 的文件落进已有的 `tests/`；只差大小写的两个构建目标、两个可执行文件撞成一个，编译报重复声明、链接失败（L-03）。
  - 安装脚本用 `ps -o comm=` 取进程路径和期望路径比，`ps` 在 C 区域设置下把路径里的「个人」输出成 `M-dM-8…`，永远认不出自己的旧进程，菜单栏同时出现两份，脚本照常打印「已安装」（L-09）。
- 根因：macOS 上 `/var`、`/tmp`、`/etc` 是指向 `/private/…` 的符号链接，不同接口返回的写法不同；默认的 APFS 不区分大小写，只差大小写的名字是同一个路径；`ps` 等命令行工具在没有 UTF-8 区域设置时（`LC_ALL=C` 的脚本、从访达或登录项启动的应用，环境里根本没有 `LANG`）把非 ASCII 字符转义输出。本机项目都在「个人」这个中文目录下，最后一条每个项目都会碰到。
- 正确做法：
  - 比较路径前先把两边都解析成真实路径（`realpath`、`resolvingSymlinksInPath()`、`fs.realpathSync`），或者两种写法都比。
  - 目录名、构建目标名、可执行文件名之间不能只差大小写；撞名后清掉构建产物目录。
  - 解析 `ps`、`lsof` 这类命令的输出时设 `LC_ALL=en_US.UTF-8`，脚本里和程序起子进程时都要设。
  - 认进程、认路径的结果用另一种办法回读（如装完 `pgrep -fl` 核对只剩一份），不只看脚本的成功提示。
- 来源：disk-slim L-02、L-03、L-09（2026-11-05，随第 0–9 批合并 `19adc49`；L-03 证据提交 `44d4bb2`；L-09 证据 `evidence/2026-11-05-install.txt`、`install-2.txt`）。
- 出现过的项目：disk-slim（3 次）。
- 升级：〔提醒〕未升级（2026-11-19，积压清单组 10，常浩批）：只有关键词提醒。disk-slim 项目内：L-03 写进了 AGENTS「规则」（〔文字〕）；L-09 有测试 `FullReviewProcessTests`，只管程序里起的子进程；disk-slim#14（`2d1d978`，2026-11-20）装了推送前钩子、跑完整 `swift test`，这条测试随推送必跑（项目内〔机检〕，2026-11-20 核对）。〔机检〕候选：起步骨架 `check-rules.mjs` 加一条「脚本里取 `ps -o comm=` / `-o command=` 却没设 `LC_ALL`」就报；只有一个项目踩过，先不做。
- 触发：`-o comm=`、`/var/folders`、`resolvingSymlinksInPath`

## G-39 把读不到、缺字段、没量到当成空值或 0（2026-11-19 提升）

- 现象：
  - 每天的磁盘用量对比里，某天下载文件夹没权限读、某个缓存刚过列出门槛，被当成「这一项是 0」，报出「下载文件夹 +10 GB」「其他 −11 GB」这类假涨跌（disk-slim L-07）。
  - 设置文件少了一个开关、或一条记录的日期写坏，整份文件按默认值处理：用户关掉的提醒重新打开，所有「保留」丢掉，保留过的文件重新被默认勾选、点一下就会被移走；下次写入再把默认值写回去，用户数据就没了（L-08）。
- 根因：「没有这一项」「读不了」和「这一项是 0 / 空」混在一起：读大小的函数吞掉读错误返回 0；Swift 编译器合成的 `Codable` 解码不用属性默认值，缺一个键整份抛错，外面的 `try?` 再把它变成「全部默认」；读文件时没分「不存在」和「读不了」。
- 正确做法：
  - 读不到就记「未知」（`nil` 或单独的状态），不记 0；对比、汇总只比两边都有的项，只在一边出现的单列或归「其他」，界面上写「没量到」。
  - 用户数据文件逐字段宽松解码（Swift 手写 `init(from:)`，`decodeIfPresent ?? 默认值`；字典、列表逐条解码，坏一条丢一条），不让一处坏数据把整份变成默认。
  - 文件在但读不了（没权限、解析失败）就报错、不写；整份读不出来时先改名留底再写。
  - 测试里专门造「缺字段」「坏一条」「没权限」的样本。
- 来源：disk-slim L-07、L-08（2026-11-05，随第 0–9 批合并 `19adc49`；对抗测试 `GrowthAdversarialTests` 修复前 13 项失败，`AlertsAdversarialTests` 的几条「字段缺失」用例修复前失败）。
- 出现过的项目：disk-slim（2 次）。
- 升级：〔提醒〕未升级（2026-11-19，积压清单组 11，常浩批）：全局只有关键词提醒。disk-slim 有测试（`GrowthAdversarialTests`、`UsageTests`、`AlertsAdversarialTests`），disk-slim#14（`2d1d978`，2026-11-20）起随推送前钩子的 `swift test` 必跑（项目内〔机检〕，2026-11-20 核对）。「这个默认值是不是吞掉了错误」机器判不了，没有〔机检〕去处；〔结构〕只能在各项目里把读用户数据收成一个入口，没有跨项目的做法。触发词只认 Swift 的写法：JS、Python 里的 `?? 0`、`|| 0` 太常见，加了会天天误报。
- 触发：`/\bstruct\s+\w+\s*:[^{\n]*\bCodable\b/`、`/try\?\s*JSONDecoder/`、`allocatedSize`

## G-40 临时改源码验红：改、测、还原写在一条命令里，被打断就留在改过的状态（2026-11-19 提升）

- 现象：为补「先红」证据，临时去掉新行为、跑测试、再还原，三步写在一条前台命令里。等共用构建目录的锁超过 2 分钟，命令被切走（exit 144），还原没执行，文件留在改过的状态（postpane #257）。另一次先 `cp` 了改前副本，还原却用了 `git checkout -- <文件>`，把这个文件里本轮还没提交的改动也丢了，靠副本才找回（#251）。
- 根因：前台命令有超时，等锁、编译的时间不可控；还原写在同一条命令的最后，前面断了它就丢。`git checkout -- <文件>` 还原的是上次提交的版本，不是改之前的版本。
- 正确做法：
  - 最好不事后补红：先写测试、跑出红，再写实现。
  - 必须临时改源码时：先提交或备份；改、测、还原分成几步，测试放后台跑；还原只用自己留的副本，再用 `cmp` 核对已还原；有未提交改动的文件不用 `git checkout` / `git restore` 还原。
  - 交付前 `git diff` 看一眼，确认没有留下验红用的改动。
- 和 G-29 的关系：G-29 讲「故意改坏」碰到了正式环境；本条讲临时改动没还原回来，不重复。
- 来源：postpane L-32（2026-11-09，#257，`ee7c73b`；证据 `~/Library/Application Support/postpane/evidence/2026-11-09-257-relay-receipts/red-host.log`；补充 #251）。
- 出现过的项目：postpane（2 次）。
- 升级：〔提醒〕未升级（2026-11-19，积压清单组 14，常浩批）：只有关键词提醒。「一条命令里改了又还原」的写法太多（`sed -i`、`perl -pi`、`python`、`cp`），预检认不全、误拦面大，没做〔机检〕。postpane 一轮流程采纳「先写测试跑出红」（积压清单组 17 的 E-14）是项目内的〔文字〕。
- 触发：`验红`、`/\bgit checkout -- \S/`、`/\bsed -i\b[^\n]*(&&|;)[^\n]*\b(test|check)\b/`

## G-41 会删东西的工具，新加的删除目录没过同一道安全检查（2026-11-19 提升）

- 现象：清理工具为了「先改名再删」加了一个暂存目录，每次清理开头补删里面的残留。审查员把暂存目录换成指向别处的符号链接，跑一次清理，链接指向的目录被永久清空；自动清理也会触发（disk-slim L-10）。
- 根因：安全检查只管「用户选中要清的路径」；工具自己新加的、会被删除的目录（暂存、缓存、日志、临时目录）没走同一套检查，补删又不分来源，见什么删什么。
- 正确做法：
  - 工具里任何会被删除的目录都过同一道检查：`lstat` 确认它和上一层都不是符号链接、确实是目录、在预期的根下面。新增删除路径时，在审查和测试里点名它。
  - 只删自己放进去的东西（名字可识别，如 UUID，且放了一段时间以上），不清空整个目录。
  - 挪动只用 `rename(2)`；跨卷（EXDEV）不复制，改为原地删。
  - 测试里造「暂存目录是符号链接」的样本，确认删不到链接指向的地方。
- 来源：disk-slim L-10（2026-11-05，随第 0–9 批合并 `19adc49`；测试 `Batch7ReviewTests` 的「暂存目录是符号链接时_…」修复前失败；演练记录 `evidence/review-batch7-20261105/clean-symlink-staging.txt`）。
- 出现过的项目：disk-slim。
- 升级：〔提醒〕未升级（2026-11-19，积压清单组 14，常浩批）：全局只有关键词提醒。disk-slim 有测试（`Batch7ReviewTests`），disk-slim#14（`2d1d978`，2026-11-20）起随推送前钩子的 `swift test` 必跑（项目内〔机检〕，2026-11-20 核对）。〔结构〕候选：工具里所有删除都走同一个带检查的删除函数，别处不直接调删除接口；这是各项目自己的代码结构，没有跨项目的去处，只有一个项目踩过，先不做。
- 触发：`removeItem(at`、`shutil.rmtree`、`trashItem(at`

## G-42 读别的进程的环境变量，会看到登录令牌明文（2026-11-19 提升）

- 现象：想把 Claude Code 会话进程对上桌面版的会话，用 `ps eww` 看进程的环境变量再 `grep -i CLAUDE`，输出里有 `CLAUDE_CODE_OAUTH_TOKEN` 明文，进了会话记录（disk-slim L-13 第②点）。
- 根因：Claude 桌面版等程序把登录令牌放在子进程的环境变量里；macOS 的 `ps` 带 `-E`（或不带横线的 `e`）会把进程的环境变量连值一起打出来，Linux 的 `/proc/<pid>/environ` 也是。命令输出原样进会话记录、日志和交接。
- 正确做法：
  - 不读别的进程的环境变量。想知道进程是谁，用命令行参数（`ps -o pid,ppid,command`，不带 `E`）或程序自己的记录。
  - 只要变量名：当前 shell 的用 `env | cut -d= -f1`；别的进程的，看它的启动配置（plist、启动脚本）里写了哪些名字。
  - 只想知道某个变量有没有、对不对：`[ -n "${NAME:-}" ] && echo 已设置`，或比摘要 `printf %s "$NAME" | shasum -a 256 | cut -c1-12`，不打印值。别的进程的，请常浩在自己的终端里查，只回报有没有。
  - 已经打印出来了：告诉常浩是哪个令牌、出现在哪个会话或文件里，由他决定要不要重新登录换掉。
- 来源：disk-slim L-13 第②点（2026-11-18，第 11 批内存，`e862639`；原命令在当天磁盘瘦身会话里，`claude/memory` 分支）。
- 出现过的项目：disk-slim。
- 升级：〔机检〕已升级（2026-11-19，积压清单组 14，常浩批）：`hooks/bash-precheck.mjs` 的 `env-ps-environment`、`env-proc-environ` 在 Claude 执行前拒绝两类命令：`ps` 带显示环境变量的选项（带横线的只认大写 `E`，如 `-E`、`-Eww`、`-axE`；不带横线的只认第一个参数里有 `e` / `E`，如 `e`、`eww`、`auxe`；macOS 带横线的 `-e` 是「所有进程」，不拦），和读 `/proc/<pid>/environ` 的命令。样本是 L-13 的原命令 `ps eww -o command= -p 1551 | … | grep -i -E "session|local_|CLAUDE"`（`tests/bash-precheck.test.mjs`）。近 14 天 41898 条真实 Bash（按调用编号去重、按每条的时间取）里，以 `ps` 开头的命令段 468 条，按这个口径拦 21 条（`ps` 20 条、`/proc/…/environ` 1 条，其中 1 条是做这条拦截时的实验命令），逐条看都是真在读环境变量，没有认错的；但多数本意是正常排障（查某个进程的 `PATH`、`LANG`、飞书配置或会话编号），拦下后要改用拒绝说明里的办法。覆盖不到：Codex（只靠「触发」提醒）；藏在 `bash -c '…'`、`docker exec`、`python -c` 引号里的命令（近 14 天有 2 条读容器里 `/proc/7/environ` 的没拦到）；`env`、`printenv`、`set` 打印当前 shell 自己的环境变量（本机 Claude 的 Bash 环境里也有令牌类变量）；`launchctl print`、`launchctl getenv`；程序自己读别的进程环境（`sysctl` 的 `KERN_PROCARGS2`）。
- 触发：`ps eww`、`/\/proc\/[^\/\s]+\/environ/`（提醒不分大小写，分不出 ps 的大写 E 和 macOS 的小写 e（所有进程），所以不写带横线的那种；它由预检拦）

## G-43 飞书 open_id 按应用区分：换机器人身份，写死的 open_id 全失效（2026-11-19 提升）

- 现象：飞书机器人从一个应用换到另一个，只改 `--profile` 不够：按本人 open_id 取会话、发私聊、核对 `whoami` 应用编号的代码都写死了旧值，散在 11 个模块里；数据库里存下的操作人（actor）和带旧身份的来源指纹，迁移后同步报「身份已变化」（work-desk L-15，issue #5）。一周后默认身份又换一次（issue #8）。
- 根因：飞书的 open_id 是「用户 × 应用」维度的，同一个人在不同应用下 open_id 不同；身份常量散在各处，换应用要逐个找，存下来的数据也带着旧 open_id。
- 正确做法：
  - 飞书身份（profile、应用编号、本人 open_id）只在一个模块里定义，其余引用；用到几个机器人时，每个模块显式写用哪个身份，调用走唯一入口，测试检查分配。
  - 换应用时先用新应用 `whoami` 拿本人 open_id，对各数据源做只读探测；存下的 actor 用「预览 → 备份 → 确认写 → 回读」的迁移脚本迁，历史回执不改写。
  - 跨应用要认同一个人，用不随应用变的编号（同一开发者下的 union_id，或租户内的 user_id），不存 open_id 当长期身份（飞书文档的说法，本机未实测）。
- 来源：work-desk L-15（2026-10-27，issue #5，`54309fe`；第 2 次 2026-11-02，issue #8，测试 `tests/lark-identity.test.mjs`）。
- 出现过的项目：work-desk（2 次）。digital-twin、Hermes 也用几个飞书机器人，还没踩到（推断会碰到）。
- 升级：〔提醒〕未升级（2026-11-19，积压清单组 14，常浩批）：只有关键词提醒。work-desk 已把飞书身份收成 `server/lark-identity.mjs` 一个入口并有测试（项目内的〔结构〕）。跨项目没有检查能判「这个 open_id 属于哪个应用」，停在这层。
- 触发：`open_id`、`/\bou_[0-9a-f]{6,}/`

## G-44 自托管西文字体不限字符范围，挡住中文字体的全角标点（2026-11-19 提升）

- 现象：页面换成自托管的西文字体后，中文全角标点「，」只有 6px 宽（视觉稿里 29px）；类型检查、测试、溢出扫描都看不出来，只有对照视觉稿才发现（trainee-hub L-01）。
- 根因：`@fontsource/*` 的 `@font-face` 不带 `unicode-range`，西文字体自带一套窄版全角标点（，。：等），在字体栈里排在中文字体前面，就把中文字体的标点挡住了。Google Fonts 只下发 latin 子集、带 `unicode-range`，所以视觉稿没这个问题。
- 正确做法：自托管西文字体时自己写 `@font-face`，`unicode-range` 照 Google Fonts 的 latin 子集限定，让中文和全角标点回落到中文字体；不直接 import `@fontsource/*/400.css`。换字体后在浏览器里量一个全角标点的宽度（应接近一个汉字宽）。
- 来源：trainee-hub L-01（2026-11-06，`3a92906`；修前 6.06px、修后 29.25px）。
- 出现过的项目：trainee-hub。little-steps 也整包引了 `@fontsource` 字体，是否受影响未核实。
- 升级：〔提醒〕未升级（2026-11-19，积压清单组 14，常浩批）：只有关键词提醒。〔机检〕候选：起步骨架 `check-rules.mjs` 加一条「import 了 `@fontsource/*.css`」就报；只有一个项目踩过，little-steps 是否受影响没核实，先不做。
- 触发：`@fontsource`、`@font-face`

## G-45 CLI 明明装了，起子进程却报「未安装」：工作目录不存在也报 ENOENT（2026-11-20 提升）

- 现象：设置页里执行方显示「可用」、`which claude` 也找得到，实际调用却报「Claude 未安装」。
- 根因：Node 的 `spawn` / `execFile` 在「命令找不到」和「`cwd` 指向的目录不存在」两种情况下都报 `ENOENT`；代码只认 `ENOENT`，就把「工作目录还没建」判成了「没装」。新数据目录、首次运行、目录被清理之后最容易碰上。
- 正确做法：起子进程前先 `mkdirSync(cwd, { recursive: true })`，或用 `mkdtempSync` 现建目录；「未安装」只用不带 `cwd` 的探测（如 `--version`）判断，调用时碰到 `ENOENT` 先查 `cwd` 在不在，再下结论，报错里写清是哪一种。测试里拿一个不存在的目录当 `cwd`，断言跑完后目录已建好，或报的是「工作目录不存在」。
- 来源：niuma-home L-22（2026-11-20；证据 `~/Library/Application Support/NiumaHome/evidence/ai-access-20261120/`，项目测试 `tests/ai-access.test.mjs`「Claude 执行方」一项）。
- 出现过的项目：niuma-home。同样「见 `ENOENT` 就判没装」的写法还有 github-center `src/agent.js:141`（工作目录用 `mkdtempSync` 现建，未踩）、digiworld `server/agent-inventory.mjs:129`（未踩）。
- 升级：〔提醒〕未升级（2026-11-20，agent-kit#95，常浩批）：只有关键词提醒。〔机检〕做不到：`cwd` 运行时在不在，静态检查判不了；niuma-home 自己的测试只算项目内的〔机检〕。
- 触发：`/spawn\w*\([^)]*cwd/`、`/ENOENT[^\n]{0,40}(未安装|missing|not.?installed)/`

## G-46 git 钩子里跑的测试自己做 git 操作，从 worktree 触发时落到了真实仓库（2026-11-20 新增）

- 现象：推送前钩子跑项目测试，测试在临时目录里建仓库、提交、推送。从主目录推送一切正常；从 worktree 推送，测试照样全过，但推送的分支多出测试造的提交（2 个变 5 个），主目录被改成 `core.bare=true`，之后任何 git 操作都报 `must be run in a work tree`。
- 根因：git 在 worktree 里运行钩子时，把 `GIT_DIR` 等仓库位置变量导出给钩子；钩子里起的子进程（测试、脚本）都继承它们，`git init`、`git -C <临时目录>` 也不再指向临时目录，而是操作真实仓库。主目录推送时 git 不导出这些变量，所以只在 worktree 里出事。属于 G-29「测试碰到正式环境」的一种。
- 正确做法：
  - 钩子在 `cd "$(git rev-parse --show-toplevel)"` 之后、跑任何检查之前，先 `unset $(git rev-parse --local-env-vars)`。
  - 测试里自己起的 git 子进程不继承这些变量（传入清理过的 `env`），不依赖调用方替它清。
  - 钩子的测试里要有一条「从 worktree 真推」的用例：临时仓库加 worktree 加本机裸仓库，推送后断言分支提交数不变、主仓库 `core.bare` 仍是 `false`。
- 来源：起步骨架 0.4.0（my-skills#112）装进 8 个仓库的 pre-push；2026-11-20 检查新 PR 时在临时仓库用 PR 原文件复现。修复：骨架 0.4.1（my-skills#116，`9ae5f2c`），各仓库 disk-slim#15、get-index#5、little-steps#8、multi-agent#13、obsidian-kb#4、ui-system#4、chatgpt-clipper#18、postpane#471。证据 `~/Library/Application Support/agent-kit/evidence/2026-11-20-pre-push-hook-gitdir/`。
- 出现过的项目：my-skills 起步骨架，以及装了它的 8 个仓库（实测只在临时仓库复现，8 个真实仓库在停用前都没中招）。
- 升级：〔机检〕部分升级（2026-11-20，my-skills#116）：骨架 0.4.1 的 pre-push 自带清变量，`tests/hooks.test.mjs` 的「从 worktree 推送」用例随 pre-push 必跑，删掉那一行就推不上去；范围是用骨架 0.4.1 钩子的仓库。不覆盖：别的钩子框架（husky、lefthook 等）和其他项目自写的、会在钩子里起 git 子进程的脚本。
- 触发：`/scripts\/hooks\/pre-(push|commit)/`、`/GIT_DIR=/`

## G-47 钩子只在主目录验过，从 worktree 推送才出的问题看不出来（2026-11-20 新增）

- 现象：钩子在主目录里跑、手动执行 `sh scripts/hooks/pre-push` 都通过，装好后从 worktree 一推就把仓库弄坏（G-46）。修好合并后，个别早先拉过旧 main 的 worktree 检出的还是旧钩子，装回后从那里推一样会出事。
- 根因：worktree 里运行钩子和主目录不同（会导出 `GIT_DIR` 等变量）；手动执行钩子脚本也不会带这些变量，等于没测到。`core.hooksPath` 写相对路径时，每个 worktree 用的是自己检出的那份钩子，主分支修好了，不等于每个 worktree 都修好了。
- 正确做法：
  - 钩子的验收必须从 worktree 真推一次：`git push --dry-run origin HEAD:refs/heads/<不存在的分支>` 会触发 pre-push 且远端不留分支。推前推后对比分支提交数、`core.bare`、有没有测试造的提交，并确认输出里钩子确实跑了。
  - 对比时注意别的会话可能同时在这个仓库提交或合并：数字变了先查 `git reflog` 和提交作者，再下结论。
  - 装回修好的钩子之前，列出每个 worktree 检出的钩子版本；还是旧版的，等它合进新 main 再装，或给它单独 `git config --worktree core.hooksPath <主目录>/scripts/hooks`（需 `extensions.worktreeConfig=true`）。
- 来源：同 G-46（2026-11-20）；postpane 装回时 `466-not-pressed` worktree 仍是旧钩子，验收记录见证据目录 `7-装回与worktree验收.txt`。
- 出现过的项目：my-skills 起步骨架、postpane。
- 升级：〔机检〕部分升级（2026-11-20，my-skills#116）：「从 worktree 推送」已做成骨架钩子测试里的用例，随 pre-push 必跑。不覆盖：装回时检查各 worktree 检出的钩子版本、真实仓库里的推送验收，这两步只能靠文字和本条提醒。
- 触发：`core.hooksPath`
