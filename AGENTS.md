# agent-kit 协作约定（Codex / Claude 必读）

Claude 和 Codex 跨项目共用的协作底座：全局坑 LESSONS 和项目起步骨架 project-starter。所有面向用户的文字用简体中文。进入顺序：本文件 → [README.md](README.md)（里面有什么、怎么接入、分层、怎么进化）。

## 规则

- 改 LESSONS 和骨架都只出提案，常浩批准才写；每次改动单独提交，提交说明写来源（项目名 + 条目号，或每周整理的提案编号）。
- 骨架 project-starter 已迁到 `~/Documents/ChatGPT/个人/work/my-skills/skills/project-starter/`（自建 skill 统一放 my-skills），改骨架在那个仓库改，改前先在临时目录试铺。
- 不往这里写任何人的私人信息、账号或凭据。

## Agent skills

开发流程用 Matt Pocock skills（`~/.agents/skills/`）：大活走 `to-spec` → `to-tickets` → `implement` / `tdd` → `code-review` → PR；小改（一张 issue、一天内做完）跳过 `to-spec`。Claude 用 `/技能名`，Codex 用 `$技能名`；这几个技能只在点名时加载，不会自动触发。

### Issue tracker

需求、规格与任务用本仓库 GitHub Issues。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个默认分流标签。见 `docs/agents/triage-labels.md`。

### Domain docs

single-context：根目录 `GLOSSARY.md` 与 `docs/adr/`，用到时再建。见 `docs/agents/domain.md`。

改动怎么走、分支怎么起名、交接写在哪、怎么合并：见 [工程流程.md](工程流程.md)。
