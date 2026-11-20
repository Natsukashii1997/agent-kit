"""UserPromptSubmit / PostToolUse hook：会话上下文越过阈值时，提醒 Claude 到断点提出交接卡。

PostToolUse 让长时间自主运行的一轮里也能及时触发，不必等用户下一条消息。

上下文用量取会话记录里最近一条主会话 assistant 消息的
input + cache_read + cache_creation tokens。每个阈值每个会话只提醒一次。
任何异常都静默跳过，不阻塞用户请求。

由 agent-kit 安装（agent-kit#105）：脚本在状态目录 runtime/ 副本里，
--config / --state-dir 指向状态目录 context-handoff/ 下的配置和提醒记录；
不带参数时仍用脚本旁边的 config.json 和 state/。
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TAIL_BYTES = 4 * 1024 * 1024

REMINDER = (
    "【上下文提醒】当前会话上下文约 {pct}%（{tokens:,} / {window:,} tokens），"
    "已越过 {th}% 交接线。不要再开新的步骤：把手上这一步做到干净的断点"
    "（不留改了一半的文件；项目有交接文档就先更新），然后在本轮收尾、调用 wrap_up 之前，"
    "用 mcp__ccd_session__start_session 提出交接卡：initiation=own_initiative，"
    "context=fresh，use_worktree=false（留在当前工作区和分支），"
    "title 以「【交接】」开头，title 与 prompt 按 CLAUDE.md 第 5 节「交接卡格式」写，"
    "然后结束本轮，即使用户要求过不中途停下。"
    "交接卡是唯一的开始入口：本轮 wrap_up 只写 recap，不带 ask 和 actions，"
    "不放「开始」「切到新会话」这类按钮，也不问要不要切过去；别的待定事项写进正文「下一步」。"
    "最终答复第一句写明「上下文已到约 {pct}%，建议切到新会话，点交接卡上的 Start 开始」。"
    "若本会话已提出过仍未处理的交接卡，不重复提出。"
)


def context_tokens(transcript: Path):
    with open(transcript, "rb") as f:
        f.seek(0, os.SEEK_END)
        f.seek(max(0, f.tell() - TAIL_BYTES))
        lines = f.read().splitlines()
    for line in reversed(lines):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        m = o.get("message")
        if o.get("type") != "assistant" or o.get("isSidechain") or not isinstance(m, dict):
            continue
        u = m.get("usage") or {}
        total = (u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0)
                 + u.get("cache_creation_input_tokens", 0))
        if total:  # 额度用完等 <synthetic> 消息用量为 0，跳过继续往前找
            return total
    return None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", type=Path, default=HERE / "config.json")
    ap.add_argument("--state-dir", type=Path, default=HERE / "state")
    args = ap.parse_args(argv)
    try:
        event = json.load(sys.stdin)
        if event.get("agent_id"):  # 子代理里的工具调用不提醒，留给主会话
            return
        config = json.loads(args.config.read_text(encoding="utf-8"))
        tokens = context_tokens(Path(event["transcript_path"]))
        if not tokens:
            return
        window = config["context_window"]
        ratio = tokens / window
        state_dir = args.state_dir
        state_dir.mkdir(parents=True, exist_ok=True)
        marker = state_dir / (hashlib.sha256(event["session_id"].encode()).hexdigest()[:16] + ".json")
        done = json.loads(marker.read_text()) if marker.exists() else []
        due = [t for t in config["thresholds"] if ratio >= t and t not in done]
        if not due:
            return
        th = max(due)
        marker.write_text(json.dumps(sorted(set(done) | set(due))))
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": event["hook_event_name"],
            "additionalContext": REMINDER.format(
                pct=round(ratio * 100), tokens=tokens, window=window, th=round(th * 100)),
        }}, ensure_ascii=False))
    except Exception:
        pass


if __name__ == "__main__":
    main()
