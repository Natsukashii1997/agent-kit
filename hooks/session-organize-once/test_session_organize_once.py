#!/usr/bin/env python3
"""合成测试：只验证脚本状态、去重、作用域与规则派发，不调用真实改名/归组接口。"""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import session_organize_once as hook  # noqa: E402

# 仓库里只有示例配置；真实配置在状态目录，不进仓库（agent-kit#65）
EXAMPLE = HERE.parent.parent / "config" / "session-organize-once.example.json"
CONFIG = json.loads(EXAMPLE.read_text(encoding="utf-8"))
ROUTE = CONFIG["grouping"]["routes"][0]
REAL_CONFIG = Path(os.environ.get("AGENT_KIT_STATE_DIR") or
                   Path.home() / "Library" / "Application Support" / "agent-kit") \
    / "session-organize-once" / "config.json"
ENV = {"CLAUDE_CODE_ENTRYPOINT": "claude-desktop",
       "CLAUDE_CODE_SESSION_ATTENDED": "1",
       "CLAUDE_CODE_HOST_SESSION_ID": "local_aaaa-1111"}
SID = "11111111-2222-3333-4444-555555555555"


def start(source="startup", sid=SID, **extra):
    return {"hook_event_name": "SessionStart", "session_id": sid,
            "source": source, **extra}


def prompt(sid=SID, pid="p-1", **extra):
    return {"hook_event_name": "UserPromptSubmit", "session_id": sid,
            "prompt_id": pid, "prompt": "SECRET-PROMPT-BODY", **extra}


class OrganizeOnce(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / "state"
        self.config = copy.deepcopy(CONFIG)
        self.env = dict(ENV)

    def tearDown(self):
        self.tmp.cleanup()

    def run_hook(self, event, config=None, env=None):
        return hook.handle(event, config or self.config, self.state,
                           self.env if env is None else env)

    def arm_and_prompt(self, source="startup", **kw):
        self.assertEqual(self.run_hook(start(source))[1], "armed")
        return self.run_hook(prompt(**kw))

    def context(self, out):
        return out["hookSpecificOutput"]["additionalContext"]

    # —— 触发时点 ——
    def test_startup_then_first_prompt_dispatches_once(self):
        out, reason = self.arm_and_prompt()
        self.assertEqual(reason, "dispatched")
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "UserPromptSubmit")
        self.assertEqual(self.run_hook(prompt(pid="p-2"))[1], "already-dispatched")
        self.assertEqual(self.run_hook(prompt(pid="p-3"))[0], {})

    def test_fork_arms_with_new_session_id(self):
        new = "99999999-0000-0000-0000-000000000000"
        self.assertEqual(self.run_hook(start("fork", sid=new))[1], "armed")
        self.assertEqual(self.run_hook(prompt(sid=new))[1], "dispatched")

    def test_resume_clear_compact_do_not_arm(self):
        for source in ("resume", "clear", "compact", None, "weird"):
            ev = start(source) if source else {"hook_event_name": "SessionStart",
                                              "session_id": SID}
            self.assertEqual(self.run_hook(ev)[1], "not-new-session", source)
        self.assertEqual(self.run_hook(prompt())[1], "not-armed")

    def test_prompt_without_session_start_is_ignored(self):
        self.assertEqual(self.run_hook(prompt())[1], "not-armed")

    def test_second_session_start_does_not_rearm_after_dispatch(self):
        self.arm_and_prompt()
        self.assertEqual(self.run_hook(start("startup"))[1], "already-seen")
        self.assertEqual(self.run_hook(prompt(pid="p-9"))[1], "already-dispatched")

    # —— 作用域 ——
    def test_subagent_events_never_arm_or_dispatch(self):
        self.assertEqual(self.run_hook(start(agent_id="sub-1"))[1], "subagent")
        self.run_hook(start())
        out, reason = self.run_hook(prompt(agent_id="sub-1", agent_type="Explore"))
        self.assertEqual((out, reason), ({}, "subagent"))
        # 子代理没有消耗主会话标记：主线程首轮仍可派发
        self.assertEqual(self.run_hook(prompt())[1], "dispatched")

    def test_main_thread_agent_type_without_agent_id_still_eligible(self):
        self.run_hook(start(agent_type="custom"))
        self.assertEqual(self.run_hook(prompt(agent_type="custom"))[1], "dispatched")

    def test_host_gate(self):
        for patch, why in (({"CLAUDE_CODE_ENTRYPOINT": "cli"}, "entrypoint"),
                           ({"CLAUDE_CODE_ENTRYPOINT": "sdk-cli"}, "entrypoint"),
                           ({"CLAUDE_CODE_SESSION_ATTENDED": "0"}, "unattended"),
                           ({"CLAUDE_CODE_HOST_SESSION_ID": ""}, "host-session-id"),
                           ({"CLAUDE_CODE_HOST_SESSION_ID": "not-local-id"}, "host-session-id")):
            env = {**ENV, **patch}
            self.assertEqual(self.run_hook(start(), env=env)[1],
                             "host-mismatch:" + why, patch)
        self.assertFalse(list(self.state.glob("*.json")) if self.state.exists() else [])

    def test_host_session_id_must_match_at_prompt_time(self):
        self.run_hook(start())
        other = {**ENV, "CLAUDE_CODE_HOST_SESSION_ID": "local_bbbb-2222"}
        self.assertEqual(self.run_hook(prompt(), env=other)[1], "host-session-changed")
        self.assertEqual(self.run_hook(prompt())[1], "dispatched")

    def test_invalid_ids_are_ignored(self):
        self.assertEqual(self.run_hook(start(sid=""))[1], "bad-session-id")
        self.assertEqual(self.run_hook(start(sid="x" * 129))[1], "bad-session-id")
        self.run_hook(start())
        self.assertEqual(self.run_hook(prompt(pid=""))[1], "bad-prompt-id")
        self.assertEqual(self.run_hook({"hook_event_name": "UserPromptSubmit",
                                        "session_id": SID})[1], "bad-prompt-id")

    def test_other_events_ignored(self):
        self.assertEqual(self.run_hook({"hook_event_name": "Stop",
                                        "session_id": SID})[1], "ignored-event")

    # —— 开关 ——
    def test_both_disabled_does_nothing(self):
        self.config["naming"]["enabled"] = False
        self.config["grouping"]["enabled"] = False
        self.config["folder_check"]["enabled"] = False
        self.assertEqual(self.run_hook(start())[1], "disabled")

    def test_naming_only(self):
        self.config["grouping"]["enabled"] = False
        text = self.context(self.arm_and_prompt()[0])
        self.assertIn("【命名】", text)
        self.assertNotIn("【归组】", text)
        self.assertNotIn(ROUTE["section_id"], text)

    def test_grouping_only(self):
        self.config["naming"]["enabled"] = False
        text = self.context(self.arm_and_prompt()[0])
        self.assertIn("【归组】", text)
        self.assertNotIn("【命名】", text)
        self.assertIn("不要调用 set_session_title", text)

    def test_all_routes_disabled_falls_back_to_naming_only(self):
        self.config["grouping"]["routes"][0]["enabled"] = False
        text = self.context(self.arm_and_prompt()[0])
        self.assertIn("【命名】", text)
        self.assertNotIn("【归组】", text)

    # —— 规则内容 ——
    def test_full_guidance_binds_claude_objects_not_codex_ones(self):
        text = self.context(self.arm_and_prompt()[0])
        self.assertIn("local_aaaa-1111", text)
        self.assertIn(ROUTE["section_id"], text)
        self.assertIn(ROUTE["section_name"], text)
        self.assertIn(ROUTE["title_prefix"], text)
        self.assertIn("mcp__ccd_session_mgmt__set_session_title", text)
        self.assertIn("mcp__ccd_sidebar__move_sessions", text)
        self.assertIn("【合并执行】", text)
        for codex_only in ("set_thread_title", "list_threads",
                           "move_thread_to_sidebar_section", "d2fb2b4e", 'source="codex"'):
            self.assertNotIn(codex_only, text)
        self.assertIn("模块名｜持续目标", text)
        self.assertIn("24", text)
        self.assertLess(len(text), 10000)  # 宿主 additionalContext 上限

    def test_state_never_stores_prompt_or_title(self):
        self.arm_and_prompt()
        stored = "".join(p.read_text() for p in self.state.glob("*.json"))
        self.assertNotIn("SECRET-PROMPT-BODY", stored)
        data = json.loads(next(self.state.glob("*.json")).read_text())
        self.assertEqual(data["status"], "guidance_dispatched")
        self.assertEqual(set(data), {"schema", "session_id", "host_session_id",
                                     "prompt_id", "status"})

    def test_state_dir_private(self):
        self.run_hook(start())
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)

    # —— 配置校验 ——
    def test_invalid_routes_rejected(self):
        bad_cases = []
        for mutate in (
            lambda r: r.update(section_id="sessions"),
            lambda r: r.update(section_id=""),
            lambda r: r.update(project_roots=["relative/path"]),
            lambda r: r.update(aliases=[]),
            lambda r: r.pop("title_prefix"),
        ):
            cfg = copy.deepcopy(CONFIG)
            mutate(cfg["grouping"]["routes"][0])
            bad_cases.append(cfg)
        dup = copy.deepcopy(CONFIG)
        dup["grouping"]["routes"].append(copy.deepcopy(dup["grouping"]["routes"][0]))
        bad_cases.append(dup)
        unm = copy.deepcopy(CONFIG)
        unm["grouping"]["unmatched"] = "create_section"
        bad_cases.append(unm)
        for cfg in bad_cases:
            with self.assertRaises(ValueError):
                self.run_hook(start(), config=cfg)

    def test_bad_schema(self):
        cfg = copy.deepcopy(CONFIG)
        cfg["schema"] = 2
        self.assertEqual(self.run_hook(start(), config=cfg)[1], "bad-config")


class FolderCheck(unittest.TestCase):
    """首轮文件夹检查：只在临时文件夹或「下载」里注入，名册来自 projects.json。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.state = base / "state"
        self.scratch = base / "scratch-workspaces"
        self.downloads = base / "Downloads"
        self.project = base / "work" / "carvomoto"
        for d in (self.scratch / "s1", self.downloads / "CarvoMOTO-资料", self.project):
            d.mkdir(parents=True)
        self.roster = base / "projects.json"
        self.roster.write_text(json.dumps({"projects": [
            {"id": "carvomoto", "name": "CarvoMOTO-汽配", "aliases": ["CarvoMOTO", "汽配"],
             "path": str(self.project)},
            {"id": "postpane", "name": "驿窗 PostPane", "aliases": ["驿窗"],
             "path": "/nowhere/postpane"}]}, ensure_ascii=False), encoding="utf-8")
        self.config = copy.deepcopy(CONFIG)
        self.config["folder_check"] = {
            "enabled": True,
            "watch_roots": {"scratch": str(self.scratch), "downloads": str(self.downloads)},
            "projects_file": str(self.roster)}

    def tearDown(self):
        self.tmp.cleanup()

    def dispatch(self, cwd, config=None):
        cfg = config or self.config
        self.assertEqual(hook.handle(start(), cfg, self.state, dict(ENV))[1], "armed")
        return hook.handle(prompt(cwd=cwd), cfg, self.state, dict(ENV))

    def test_scratch_folder_gets_folder_guidance_with_roster(self):
        out, reason = self.dispatch(str(self.scratch / "s1"))
        self.assertEqual(reason, "dispatched:folder-scratch")
        text = out["hookSpecificOutput"]["additionalContext"]
        for needle in ("【文件夹】", "临时文件夹", "CarvoMOTO-汽配", "汽配", str(self.project),
                       "AskUserQuestion", "mcp__ccd_directory__change_directory",
                       "mcp__ccd_directory__request_directory", "~/Sandbox/", "kb-note",
                       "【命名】"):
            self.assertIn(needle, text)
        self.assertLess(len(text), 10000)

    def test_downloads_subfolder_is_watched(self):
        out, reason = self.dispatch(str(self.downloads / "CarvoMOTO-资料"))
        self.assertEqual(reason, "dispatched:folder-downloads")
        text = out["hookSpecificOutput"]["additionalContext"]
        self.assertIn("「下载」文件夹", text)
        self.assertIn("只拷不删", text)

    def test_project_folder_unchanged(self):
        out, reason = self.dispatch(str(self.project))
        self.assertEqual(reason, "dispatched")
        self.assertNotIn("【文件夹】", out["hookSpecificOutput"]["additionalContext"])

    def test_lookalike_prefix_is_not_inside_root(self):
        lookalike = Path(self.tmp.name) / "Downloads-old"
        lookalike.mkdir()
        self.assertEqual(self.dispatch(str(lookalike))[1], "dispatched")

    def test_missing_or_bad_cwd_skips_folder(self):
        for cwd in (None, "", 42, "x" * 5000):
            self.state = Path(self.tmp.name) / ("state-%s" % type(cwd).__name__ + str(len(str(cwd))))
            self.assertEqual(self.dispatch(cwd)[1], "dispatched")

    def test_unreadable_roster_still_dispatches(self):
        self.config["folder_check"]["projects_file"] = str(Path(self.tmp.name) / "none.json")
        out, reason = self.dispatch(str(self.scratch / "s1"))
        self.assertEqual(reason, "dispatched:folder-scratch")
        self.assertIn("名册读取失败", out["hookSpecificOutput"]["additionalContext"])

    def test_folder_only_config(self):
        self.config["naming"]["enabled"] = False
        self.config["grouping"]["enabled"] = False
        out, reason = self.dispatch(str(self.scratch / "s1"))
        self.assertEqual(reason, "dispatched:folder-scratch")
        text = out["hookSpecificOutput"]["additionalContext"]
        self.assertIn("【文件夹】", text)
        self.assertNotIn("【命名】", text)
        self.assertNotIn("【归组】", text)

    def test_folder_only_outside_roots_does_nothing(self):
        self.config["naming"]["enabled"] = False
        self.config["grouping"]["enabled"] = False
        self.assertEqual(self.dispatch(str(self.project)), ({}, "nothing-to-do"))

    def test_state_never_stores_folder_path(self):
        self.dispatch(str(self.scratch / "s1"))
        stored = "".join(p.read_text() for p in self.state.glob("*.json"))
        self.assertNotIn("scratch-workspaces", stored)
        self.assertNotIn("SECRET-PROMPT-BODY", stored)

    def test_dispatches_only_once(self):
        self.dispatch(str(self.scratch / "s1"))
        again = hook.handle(prompt(pid="p-2", cwd=str(self.scratch / "s1")),
                            self.config, self.state, dict(ENV))
        self.assertEqual(again, ({}, "already-dispatched"))

    def test_invalid_folder_config_rejected(self):
        for mutate in (
            lambda f: f.update(watch_roots={}),
            lambda f: f.update(watch_roots=["~/Downloads"]),
            lambda f: f.update(watch_roots={"desktop": "/tmp"}),
            lambda f: f.update(watch_roots={"scratch": "relative/path"}),
            lambda f: f.pop("projects_file"),
        ):
            cfg = copy.deepcopy(self.config)
            mutate(cfg["folder_check"])
            with self.assertRaises(ValueError):
                hook.handle(start(), cfg, self.state, dict(ENV))

    def test_real_config_and_roster_fit_host_limit(self):
        if not REAL_CONFIG.exists():
            self.skipTest("本机没有装真实配置（CI 上正常跳过）")
        cfg = json.loads(REAL_CONFIG.read_text(encoding="utf-8"))
        real = hook.validated_folder_check(cfg.get("folder_check", {}))
        if not real or not real["projects_file"].exists():
            self.skipTest("真实配置没开文件夹检查或本机没有 projects.json")
        roster = hook.load_roster(real["projects_file"])
        self.assertGreater(len(roster), 0)
        text = hook.guidance("local_aaaa-1111", "p-1", True,
                             hook.validated_routes(cfg["grouping"]),
                             hook.folder_guidance("scratch", roster))
        self.assertLess(len(text), 10000)


class CommandLine(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / "state"

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, event, env=None, config=EXAMPLE, raw=None):
        proc = subprocess.run(
            [sys.executable, "-B", str(HERE / "session_organize_once.py"),
             "--config", str(config), "--state-dir", str(self.state)],
            input=raw if raw is not None else json.dumps(event).encode(),
            capture_output=True, env={**os.environ, **(env or ENV)}, timeout=15)
        self.assertEqual(proc.returncode, 0)
        return json.loads(proc.stdout), proc.stderr.decode()

    def test_full_cycle_through_stdin(self):
        self.assertEqual(self.run_cli(start())[0], {})
        out, _ = self.run_cli(prompt())
        self.assertIn("additionalContext", out["hookSpecificOutput"])
        self.assertEqual(self.run_cli(prompt(pid="p-2"))[0], {})
        log = (self.state / "decisions.log").read_text()
        self.assertIn("armed", log)
        self.assertIn("dispatched", log)
        self.assertNotIn("SECRET-PROMPT-BODY", log)

    def test_garbage_and_oversize_never_block(self):
        for raw in (b"not json", b"", b"x" * (hook.MAX_INPUT + 10)):
            out, err = self.run_cli(None, raw=raw)
            self.assertEqual(out, {})
            self.assertIn("skipped", err)

    def test_missing_config_never_blocks(self):
        out, err = self.run_cli(start(), config=Path(self.tmp.name) / "none.json")
        self.assertEqual(out, {})
        self.assertIn("skipped", err)

    def test_concurrent_prompts_dispatch_exactly_once(self):
        self.run_cli(start())
        procs = [subprocess.Popen(
            [sys.executable, "-B", str(HERE / "session_organize_once.py"),
             "--config", str(EXAMPLE), "--state-dir", str(self.state)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={**os.environ, **ENV}) for _ in range(8)]
        outputs = [json.loads(p.communicate(json.dumps(prompt()).encode())[0])
                   for p in procs]
        self.assertEqual(sum(1 for o in outputs if o), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
