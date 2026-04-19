#!/usr/bin/env python3
"""
queue-dashboard.py - EventPulse Queue UI

Full keyboard-driven queue management dashboard.
Layout matches the EventPulse queue UI specification.
"""

import json
import os
import sys
import time
import subprocess
import termios
import tty
from pathlib import Path
from collections import OrderedDict

RUNTIME_DIR = Path(__file__).parent / "runtime"
SOURCES_DIR = Path(__file__).parent / "sources"

# Queue definitions: (display_name, filename_pattern, marker)
QUEUES = OrderedDict([
    ("preA",               ("preA-queue.jsonl",              "")),
    ("postA",              ("postA-queue.jsonl",             "")),
    ("preB",               ("preB-queue.jsonl",              "")),
    ("postB",              ("postB-queue.jsonl",             "")),
    ("postB-preC",         ("postB-preC-queue.jsonl",        "")),
    ("postTestC-A",        ("postTestC-A.jsonl",             "")),
    ("postTestC-B",        ("postTestC-B.jsonl",             "")),
    ("postTestC-D",        ("postTestC-D.jsonl",             "◀")),
    ("postTestC-UI",       ("postTestC-UI.jsonl",            "◀")),
    ("postTestC-man",      ("postTestC-manual-review.jsonl", "")),
    ("postTestC-Out",      ("postTestC-Out.jsonl",           "◀")),
    ("postTestC-Fail",     (None,                           "")),
    ("preUI",              ("preUI-queue.jsonl",             "")),
    ("EVENTPULSE-APP",    ("EVENTPULSE-APP.jsonl",         "◀")),
])

# Keyboard shortcuts (key -> (command, description))
SHORTCUTS = OrderedDict([
    ("a",  ("status",               "Status + auto-dedup")),
    ("l",  ("list <queue>",         "List sources in queue")),
    ("f",  ("find <sourceId>",      "Where is the source?")),
    ("r",  ("r — reload",            "Reload all queues")),
    ("rs", ("reset <s>",            "Reset source to preA")),
    ("M",  ("move-all <fr> <to>",  "Move all (M M 9 4)")),
    ("g",  ("merge <k1,k2> <t>",   "Merge queues")),
    ("d",  ("diff <A> <B>",        "Compare queues")),
    ("s",  ("missing <queue>",      "Missing from queue?")),
    ("R",  ("R — fill preA",       "Fill preA with missing")),
    ("X",  ("reset-all <queue>",    "Move all to preA")),
    ("S",  ("snapshot <name>",      "Save backup")),
    ("Y",  ("restore-snap <n>",     "Restore from backup")),
    ("L",  ("log / snapshots",     "Journal + backups")),
    ("gl", ("gl — google-fix 404",  "404: Google-fix")),
    ("q",  ("Quit",                 "Exit")),
])

# Tool definitions: (key, label, description, cmd_list)
TOOLS = [
    ("[0]",  "Tool 0",     "importRawSources",                              ["npx", "tsx", "02-Ingestion/importRawSources.ts"]),
    ("[1]",  "Tool A",     "runA (50 parallel)",                             ["npx", "tsx", "02-Ingestion/A-directAPI-networkGate/runA.ts"]),
    ("[2]",  "Tool B",     "runB-parallel",                                  ["npx", "tsx", "02-Ingestion/B-JSON-feedGate/runB-parallel.ts"]),
    ("[3]",  "Tool C",     "runC (--no-c4 --workers 5)",                    ["npx", "tsx", "02-Ingestion/C-htmlGate/run-dynamic-pool.ts", "--no-c4", "--workers", "5"]),
    ("[4]",  "Tool C1",    "runC-one-time-only (1 round, --workers 5)",     ["npx", "tsx", "02-Ingestion/C-htmlGate/run-dynamic-pool.ts", "--rounds", "1", "--workers", "5"]),
    ("[5]",  "Tool C-AI",  "runC-ai-deep-discovery (10 sources, AI)",        ["npx", "tsx", "02-Ingestion/C-htmlGate/run-dynamic-pool.ts", "--ai", "--limit", "10"]),
    ("[6]",  "🔥 MONSTERKÖRNING", "10 rundor C + AI-fallback",              ["npx", "tsx", "02-Ingestion/C-htmlGate/run-dynamic-pool.ts", "--rounds", "10", "--ai", "--workers", "5"]),
    ("[7]",  "🔬 Validate", "patterns (AI→TestC→Implement)",                  ["python3", "runtime/validate-patterns.py"]),
    ("[8]",  "🤖 Tool 8",   "Ollama Qwen AI (12 parallel, local)",          ["npx", "tsx", "02-Ingestion/F-eventExtraction/run-ollama.ts", "--model", "qwen", "--parallel", "12"]),
    ("[9]",  "⚡ Tool 9",   "Minimax AI (12 parallel, cloud)",              ["npx", "tsx", "02-Ingestion/F-eventExtraction/run-minimax.ts", "--parallel", "12"]),
    ("[10]", "🧠 Tool 10",  "C4-AI Ollama (12 parallel, reports)",          ["npx", "tsx", "02-Ingestion/C-htmlGate/C4-observer.ts", "--parallel", "12"]),
    ("[aa]", "🔧 Tool A-A", "runA-extract (preUI → extractedevents/)",      ["npx", "tsx", "02-Ingestion/A-directAPI-networkGate/runA-extract.ts"]),
    ("[ab]", "🔧 Tool A-B", "importToEventPulse (extractedevents → Supabase)",["npx", "tsx", "02-Ingestion/importToEventPulse.ts"]),
    ("[ex]", "📱 Expo Go",  "Starta app i separat fönster (tunnel)",         ["npx", "expo", "start", "--tunnel"]),
]


def count_queue(filename: str) -> int:
    """Count entries in a queue file."""
    if not filename:
        return 0
    path = RUNTIME_DIR / filename
    if not path.exists():
        return 0
    try:
        return sum(1 for line in path.read_text().splitlines() if line.strip())
    except:
        return 0


def count_fail_files() -> int:
    """Count entries across all postTestC-Fail-*.jsonl files."""
    total = 0
    for f in RUNTIME_DIR.iterdir():
        if f.name.startswith("postTestC-Fail") and f.suffix == ".jsonl":
            total += count_queue(f.name)
    return total


def count_unique_sources_in_queue(filename: str) -> int:
    """Count unique sourceIds in a queue."""
    if not filename:
        return 0
    path = RUNTIME_DIR / filename
    if not path.exists():
        return 0
    sources = set()
    try:
        for line in path.read_text().splitlines():
            if line.strip():
                e = json.loads(line)
                sources.add(e.get("sourceId", ""))
    except:
        pass
    return len(sources)


def get_total_sources() -> int:
    """Count total source files in sources/."""
    try:
        return sum(1 for f in SOURCES_DIR.iterdir() if f.suffix == ".jsonl")
    except:
        return 0


def get_log_file() -> str:
    """Find the most recent log file."""
    log_dir = RUNTIME_DIR / "logs"
    if not log_dir.exists():
        return ""
    logs = sorted(log_dir.iterdir(), key=lambda f: f.stat().st_mtime, reverse=True)
    if logs:
        return str(logs[0].name)
    return ""


def get_queue_status():
    """Get all queue counts and status."""
    status = {}
    total_inputs = 0
    total_outputs = 0

    for name, (filename, marker) in QUEUES.items():
        if name == "postTestC-Fail":
            count = count_fail_files()
        else:
            count = count_queue(filename)

        unique = 0
        if filename:
            unique = count_unique_sources_in_queue(filename)

        status[name] = {"count": count, "unique": unique, "marker": marker}

        # Categorize input vs output
        if name in ("preA", "preB", "postB", "postB-preC"):
            total_inputs += count
        elif name in ("postA", "preUI") or name.startswith("postTestC"):
            total_outputs += count

    return {
        "queues": status,
        "total_sources": get_total_sources(),
        "total_input_queue": total_inputs,
        "total_output_queue": total_outputs,
        "log_file": get_log_file(),
    }


def build_queue_shortcut_line(name: str, data: dict, shortcut_key: str, shortcut_cmd: str, shortcut_desc: str) -> str:
    """Build a single queue + shortcut line. Fixed 80-char width."""
    count = data["count"]
    marker = data["marker"]
    count_str = f"{count:>4}"
    # mkr_str: marker char + trailing space (marker takes 2 visual cols)
    mkr_str = f"{marker} " if marker else "  "

    # Left: name(22) + cnt(4) + space(1) + mkr_str(2) = 29
    left = f"{name:<22}{count_str} {mkr_str}"

    # Right: space + [key] + space + cmd + space + arrow + space + desc
    right_raw = f"[{shortcut_key}] {shortcut_cmd}  ->  {shortcut_desc}"
    # Truncate to fit 48 chars (total = 3 + 29 + 48 + 1 = 81 -> use 48 for right)
    right = right_raw[:48].ljust(48)

    line = f"║  {left}{right}║"
    return line


def render_dashboard(status: dict):
    """Render the full dashboard matching the specified layout."""
    os.system("clear" if sys.platform != "win32" else "cls")

    qs = status["queues"]
    total = status["total_sources"]
    now = time.strftime("%H:%M:%S")

    # Top border
    print("╔══════════════════════════════════════════════════════════════════════════════╗")
    print(f"║  EventPulse Queue UI{'':<51}{now}{' ' * 2}║")
    print("╠══════════════════════════════════════════════════════════════════════════════╣")

    # Shortcuts header
    print("║  KÖER                                                           QUEUE-MEM   ║")
    print("║  ─────────────────────────────────         ───────────────────────────────║")

    # Queue lines with shortcuts
    shortcuts_items = list(SHORTCUTS.items())
    queue_items = list(qs.items())

    for i, (name, data) in enumerate(queue_items):
        if i < len(shortcuts_items):
            key, (cmd, desc) = shortcuts_items[i]
            line = build_queue_shortcut_line(name, data, key, cmd, desc)
            print(line)
        else:
            count_str = f"{data['count']:>4}"
            marker_str = f"{data['marker']} " if data['marker'] else "  "
            left = f"{name:<22}{count_str} {marker_str}"
            right = "[ ]".ljust(48)
            print(f"║  {left}{right}║")

    print("╠══════════════════════════════════════════════════════════════════════════════╣")

    # Tools section header
    print("║  VERKTYG                                              TOTAL SOURCES:", end="")
    total_str = f"{total:<6}"
    print(f" {total_str}  ║")
    print("║  ─────────────────────────────────────────     ───────────────────────────║")

    # Two-column tool layout
    col_width = 78
    half = (len(TOOLS) + 1) // 2
    left = TOOLS[:half]
    right = TOOLS[half:]

    for (lk, lname, ldesc, _), (rk, rname, rdesc, _) in zip(left, right):
        left_str = f"{lk} {lname:<20} {ldesc:<30}"
        right_str = f"{rk} {rname:<20} {rdesc:<30}" if rk else ""
        print(f"║  {left_str:<{col_width}}║")
        if right_str.strip():
            print(f"║  {right_str:<{col_width}}║")

    # If odd number of tools, print last one
    if len(TOOLS) % 2 == 1:
        lk, lname, ldesc, _ = TOOLS[-1]
        print(f"║  {lk} {lname:<20} {ldesc:<30}                              ║")

    print("╠══════════════════════════════════════════════════════════════════════════════╣")

    # Log file
    log = status.get("log_file", "")
    if log:
        print(f"║  LOG: runtime/logs/{log:<70}  ║")
    else:
        print(f"║  LOG: {'—':<74}  ║")

    print("╚══════════════════════════════════════════════════════════════════════════════╝")


def run_tool(idx: int):
    """Run a tool by index."""
    if idx < 0 or idx >= len(TOOLS):
        print(f"\033[91m✗ Invalid tool index: {idx}\033[0m")
        return
    key, name, desc, cmd = TOOLS[idx]
    cwd = Path(__file__).parent
    print(f"\n\033[1m>>> Running: {' '.join(cmd)}\033[0m")
    print("─" * 70)
    try:
        result = subprocess.run(cmd, cwd=str(cwd))
        print("─" * 70)
        print(f"\033[92m✓ Tool finished (exit code: {result.returncode})\033[0m")
    except Exception as e:
        print(f"\033[91m✗ Error running tool: {e}\033[0m")
    input("\nPress Enter to return to dashboard...")


def interactive_mode():
    """Interactive mode with keyboard navigation."""
    fd = sys.stdin.fileno()

    def setup_terminal():
        try:
            new_settings = termios.tcgetattr(fd)
            new_settings[0] &= ~(termios.ICANON | termios.ECHO)
            new_settings[3] &= ~(termios.ECHO)
            new_settings[6][termios.VMIN] = 0
            new_settings[6][termios.VTIME] = 0
            termios.tcsetattr(fd, termios.TCSADRAIN, new_settings)
        except:
            pass

    def restore_terminal():
        try:
            termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)
        except:
            pass

    old_settings = termios.tcgetattr(fd)
    setup_terminal()
    try:
        while True:
            status = get_queue_status()
            render_dashboard(status)
            print()
            print("Keys: 0-9,aa,ab,ex  Run tool | r reload | q Quit")

            try:
                ch = sys.stdin.read(1)
            except:
                continue

            if ch.isdigit():
                idx = int(ch)
                if 0 <= idx <= 9:
                    restore_terminal()
                    run_tool(idx)
                    setup_terminal()

            elif ch == 'q':
                restore_terminal()
                break

            elif ch == 'r':
                # Reload — just loop (no-op, next iteration re-renders)
                pass

            elif ch in ('a', 'e'):
                try:
                    ch2 = sys.stdin.read(1)
                    combo = ch + ch2
                    if combo == 'aa':
                        restore_terminal()
                        run_tool(11)
                        setup_terminal()
                    elif combo == 'ab':
                        restore_terminal()
                        run_tool(12)
                        setup_terminal()
                    elif combo == 'ex':
                        restore_terminal()
                        run_tool(13)
                        setup_terminal()
                    elif combo == 'gl':
                        restore_terminal()
                        print("\n\033[1m>>> Running Google 404 fix...\033[0m")
                        subprocess.run(["python3", "runtime/gl-fix-404.py"], cwd=str(Path(__file__).parent))
                        input("\nPress Enter to return to dashboard...")
                        setup_terminal()
                except:
                    pass

    finally:
        restore_terminal()


def main():
    if "--help" in sys.argv or "-h" in sys.argv:
        print("EventPulse Queue UI")
        print("Usage: python3 queue-dashboard.py")
        print()
        print("Keys:")
        print("  0-9      Run tool 0-9")
        print("  aa, ab   Run tool A-A, A-B")
        print("  ex       Run Expo Go")
        print("  r        Reload dashboard")
        print("  q        Quit")
        return

    interactive_mode()


if __name__ == "__main__":
    main()
