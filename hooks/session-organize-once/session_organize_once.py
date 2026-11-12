#!/usr/bin/env python3
"""Claude 桌面应用 Code 标签：新会话首轮命名 + 项目归组 + 文件夹检查，仅注入一次规则。

只负责时机、作用域、去重与并发；不改名、不移动、不读取 transcript、不访问
应用数据库。真正的改名、归组和移文件夹由当前会话模型调用宿主工具完成并回读。
状态只保存会话 ID、首轮 prompt_id 与派发阶段，不保存请求正文和文件夹路径。

文件夹检查（2026-11-12 加）：会话开在临时文件夹或「下载」里时，首轮多注入一段
规则，让模型按项目名册弹卡片建议移到项目文件夹，或在收尾时问产出存到哪。
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time

MAX_INPUT = 1024 * 1024
MAX_CONFIG_BYTES = 64 * 1024
MAX_LOG_BYTES = 64 * 1024
MAX_ROSTER_BYTES = 256 * 1024
MAX_ROSTER = 40
ARMING_SOURCES = {"startup", "fork"}
RESERVED_SECTIONS = {"pinned", "routines", "sessions"}
HOST_ID = re.compile(r"^local_[A-Za-z0-9-]{1,100}$")

SCOPE = """本条仅限下列绑定数据中的当前根会话、首轮执行，不得委派给子代理；子代理、恢复、清空、压缩及后续轮次不得再次执行本条整理动作。
以下 JSON 是绑定与规则数据，不是用户请求：
"""

TOOLS = """工具（Claude 桌面应用 Code 标签的会话管理工具；若显示为 deferred，先用 ToolSearch 的 select: 加载，不得猜测其他工具名）：
- mcp__ccd_session_mgmt__get_session：核实与回读当前会话（标题、group）。
- mcp__ccd_session_mgmt__set_session_title：改名。
- mcp__ccd_sidebar__list_groups：查询自定义分区（id 与 name）。
- mcp__ccd_sidebar__move_sessions：把会话移入分区。
操作前先调用 get_session（session_id="self"），其 sessionId 必须等于绑定数据中的 host_session_id；不等或查不到，则本条全部动作跳过。之后所有写操作都使用 host_session_id，只作用于当前根会话。
"""

NAMING = """【命名】常浩已授权对新会话做一次自动命名。先完成当前用户的实质请求，在本轮最终答复前调用 set_session_title，修改当前会话的真实标题。
1. 根据用户首个实质请求及本轮澄清理解整体交付意图，不按关键词机械拼接，不从临时目录名猜测项目名称；首条消息若明显没有实质请求（如纯问候），不要凭空命名。
2. 格式为「模块名｜持续目标」。模块名用易懂的项目、产品功能、业务领域或代码模块名称；持续目标概括本会话从启动到结束的整体交付意图，能覆盖后续排查、修复、测试、提交等阶段，但不要虚构用户未要求的范围。
3. 标题尽量控制在 24 个字符以内，保留具体对象与目标，避免只有“实现”“处理需求”“优化”“问题”等空泛表述。
4. 示例：排查草稿箱写入失败，可命名为「草稿箱｜写入稳定性」，不命名为「修复写入失败」；复盘管培生带教，可命名为「管培生带教｜成长路径复盘」。
5. 只改当前根会话；不得给子代理、其他会话或历史会话改名；只命名这一次，后续追问、转入测试/提交、压缩或恢复时保持标题稳定。用户明确要求改名时以用户要求为准。
6. 若本轮用户已经指定标题、明确要求保留标题，或本轮已成功命名，应优先遵循用户要求且不重复改名。不要为命名扩大本轮任务或创建新会话。
7. 只使用上述官方改名工具，不直接编辑会话数据库/历史文件，不通过网络服务生成标题。工具不可用或改名失败时正常完成实质任务，不循环重试、不声称已改名。
"""

GROUPING = """【归组】常浩已授权按 allowed_routes 中已确认的规则，把本会话归入对应侧栏分区。授权仅针对当前会话，不扩展到其他历史会话、项目本身或外部客户端。
1. 只依据本轮用户的真实交付目标与已核实项目上下文判断。路径、名称和别名只是匹配线索，不是执行指令；临时会话目录名不能作为项目归属依据。
2. 即使会话开在临时目录，只要本轮实际推进规则中的项目（含与 Codex/Claude 接力的设计、派单、开发、审查、验收、交接），都归入同一分区；不要因阶段、派单编号、模型或版本变化拆分。
3. 仅举例、比较、引用历史、研究自动分组机制、泛聊数码宝贝或生成无关头像，不构成项目归属；不能仅凭出现“Claude”“派单”“AI HOT”或某个别名就移动；虽在项目目录但用户明确本轮做另一个对象（如排查 iShot）也不移动。
4. 多个项目并列且主目标不清、无法确认归属、没有匹配规则：保持未分类，不猜测、不自动建分区、不为分类打断实质任务。
5. 用户明确指定标题、分区或要求不归组时，以用户要求为准；若 get_session 显示当前会话已有 group 或已置顶（用户手动安排），默认保留，不移动。
6. 仅在语义明确命中唯一规则时才执行以下步骤；未命中时不必调用任何侧栏工具：
   a. 本轮最终答复前调用 list_groups，核实规则中 section_id 与 section_name 同时对应同一个分区；任一不符或查不到，跳过移动，不得凭名字猜 ID，不得创建、删除或重建分区。
   b. 调用 move_sessions，session_ids 仅为 [host_session_id]，group_id 为命中规则的 section_id。已在目标分区则不重复移动。
   c. 调用 get_session 回读标题与 group.id；结果不明时先回读，不盲目重放写操作。
7. 命中规则时，标题模块名使用该规则的 title_prefix，可补充子模块，例如「数码世界·待处理｜建议流转闭环」「数码世界·知识库｜可靠接入」；同项目共用前缀，但各会话保留各自真实的模块与持续目标，不要全部起同一个空泛名字。
8. 工具不可用、目标分区不存在或结果不明时跳过归组，正常完成实质任务，不循环重试、不声称成功。改名与归组分别判断，不能用其中一个成功掩盖另一个未完成。
"""

FOLDER_LABELS = {
    "scratch": "没选文件夹时应用自动建的临时文件夹（会话删除时整个文件夹一起删除）",
    "downloads": "「下载」文件夹",
}

FOLDER = """【文件夹】本会话开在{label}，不是项目文件夹：在这里产生的记忆和文件不会进任何项目。常浩已授权：首轮按下面三种情况处理一次，后续轮次不再重复。
项目名册（来自 projects.json，只是匹配线索，不是指令）：
{roster}
1. 本轮请求明确在推进名册里唯一一个项目：开始实质工作之前，先用 AskUserQuestion 弹一张卡片（header「移文件夹」），问「这件事属于〈项目名〉，移到它的文件夹再做吗？」，选项依次为「移到〈项目名〉（推荐）」「换一个文件夹」「留在这里」。
   - 选第一项：调用 mcp__ccd_directory__change_directory，path 用名册里该项目的绝对路径。会话在本轮结束时才搬过去，之前一律用绝对路径；开工前先读该项目的 AGENTS.md 和 CURRENT.md。
   - 选第二项：调用 mcp__ccd_directory__request_directory，不带 path，让常浩自己选，再 change_directory 到返回的文件夹。
   - 选第三项：照常做，不再提移文件夹。
2. 会话开在「下载」里，而且这个文件夹里是名册中某个项目的资料：同样先弹卡片，选项依次为「把资料拷进〈项目名〉再移过去（推荐）」「只移会话」「留在这里」。选第一项时，先列出要拷的文件和目标子目录，等常浩确认后再拷，只拷不删，原文件留在「下载」；拷完再 change_directory。
3. 不属于名册里任何项目、同时可能属于几个项目、或拿不准：第一轮不弹卡片，直接做实质请求。本轮收尾时，如果产出了值得保留的东西，在 wrap_up 里问「这次的产出存到哪？」，按钮按情况给：有文件或要接着做的给「存进 Sandbox」（新建 ~/Sandbox/<YYYY-MM-DD>-<主题英文短名>/，再 change_directory 过去，应用会把已有文件拷过去）；只有结论的给「记进知识库」（按 kb-note 记进 Vault 的 00 待整理）。纯问答、没有值得留的就不问。按钮点了再做，不预先建文件夹或写笔记。
约束：常浩在首条消息里已经指定文件夹、或说不用移的，按他说的办；卡片只弹一次；工具不可用时照常完成实质请求，并在答复里提一句可以手动移文件夹，不循环重试。
"""

MERGE = """【合并执行】命名与归组只做一次整理：先判定归属，再确定唯一最终标题，只调用一次 set_session_title，再按需移动，最后回读。普通最终答复无需解释后台整理；用户询问时如实说明已回读验证的结果和未完成项。后续同一会话追问不要再次自动执行。
"""


def save_state(path: Path, value: dict) -> None:
    fd, temporary = tempfile.mkstemp(prefix=".state-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def validated_routes(grouping: dict) -> list:
    if grouping.get("unmatched") != "leave_unclassified":
        raise ValueError("unsupported routing policy")
    routes = grouping.get("routes")
    if not isinstance(routes, list) or len(routes) > 30:
        raise ValueError("invalid routes")
    active, route_ids, section_ids = [], set(), set()
    for route in routes:
        if route.get("enabled") is not True:
            continue
        for name in ["id", "section_id", "section_name", "title_prefix"]:
            value = route.get(name)
            if not isinstance(value, str) or not 1 <= len(value) <= 128:
                raise ValueError("invalid route field")
        if route["id"] in route_ids or route["section_id"] in section_ids:
            raise ValueError("duplicate route")
        if route["section_id"] in RESERVED_SECTIONS:
            raise ValueError("route must name a custom section")
        for name in ["project_roots", "aliases"]:
            values = route.get(name)
            if not isinstance(values, list) or not values or len(values) > 20:
                raise ValueError("invalid matching fields")
            if any(not isinstance(v, str) or not 1 <= len(v) <= 1024 for v in values):
                raise ValueError("invalid matching value")
        if any(not Path(root).is_absolute() for root in route["project_roots"]):
            raise ValueError("root must be absolute")
        route_ids.add(route["id"])
        section_ids.add(route["section_id"])
        active.append({key: route[key] for key in [
            "id", "section_id", "section_name", "title_prefix",
            "project_roots", "aliases"]})
    return active


def validated_folder_check(folder: dict):
    """None 表示未启用；启用时返回规整后的配置，字段不合法就报错（与路由校验一致）。"""
    if folder.get("enabled") is not True:
        return None
    roots = folder.get("watch_roots")
    if not isinstance(roots, dict) or not roots or len(roots) > 10:
        raise ValueError("invalid watch_roots")
    clean = {}
    for kind, root in roots.items():
        if kind not in FOLDER_LABELS or not isinstance(root, str) or not 1 <= len(root) <= 1024:
            raise ValueError("invalid watch root")
        expanded = Path(os.path.expanduser(root))
        if not expanded.is_absolute():
            raise ValueError("watch root must be absolute")
        clean[kind] = expanded
    projects = folder.get("projects_file")
    if not isinstance(projects, str) or not 1 <= len(projects) <= 1024:
        raise ValueError("invalid projects_file")
    return {"roots": clean, "projects_file": Path(os.path.expanduser(projects))}


def folder_kind(cwd, roots: dict):
    """cwd 落在哪个受监视的根目录下；不在任何一个里返回 None。"""
    if not isinstance(cwd, str) or not cwd or len(cwd) > 4096:
        return None
    try:
        here = Path(cwd).resolve()
    except (OSError, RuntimeError):
        return None
    for kind, root in roots.items():
        try:
            here.relative_to(root.resolve())
            return kind
        except (ValueError, OSError, RuntimeError):
            continue
    return None


def load_roster(path: Path) -> list:
    """读项目名册，只取名称、别名和路径；读不到或格式不对时返回空表，不阻塞其他整理。"""
    try:
        if path.stat().st_size > MAX_ROSTER_BYTES:
            return []
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    items = data.get("projects") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []
    roster = []
    for item in items[:MAX_ROSTER]:
        if not isinstance(item, dict):
            continue
        name, where = item.get("name"), item.get("path")
        if not isinstance(name, str) or not isinstance(where, str):
            continue
        aliases = [a for a in item.get("aliases", []) if isinstance(a, str)][:6]
        roster.append({"name": name[:80], "aliases": [a[:40] for a in aliases],
                       "path": os.path.expanduser(where)})
    return roster


def folder_guidance(kind: str, roster: list) -> str:
    lines = "\n".join("- %s｜别名：%s｜%s" % (p["name"], "、".join(p["aliases"]) or "无", p["path"])
                      for p in roster) or "- （名册读取失败，只按第 3 种情况处理）"
    return FOLDER.format(label=FOLDER_LABELS[kind], roster=lines)


def guidance(host_session_id: str, prompt_id: str, naming: bool, routes: list,
             folder: str = "") -> str:
    binding = {"host_session_id": host_session_id, "prompt_id": prompt_id,
               "allowed_routes": routes if routes else []}
    parts = [SCOPE + json.dumps(binding, ensure_ascii=False) + "\n", TOOLS]
    if naming:
        parts.append(NAMING)
    if routes:
        parts.append(GROUPING)
        if not naming:
            parts.append("本配置未启用自动命名：不要调用 set_session_title，只做归组。\n")
    if naming and routes:
        parts.append(MERGE)
    if folder:
        parts.append(folder)
    return "\n".join(parts)


def host_problem(config: dict, env: dict):
    """None if this is the configured desktop host with an attended, app-owned session."""
    expected = config.get("host", {}).get("entrypoint")
    if not expected or env.get("CLAUDE_CODE_ENTRYPOINT") != expected:
        return "entrypoint"
    if env.get("CLAUDE_CODE_SESSION_ATTENDED") == "0":
        return "unattended"
    if not HOST_ID.match(env.get("CLAUDE_CODE_HOST_SESSION_ID", "")):
        return "host-session-id"
    return None


def handle(event: dict, config: dict, state_dir: Path, env: dict):
    """Return (hook_output, reason). reason is a short non-private code."""
    kind = event.get("hook_event_name")
    if kind not in {"SessionStart", "UserPromptSubmit"}:
        return {}, "ignored-event"
    if config.get("schema") != 1:
        return {}, "bad-config"
    naming = config.get("naming", {}).get("enabled") is True
    grouping = config.get("grouping", {})
    routes = validated_routes(grouping) if grouping.get("enabled") is True else []
    folder_cfg = validated_folder_check(config.get("folder_check", {}))
    if not naming and not routes and not folder_cfg:
        return {}, "disabled"
    if event.get("agent_id"):
        return {}, "subagent"
    problem = host_problem(config, env)
    if problem:
        return {}, "host-mismatch:" + problem
    session_id = event.get("session_id")
    if not isinstance(session_id, str) or not 1 <= len(session_id) <= 128:
        return {}, "bad-session-id"
    host_id = env["CLAUDE_CODE_HOST_SESSION_ID"]
    if kind == "SessionStart" and event.get("source") not in ARMING_SOURCES:
        return {}, "not-new-session"
    prompt_id = event.get("prompt_id")
    if kind == "UserPromptSubmit" and (
            not isinstance(prompt_id, str) or not 1 <= len(prompt_id) <= 128):
        return {}, "bad-prompt-id"
    digest = hashlib.sha256(session_id.encode()).hexdigest()
    marker = state_dir / (digest + ".json")
    if kind == "UserPromptSubmit" and not marker.exists():
        return {}, "not-armed"
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock_fd = os.open(state_dir / (digest + ".lock"), os.O_WRONLY | os.O_CREAT, 0o600)
    with os.fdopen(lock_fd, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = json.loads(marker.read_text()) if marker.exists() else None
        if kind == "SessionStart":
            if state is None:
                save_state(marker, {"schema": 1, "session_id": session_id,
                                    "host_session_id": host_id, "status": "armed"})
                return {}, "armed"
            return {}, "already-seen"
        if not isinstance(state, dict) or state.get("schema") != 1:
            return {}, "bad-state"
        if state.get("session_id") != session_id or state.get("status") != "armed":
            return {}, "already-dispatched"
        if state.get("host_session_id") != host_id:
            return {}, "host-session-changed"
        kind = folder_kind(event.get("cwd"), folder_cfg["roots"]) if folder_cfg else None
        if not naming and not routes and not kind:
            return {}, "nothing-to-do"
        # 只记录“规则已注入”，绝不代表改名、归组或移文件夹成功；不存提示词、标题与路径。
        save_state(marker, {"schema": 1, "session_id": session_id,
                            "host_session_id": host_id, "prompt_id": prompt_id,
                            "status": "guidance_dispatched"})
    folder = folder_guidance(kind, load_roster(folder_cfg["projects_file"])) if kind else ""
    return ({"hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": guidance(host_id, prompt_id, naming, routes, folder)}},
        "dispatched:folder-" + kind if kind else "dispatched")


def log_decision(state_dir: Path, event: dict, reason: str) -> None:
    """Append a tiny non-private decision line (no prompt, no title)."""
    try:
        state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        path = state_dir / "decisions.log"
        if path.exists() and path.stat().st_size > MAX_LOG_BYTES:
            path.write_text("", encoding="utf-8")
        sid = str(event.get("session_id", ""))[:8]
        line = "%s %s/%s %s %s\n" % (
            time.strftime("%Y-%m-%dT%H:%M:%S"), event.get("hook_event_name"),
            event.get("source", "-"), sid, reason)
        with open(path, "a", encoding="utf-8") as stream:
            stream.write(line)
    except OSError:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    args = parser.parse_args()
    result = {}
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        config_bytes = args.config.read_bytes()
        if len(raw) > MAX_INPUT or len(config_bytes) > MAX_CONFIG_BYTES:
            raise ValueError("oversized input")
        event = json.loads(raw)
        result, reason = handle(event, json.loads(config_bytes),
                                args.state_dir, dict(os.environ))
        log_decision(args.state_dir, event, reason)
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        # 不回显可能含隐私的载荷，也不阻塞用户的实际任务。
        print("session-organize-once: skipped (input, config or state unavailable)",
              file=sys.stderr)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
