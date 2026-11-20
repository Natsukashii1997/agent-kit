#!/usr/bin/env python3
"""上下文提醒钩子（agent-kit#105）的单元测试：用临时会话记录驱动脚本，只看输出和提醒记录。"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "context_handoff.py"
EXAMPLE = HERE.parent.parent / "config" / "context-handoff.example.json"


def assistant(tokens, sidechain=False):
    return {"type": "assistant", "isSidechain": sidechain,
            "message": {"usage": {"input_tokens": tokens, "cache_read_input_tokens": 0,
                                  "cache_creation_input_tokens": 0}}}


class ContextHandoff(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.transcript = self.tmp / "t.jsonl"
        self.state = self.tmp / "state" / "nested"  # 状态目录不存在时要自己建

    def write(self, *records):
        self.transcript.write_text("\n".join(json.dumps(r) for r in records) + "\n")

    def run_hook(self, **event):
        ev = {"session_id": "s-1", "hook_event_name": "UserPromptSubmit",
              "transcript_path": str(self.transcript), **event}
        res = subprocess.run([sys.executable, "-B", str(SCRIPT), "--config", str(EXAMPLE),
                              "--state-dir", str(self.state)],
                             input=json.dumps(ev), capture_output=True, text=True, timeout=10)
        self.assertEqual(res.returncode, 0, res.stderr)
        return json.loads(res.stdout)["hookSpecificOutput"] if res.stdout.strip() else None

    def test_below_threshold_silent(self):
        self.write(assistant(400_000))
        self.assertIsNone(self.run_hook())

    def test_crossing_reminds_once_with_single_start_rule(self):
        self.write(assistant(520_000))
        out = self.run_hook()
        self.assertEqual(out["hookEventName"], "UserPromptSubmit")
        text = out["additionalContext"]
        self.assertIn("约 52%", text)
        self.assertIn("交接卡是唯一的开始入口", text)  # agent-kit#88
        self.assertIn("点交接卡上的 Start 开始", text)
        self.assertIsNone(self.run_hook(), "同一阈值只提醒一次")
        self.write(assistant(720_000))
        self.assertIn("已越过 70% 交接线", self.run_hook(hook_event_name="PostToolUse")["additionalContext"])

    def test_skips_sidechain_and_zero_usage(self):
        self.write(assistant(900_000, sidechain=True), assistant(0))
        self.assertIsNone(self.run_hook())

    def test_subagent_event_skipped(self):
        self.write(assistant(900_000))
        self.assertIsNone(self.run_hook(agent_id="a-1"))
        self.assertFalse(self.state.exists())

    def test_bad_input_never_blocks(self):
        res = subprocess.run([sys.executable, "-B", str(SCRIPT), "--config", str(EXAMPLE),
                              "--state-dir", str(self.state)],
                             input="not json", capture_output=True, text=True, timeout=10)
        self.assertEqual((res.returncode, res.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()
