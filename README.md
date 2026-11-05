# agent-kit

Claude 和 Codex 跨项目共用的协作底座：各项目里换个项目也成立的坑，和新项目的起步骨架。只此一份，两边都从这里读；进化就是这个仓库的提交。

## 里面有什么

- [LESSONS.md](LESSONS.md)：全局坑 G-xx。排障、发布、改脚本、装 launchd 或定时任务之前先 `grep`。
- [机器执行层](docs/机器执行层.md)：把最要紧的几条规矩交给机器——不可逆操作「先问 / 直接拒绝」（权限规则 + hook）、LESSONS 按关键词自动提醒、agent-kit 自检 `tools/doctor.mjs`、每周整理输入 `tools/weekly-review.mjs`。launchd / Hermes 体检和会话复盘不在这里，归 my-skills 的 automation-checkup、session-retro。`node tools/install.mjs` 预览、加 `--apply` 装进本机 Claude Code 和 Codex。
- 「项目起步」project-starter：给新项目铺两层骨架。2026-10-27 起和其他自建 skill 一起放在 [my-skills](https://github.com/Natsukashii1997/my-skills)（本机 `~/Documents/ChatGPT/个人/work/my-skills/skills/project-starter/`），`~/.agents/skills/project-starter` 是指向那里的链接，Claude 用 `/project-starter`，Codex 用 `$project-starter`。

## 分层

- **协作规矩归 agent-kit**：AGENTS 入口与导航表、LESSONS 与三级升级、交接格式、防伪造五条、通用规则检查。
- **机器执行层也归 agent-kit**：跨项目的 hook、权限规则、agent-kit 自检和每周汇总（`hooks/`、`config/`、`tools/`）。改了跑 `node --test tests/*.test.mjs`。
- **开发流程归 Matt Pocock skills**（`~/.agents/skills/`）：issue → `to-spec` / `to-tickets` → `implement` / `tdd` → `code-review` → PR；每个仓库的 `docs/agents/` 写明 issue 看板、分流标签和领域文档放哪。
- **改动怎么走归《工程流程》**（[工程流程.md](工程流程.md)）：issue → 分支 → PR → 合并的走法、分支命名、交接写在 PR 里、Claude 和 Codex 交替。
- `project-starter` 铺骨架时两层一起铺；已有项目只缺开发流程这层的，跑 `setup-matt-pocock-skills`。

## 怎么接入

- `~/.claude/CLAUDE.md`「7. 跨项目沉淀」和 `~/.codex/AGENTS.md`「跨项目沉淀」各有一段同样的话指向这里。两段要一起改、保持一字不差。

## 怎么进化

- 项目 `docs/LESSONS.md` 的第三级升级：换个项目也成立的坑，提议提升到这里的 LESSONS（写法见它开头）。
- 每次改动都提交，提交说明写来源（项目名 + 条目号或每周整理的提案编号）。只出提案、用户批准才改。
