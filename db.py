#!/usr/bin/env python3
"""
queue-ui.py - EventPulse Queue Dashboard

Usage:
  python3 queue-ui.py
"""

import os
import sys
import subprocess
import time
import threading
from pathlib import Path

RUNTIME_DIR = Path(__file__).parent / "runtime"
PROJECT_ROOT = Path(__file__).parent
SOURCES_DIR = PROJECT_ROOT / "sources"

# ── Queue config ──────────────────────────────────────────────────────────────

QUEUES = [
    ("preA",          "preA-queue.jsonl"),
    ("postA",         "postA-queue.jsonl"),
    ("preB",          "preB-queue.jsonl"),
    ("postB",         "postB-queue.jsonl"),
    ("postB-preC",    "postB-preC-queue.jsonl"),
    ("postTestC-A",   "postTestC-A.jsonl"),
    ("postTestC-B",   "postTestC-B.jsonl"),
    ("postTestC-D",   "postTestC-D.jsonl"),
    ("postTestC-UI",  "postTestC-UI.jsonl"),
    ("postTestC-man",       "postTestC-manual-review.jsonl"),
    ("postTestC-serverdown", "postTestC-serverdown.jsonl"),
    ("postTestC-404",        "postTestC-404.jsonl"),
    ("postTestC-error500",  "postTestC-error500.jsonl"),
    ("postTestC-timeout",    "postTestC-timeout.jsonl"),
    ("postTestC-blocked",    "postTestC-blocked.jsonl"),
    ("postTestC-out",        "postTestC-out.jsonl"),
    ("postTestC-Fail","postTestC-Fail.jsonl"),
    ("preUI",         "preUI-queue.jsonl"),
    ("EVENTPULSE-APP","EVENTPULSE-APP-queue.jsonl"),
]

TOOL_CATEGORIES = [
    {
        "name": "TOOL 0",
        "tools": [
            {"id": "0",  "label": "Tool 0 — importRawSources",                      "cmd": ["npx", "tsx", "02-Ingestion/importRawSources.ts"], "drain": None},
        ],
    },
    {
        "name": "TOOL A-D",
        "tools": [
            {"id": "1",  "label": "Tool A — runA (50 parallel)",                    "cmd": ["npx", "tsx", "02-Ingestion/A-directAPI-networkGate/runA.ts", "--workers", "50"], "drain": "preA-queue.jsonl"},
            {"id": "2",  "label": "Tool B — runB-parallel",                          "cmd": ["npx", "tsx", "02-Ingestion/B-JSON-feedGate/runB-parallel.ts", "--limit", "100", "--workers", "8"], "drain": "preB-queue.jsonl"},
            {"id": "3",  "label": "Tool C - drain all — runC-one-time-only",        "cmd": ["npx", "tsx", "02-Ingestion/C-htmlGate/runC-one-time-only.ts", "--workers", "5"], "drain": "postB-preC-queue.jsonl"},
        ],
    },
    {
        "name": "SCRAPING API",
        "tools": [
            {"id": "8",  "label": "🔍 ScB shallow (scrapingBee) — homepage (~5 ScB)",  "cmd": ["npx", "tsx", "02-Ingestion/C-htmlGate/runC-scrapingbee.ts", "--mode=shallow", "--workers", "12"], "drain": "postB-preC-queue.jsonl"},
            {"id": "9",  "label": "🔍 ScB medium (scrapingBee) — sitemap+AI (~55 ScB)", "cmd": ["npx", "tsx", "02-Ingestion/C-htmlGate/runC-scrapingbee.ts", "--mode=medium", "--workers", "8"], "drain": "postB-preC-queue.jsonl"},
            {"id": "10", "label": "🔥 ScB deep (scrapingBee) — full pipeline (~100 ScB)", "cmd": ["npx", "tsx", "02-Ingestion/C-htmlGate/runC-scrapingbee.ts", "--mode=deep", "--workers", "5"], "drain": "postB-preC-queue.jsonl"},
            {"id": "11", "label": "🔬 Why extraction fails? from -man → -404, serverdown, blocked", "cmd": ["npx", "tsx", "02-Ingestion/C-htmlGate/tools/scB-diagnostic.ts", "--batch"], "drain": None},
            {"id": "12", "label": "🔍 ScB 404-exa — Exa API fix + requeue",          "cmd": ["python3", "03-Queue/gl-fix-404.py"], "drain": None},
            {"id": "13", "label": "🤖 ScB 404-AI — Claude Code fix (ollama)",       "cmd": ["python3", "03-Queue/scb-404-AI.py"], "drain": None},
        ],
    },
    {
        "name": "GAMLA VERKTYG",
        "tools": [
            {"id": "ca", "label": "Tool C1 — runC (--no-c4 --workers 5)",           "cmd": ["npx", "tsx", "02-Ingestion/C-htmlGate/run-dynamic-pool.ts", "--no-c4", "--workers", "5"], "drain": "postB-preC-queue.jsonl"},
            {"id": "cb", "label": "Tool C-AI — runC-ai-deep-discovery (10 sources)",  "cmd": ["npx", "tsx", "02-Ingestion/C-htmlGate/runC-ai-deep-discovery.ts", "--limit", "10"], "drain": "postB-preC-queue.jsonl"},
            {"id": "cc", "label": "🔥 MONSTERKÖRNING — 10 rundor C + AI-fallback",  "cmd": None, "special": "monster", "drain": None},
            {"id": "cd", "label": "🔬 Validate patterns (AI→TestC→Implement)",       "cmd": ["npx", "tsx", "02-Ingestion/C-htmlGate/runC-pattern-validator.ts"], "drain": None},
            {"id": "ce", "label": "🧠 C4-AI Ollama — reports (12 parallel)",         "cmd": ["npx", "tsx", "02-Ingestion/C-htmlGate/C4-observer.ts", "--parallel", "12"], "drain": None},
            {"id": "cf", "label": "🤖 Ollama Qwen — event extraction (12 parallel, local)", "cmd": ["npx", "tsx", "02-Ingestion/F-eventExtraction/run-ollama.ts", "--model", "qwen", "--parallel", "12"], "drain": None},
            {"id": "cg", "label": "⚡ Minimax AI — event extraction (12 parallel, cloud)",   "cmd": ["npx", "tsx", "02-Ingestion/F-eventExtraction/run-minimax.ts", "--parallel", "12"], "drain": None},
        ],
    },
    {
        "name": "MAINTENANCE",
        "tools": [
            {"id": "aa", "label": "🔧 Tool A-A — runA-extract (preUI → extractedevents/)", "cmd": ["npx", "tsx", "02-Ingestion/A-directAPI-networkGate/runA-extract.ts"], "drain": "preUI-queue.jsonl"},
            {"id": "ab", "label": "🔧 Tool A-B — importToEventPulse (extractedevents→Supabase)", "cmd": ["npx", "tsx", "03-Queue/importToEventPulse.ts"], "drain": None},
            {"id": "ex", "label": "📱 Expo Go — Starta app i separat fönster (tunnel)",   "cmd": None, "dir": "06-UI", "drain": None},
        ],
    },
]

# Flat list for backward-compatible command lookup
TOOLS = [t for cat in TOOL_CATEGORIES for t in cat["tools"]]

MEM_CMDS = [
    {"id": "a",  "label": "status",               "desc": "Status + auto-dedup"},
    {"id": "l",  "label": "list <queue>",         "desc": "List sources in queue"},
    {"id": "f",  "label": "find <sourceId>",      "desc": "Where is the source?"},
    {"id": "r",  "label": "r — reload",            "desc": "Reload all queues"},
    {"id": "rs", "label": "reset <s>",            "desc": "Reset source to preA"},
    {"id": "M",  "label": "move-all <fr> <to>",  "desc": "Move all (M M 9 4)"},
    {"id": "g",  "label": "merge <k1,k2> <t>",   "desc": "Merge queues"},
    {"id": "d",  "label": "diff <A> <B>",         "desc": "Compare queues"},
    {"id": "s",  "label": "missing <queue>",      "desc": "Missing from queue?"},
    {"id": "R",  "label": "R — fill preA",       "desc": "Fill preA with missing"},
    {"id": "X",  "label": "reset-all <queue>",    "desc": "Move all to preA"},
    {"id": "S",  "label": "snapshot <name>",      "desc": "Save backup"},
    {"id": "Y",  "label": "restore-snap <n>",     "desc": "Restore from backup"},
    {"id": "L",  "label": "log / snapshots",     "desc": "Journal + backups"},
    {"id": "gl", "label": "gl — google-fix 404",  "desc": "404: Google-fix"},
    {"id": "q",  "label": "Quit",                 "desc": "Exit"},
    {"id": "t",  "label": "t — claude minimaxC",  "desc": "Starta claude via tmate"},
    {"id": "u",  "label": "u — db.py i tmate",    "desc": "db.py i ny tmate-win"},
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def count_queue(fname):
    if not fname:
        return 0
    # postTestC-Fail uses count_fail() which globs multiple fail files
    if fname == "postTestC-Fail.jsonl" or fname.startswith("postTestC-Fail"):
        return count_fail()
    path = RUNTIME_DIR / fname
    if not path.exists():
        return 0
    try:
        return sum(1 for line in path.read_text().splitlines() if line.strip())
    except:
        return 0


def count_fail():
    total = 0
    try:
        for f in RUNTIME_DIR.iterdir():
            if f.name.startswith("postTestC-Fail") and f.suffix == ".jsonl":
                total += sum(1 for line in f.read_text().splitlines() if line.strip())
    except:
        pass
    return total


def get_total_sources():
    try:
        return sum(1 for f in SOURCES_DIR.iterdir() if f.suffix == ".jsonl")
    except:
        return 0


def queue_counts():
    counts = {}
    for name, fname in QUEUES:
        if name == "postTestC-Fail":
            counts[name] = count_fail()
        else:
            counts[name] = count_queue(fname)
    return counts


def ask_queue_num(prompt="Välj queue (nr): "):
    """Show queue list with counts and ask for a number."""
    counts = queue_counts()
    print()
    for i, (name, fname) in enumerate(QUEUES):
        c = counts.get(name, 0)
        flag = " ◀" if c > 0 else ""
        print(f"  [{i}] {name:<14}  {c:>5}{flag}")
    print()
    sel = input(f"  {prompt}").strip()
    try:
        idx = int(sel)
        if 0 <= idx < len(QUEUES):
            return QUEUES[idx][0]
        else:
            print(f"  Ogiltigt index: {idx}")
            return None
    except ValueError:
        # allow direct name input
        if sel in dict(QUEUES):
            return sel
        print(f"  Okänt: {sel}")
        return None


# ── Display helpers ──────────────────────────────────────────────────────────

def green(t):  return f"\033[92m{t}\033[0m"
def yellow(t): return f"\033[93m{t}\033[0m"
def red(t):    return f"\033[91m{t}\033[0m"


def show_dashboard(running_id=None, done_id=None):
    counts = queue_counts()
    total = get_total_sources()
    now = time.strftime("%H:%M:%S")

    preA           = counts.get("preA", 0)
    postA          = counts.get("postA", 0)
    preB           = counts.get("preB", 0)
    postB          = counts.get("postB", 0)
    postB_preC     = counts.get("postB-preC", 0)
    postTestC_A    = counts.get("postTestC-A", 0)
    postTestC_B    = counts.get("postTestC-B", 0)
    postTestC_D    = counts.get("postTestC-D", 0)
    postTestC_UI   = counts.get("postTestC-UI", 0)
    postTestC_man       = counts.get("postTestC-man", 0)
    postTestC_serverdown= counts.get("postTestC-serverdown", 0)
    postTestC_404       = counts.get("postTestC-404", 0)
    postTestC_error500  = counts.get("postTestC-error500", 0)
    postTestC_timeout   = counts.get("postTestC-timeout", 0)
    postTestC_blocked   = counts.get("postTestC-blocked", 0)
    postTestC_out       = counts.get("postTestC-out", 0)
    postTestC_Out       = counts.get("postTestC-Out", 0)  # kept for compatibility
    postTestC_Fail = counts.get("postTestC-Fail", 0)
    preUI          = counts.get("preUI", 0)
    EVENTPULSE_APP = counts.get("EVENTPULSE-APP", 0)

    print()
    # Top border — 160 chars wide
    print("╔" + "═" * 158 + "╗")
    print(f"║  EventPulse Queue UI{'':<111}{now}{' ' * 2}║")
    print("╠" + "═" * 158 + "╣")

    # ── KÖER + QUEUE-MEM header ─────────────────────────────────────────────
    print("║  KÖER                                                           QUEUE-MEM   ║")
    print("║  ─────────────────────────────────         ───────────────────────────────║")

    queue_list = [
        ("preA",          preA,          ""),
        ("postA",         postA,         ""),
        ("preB",          preB,          ""),
        ("postB",         postB,         ""),
        ("postB-preC",    postB_preC,    ""),
        ("postTestC-A",   postTestC_A,   ""),
        ("postTestC-B",   postTestC_B,   ""),
        ("postTestC-D",   postTestC_D,   "◀"),
        ("postTestC-UI",  postTestC_UI,  "◀"),
        ("postTestC-man",       postTestC_man,       ""),
        ("postTestC-serverdown",postTestC_serverdown,""),
        ("postTestC-404",       postTestC_404,       ""),
        ("postTestC-error500",  postTestC_error500,  ""),
        ("postTestC-timeout",   postTestC_timeout,   ""),
        ("postTestC-blocked",   postTestC_blocked,   ""),
        ("postTestC-out",       postTestC_out,       ""),
        ("postTestC-Fail",postTestC_Fail,""),
        ("preUI",         preUI,         ""),
        ("EVENTPULSE-APP",EVENTPULSE_APP,"◀"),
    ]

    # Full line = 160 chars total:
    # ║ + space + L_WIDTH + R_WIDTH + space + ║ = 3 + L_WIDTH + R_WIDTH = 160
    L_WIDTH = 58   # chars for left part (name + count + marker)
    R_WIDTH = 98   # chars for right part (shortcut + desc)

    def fit_text(s, max_chars):
        """Truncate string to max_chars characters, padded to R_WIDTH."""
        if len(s) <= max_chars:
            return s.ljust(max_chars)
        return s[:max_chars]

    for i, (name, cnt, marker) in enumerate(queue_list):
        mem_cmd = MEM_CMDS[i] if i < len(MEM_CMDS) else None
        if mem_cmd:
            key   = mem_cmd["id"]
            label = mem_cmd["label"]
            desc  = mem_cmd["desc"]
            cnt_str = f"{cnt:>4}"
            mkr_str = f"{marker} " if marker else "  "
            left  = f"{name:<22}{cnt_str} {mkr_str}"
            right_raw = f"[{key}] {label}  ->  {desc}"
            right = fit_text(right_raw, R_WIDTH)
            line  = f"║  {left:<{L_WIDTH}}{right:<{R_WIDTH}}║"
            print(line)
        else:
            cnt_str = f"{cnt:>4}"
            mkr_str = f"{marker} " if marker else "  "
            left  = f"{name:<22}{cnt_str} {mkr_str}"
            right = "[ ]".ljust(R_WIDTH)
            line  = f"║  {left:<{L_WIDTH}}{right:<{R_WIDTH}}║"
            print(line)

    # ── Extra commands below queues ───────────────────────────────────────
    for i in range(len(queue_list), len(MEM_CMDS)):
        mem_cmd = MEM_CMDS[i]
        key   = mem_cmd["id"]
        label = mem_cmd["label"]
        desc  = mem_cmd["desc"]
        right_raw = f"[{key}] {label}  ->  {desc}"
        right = fit_text(right_raw, R_WIDTH)
        line  = f"║  {'':25}{'':>4}   {right:<{R_WIDTH}}║"
        print(line)

    print("╠" + "═" * 158 + "╣")

    # ── VERKTYG section ────────────────────────────────────────────────────
    print("║  VERKTYG                                              TOTAL SOURCES:", end="")
    print(f" {total:<6}  ║")
    print("║  ─────────────────────────────────────────     ───────────────────────────║")

    all_tools_flat = [t for cat in TOOL_CATEGORIES for t in cat["tools"]]

    def fmt_tool(tool):
        tid   = tool["id"]
        label = tool["label"]
        drain = " [auto-drain]" if tool.get("drain") else ""
        star  = " ★" if tool.get("special") == "monster" else ""
        return f"[{tid:>2}] {label}{drain}{star}"

    n = len(all_tools_flat)
    for i in range(0, n, 2):
        left = all_tools_flat[i]
        left_str = fmt_tool(left)
        print(f"║  {left_str:<156}║")
        if i + 1 < n:
            right = all_tools_flat[i + 1]
            right_str = fmt_tool(right)
            print(f"║  {right_str:<156}║")

    print("╠" + "═" * 158 + "╣")

    # ── Log file ────────────────────────────────────────────────────────────
    logs_dir = RUNTIME_DIR / "logs"
    last_log = ""
    if logs_dir.exists():
        logs = sorted(logs_dir.glob("run-*.log"), key=lambda f: f.stat().st_mtime, reverse=True)
        if logs:
            last_log = str(logs[0].relative_to(RUNTIME_DIR.parent))
    if last_log:
        print(f"║  LOG: {last_log:<154}  ║")
    else:
        print(f"║  LOG: {'—':<154}  ║")

    print("╚" + "═" * 158 + "╝")
    print()

    if done_id:
        print(f"  {green('✓ KLAR:')} {done_id}")
    elif running_id:
        print(f"  {yellow('⏳ KÖRS:')} {running_id}")
    print()


# ── Tool runner ──────────────────────────────────────────────────────────────

def run_with_spinner(tool):
    logs_dir = RUNTIME_DIR / "logs"
    logs_dir.mkdir(exist_ok=True)

    ts = time.strftime("%Y%m%d-%H%M%S")
    log_path = logs_dir / f"run-{tool['id']}-{ts}.log"

    print()
    print(f"  ┌──────────────────────────────────────────┐")
    print(f"  │  KÖR: {tool['label']:<36}│")
    print(f"  │  LOG: {str(log_path):<36}│")
    print(f"  └──────────────────────────────────────────┘")
    print()
    sys.stdout.flush()

    # Expo Go: start in separate terminal window
    if tool.get("dir"):
        expo_dir = PROJECT_ROOT / tool["dir"]
        cmd = f'''
            tell application "Terminal"
                activate
                do script "cd {expo_dir} && npx expo start --tunnel --port 8083"
            end tell
        '''
        subprocess.run(["osascript", "-e", cmd])
        print(f"\n  ✓ Expo tunnel startad i separat fönster!")
        print(f"  Öppna appen i Expo Go och skanna QR-koden.")
        rc = 0
    else:
        # Stream output to both terminal AND log file (real-time visibility)
        proc = subprocess.Popen(
            tool["cmd"],
            cwd=str(PROJECT_ROOT),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        with open(log_path, 'w') as log_file:
            while True:
                line = proc.stdout.readline()
                if not line:
                    break
                decoded = line.decode('utf-8', errors='replace')
                print(decoded, end='')  # Show in terminal
                log_file.write(decoded)
                sys.stdout.flush()
        rc = proc.wait()

    sys.stdout.flush()
    label = green("✓ KLAR!") if rc == 0 else red("✗ KLAR!")
    print(f"\n  {label} Exit code: {rc}  |  Log: {log_path}")
    sys.stdout.flush()
    return rc


def drain_until_empty(tool):
    """Run a tool repeatedly until its drain queue is empty."""
    drain_file = tool.get("drain")
    if not drain_file:
        run_with_spinner(tool)
        return
    # Always run at least once — even if queue appears empty (create log file)
    run_with_spinner(tool)
    while True:
        remaining_before = count_queue(drain_file)
        if remaining_before == 0:
            print(f"  ✓ {drain_file} är tom — klar!")
            break
        print(f"  [{remaining_before} kvar i {drain_file} — kör igen...]")
        run_with_spinner(tool)
        remaining_after = count_queue(drain_file)
        if remaining_after >= remaining_before:
            # No progress — stop to avoid infinite loop
            print(f"  ⚠  Ingen minskning ({remaining_after} kvar), stoppar.")
            break
        time.sleep(0.5)


# ── Queue-mem interactive handlers ────────────────────────────────────────────

def handle_mem_cmd(choice, arg=""):
    mc = next((m for m in MEM_CMDS if m["id"] == choice), None)
    if not mc:
        return
    cmd_id = mc["id"]

    # ── a: status (med auto-dedup) ─────────────────────────────────────────
    if cmd_id == "a":
        subprocess.run(["python3", "queue-mem.py", "status"])
        input("  Tryck Enter...")
        return

    # ── l: list ──────────────────────────────────────────────────────────────
    elif cmd_id == "l":
        if not arg:
            qname = ask_queue_num()
        else:
            qname = arg
        if qname:
            subprocess.run(["python3", "queue-mem.py", "list", qname])
        input("  Tryck Enter...")
        return

    # ── f: find ───────────────────────────────────────────────────────────────
    elif cmd_id == "f":
        if not arg:
            arg = input("  sourceId: ").strip()
        if arg:
            subprocess.run(["python3", "queue-mem.py", "find", arg])
        input("  Tryck Enter...")
        return

    # ── m: move single source ──────────────────────────────────────────────────
    elif cmd_id == "m":
        parts = arg.split(None, 1) if arg else []
        sid = parts[0] if parts else ""
        to_q = parts[1] if len(parts) > 1 else ""
        if not sid:
            sid = input("  sourceId: ").strip()
        if not to_q:
            to_q = ask_queue_num("Till queue (nr): ")
        if sid and to_q:
            subprocess.run(["python3", "queue-mem.py", "move", sid, to_q])
            show_dashboard()
        input("  Tryck Enter...")
        return

    # ── M: move-all (eller visa köinfo) ────────────────────────────────────────
    elif cmd_id == "M":
        parts = arg.split(None, 2) if arg else []
        from_q = parts[0] if len(parts) > 0 else ""
        to_q = parts[1] if len(parts) > 1 else ""

        # Resolve from_q from number or name
        if from_q:
            try:
                idx = int(from_q)
                from_q = QUEUES[idx][0] if idx < len(QUEUES) else from_q
            except (ValueError, IndexError):
                from_q = from_q if from_q in dict(QUEUES) else ""
        if not from_q:
            from_q = ask_queue_num("Från queue (nr): ")

        fname = dict(QUEUES).get(from_q, "")
        cnt = count_queue(fname) if fname else 0
        print(f"\n  → {from_q}: {cnt} källa{'or' if cnt != 1 else ''}")

        # M n → fråga efter målkön också, sen flytta
        if not to_q:
            to_q = ask_queue_num("Till queue (nr): ")

        # M n n → resolve andra siffran och visa den också
        try:
            idx2 = int(to_q)
            to_q = QUEUES[idx2][0] if idx2 < len(QUEUES) else to_q
        except (ValueError, IndexError):
            to_q = to_q if to_q in dict(QUEUES) else ""

        tname = dict(QUEUES).get(to_q, "")
        tcnt = count_queue(tname) if tname else 0
        print(f"  → {to_q}: {tcnt} källa{'or' if tcnt != 1 else ''}")

        # Actual move: from_q → to_q
        if from_q and to_q and from_q in dict(QUEUES) and to_q in dict(QUEUES):
            print(f"\n  ⚙  Flyttar {cnt} källa{'or' if cnt != 1 else ''} {from_q} → {to_q}...")
            subprocess.run(["python3", "queue-mem.py", "move-all", from_q, to_q])
            show_dashboard()
        else:
            print(f"\n  Debug: from_q={repr(from_q)} to_q={repr(to_q)}")
            print(f"  from_q in QUEUES: {from_q in dict(QUEUES)}, to_q in QUEUES: {to_q in dict(QUEUES)}")
            print("\n  Okänd queue — ingen flytt utförd.")

        input("  Tryck Enter...")
        return

    # ── g: merge ──────────────────────────────────────────────────────────────
    elif cmd_id == "g":
        parts = arg.split(None, 1) if arg else []
        from_str = parts[0] if parts else ""
        to_q = parts[1] if len(parts) > 1 else ""
        if not from_str:
            from_str = input("  Från köer (kommasep): ").strip()
        if not to_q:
            to_q = ask_queue_num("Till queue (nr): ")
        if from_str and to_q:
            subprocess.run(["python3", "queue-mem.py", "merge", from_str, to_q])
            show_dashboard()
        input("  Tryck Enter...")
        return

    # ── d: diff ───────────────────────────────────────────────────────────────
    elif cmd_id == "d":
        parts = arg.split(None, 1) if arg else []
        qa = parts[0] if parts else ""
        qb = parts[1] if len(parts) > 1 else ""
        if not qa:
            qa = ask_queue_num("Queue A (nr): ")
        if not qb:
            qb = ask_queue_num("Queue B (nr): ")
        if qa and qb:
            subprocess.run(["python3", "queue-mem.py", "diff", qa, qb])
        input("  Tryck Enter...")
        return

    # ── s: missing ────────────────────────────────────────────────────────────
    elif cmd_id == "s":
        if not arg:
            qname = ask_queue_num("Mål queue (nr): ")
        else:
            qname = arg
        if qname:
            subprocess.run(["python3", "queue-mem.py", "missing", qname])
        input("  Tryck Enter...")
        return

    # ── rs: reset single ────────────────────────────────────────────────────────
    elif cmd_id == "rs":
        if not arg:
            arg = input("  sourceId: ").strip()
        if arg:
            subprocess.run(["python3", "queue-mem.py", "reset", arg])
            show_dashboard()
        input("  Tryck Enter...")
        return

    # ── R: fill preA from sources ────────────────────────────────────────────
    elif cmd_id == "R":
        subprocess.run(["python3", "queue-mem.py", "reconcile", "--force"])
        show_dashboard()
        input("  Tryck Enter...")
        return

    # ── r: reload ────────────────────────────────────────────────────────────
    elif cmd_id == "r":
        show_dashboard()
        input("  Tryck Enter...")
        return

    # ── X: reset-all ──────────────────────────────────────────────────────────
    elif cmd_id == "X":
        if not arg:
            from_q = ask_queue_num("Från queue (nr): ")
        else:
            from_q = arg
        if from_q:
            subprocess.run(["python3", "queue-mem.py", "reset-all", from_q])
            show_dashboard()
        input("  Tryck Enter...")
        return

    # ── S: snapshot ────────────────────────────────────────────────────────────
    elif cmd_id == "S":
        name = arg or input("  Snapshot-namn: ").strip()
        if name:
            subprocess.run(["python3", "queue-mem.py", "snapshot", name])
        input("  Tryck Enter...")
        return

    # ── Y: restore-snap ────────────────────────────────────────────────────────
    elif cmd_id == "Y":
        name = arg or input("  Snapshot-namn: ").strip()
        if name:
            subprocess.run(["python3", "queue-mem.py", "restore-snap", name])
        input("  Tryck Enter...")
        return

    # ── L: log / snapshots ───────────────────────────────────────────────────
    elif cmd_id == "L":
        subprocess.run(["python3", "queue-mem.py", "log"])
        print()
        subprocess.run(["python3", "queue-mem.py", "snapshots"])
        input("  Tryck Enter...")
        return

    # ── gl: google-fixa 404:or → RawSources md + flytta till postTestC-out ───
    elif cmd_id == "gl":
        import subprocess as _sub
        result = _sub.run(
            ["python3", "03-Queue/gl-fix-404.py"],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True
        )
        print(result.stdout)
        if result.stderr:
            print(result.stderr[:500])
        input("  Tryck Enter...")
        return

    # ── q: quit ───────────────────────────────────────────────────────────────
    elif cmd_id == "q":
        print("  Hej då!")
        sys.exit(0)

    # ── t: starta claude minimaxC i ny tmate-terminal ─────────────────────
    elif cmd_id == "t":
        print("  ⏳ Startar claude minimaxC i nytt tmate-fönster...")
        subprocess.run(
            ["osascript", "-e",
             'tell application "Terminal" to do script "cminiC"'],
            check=False
        )
        print("  ✓ Kör cminiC i nytt Terminal-fönster")
        print("  Surfa till tmate-URL från mobilen!")
        input("  Tryck Enter...")
        return

    # ── u: starta db.py i ny tmate-terminal ───────────────────────────────
    elif cmd_id == "u":
        print("  ⏳ Startar db.py i nytt tmate-fönster...")
        db_path = Path(__file__).resolve()
        subprocess.run(
            ["osascript", "-e",
             f'tell application "Terminal" to do script "cd {db_path.parent} && tmate -F && python3 db.py"'],
            check=False
        )
        print("  ✓ Kör db.py i nytt Terminal-fönster med tmate")
        print("  Surfa till tmate-URL från mobilen!")
        input("  Tryck Enter...")
        return


# ── MONSTERKÖRNING ───────────────────────────────────────────────────────────

def monster_run():
    MAX_ROUNDS = 10
    NO_PROGRESS_LIMIT = 3

    tool_c  = next(t for t in TOOLS if t["id"] == "4")   # runC-one-time-only
    tool_ai = next(t for t in TOOLS if t["id"] == "9")    # runC-ai-deep-discovery-minimax

    no_progress_streak = 0
    total_ui = 0
    total_d = 0

    print()
    print(f"╔══════════════════════════════════════════════════════════════════════════════╗")
    print(f"║  🔥 MONSTERKÖRNING — max {MAX_ROUNDS} rundor C + Minimax AI-fallback              ║")
    print(f"╚══════════════════════════════════════════════════════════════════════════════╝")

    for round_num in range(1, MAX_ROUNDS + 1):
        preC = count_queue("postB-preC-queue.jsonl")
        if preC == 0:
            print(f"\n  ✅ postB-preC är tom efter {round_num - 1} rundor. Klar!")
            break

        ui_before = count_queue("postTestC-UI.jsonl")
        d_before  = count_queue("postTestC-D.jsonl")

        print()
        print(f"  ══════════════════════════════════════════════")
        print(f"  MONSTER ROUND {round_num}/{MAX_ROUNDS}  |  postB-preC: {preC} kvar")
        print(f"  ══════════════════════════════════════════════")

        # Kör Tool 4 (one-time-only, paralleliserad)
        run_with_spinner(tool_c)

        # Flytta manual-review → postB-preC
        man = count_queue("postTestC-manual-review.jsonl")
        if man > 0:
            print(f"\n  ↩ Återlägger {man} manual-review → postB-preC...")
            subprocess.run(
                ["python3", "queue-mem.py", "reset-all", "postTestC-man"],
                cwd=str(PROJECT_ROOT), check=False
            )

        # Mät framsteg
        ui_after = count_queue("postTestC-UI.jsonl")
        d_after  = count_queue("postTestC-D.jsonl")
        new_ui   = ui_after - ui_before
        new_d    = d_after  - d_before
        total_ui += new_ui
        total_d  += new_d

        if new_ui > 0 or new_d > 0:
            print(f"  ✅ Framsteg: +{new_ui} UI  +{new_d} D  (totalt: {total_ui} UI, {total_d} D)")
            no_progress_streak = 0
        else:
            no_progress_streak += 1
            print(f"  ⚠  Ingen framsteg ({no_progress_streak}/{NO_PROGRESS_LIMIT} i rad)")

        # Byt till AI om ingen framsteg 3 rundor i rad
        if no_progress_streak >= NO_PROGRESS_LIMIT:
            print(f"\n  🤖 Ingen framsteg på {NO_PROGRESS_LIMIT} rundor — aktiverar AI-djupskanning...")
            while count_queue("postB-preC-queue.jsonl") > 0:
                run_with_spinner(tool_ai)
                man = count_queue("postTestC-manual-review.jsonl")
                if man > 0:
                    subprocess.run(
                        ["python3", "queue-mem.py", "reset-all", "postTestC-man"],
                        cwd=str(PROJECT_ROOT), check=False
                    )

            # ── AI → VALIDATOR → PROMOTER loop ──────────────────────
            print(f"\n  🔬 Validerar AI-upptäckta mönster...")
            result_validator = subprocess.run(
                ["npx", "tsx", "02-Ingestion/C-htmlGate/runC-pattern-validator.ts"],
                cwd=str(PROJECT_ROOT), capture_output=True, text=True
            )
            print(result_validator.stdout)
            if result_validator.stderr:
                print(f"  [validator stderr] {result_validator.stderr[:500]}")

            # Check if confirmed patterns exist
            val_report_path = os.path.join(RUNTIME_DIR, "..", "02-Ingestion", "C-htmlGate", "reports", "pattern-validation")
            val_reports = sorted(subprocess.run(
                ["sh", "-c", f"ls -t {val_report_path}/validation-*.json 2>/dev/null | head -1"],
                cwd=str(PROJECT_ROOT), capture_output=True, text=True
            ).stdout.strip().split("\n"))

            if val_reports and val_reports[0]:
                confirmed_check = subprocess.run(
                    ["python3", "-c",
                     f"import json; d=json.load(open('{val_reports[0].strip()}')); "
                     f"print(len([v for v in d['validations'] if v['status']=='confirmed']))"],
                    capture_output=True, text=True
                )
                confirmed_count = int(confirmed_check.stdout.strip() or "0")
                if confirmed_count > 0:
                    print(f"\n  📣 {confirmed_count} mönster confirmed — kör promoter...")
                    subprocess.run(
                        ["npx", "tsx", "02-Ingestion/C-htmlGate/runC-pattern-promoter.ts"],
                        cwd=str(PROJECT_ROOT)
                    )
                    print(f"\n  🔄 C-medlemmar uppdaterade — kör C igen med nya mönster...")
                    run_with_spinner(tool_c)
                    # Flytta eventuella nya manual-review
                    man2 = count_queue("postTestC-manual-review.jsonl")
                    if man2 > 0:
                        subprocess.run(
                            ["python3", "queue-mem.py", "reset-all", "postTestC-man"],
                            cwd=str(PROJECT_ROOT), check=False
                        )
                    new_ui2 = count_queue("postTestC-UI.jsonl") - ui_after
                    new_d2  = count_queue("postTestC-D.jsonl")  - d_after
                    total_ui += new_ui2
                    total_d  += new_d2
                    if new_ui2 > 0 or new_d2 > 0:
                        print(f"  ✅ Efter promotion: +{new_ui2} UI  +{new_d2} D")
            # ── Slut AI → VALIDATOR → PROMOTER loop ─────────────────

            break

        time.sleep(0.5)

    print()
    print(f"  ╔══════════════════════════════════════════════╗")
    print(f"  ║  MONSTERKÖRNING AVSLUTAD                    ║")
    print(f"  ║  Totalt: {total_ui} till UI  |  {total_d} till D          ║")
    print(f"  ╚══════════════════════════════════════════════╝")
    print()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    while True:
        sys.stdout.flush()
        show_dashboard()
        sys.stdin.flush()
        try:
            raw = input("Val: ").strip()
        except (EOFError, OSError):
            # stdin stängd eller i otillgängligt läge — öppna från /dev/tty som fallback
            try:
                raw = open("/dev/tty").readline().strip()
            except Exception:
                print("\n  [stdin недоступен — avslutar]")
                break
        if not raw:
            continue

        parts = raw.split(None, 1)
        # Keep original case for command lookup (M vs m are different!)
        cmd_raw = parts[0]
        choice = cmd_raw.lower()
        arg = parts[1] if len(parts) > 1 else ""

        if choice == "q":
            print("  Hej då!")
            break

        elif choice in [t["id"] for t in TOOLS]:
            tool = next(t for t in TOOLS if t["id"] == choice)
            if tool.get("special") == "monster":
                monster_run()
                input("  Tryck Enter...")
            else:
                drain_until_empty(tool)
            time.sleep(1)

        elif cmd_raw in [m["id"] for m in MEM_CMDS]:
            handle_mem_cmd(cmd_raw, arg)

        else:
            print(f"  Okänt val: {choice}")
            time.sleep(1)


if __name__ == "__main__":
    main()
