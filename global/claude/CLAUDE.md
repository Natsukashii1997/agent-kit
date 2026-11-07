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

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
