# agent-kit

Claude 和 Codex 跨项目共用的协作底座：各项目里换个项目也成立的坑，和新项目的起步骨架。只此一份，两边都从这里读；进化就是这个仓库的提交。

## 里面有什么

- [LESSONS.md](LESSONS.md)：全局坑 G-xx。排障、发布、改脚本、装 launchd 或定时任务之前先 `grep`。
- [skills/project-starter/](skills/project-starter/SKILL.md)：「项目起步」，给新项目铺两层骨架。`~/.agents/skills/project-starter` 是指向这里的链接，Claude 用 `/project-starter`，Codex 用 `$project-starter`。

## 分层

- **协作规矩归 agent-kit**：AGENTS 入口与导航表、LESSONS 与三级升级、交接格式、防伪造五条、通用规则检查。
- **开发流程归 Matt Pocock skills**（`~/.agents/skills/`）：issue → `to-spec` / `to-tickets` → `implement` / `tdd` → `code-review` → PR；每个仓库的 `docs/agents/` 写明 issue 看板、分流标签和领域文档放哪。
- `project-starter` 铺骨架时两层一起铺；已有项目只缺开发流程这层的，跑 `setup-matt-pocock-skills`。

## 怎么接入

- `~/.claude/CLAUDE.md`「7. 跨项目沉淀」和 `~/.codex/AGENTS.md`「跨项目沉淀」各有一段同样的话指向这里。两段要一起改、保持一字不差。

## 怎么进化

- 项目 `docs/LESSONS.md` 的第三级升级：换个项目也成立的坑，提议提升到这里的 LESSONS（写法见它开头）。
- 每次改动都提交，提交说明写来源（项目名 + 条目号或每周整理的提案编号）。只出提案、用户批准才改。
