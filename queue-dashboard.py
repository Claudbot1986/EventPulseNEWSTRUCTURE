#!/usr/bin/env python3
"""
queue-dashboard.py - Live queue status dashboard

Usage:
  python3 queue-dashboard.py              # One-shot view
  python3 queue-dashboard.py --watch     # Live updating (Ctrl+C to stop)
  python3 queue-dashboard.py --watch -i N # Live updating with N second interval

Shows real-time status of all EventPulse queues with totals.
Verifies that postB-preC is always 0 after processing.
"""

import json
import os
import sys
import time
from pathlib import Path
from collections import OrderedDict

RUNTIME_DIR = Path(__file__).parent / "runtime"
SOURCES_DIR = Path(__file__).parent / "sources"

# Queue definitions: (display_name, filename_pattern)
QUEUES = OrderedDict([
    ("preA",               "preA-queue.jsonl"),
    ("postA-UI",           "postA-queue.jsonl"),
    ("preB",               "preB-queue.jsonl"),
    ("postB-UI",           "postB-queue.jsonl"),
    ("postB-preC",         "postB-preC-queue.jsonl"),
    ("preUI",              "preUI-queue.jsonl"),
    ("postTestC-A",        "postTestC-A.jsonl"),
    ("postTestC-B",        "postTestC-B.jsonl"),
    ("postTestC-D",        "postTestC-D.jsonl"),
    ("postTestC-UI",       "postTestC-UI.jsonl"),
    ("postTestC-manual",   "postTestC-manual-review.jsonl"),
    ("postTestC-Fail",     None),  # Special: sum of all Fail files
])


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


def get_queue_status():
    """Get all queue counts and status."""
    status = {}
    total_inputs = 0
    total_outputs = 0
    
    for name, filename in QUEUES.items():
        if name == "postTestC-Fail":
            count = count_fail_files()
        else:
            count = count_queue(filename)
        
        unique = 0
        if filename:
            unique = count_unique_sources_in_queue(filename)
        
        status[name] = {"count": count, "unique": unique}
        
        # Categorize input vs output
        if name in ("preA", "preB", "postB-UI", "postB-preC"):
            total_inputs += count
        elif name in ("postA-UI", "preUI") or name.startswith("postTestC"):
            total_outputs += count
    
    return {
        "queues": status,
        "total_sources": get_total_sources(),
        "total_input_queue": total_inputs,
        "total_output_queue": total_outputs,
    }


def render_dashboard(status: dict, watch: bool = False):
    """Render the dashboard."""
    os.system("clear" if sys.platform != "win32" else "cls")
    
    qs = status["queues"]
    total = status["total_sources"]
    
    # Header
    print("╔══════════════════════════════════════════════════════════════════╗")
    print("║              EventPulse Queue Dashboard                          ║")
    if watch:
        print(f"║              Live Mode (Ctrl+C to stop)                        ║")
    print("╚══════════════════════════════════════════════════════════════════╝")
    print()
    
    # Queue table
    print(f"{'Queue':<22} {'Entries':>10} {'Unique':>10}")
    print("─" * 46)
    
    for name, data in qs.items():
        count = data["count"]
        unique = data["unique"]
        
        # Highlight warnings
        if name == "postB-preC" and count > 0:
            marker = " ⚠️  POSTB-PREC NOT EMPTY!"
            color_marker = f" \033[91m⚠\033[0m"
        elif name == "postB-preC" and count == 0:
            marker = " \033[92m✓\033[0m"
            color_marker = ""
        else:
            marker = ""
            color_marker = ""
        
        if marker:
            print(f"{name:<22} {count:>10} {unique:>10}{marker}")
        else:
            print(f"{name:<22} {count:>10} {unique:>10}")
    
    print("─" * 46)
    total_in = sum(qs[n]["count"] for n in qs if n in ("preA", "preB", "postB", "postB-preC"))
    total_out = sum(qs[n]["count"] for n in qs if n.startswith("postTestC"))
    print(f"{'TOTAL INPUT':<22} {total_in:>10}")
    print(f"{'TOTAL OUTPUT':<22} {total_out:>10}")
    print()
    
    # Summary
    print(f"Total Sources in sources/:     {total}")
    print(f"Total Queued (input+output):   {total_in + total_out}")
    
    # Processing status
    processed = total_out
    remaining = total - (total_out - qs.get("postTestC-Fail", {"count": 0})["count"])  # Approximate
    
    print()
    
    # Critical warnings
    if qs["postB-preC"]["count"] > 0:
        print(f"\033[91m⚠️  WARNING: postB-preC has {qs['postB-preC']['count']} entries!\033[0m")
        print("    Run: npx tsx 02-Ingestion/C-htmlGate/run-dynamic-pool.ts")
        print()
    
    # Balance check
    in_out = total_in + total_out
    if in_out > 0:
        completion = (total_out / total) * 100 if total > 0 else 0
        print(f"Approximate completion: {completion:.1f}% ({total_out}/{total})")
    
    print()
    print(f"Updated: {time.strftime('%H:%M:%S')}")


def main():
    watch = False
    interval = 2
    
    args = sys.argv[1:]
    if "--watch" in args:
        watch = True
        args.remove("--watch")
    if "-i" in args:
        idx = args.index("-i")
        if idx + 1 < len(args):
            interval = float(args[idx + 1])
            args = args[:idx] + args[idx+2:]
    
    if watch:
        print("Starting live dashboard (Ctrl+C to stop)...")
        time.sleep(0.5)
        while True:
            try:
                status = get_queue_status()
                render_dashboard(status, watch=True)
                time.sleep(interval)
            except KeyboardInterrupt:
                print("\nDashboard stopped.")
                break
    else:
        status = get_queue_status()
        render_dashboard(status, watch=False)


if __name__ == "__main__":
    main()
