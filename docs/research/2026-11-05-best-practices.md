# Claude Code / Codex 重度用户最佳实践对照报告（2026-11-05）

> 落地情况：第 1、2、5 件做成了可安装的文件；第 3、4 件按第 5 节的本机核对，交给 my-skills#30（automation-checkup）、#28（session-retro），本仓库只补它们不覆盖的部分。装法和已知局限见 [docs/机器执行层.md](../机器执行层.md)。

> **调研范围与局限（先看这里）**
>
> - **已联网**：2026-11-05 实际读取了下文「来源清单」里的页面和仓库文件。下文引用的说法我都在原文里抽查过。没读到的会单独写明。
> - **my-skills 未读**：本会话申请读取私有仓库 `Natsukashii1997/my-skills`，被会话权限拒绝。骨架 project-starter 的现状，改用本仓库提交 `151caa5` 之前（2026-10-27 迁走前）的快照作证据。迁走后骨架又改了什么，**未核实**。
> - **Codex 官方文档没读全**：developers.openai.com 被网络代理拦截。只从 `openai/codex` 仓库确认 Codex 有生命周期 hook 和执行策略规则（exec policy），具体写法**未核实**。
> - **本机设置看不到**：云端会话看不到你本机的 `~/.claude/settings.json`、`~/.codex/`、launchd 任务和 Hermes 配置。表里写「未知」的都属于这一类。
> - **已补本机核对**：同日由本机 Claude 会话逐条核对了本机现状，并抽查了官方文档原文，结果见**第 5 节**。第 1～4 节保留调研时的原样；两处说法不一致时，以第 5 节为准。

---

## 1. 结论与最值得做的 5 件事

**一句话结论**：你这套体系在「写给人和模型读的规矩」上，已经比我看到的公开合集都严谨，包括坑库三级升级、交接防伪造五条、一分支一写者、提案批准制。真正缺的是**机器强制执行的那一层**：规矩写了，可到了关键时刻没有机器拦截或提醒，下面五个现象都说明这一点。所以下一步不该再加文档，而是把已有规矩里高频、机器能判断的几条，改成权限规则、hook 和体检脚本。

五个现象：
- 全仓库和骨架里一个 hook 都没有。
- 18 条全局坑全部写着「升级：未升级」。
- 两份全局指令靠人工保持一字不差。
- 本机定时任务没有统一体检。
- 会话记录从没被系统地复盘过。

> 术语，第一次出现时解释：
> - **hook（钩子）**：Claude Code 在固定时刻必定会跑的一小段脚本，例如「每次执行命令前」「会话开始时」「准备停下时」。它不靠模型自觉。
> - **权限规则**：`settings.json` 里的一行配置，写明「这类命令一律拒绝」或「一律先问我」。
> - **确定性 / 非确定性**：这是官方文档的划分。CLAUDE.md、AGENTS.md、skill 都是写给模型看的，模型「通常会照做，但没有保证」。hook、权限规则是由程序执行的，「每次都执行」。

### 最值得做的 5 件事（按收益 / 成本排序）

| # | 做什么 | 预计收益 | 成本 | 要你决定的事 |
|---|---|---|---|---|
| 1 | **给不可逆操作加权限规则**：在 `~/.claude/settings.json` 里，把强推、推 main、`gh pr merge`、`git reset --hard` 设为「先问我」，强推 main 设为「拒绝」 | 《工程流程》第 3、5 节的两条红线，从文字约定变成机器强制：「不 force push main」和「合并由常浩说了算」。模型跑偏或误解授权时也推不出去 | **低**：十几行配置，不碰仓库代码 | ① 名单：哪些「先问」、哪些「直接拒绝」。② Codex 用执行策略规则做同样的事，写法未核实，要不要同步做。③ Hermes 不受这套约束，派单时靠什么兜底 |
| 2 | **LESSONS 按关键词提醒**：给每条 G-xx 加一行「触发词」，再加一个命令执行前的 hook。命令里出现 `launchctl`、`plist`、`codesign`、写 `/tmp` 证据等触发词时，自动把对应坑的标题和正确做法提示给模型。只提醒，不拦截 | LESSONS 开头「排障、装 launchd 之前先 grep」从靠自觉变成到点必提醒。18 条坑的「升级」也有了统一去处 | **低到中**：一个小脚本，加上给 18 条补触发词 | ① 同意给 G-xx 加「触发词」字段吗？这会改 LESSONS 的格式，按规矩要你批准。② 脚本放 agent-kit 还是 my-skills。③ 要不要接到 Codex 的 hook（写法未核实） |
| 3 | **本机体检（doctor）+ 定时跑**：一个脚本一次性查完以下几项 | 你的坑里有 4 条是「静默失败、没人发现」：G-05、G-12、G-14、G-18，体检正好治这一类。体检也就是这 4 条的「升级」去处 | **中**：在某个项目开一张 issue，写脚本加测试，1～2 个会话 | ① 放哪个仓库，github-center 还是新开。② 多久跑一次，用 launchd 跑，还是用 Hermes 定时跑再推到飞书。③ 什么情况算告警 |
| 4 | **会话复盘试点 4 周**：用 sheal 读本机 `~/.claude` 和 `~/.codex` 的会话记录，产出「重复失败循环、被反复违反的规则、花费」，作为每周整理的输入。只用本地分析 | 每周整理从「凭记忆想起踩了什么坑」变成「看数据」。`drift` 能直接检验 G-xx 有没有被再犯，再犯就触发 LESSONS 的「第二次出现即升级」 | **低（试用）**，价值**待验证**：sheal 只有 89 星、版本 0.3.0，项目还年轻 | ① 允不允许第三方工具读你的全部会话记录？记录里有你的个人上下文。② 联网功能一律不开：`--enrich`、`--slack`、`backup push`。③ 试点不满意，就改让 Claude 写一个只读的自建 skill |
| 5 | **两份全局指令改成单一来源 + 机检**：`~/.claude/CLAUDE.md` 和 `~/.codex/AGENTS.md` 里「跨项目沉淀」那段，只在一个地方写 | 去掉「两段要一起改、一字不差」这个人工负担和走样风险 | **低** | 二选一。A：共享段放一个文件，Claude 侧用 `@文件路径` 导入，官方支持 `@~/` 路径；Codex 侧还是复制，由第 3 件的体检逐字比对。B：维持复制，只加比对 |

第 3 件体检建议查的项目，括号里是对应的坑：
- launchd 任务都已加载、上次退出码为 0、错误日志不比正常日志新（G-05、G-18）。
- 有没有长任务日志只有「开始」行、没有 `exit N` 行（G-12）。
- 开机时间：重启过就列出同时停掉的本机服务（G-12）。
- Hermes 定时任务有没有未处理的失败记录、模型冷却有没有残留（G-13、G-14）。
- 各仓库本地 main 有没有没推的提交（《工程流程》5.1）。
- 两份全局指令是否一致（第 5 件）。

第 3 件可以借鉴 RubenNijhuis/dotfiles 的体检写法。它分得清两种情况：「错误日志比最近一次正常日志新，需要看」和「旧错误已被之后的成功运行覆盖，属于历史」。这正好避免 G-14 那种误报。

**还有一件不花成本、但要你定的事**：Claude Code 的「自动记忆」（auto memory）在本机会话里**默认开启**。它会把你的纠正和偏好自动写成笔记，存在 `~/.claude/projects/<项目>/memory/`，每次会话加载前 200 行。这等于在 LESSONS 之外，又有一层没经你批准的规则，和你「提炼成规则要先经我同意」的约定冲突。可选做法：
- 关掉：`/memory` 里切换，或在设置里写 `autoMemoryEnabled: false`。
- 保留，但每周整理时顺带看一眼它记了什么。

### 判断依据和会推翻判断的证据

- **关键假设 1**：你主要在本机 Claude Code 里干活。权限规则和 hook 只管 Claude Code，管不到 Hermes。如果 Hermes 派单占比很高，第 1、2 件的收益要打折，得看 Hermes 自己的约束能力。
- **关键假设 2**：G-xx 再犯是真实风险。第 4 件的复盘数据就是检验：如果 4 周内复盘没发现任何一条 G-xx 被再犯，第 2 件的优先级应该下调。
- **分清三种状态**：第 1、5 件属于「当前可执行」，官方文档有明确写法。第 2、3 件「理论上更优」，要等真实触发一次才算验证。第 4 件依赖第三方工具，「待验证」。

---

## 2. 对照表：业界实践 vs 你的现状

现状标记：**已做到** / **部分** / **缺失** / **未知**（本机设置看不到）。证据位置指本仓库文件。「骨架」指提交 `151caa5` 之前的 `skills/project-starter/`，可以用 `git show 151caa5^:skills/project-starter/<文件>` 查看。

### A. 规则文件与记忆

| 实践 | 来源 | 你的现状 | 证据 | 建议 |
|---|---|---|---|---|
| 指令文件要短，只写模型自己看不出来的 | [官方 best-practices「Keep CLAUDE.md short」](https://code.claude.com/docs/en/best-practices.md)；awesome-claude-code 收录的 HumanLayer《Writing a Good CLAUDE.md》 | **已做到** | `AGENTS.md` 共 27 行，只做导航；骨架 `AGENTS.md` 写明「只放怎么开始和做什么事之前读哪份」 | 保持 |
| 入口加按需读取（渐进加载） | [官方 skills](https://code.claude.com/docs/en/skills.md)：平时只加载名字和描述，用到时才加载全文；pro-workflow 把 CLAUDE.md 拆成几份 | **已做到** | 骨架 `AGENTS.md`「做什么事之前读哪份」导航表；`README.md`「分层」 | 保持 |
| 一份指令多个工具共用 | [官方 memory「AGENTS.md」](https://code.claude.com/docs/en/memory.md)：Claude Code 能直接读 AGENTS.md，也可以在 CLAUDE.md 里写 `@AGENTS.md` 导入；zhurudong 模板用软链接 | **部分**：项目层统一用 AGENTS.md，已做到；用户层两份手工同步 | `README.md`「怎么接入」：「两段要一起改、保持一字不差」 | 第 5 件 |
| 模型自动记忆（auto memory） | [官方 memory「Auto memory」](https://code.claude.com/docs/en/memory.md)：本机默认开启 | **未知** | 无 | 见第 1 节「还有一件事」 |
| 定期审查过期或冲突的指令 | 官方 memory 页：`/doctor prompt-audit` 审查 CLAUDE.md、AGENTS.md、skills 里过期或冲突的指令 | **缺失** | 无 | 每周整理时顺手跑一次，零成本 |

### B. 确定性执行（hook 与权限）

| 实践 | 来源 | 你的现状 | 证据 | 建议 |
|---|---|---|---|---|
| 分清「模型读的规矩」和「程序执行的规矩」，红线放后者 | [官方 best-practices「Deterministic and non-deterministic instructions」「Enforce the rules that can't have exceptions」](https://code.claude.com/docs/en/best-practices.md) | **部分**：骨架有 `check-rules.mjs` 和交接格式测试，属于程序执行，但只在有人跑测试时才生效 | 骨架 `scripts/check-rules.mjs`、`tests/handoff-format.test.mjs` | 第 1、2 件 |
| 危险命令拦截：命令执行前的 hook 返回码 2 拦下，或用权限规则 deny / ask | [disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery) 的 `pre_tool_use.py` 拦 `rm -rf` 和读 `.env`；[pro-workflow](https://github.com/rohitg00/pro-workflow) 的 `git-blast-radius.js` 拦强推、删远端分支、`reset --hard` 等，`settings.example.json` 里把推 main 和 `gh pr merge` 设成先问 | **缺失**：只有文字 | `工程流程.md` 第 3 节「不 force push main」、第 5 节「合并由常浩说了算」 | 第 1 件 |
| 硬限制用权限规则，不单靠 hook | [官方 hooks](https://code.claude.com/docs/en/hooks.md)：hook 默认「出错就放行」，脚本路径写错、超时都不会拦；要拦就设 `onFailure: "block"`；「硬限制请用权限规则」 | 不适用（还没有 hook） | 无 | 第 1 件用权限规则，第 2 件只提醒，所以出错放行也无害 |
| 写文件时扫描密钥 | awesome-claude-code-toolkit、pro-workflow 的写文件前密钥扫描 | **部分**：靠文字规则和推送前人工检查 | `AGENTS.md`「不往这里写……凭据」；`工程流程.md` 5.1 | 低优先；第 1 件可以顺带加「禁止读 `.env`」 |
| 准备停下时的 hook：检查跑完才允许停 | [官方 best-practices「Enforce the check with a Stop hook」](https://code.claude.com/docs/en/best-practices.md)；disler 的 `/plan_w_team`；toolkit 的 `stop-check.js` | **部分**：交接格式测试有，但靠自觉去跑 | 骨架 `AGENTS.md`「交接格式」 | 可选：在项目里加一个停下前跑 `handoff-format` 测试的 hook，只在本轮改过文件时触发。先评估会不会太打扰 |

### C. 会话与交接

| 实践 | 来源 | 你的现状 | 证据 | 建议 |
|---|---|---|---|---|
| 收尾时写交接：做了什么、没做什么、下一步 | pro-workflow `/handoff`、`/wrap-up`；toolkit `/wrap-up`、`/checkpoint` | **已做到，且更严**：开工时间、原样测试结果、「沿用别人的结果要明说」、PR 描述即交接 | `工程流程.md` 第 4 节；`.github/pull_request_template.md`；骨架 `docs/OPERATIONS.md`「报告与验收」 | 保持。公开合集里**都没有**防伪造这类约束，这是你的长处 |
| 会话开始时自动注入上下文（git 状态、待办、issue） | hooks-mastery `session_start.py`；toolkit `context-loader.js` | **缺失**：靠 AGENTS 写的进入顺序 | `工程流程.md` 第 6 节「接手顺序」 | 低优先；可以和第 2 件合做，注入 CURRENT.md 的「唯一下一步」 |
| 压缩上下文前备份对话、压缩后重新注入 | disler `pre_compact.py`；pro-workflow `pre-compact.js` | **缺失** | 无 | **暂不做**：官方说现在 1M 窗口，压缩少见；你的「先写盘再报告」已覆盖这个风险 |
| 同一件事纠正两次还不对，就 `/clear` 重写提示 | [官方 best-practices「Steer the session」](https://code.claude.com/docs/en/best-practices.md) | **未知**（属于使用习惯） | 无 | 建议当个人习惯；第三次纠正通常更差 |

### D. 开发流程与并行

| 实践 | 来源 | 你的现状 | 证据 | 建议 |
|---|---|---|---|---|
| 先规划再动手，测试先行，审查后再 PR | 官方 best-practices「Give Claude a check to run」；Matt Pocock skills | **已做到** | `AGENTS.md`「Agent skills」；`工程流程.md` 第 1 节 | 保持 |
| 并行会话各开 worktree（独立工作目录） | [官方 worktrees](https://code.claude.com/docs/en/worktrees.md)：`claude -w <名字>` 原生创建；pro-workflow `parallel-worktrees`；Claude Squad | **已做到**（手工开） | `工程流程.md` 第 1、6 节；`LESSONS.md` G-04 | 可以改用 `claude -w` 原生命令，少一步手工操作 |
| 一个分支同一时间只有一个写者，接手要留言 | 未在公开合集里看到同等约定 | **已做到** | `工程流程.md` 第 2 节 | 保持 |
| 合并必须人点头 | pro-workflow 把 `gh pr merge` 设成先问 | 文字**已做到**，机器**缺失** | `工程流程.md` 第 5 节 | 第 1 件 |
| 只读的验收子代理，写不了文件、只能查 | disler 的 `validator.md`（禁写、禁改）；[官方 subagents](https://code.claude.com/docs/en/sub-agents.md) | **部分**：有 `code-review` 技能，没有独立的只读验收者 | 骨架 `docs/OPERATIONS.md` 防伪造第 4、5 条 | 可选：把「验收方」做成只读子代理，从机制上保证防伪造第 4 条「沿用别人的结果要明说」 |

### E. 学习沉淀（坑 → 规则 → 机器检查）

| 实践 | 来源 | 你的现状 | 证据 | 建议 |
|---|---|---|---|---|
| 坑库 + 人审批后才晋升为规则 | pro-workflow `/learn-rule`（「wait for user approval」）；[sheal](https://github.com/liwala/sheal)（「Learnings are never auto-accepted」）；obsidian-second-brain Crew（要人运行 `keep` 才变规则） | **已做到** | `LESSONS.md`「怎么写」「怎么升级」；`AGENTS.md`「规则」 | 保持。和成熟工具的方向一致，而且更严 |
| 坑最终变成机器检查（闭环） | 官方 best-practices；awesome-claude-code 收录的 Compound Engineering 插件 | **部分，接近缺失**：机制写了，但 18 条里 0 条完成升级。launchd 相关的 4 条（G-05、G-12、G-14、G-18）已经是同一类问题多次出现 | `LESSONS.md` 第 12～15 行；每条末尾的「升级：未升级」 | 第 2、3 件 |
| 从会话记录里挖重复失败、规则漂移 | sheal 的 `retro`、`drift`；[agentsesh](https://github.com/ateeples/agentsesh) | **缺失** | 无 | 第 4 件 |
| 知识库要有索引和定期「体检」，查重复、过期、孤立条目 | [Karpathy LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 的 `index.md`、`log.md` 和定期 lint | **部分**：编号只增、结论被推翻时注日期，这些已有；没有索引，也没有定期体检 | `LESSONS.md`「怎么写」第 4 条 | G-xx 超过约 30 条时，加目录和每月一次体检（重复、被推翻、该升级没升级），照搬项目 LESSONS 现有的「超过约 30 条整理一次」 |

### F. 定时任务与本机运维

| 实践 | 来源 | 你的现状 | 证据 | 建议 |
|---|---|---|---|---|
| 本机体检命令（`make doctor`） | [RubenNijhuis/dotfiles](https://github.com/RubenNijhuis/dotfiles) 的 `health/doctor.sh`：逐个查 launchd 任务的加载状态、上次退出码、错误日志新旧，还查配置仓库有没有没推的提交 | **缺失** | 无 | 第 3 件 |
| 定时任务日志写「开始 / 完成 / 失败」，以便看出卡住的任务 | [vraravam/dotfiles](https://github.com/vraravam/dotfiles)：STARTED、COMPLETED、FAILED | 文字**已做到** | `LESSONS.md` G-12：「第一行写开始时间，最后一行写 `exit N`」 | 第 3 件让体检自动读这两行 |
| 无人值守的定时任务 | [官方 scheduled tasks（云端）](https://code.claude.com/docs/en/routines.md)：在 Anthropic 服务器上跑，关机也照跑，最小间隔 1 小时，**研究预览版**；[桌面版定时任务](https://code.claude.com/docs/en/desktop-scheduled-tasks.md)；[`/loop`](https://code.claude.com/docs/en/scheduled-tasks.md) 只在会话开着时有效 | **部分**：用 launchd 和 Hermes 定时 | `LESSONS.md` G-05、G-12、G-14、G-18 | 不依赖本机文件的周期任务（比如每周查 GitHub issue 积压、汇总各仓库 PR 状态）可以试云端定时任务，不受重启影响；依赖本机的继续用 launchd |
| 本机配置纳入版本管理，可以恢复 | vraravam（家目录本身是 git 仓库）；[mntn](https://github.com/alloalexandre/mntn)（备份配置）；RubenNijhuis（`make backup`） | **未知**：看不到 `~/.claude/settings.json`、hook 脚本、`~/.codex/` 有没有进版本库 | 无 | 做第 1、2 件时，把配置和脚本放进 my-skills 或单独的配置仓库；体检查有没有没提交的改动 |

### G. 个人知识体系（长期目标相关）

| 实践 | 来源 | 你的现状 | 证据 | 建议 |
|---|---|---|---|---|
| 知识分三层：原始资料只读，AI 维护的 wiki 层，加上人和 AI 共同修订的规则文件；三个操作是录入、提问、体检 | [Karpathy LLM Wiki gist（2026-04-04）](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) | **部分**：LESSONS 本身就是一个小型「AI 写、人审」的 wiki；Vault 用页名指针引用 | `工程流程.md` 第 7 节 | 方向可借鉴，但**先别建全量 wiki**，原因见第 3 节第 3、4 条。如果想试，用 [claude-obsidian](https://github.com/AgriciDaniel/claude-obsidian)，它的写入要先给计划，2.0 版已取消自动提交。只在 Vault 的一个子目录、一个主题上试 |
| 写入要人审批，结论必须带来源 | [vouchdev/vouch](https://github.com/vouchdev/vouch)：AI 只提案，人批准才落盘；没有引用来源的结论直接判为不合格 | **已做到（流程上）** | `LESSONS.md`「证据查不到就写『未核实』，不编」 | 保持。这正好对上 gist 评论区最多人抱怨的问题：错误事实被一再重复 |

### H. 跨工具（Claude / Codex / Hermes）

| 实践 | 来源 | 你的现状 | 证据 | 建议 |
|---|---|---|---|---|
| 规则、技能在不同工具之间自动转换 | awesome-claude-code 收录的 Rulesync、compass、faf-cli | 不需要 | 你已用同一个 AGENTS.md，加上 `~/.agents/skills` 共享 | 保持，不必引入 |
| 技能放在各工具都认的目录 | pro-workflow 的 `cross-agent-workflows.md`（`.agents/skills`） | **已做到** | `README.md`「里面有什么」；my-skills | 保持 |
| 多个工具共用一本「谁做了什么」的日志 | obsidian-second-brain 的 Crew | **已做到（换了个形式）**：PR 描述就是交接，加上 issue 留言 | `工程流程.md` 第 4、6 节 | 保持。用 GitHub 当共享日志比本地日志文件更稳 |

---

## 3. 不建议照搬的做法

| 做法 | 出自 | 为什么不照搬 |
|---|---|---|
| **自动把「教训」写进规则或 CLAUDE.md** | agentsesh 的 `--feedback`（README：「直接写进 CLAUDE.md」）和 `analyze --fix`；toolkit 的 `/wrap-up`、`/checkpoint`（更新 CLAUDE.md，没有确认步骤）；pro-workflow 的 `learn-capture.js`：模型一提出 `[LEARN]` 就入库，并在之后每次会话注入。它的 `/learn-rule` 自己写着「等用户批准」，但提案一打印就被存了，实际上绕过了批准 | 和 `AGENTS.md`「只出提案，常浩批准才写」直接冲突。自动写入的规则会越积越多、彼此矛盾，而且没人知道哪条是谁、为什么加的。Claude 自带的 auto memory 是同类问题，见第 1 节 |
| **自动提交、自动推送** | toolkit 的 `/wrap-up`：「Always commit or stash」；pro-workflow 示例配置里写「推功能分支是常规操作」，并允许沙盒里的命令自动放行；mntn 新版的 `sync`：自动 git add、commit、push（据搜索摘要，未读到原文） | 和《工程流程》第 5 节冲突：推送前要检查有没有别的会话的提交、有没有私人内容，有就停下来问。推出去就收不回 |
| **夜间自动「调和矛盾」、改写笔记** | obsidian-second-brain：`/obsidian-reconcile` 自动解决矛盾，每晚的代理自动修孤立笔记；压缩上下文后的后台代理用 `--dangerously-skip-permissions`（跳过所有权限确认）运行 | 绕过人审。Karpathy gist 评论区有人实测：改错一条事实后，wiki 的「体检」报告一切正常，读它的模型照样重复错误。对策是把检查写成脚本，而不是让 AI 自己调和 |
| **一次装满整套 hook 合集** | disler 接满 13 种时刻；pro-workflow 有 35 条 hook；toolkit 的 `hooks.json` 用的是平铺格式，和 Claude Code 现行格式（按事件分组）不符，**可能根本加载不了** | 你不读代码，很难判断几十个脚本各在干什么、哪个坏了。而且 hook 默认出错就放行，坏了也看不出来。只挑和你的 G-xx 对得上的 |
| **重型会话分析平台** | tetriz-ai/session-intelligence：要装 Go 和 Docker、配 Gemini 密钥，会话内容要上传给模型 | 成本和隐私都不划算。第 4 件用纯本地的轻量工具试点即可 |
| **自主循环，一直跑到规格完成为止**（awesome-claude-code 收录的 Ralph 类） | awesome-claude-code | 和骨架「一次只做一件授权的事，范围外的问题记进交接，不顺手修」冲突 |
| **把 Karpathy wiki 当作 agent 的记忆层全面铺开** | LLM Wiki 的各种实现 | gist 评论区的实测问题：① 录入成本高，生成的 wiki 常常缺细节，最后还是要回去读原始资料；② 近似重复的页面是最常见的缺陷；③ 有人的结论是 wiki 不该给 agent 当记忆，只该给人留决定、待解问题和当前状态。这些都是评论者的经验，未经独立验证。对你来说，LESSONS 加 Vault 指针已经覆盖「给 agent 的记忆」，wiki 只适合当「给人看的知识层」小范围试 |
| **语音通知、状态栏、压缩前备份这类体验增强** | disler 等 | 不是你的瓶颈，加了只增加维护面 |

---

## 4. 来源清单

访问日期均为 2026-11-05。「原始文件」指 `raw.githubusercontent.com` 上的对应文件。

**Anthropic 官方文档**（`code.claude.com/docs/en/…`，读的是 `.md` 版本）
- best-practices：确定性和非确定性指令、Stop hook、权限规则、`/clear` — https://code.claude.com/docs/en/best-practices.md
- memory：CLAUDE.md 层级、`@` 导入、AGENTS.md、auto memory、`/doctor prompt-audit` — https://code.claude.com/docs/en/memory.md
- hooks：事件、返回码 2 表示拦截、出错默认放行、`onFailure` — https://code.claude.com/docs/en/hooks.md
- skills — https://code.claude.com/docs/en/skills.md
- sub-agents — https://code.claude.com/docs/en/sub-agents.md （由调研代理读取）
- 云端定时任务（routines，研究预览版） — https://code.claude.com/docs/en/routines.md
- `/loop` — https://code.claude.com/docs/en/scheduled-tasks.md
- 桌面版定时任务 — https://code.claude.com/docs/en/desktop-scheduled-tasks.md
- worktrees — https://code.claude.com/docs/en/worktrees.md （由调研代理读取）
- headless — https://code.claude.com/docs/en/headless.md （由调研代理读取）

**Codex**
- `openai/codex` 仓库的 `docs/config.md`，里面有「Lifecycle hooks」一节；`docs/execpolicy.md` 只是一个指向官网的链接页。官网 developers.openai.com 被代理拦截，**没读到**。

**经验合集**
- hesreallyhim/awesome-claude-code（57,276 星）：README — https://github.com/hesreallyhim/awesome-claude-code
- rohitg00/awesome-claude-code-toolkit（2,810 星）：README、`hooks/`、`commands/workflow/`、`rules/agents.md` — https://github.com/rohitg00/awesome-claude-code-toolkit
- disler/claude-code-hooks-mastery（3,970 星）：README、`.claude/settings.json`、`.claude/hooks/*.py`、`.claude/agents/team/validator.md` — https://github.com/disler/claude-code-hooks-mastery
- rohitg00/pro-workflow（2,943 星）：README、`hooks/hooks.json`、`scripts/learn-capture.js`、`scripts/git-blast-radius.js`、`skills/learn-rule`、`skills/session-handoff`、`settings.example.json`、`references/cross-agent-workflows.md` — https://github.com/rohitg00/pro-workflow

**Karpathy LLM Wiki 及其实现**（GitHub topic `karpathy-llm-wiki`，共 55 个仓库）
- Karpathy gist `llm-wiki.md`（创建于 2026-04-04），读了正文和最近约 30 条评论 — https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- AgriciDaniel/claude-obsidian（16,177 星）：README、`CHANGELOG.md`、`hooks/hooks.json` — https://github.com/AgriciDaniel/claude-obsidian
- eugeniughelbur/obsidian-second-brain（5,161 星）：README、`references/crew.md` — https://github.com/eugeniughelbur/obsidian-second-brain
- vouchdev/vouch（70 星） — https://github.com/vouchdev/vouch
- zhurudong/andrej-karpathy-llm-wiki、TrueHOOHA/LLM-Wiki：README

**会话复盘**
- sheal（89 星，0.3.0 版） — https://github.com/liwala/sheal
- agentsesh（0 星，PyPI 0.15.0） — https://github.com/ateeples/agentsesh
- 「Session Intelligence」：**名字有歧义**，没法确定你指的是哪个。读了 https://github.com/tetriz-ai/session-intelligence 和 https://github.com/ZoheerAlmansoub/agent-session-intelligence 的 README

**macOS 维护与 dotfiles**
- RubenNijhuis/dotfiles：README、Makefile、`health/doctor.sh`、`ops/automation/launchd-manager.sh` — https://github.com/RubenNijhuis/dotfiles
- vraravam/dotfiles：README、Advanced.md、Extras.md、TechnicalDeepDive.md — https://github.com/vraravam/dotfiles
- mntn：**正式仓库不确定**。网上说在 alexandretrotel/mntn，但读不到。只读到 https://github.com/alloalexandre/mntn（可能是旧副本）。新版的 `doctor`、`sync` 功能只见于搜索摘要，**未核实**

**本仓库内的证据**
- `AGENTS.md`、`README.md`、`LESSONS.md`（G-01 到 G-18）、`工程流程.md`、`docs/agents/*.md`、`.github/pull_request_template.md`
- 骨架快照：`git show 151caa5^:skills/project-starter/…`（`SKILL.md`、`skeleton/AGENTS.md`、`skeleton/docs/OPERATIONS.md`、`skeleton/docs/LESSONS.md`、`skeleton/docs/templates/handoff.md`、`skeleton/scripts/check-rules.mjs`）

---

## 5. 本机核对补充（2026-11-05，本机 Claude 会话）

第 1～4 节在云端写成，看不到本机。下面是同一天在常浩的 Mac 上逐条核对的结果。只读查看，没有改任何设置。

### 5.1 关于你现状的说法

| 报告原来的说法 | 本机核对结果 | 对结论的影响 |
|---|---|---|
| 「全仓库和骨架里一个 hook 都没有」 | 只对仓库成立。本机 Claude（`~/.claude/settings.json`）有 9 个 hook，分布在 6 个时刻：会话开始 2、发消息时 3、工具执行后 1、请求权限时 1、通知 1、压缩前 1。用途是会话自动命名和归组、上下文到 50% 提醒交接、把状态推给 PostPane。Codex（`~/.codex/hooks.json`）有 7 个：会话开始 3、发消息时 3、请求权限时 1，用途是会话命名和归组。**没有一个是在命令执行前拦截危险操作的**（没有 `PreToolUse`） | 结论不变：缺的是「拦截」这一层，不是 hook 本身。第 1 节第一句的「一个 hook 都没有」应理解为「没有起拦截作用的 hook」 |
| 第 1 件：给不可逆操作加权限规则 | `~/.claude/settings.json` 里没有任何权限规则（没有 `permissions` 段）；`~/.codex/rules/` 目录存在但是空的。另外本机已经装了 Matt Pocock 的 `git-guardrails-claude-code` skill，它就是用来设置「拦危险 git 命令」的 hook | **仍排第一，而且有现成工具**。做法建议：硬红线（强推 main）用权限规则 `deny`，其余（推 main、`gh pr merge`、`git reset --hard`）用 `ask`；`git-guardrails-claude-code` 可作补充，但按官方文档，hook 默认出错放行，硬限制仍以权限规则为准。Codex 侧在 `~/.codex/rules/` 里写执行策略规则 |
| 「18 条全局坑全部写着『升级：未升级』」 | 属实：`LESSONS.md` 共 18 条，18 条都是「升级：未升级」 | 无 |
| 「两份全局指令靠人工保持一字不差」 | 目前一致：`~/.claude/CLAUDE.md` 第 7 节和 `~/.codex/AGENTS.md` 的「跨项目沉淀（agent-kit）」正文逐字相同，只有标题差一个编号「7.」 | 风险真实但还没出过事，第 5 件可往后放 |
| 第 3 件：本机体检（doctor） | 同日已有现成实现：`my-skills` 的 `automation-checkup` skill（PR #30，草稿），只读体检所有 launchd 任务、hermes cron 和 crontab，分三档出报告。本机实跑一次约 3 秒，查出两个 Hermes 网关本次登录以来分别重启 17 次和 10 次（上次退出码 1、75）、飞书频道桥跑在 `bridge-candidates/…` 候选目录里、几个已停用任务的 plist 残留。另有 digital-twin 的 `cn.digital-twin.health` 每日健康检查 | 第 3 件改为「合并 PR #30 并按需定时跑」，不必另起项目 |
| 第 4 件：用 sheal 试点会话复盘 | 同日已有自建替代：`my-skills` 的 `session-retro` skill（PR #28，草稿），纯本地、只出提案、片段脱敏，不需要让第三方工具读全部会话记录；已按本机真实记录适配新版 Codex 格式 | 第 4 件改为「用 session-retro 试点」，第 1 节表里 ①②③ 三个隐私问题随之消失 |
| 自动记忆「默认开启」，与「提炼成规则要先经我同意」冲突 | 属实：`autoMemoryEnabled` 没设置，即为默认开启；本机会话确实在用 | 仍要你定：关掉，或保留并在每周整理时看一眼 |

### 5.2 官方文档原文抽查

下载了 `code.claude.com/docs/en/` 下 memory、hooks、best-practices、routines 四页的 `.md` 原文，逐条对照，报告引用的这些说法都能在原文找到：

- best-practices：「Deterministic and non-deterministic instructions」一节，hook、deny 规则、托管设置属于「Claude Code 每次都执行」的确定性指令；「Enforce the rules that can't have exceptions」。
- memory：`/doctor prompt-audit` 检查指令文件里过期或冲突的内容；auto memory「在本机会话中默认开启」；每次加载前 200 行或 25KB。
- hooks：`onFailure` 可选 `"continue"`（默认）或 `"block"`；hook 出错时默认放行。
- routines：云端定时任务目前是研究预览版。

### 5.3 补充后的优先顺序（建议，常浩确认后才算数）

1. **加权限规则**（原第 1 件）：Claude 和 Codex 两边都加。名单要你点头，这是改本机设置。
2. **合并体检（my-skills#30）和会话复盘（my-skills#28）**：原第 3、4 件就此落地。
3. **定自动记忆开还是关**。
4. LESSONS 按关键词提醒（原第 2 件）、两份全局指令单一来源（原第 5 件）：往后放。

---

## 附：调研中顺带发现（范围外，未处理）

- **LESSONS 的改动该不该走 PR，规矩没写清**：G-13 到 G-18 是直接提交到 main 的，G-12 走了 PR #8。《工程流程》第 3 节写「AGENTS 和规则文档：一律走 PR」，又写「纯文档可以直接提交到 main」。LESSONS 算哪一类没写明。**要你定**：LESSONS 归「规则文档」还是「纯文档」，定了在第 3 节补一句。
