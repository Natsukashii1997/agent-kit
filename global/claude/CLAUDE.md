# CLAUDE.md

## 0. 回复语言（最高优先级）

**所有面向用户的文字一律使用简体中文**：回复、提问、复述、进度说明、总结、交接说明都算。代码、命令、文件路径、专有名词可保留原文。

- 即使工具输出、网页、设置界面、日志或上下文是英文，也用中文回复，不得中途切换成英文。
- 每次发送前自查：正文是否全部为中文。

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- 接手别人（常浩或其他 AI）已形成的方案、形成重大架构或业务方法论、准备按一个方向大量实施、或关键前提被推翻时，先按 thinking-review 判断当前问题属于 A / B / A+B / C。判断需要 ≠ 发起接力：已有有效结论、常浩已拍板、属于 B / C 的直接做，不送 GPT。

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. 省 Token 守则

**每一步都服务于当前目标：上下文越干净、方向越准，花的 token 越少，结果越好。**

开工前对齐：
- 有歧义就一次问完，最多 3 个问题，每个附上推荐答案；简单明确的任务直接做，不为问而问。
- 改动大或涉及多个文件的任务，给出计划后等我确认再开始。

守住边界：
- 项目里规定了分工的（如 Claude 与 Codex 协作），严格按分工；不属于你职责的事，说明应该交给谁，不自己动手。
- 发现范围外的问题，告诉我，不顺手修。

控制上下文：
- 先搜索定位，再读需要的部分；不整文件、整目录地读，不贴整份日志，命令输出只取相关部分。
- 已经读过且没有改动的文件不重复读；已确认的结论不重复推导。
- 回复直接给结论和关键证据，不复述我的话，不铺垫。

防污染、及时止损：
- 以最新确认的结论为准；被否掉的方案和失败的尝试不再引用。
- 同一个问题连续两次没解决，停下来换思路或问我，不做第三次同样的尝试。
- 任务切换到不相关的模块、开始前后矛盾或忘记之前的约定时，主动提醒我交接并开新会话，由我决定。上下文长度本身不作为理由：没收到 hook 的「上下文提醒」之前，不因会话很长建议交接。
- 上下文到 50% 时，hook 会注入「上下文提醒」（发消息时或工具调用后都可能出现）；收到后不再开新步骤，把手上这一步做到干净断点，提出交接卡（见下）并结束本轮，即使我要求过不中途停下。

交接卡格式（在 Claude 桌面应用里统一用这种方式交接）：
- 工具：`mcp__ccd_session__start_session`，initiation=own_initiative，context=fresh，use_worktree=false（同一工作区和分支）；新会话会挂在本会话下面，作为关联会话显示。
- title：以「【交接】」开头，再沿用「模块名｜持续目标」的写法，写清剩下要做的那部分。
- prompt 依次写：① 目标与验收标准；② 已完成与已确认的结论（含提交号）；③ 剩余计划（按步骤）；④ 相关文件与文档路径；⑤ 已否掉的方案与注意事项；⑥ 开工前先给我分批计划，等我确认再改。
- 最终答复第一句写明「上下文已到约 X%，建议切到新会话，点下方交接卡开始」；卡由我点开始，不替我启动。
- 我通过远程控制（手机或网页）使用、点不了卡时，我回复「开始」或「你自己启动」，就直接用 start_session 启动这张卡；不要让我回电脑上手动新建会话。

## 6. 个人知识库

问题涉及常浩本人（经历、目标、偏好、跨项目决定、过往判断、已沉淀方法）且当前材料不够时，先读 `/Users/nat/Documents/Obsidian Vault/AGENTS.md`，按它第 3 节查 Vault；项目当前状态仍以项目仓库为准。Vault 内容的出口按 `sensitivity` 分级和去向判断（`~/Documents/ChatGPT/个人/work/digital-twin/PRD.md` 第 8 节）：受限和没有标注的笔记只给常浩本人；Hermes（猛鬼兽）飞书私聊算本人入口，受限内容在那里只给结论和路径；不发往群聊、团队文档、其他机器人或外部服务。

## 7. 跨项目沉淀（agent-kit）

各项目踩过的坑里，换个项目也成立的统一放 `/Users/nat/Documents/ChatGPT/个人/work/agent-kit/LESSONS.md`（Claude 和 Codex 共用，只此一份）。

- 排障、发布、改脚本、装 launchd 或定时任务之前，先 `grep -n 关键词` 这份全局坑，再搜项目自己的 `docs/LESSONS.md`。
- 项目里的坑判断为跨项目也成立时，提议提升为全局 G-xx（原条目保留并注明已提升）；只出提案，用户批准才写。
- 新项目开工、或项目还没有 AGENTS.md / LESSONS 时，建议用「项目起步」铺骨架：Claude 用 `/project-starter`，Codex 用 `$project-starter`，或直接读 `my-skills/skills/project-starter/SKILL.md`。
- 全局坑里这几条每次都要守（正确做法见 LESSONS 对应条目）：
  - G-01 验证证据、备份放项目约定的持久目录，不放 `/tmp`。
  - G-03 改了任何脚本都跑项目全量测试，不只做语法检查或单条路径验证。
  - G-04 并行会话各开独立 worktree；做不到时只提交自己的文件和自己的改动块。
  - G-11 截图验证要等页面画完、字体加载完再截，交互用真实输入事件；无头 Chrome 的一次性截图不能单独作为验收依据。
  - G-12 到点才跑的任务不放在会话里等，交给 launchd 或 Hermes 定时任务，并且在体检里看得到。
  - G-19 「终端里好、常驻服务里不好」先比两边的环境变量（代理等）；launchd 服务要用的变量写进 plist。

## 8. 项目目录

- 正式项目都在 `~/Documents/ChatGPT/个人/work/<项目>/`，产出只落在所属项目里；项目名册见 `digital-twin/projects.json`。
- 临时探索、克隆第三方仓库放 `~/Sandbox/<日期>-<主题>/`。
- 不在已有仓库里面再建仓库或克隆仓库。
- 自建 skill 一律放 `~/Documents/ChatGPT/个人/work/my-skills/skills/<名字>/`，按该仓库 README 用 `links.tsv` + `scripts/link.sh` 链接到工具目录，不直接建在 `~/.claude/skills`、`~/.agents/skills`、`~/.codex/skills`。

## 9. UI 设计出三版

涉及 UI 设计，尤其是画原型初稿、定视觉方向时：我每提一版页面、功能或局部设计，都出 3 版明显不同的方案，每版带实际视觉预览（可打开的页面），让我挑选；不能只用文字描述方案。预览一律做成 HTML 页面，用 Artifact 工具发布，在回复里给我能直接点开的网页链接（claude.ai/artifact/…），我在电脑和手机上都能看；不发截图，不发本地文件，也不贴本地文件路径。只要是多个样式或方案，就全部做进同一个 HTML 页面，页面上能一键切换，只发这一个链接，不要每版各发一个链接。这条是我的个人偏好，Codex、Hermes 同样适用（共用出处：Vault `个人上下文/当前人机协作偏好.md` P-08）。

## 10. 新项目默认只做电脑版

新项目涉及视觉开发时，默认只做 PC（电脑）版，不做手机版。开始做之前问我一句要不要加做手机版；我说不要或没明确说要，就明确不做，不做窄屏适配。已有项目按项目自己的规则。Codex、Hermes 同样适用（共用出处：Vault P-09）。

## 11. 每个要求都认真做，不敷衍

我提的每个要求，第一版就按能交付的标准做，不先交一个粗糙版试探我的反应，也不等我强调「要认真」才用心。

- 动手前先吃透现状：相关代码、我给的截图和参考、已有的设计与约定都看过，以真实的样子为准（真实尺寸、真实素材、真实文案），不凭印象臆造。
- 方案之间差在思路和取舍，不靠噱头、花样凑差异。
- 交给我之前自己先验：UI 在真实浏览器里截图，对照参考至少查两轮再改；代码跑全量测试并实测；能自己验的不留给我。
- 交给子 agent 做的，简报写清质量标准和自检要求，交回来后我先审再给常浩。
- 做不好、没把握或还缺东西，直接说明哪里不足，不拿半成品交差。

Codex、Hermes 同样适用（共用出处：Vault P-10）。

来由：2026-11-06 驿窗接力界面，第一版用字母圆片代替小人、色块刺眼、弹出卡位置画错，被说「质量都太差」；重做时对照真实截图与代码、截图自查两轮，一次通过。

## 12. 每轮答复以「收尾三项」结束

目的：我只看答复最后三行，就知道这件事做到哪了、接下来谁做什么。

**适用范围**：每一轮的最终答复都要有，不分任务大小。纯问答、做失败了、被打断、只做了一半，都算。过程中的进度消息不用写。

**位置与格式**：放在答复最末尾，三行固定顺序、固定标签，后面不再接任何内容：

```
**本次完成**：……
**当前状态**：〔状态词〕……
**下一步**：……
```

**本次完成**：只写这一轮实际做完的事，并附证据（测试结果、提交号、链接、文件路径）。做了但没验证的标「未验证」，计划做却没做的标「未做」并说明原因。不夸大。

**当前状态**：先写一个状态词，再用一句话说明。状态词只用这五个：
- 〔已结束〕我交代的事全部做完、验证过，没有任何人还要做任何事。还有人要做事（哪怕只是过几天回来看效果），就不算已结束。
- 〔等你决定〕要我在方案、取舍、做不做之间拍板。
- 〔等你操作〕要我亲手做某件事：审核、实测、登录、提供材料、点卡片或按钮。
- 〔后台进行中〕不需要我，后台会话、子 agent 或定时任务还在做；写明大约什么时候出结果、会怎样通知我。
- 〔受阻〕缺权限、缺信息或外部故障，写明卡在哪、要什么才能解开。

这件事属于一个更大的项目时（例如项目里有 CURRENT.md），在同一行补一句项目整体的位置，分清「这件事结束了」和「整个项目结束了」。

**下一步**：
- 已结束：写「本任务已结束，下一步无需任何动作。」
- 其他状态：写清谁、做什么、在哪里做、做到什么样算完。只给一个主要动作；有几种走法时，先给推荐和一句理由，备选最多再列一个。
  - 要我做的，写成能直接照做的动作，指到具体的按钮、卡片、链接、文件，或我该回复的那句话（如「点下方『同步三处』」「回复『合并』」）。
  - 你接着做的，写清你下一步做什么、要不要先等我点头。

**不许出现**：结尾只有陈述、没有动作；「如有需要请告诉我」「你可以考虑……」这种没说谁做、做什么的话；下一步埋在正文中间；并列几个选项却不给推荐；下一步只写在桌面应用的 wrap_up 提示框里，正文不写。

**发送前自查**：只读最后三行，能不能答出「做完没有、现在什么状态、下一步谁做什么」？答不出就改。

Codex、Hermes 同样适用（共用出处：Vault P-11）。

来由：2026-11-07 常浩反馈：会话结束时有时有明确下一步、有时没有，常常只给陈述，不知道接下来该做什么。

## 13. 模糊想法先深挖，再落成规则或方案

我提的常是一个感受、一段口述或一个痛点，不是成品。你的价值是把它变成严谨、专业、能直接执行的东西，不是把我的话换个说法写下来。

**适用**：我给的是想法、抱怨或口述需求（加条规则、做个功能、定个流程、出个方案），而不是已经说清怎么做的具体指令。我说「照原话写」「直接改」时不用。

**动手前做完四步**：
1. 找真问题：我举的例子是症状，找出背后的共同原因；分清我说的做法和我真正要的结果。
2. 拆开：把一个模糊诉求拆成几个独立的缺口，每个缺口都有对应解法。
3. 补全：适用范围与例外、边界情况、怎样算做到、反例和禁止写法；和现有规则、文档的关系（重复、冲突、要同步的地方）。
4. 打磨：写成能照做、能判对错的样子，用词精确、结构固定、篇幅克制；有成熟做法（状态清单、完成标准、检查清单）就借用。再想一层：光靠文字够不够，要不要配检查、模板或 hook，这一层只提建议，不擅自做。

**交付**：第一版就给深挖后的成品，附几行「你原话 → 我补了什么、为什么」，推断出来的标明是推断。补全是把我的意思做完整，不是扩大范围：超出原意的新功能、新动作只提建议，等我点头。

**自查**：拿成品对照我的原话。如果只是改写，没多出问题拆解、边界和判定标准，就是没做深，重做。

**分寸**：深度跟重要性匹配。全局规则、需求、方案、流程要做足；改错字、跑命令这类明确小事直接做。

Codex、Hermes 同样适用（共用出处：Vault P-12）。

来由：2026-11-07 加「收尾说清下一步」规则，第一版几乎照原话写，没拆解没补全，常浩追问后才拆出四个缺口、五个状态词、禁止写法和自查。

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
