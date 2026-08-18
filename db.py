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
import json
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
    ("postTestC-man1",      "postTestC-man1.jsonl"),
    ("postTestC-serverdown", "postTestC-serverdown.jsonl"),
    ("postTestC-404",        "postTestC-404.jsonl"),
    ("postTestC-error500",  "postTestC-error500.jsonl"),
    ("postTestC-timeout",    "postTestC-timeout.jsonl"),
    ("postTestC-blocked",    "postTestC-blocked.jsonl"),
    ("postTestC-out",        "postTestC-out.jsonl"),
    ("post10-UI",            "post10-UI.jsonl"),
    ("post10-man",           "post10-man.jsonl"),
    ("postD-UI",             "postD-UI.jsonl"),
    ("postD-man1",           "postD-man1.jsonl"),
    ("postD-man",            "postD-man.jsonl"),
    ("post-man",             "post-man.jsonl"),
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
            {"id": "14", "label": "🎭 Tool D — JS render gate (postTestC-D -> postD-UI/postD-man1/postD-man)", "cmd": ["npx", "tsx", "02-Ingestion/D-renderGate/runD-scrapingbee.ts", "--workers=4", "--max-pages=8"], "drain": "postTestC-D.jsonl"},
            {"id": "15", "label": "🧠 Tool D-AI — per-site AI+ScB (postD-man -> postD-UI/postD-man1/postD-man)", "cmd": ["npx", "tsx", "02-Ingestion/D-renderGate/runD-ai-scrapingbee.ts", "--input=postD-man.jsonl", "--workers=4", "--max-pages=8"], "drain": "postD-man.jsonl"},
            {"id": "16", "label": "🧹 Source URL dedupe (safe apply, backup first)", "cmd": ["python3", "scripts/dedupe-sources-by-url.py", "--apply"], "drain": None},
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
    {
        "name": "ALLTOOLS-E2E",
        "tools": [
            {
                "id": "17",
                "label": "🧭 Alltools-E2E — riktig A→B→C→D (preA-batch, rapport under Alltools-E2E/runtime/reports/)",
                "cmd": ["python3", "Alltools-E2E/e2e.py", "--limit", "10", "--apply", "--sync-legacy"],
                "drain": None,
            },
            {
                "id": "18",
                "label": "🧭 Alltools-E2E — töm preA (batch 10, rapporter per batch tills tomt)",
                "special": "e2e_drain_prea",
                "cmd": ["python3", "Alltools-E2E/e2e_drain_prea.py"],
                "drain": None,
            },
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
    {"id": "R",  "label": "R — sync-prea",       "desc": "sources/ → preA, töm övriga köer"},
    {"id": "X",  "label": "reset-all <queue>",    "desc": "Move all to preA"},
    {"id": "S",  "label": "snapshot <name>",      "desc": "Save backup"},
    {"id": "Y",  "label": "restore-snap <n>",     "desc": "Restore from backup"},
    {"id": "L",  "label": "log / snapshots",     "desc": "Journal + backups"},
    {"id": "gl", "label": "gl — google-fix 404",  "desc": "404: Google-fix"},
    {"id": "q",  "label": "Quit",                 "desc": "Exit"},
    {"id": "t",  "label": "t — claude minimaxC",  "desc": "Starta claude via tmate"},
    {"id": "u",  "label": "u — db.py i tmate",    "desc": "db.py i ny tmate-win"},
]

PIPELINE_COLUMNS = [
    "stage",
    "input_queue",
    "processor",
    "success_queue",
    "fail_queue",
    "retry_queue",
    "enabled",
    "mode",
    "sla_sec",
    "last_run",
    "in_count",
    "out_success",
    "out_fail",
]

PIPELINE_LABELS = {
    "stage": "Steg",
    "input_queue": "In-kö",
    "processor": "Processor",
    "success_queue": "Lyckad -> kö",
    "fail_queue": "Fel -> kö",
    "retry_queue": "Retry-kö",
    "enabled": "Aktiv",
    "mode": "Läge",
    "sla_sec": "SLA (sek)",
    "last_run": "Senast körd",
    "in_count": "In",
    "out_success": "Lyckade",
    "out_fail": "Fel",
}

PIPELINE_STAGES = [
    {
        "stage": "INGEST_RAW",
        "input_queue": "rawsources",
        "processor": "import_raw",
        "success_queue": "preA",
        "fail_queue": "post-man",
        "retry_queue": "rawsources",
        "enabled": True,
        "mode": "manual",
        "sla_sec": 120,
        "last_run": "-",
    },
    {
        "stage": "A_GATE",
        "input_queue": "preA",
        "processor": "run_a",
        "success_queue": "postA/preUI",
        "fail_queue": "preB",
        "retry_queue": "preA",
        "enabled": True,
        "mode": "manual",
        "sla_sec": 300,
        "last_run": "-",
    },
    {
        "stage": "B_GATE",
        "input_queue": "preB",
        "processor": "run_b",
        "success_queue": "postB/preUI",
        "fail_queue": "postB-preC",
        "retry_queue": "preB",
        "enabled": True,
        "mode": "manual",
        "sla_sec": 300,
        "last_run": "-",
    },
    {
        "stage": "C_HTML",
        "input_queue": "postB-preC",
        "processor": "run_c",
        "success_queue": "postTestC-UI/preUI",
        "fail_queue": "postTestC-man",
        "retry_queue": "postB-preC",
        "enabled": True,
        "mode": "manual",
        "sla_sec": 480,
        "last_run": "-",
    },
    {
        "stage": "SCB_DEEP",
        "input_queue": "postB-preC",
        "processor": "run_scb_deep",
        "success_queue": "postTestC-UI/preUI",
        "fail_queue": "postTestC-man",
        "retry_queue": "postTestC-man1",
        "enabled": True,
        "mode": "manual",
        "sla_sec": 900,
        "last_run": "-",
    },
    {
        "stage": "LOW_EVENT_REVIEW",
        "input_queue": "postTestC-man1",
        "processor": "man1_diag",
        "success_queue": "preUI",
        "fail_queue": "post-man",
        "retry_queue": "postTestC-man1",
        "enabled": True,
        "mode": "manual",
        "sla_sec": 600,
        "last_run": "-",
    },
    {
        "stage": "D_JS_RENDER",
        "input_queue": "postTestC-D",
        "processor": "run_d",
        "success_queue": "postD-UI",
        "fail_queue": "postD-man1/postD-man",
        "retry_queue": "postTestC-D",
        "enabled": False,
        "mode": "manual",
        "sla_sec": 900,
        "last_run": "-",
    },
]

STAGE_TOOL_MAP = {
    "INGEST_RAW": "0",
    "A_GATE": "1",
    "B_GATE": "2",
    "C_HTML": "3",
    "SCB_DEEP": "10",
    "D_JS_RENDER": "14",
    # LOW_EVENT_REVIEW currently manual analysis stage (no bound tool yet)
}

PIPELINE_STATE_FILE = RUNTIME_DIR / "pipeline-e2e-state.json"


# ── Helpers ───────────────────────────────────────────────────────────────────

def count_pre_a_queue():
    """Antal rader med sourceId i preA-queue.jsonl."""
    return count_queue("preA-queue.jsonl")


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


# e2eEventsPath (verktyg 17/18) — samma nycklar som Alltools-E2E/e2e.py
E2E_EVENTS_PATH_ORDER = [
    ("api", "E2E api (A)"),
    ("network", "E2E network (B)"),
    ("html", "E2E html (C)"),
    ("render", "E2E render (D)"),
    ("pending", "pending"),
    ("unset", "unset / äldre kö"),
]


def _normalize_e2e_events_path(raw):
    valid = {k for k, _ in E2E_EVENTS_PATH_ORDER}
    if raw is None:
        return "unset"
    s = str(raw).strip().lower()
    if not s:
        return "unset"
    return s if s in valid else "unset"


def _lines_nonempty(fpath: Path) -> int:
    if not fpath.is_file():
        return 0
    n = 0
    for line in fpath.read_text(encoding="utf-8").splitlines():
        if line.strip():
            n += 1
    return n


def _load_sources_status_events() -> dict:
    out = {}
    p = RUNTIME_DIR / "sources_status.jsonl"
    if not p.is_file():
        return out
    try:
        for line in p.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw:
                continue
            try:
                o = json.loads(raw)
                sid = str(o.get("sourceId") or "").strip()
                if not sid:
                    continue
                out[sid] = max(0, int(o.get("eventsFound", 0) or 0))
            except Exception:
                continue
    except Exception:
        pass
    return out


def _sid_home_from_runtime() -> dict:
    sid_home = {}
    for qlabel, fname in QUEUES:
        fpath = RUNTIME_DIR / fname
        if not fpath.is_file():
            continue
        try:
            for line in fpath.read_text(encoding="utf-8").splitlines():
                raw = line.strip()
                if not raw:
                    continue
                try:
                    o = json.loads(raw)
                    sid = str(o.get("sourceId") or "").strip()
                    if sid and sid not in sid_home:
                        sid_home[sid] = qlabel
                except Exception:
                    continue
        except Exception:
            continue
    return sid_home


def _infer_e2e_path_runtime(sid: str, home: str) -> str:
    ext = PROJECT_ROOT / "03-Queue" / "03-extractedevents"
    if _lines_nonempty(ext / "D" / f"{sid}.jsonl") > 0:
        return "render"
    if _lines_nonempty(ext / "C" / f"{sid}.jsonl") > 0:
        return "html"
    if _lines_nonempty(ext / f"{sid}.jsonl") > 0:
        if home == "postB":
            return "network"
        return "api"
    if home == "postA":
        return "api"
    if home == "postB":
        return "network"
    if home in ("postTestC-UI", "postTestC-man1", "preUI"):
        return "html"
    if home == "post10-UI":
        return "html"
    if home == "post10-man":
        return "pending"
    if home in ("postD-UI", "postD-man1", "postD-man"):
        return "render"
    if home in ("postB-preC", "postTestC-D", "preB", "preA"):
        return "pending"
    return "unset"


def _events_from_extracted_files(sid: str) -> int:
    ext = PROJECT_ROOT / "03-Queue" / "03-extractedevents"
    return (
        _lines_nonempty(ext / f"{sid}.jsonl")
        + _lines_nonempty(ext / "C" / f"{sid}.jsonl")
        + _lines_nonempty(ext / "D" / f"{sid}.jsonl")
    )


def _preui_file_aggregates():
    events_by_id = {}
    path_by_id = {}
    pre_path = RUNTIME_DIR / "preUI-queue.jsonl"
    if not pre_path.is_file():
        return events_by_id, path_by_id
    try:
        for line in pre_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            sid = o.get("sourceId")
            if not sid:
                continue
            sid = str(sid)
            try:
                n = int(o.get("eventsFound", 0) or 0)
            except (TypeError, ValueError):
                n = 0
            n = max(0, n)
            path_norm = _normalize_e2e_events_path(o.get("e2eEventsPath"))
            if sid not in events_by_id:
                events_by_id[sid] = n
                path_by_id[sid] = path_norm
            else:
                prev = events_by_id[sid]
                if n > prev:
                    events_by_id[sid] = n
                    path_by_id[sid] = path_norm
                elif n == prev:
                    path_by_id[sid] = path_norm
    except Exception:
        pass
    return events_by_id, path_by_id


def load_runtime_e2e_aggregates():
    status_ev = _load_sources_status_events()
    homes = _sid_home_from_runtime()
    events_by_id = {}
    path_by_id = {}
    for sid, home in homes.items():
        path_by_id[sid] = _normalize_e2e_events_path(_infer_e2e_path_runtime(sid, home))
        n_status = status_ev.get(sid, 0)
        n_files = _events_from_extracted_files(sid)
        events_by_id[sid] = max(n_status, n_files)
    return events_by_id, path_by_id, homes


def load_pre_ui_aggregates():
    """
    Per sourceId: max(events) och e2eEventsPath.
    Kombinerar runtime-köer + extractedevents (A–D) med preUI-raders annotering.
    """
    ev_p, path_p = _preui_file_aggregates()
    ev_r, path_r, homes = load_runtime_e2e_aggregates()
    all_ids = set(ev_p) | set(ev_r) | set(path_p) | set(path_r)
    events_out = {}
    path_out = {}
    for sid in all_ids:
        n = max(ev_p.get(sid, 0), ev_r.get(sid, 0))
        if sid in homes:
            pth = path_r.get(sid, "unset")
        else:
            pth = path_p.get(sid, "unset")
        events_out[sid] = n
        path_out[sid] = _normalize_e2e_events_path(pth)
    return events_out, path_out


def load_pre_ui_sources():
    """Bakåtkompatibel: endast events_by_id (max eventsFound per sourceId)."""
    events_by_id, _ = load_pre_ui_aggregates()
    return events_by_id


def pre_ui_e2e_path_counts():
    """Runtime-köer + extractedevents (+ preUI-metadata) → fördelning av e2eEventsPath."""
    _, path_by_id = load_pre_ui_aggregates()
    counts = {k: 0 for k, _ in E2E_EVENTS_PATH_ORDER}
    for sid in path_by_id:
        key = path_by_id.get(sid, "unset")
        counts[key] = counts.get(key, 0) + 1
    return counts, len(path_by_id)


# Intervall för preUI eventsFound (0/1 egna; sedan 2-5 … 2001+)
PREUI_EVENT_BUCKETS = [
    (0, 0, "0 events"),
    (1, 1, "1 event"),
    (2, 5, "2-5 events"),
    (6, 10, "6-10 events"),
    (11, 20, "11-20 events"),
    (21, 30, "21-30 events"),
    (31, 100, "31-100 events"),
    (101, 200, "101-200 events"),
    (201, 500, "201-500 events"),
    (501, 2000, "501-2000 events"),
    (2001, None, "2001+ events"),
]


def _bucket_index_preui_events(ev):
    try:
        n = max(0, int(ev))
    except (TypeError, ValueError):
        n = 0
    for i, (lo, hi, _) in enumerate(PREUI_EVENT_BUCKETS):
        if hi is None:
            if n >= lo:
                return i
        elif lo <= n <= hi:
            return i
    return len(PREUI_EVENT_BUCKETS) - 1


def events_per_source_histogram():
    """Aggregerat events per källa (load_pre_ui_sources / alla köer + extraktioner)."""
    events_by_id = load_pre_ui_sources()
    counts = [0] * len(PREUI_EVENT_BUCKETS)
    for sid, ev in events_by_id.items():
        counts[_bucket_index_preui_events(ev)] += 1
    out = []
    for i, (_, _, label) in enumerate(PREUI_EVENT_BUCKETS):
        if counts[i] > 0:
            out.append((label, counts[i]))
    return out


def queue_counts():
    counts = {}
    for name, fname in QUEUES:
        if name == "postTestC-Fail":
            counts[name] = count_fail()
        else:
            counts[name] = count_queue(fname)
    return counts


def load_pipeline_state():
    if not PIPELINE_STATE_FILE.exists():
        return {}
    try:
        return json.loads(PIPELINE_STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_pipeline_state(state):
    PIPELINE_STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def update_pipeline_state(stage, in_count, out_success, out_fail):
    state = load_pipeline_state()
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    state[stage] = {
        "last_run": now_iso,
        "in_count": in_count,
        "out_success": out_success,
        "out_fail": out_fail,
    }
    save_pipeline_state(state)


def run_tool_by_id(tool_id):
    tool = next((t for t in TOOLS if t["id"] == tool_id), None)
    if not tool:
        print(f"  ⚠ Tool saknas för id={tool_id}")
        return 1
    if tool.get("special") == "e2e_drain_prea":
        return run_e2e_drain_prea_interactive(tool)
    drain_until_empty(tool)
    return 0


def run_pipeline_stage(stage_name):
    row = next((r for r in PIPELINE_STAGES if r["stage"] == stage_name), None)
    if not row:
        print(f"  Okänt stage: {stage_name}")
        return 1
    if not row.get("enabled", False):
        print(f"  Stage {stage_name} är avstängd (enabled=false)")
        return 1
    in_before = queue_counts()
    def resolve_from(d, queue_name):
        for q in str(queue_name).split("/"):
            q = q.strip()
            if q in d:
                return d.get(q, 0)
        return 0
    in_count = 0
    in_count = resolve_from(in_before, row["input_queue"])

    print(f"\n  ▶ E2E stage: {stage_name} ({row['processor']})")
    tool_id = STAGE_TOOL_MAP.get(stage_name)
    if tool_id:
        run_tool_by_id(tool_id)
    else:
        print("  ℹ Ingen automatisk processor bunden än (manuell stage).")

    after = queue_counts()
    succ_before = resolve_from(in_before, row["success_queue"])
    succ_after = resolve_from(after, row["success_queue"])
    fail_before = resolve_from(in_before, row["fail_queue"])
    fail_after = resolve_from(after, row["fail_queue"])
    out_success = max(0, succ_after - succ_before)
    out_fail = max(0, fail_after - fail_before)
    update_pipeline_state(stage_name, in_count, out_success, out_fail)
    return 0


def run_alltools_e2e(limit=10):
    """Kör riktig A→B→C→D mot projektets runtime/ (preA-batch)."""
    script = PROJECT_ROOT / "Alltools-E2E" / "e2e.py"
    if not script.is_file():
        print(f"  ⚠ Saknas: {script}")
        return 1
    print(
        f"\n  ▶ Alltools-E2E: python3 {script.name} --limit {limit} --apply --sync-legacy --from-preA"
    )
    return subprocess.run(
        [
            "python3",
            str(script),
            "--limit",
            str(int(limit)),
            "--apply",
            "--sync-legacy",
            "--from-preA",
        ],
        cwd=str(PROJECT_ROOT),
    ).returncode


def run_pipeline_auto():
    """Kör Alltools-E2E: riktig A–D på projekt-runtime (preA krävs)."""
    print("\n  ⏩ e2e-run → Alltools-E2E (riktig A→B→C→D, preA-batch)")
    run_alltools_e2e(10)


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
    pipeline_state = load_pipeline_state()
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
    postTestC_man1      = counts.get("postTestC-man1", 0)
    postTestC_serverdown= counts.get("postTestC-serverdown", 0)
    postTestC_404       = counts.get("postTestC-404", 0)
    postTestC_error500  = counts.get("postTestC-error500", 0)
    postTestC_timeout   = counts.get("postTestC-timeout", 0)
    postTestC_blocked   = counts.get("postTestC-blocked", 0)
    postTestC_out       = counts.get("postTestC-out", 0)
    postD_UI            = counts.get("postD-UI", 0)
    postD_man1          = counts.get("postD-man1", 0)
    postD_man           = counts.get("postD-man", 0)
    post_man            = counts.get("post-man", 0)
    postTestC_Out       = counts.get("postTestC-Out", 0)  # kept for compatibility
    postTestC_Fail = counts.get("postTestC-Fail", 0)
    preUI          = counts.get("preUI", 0)
    EVENTPULSE_APP = counts.get("EVENTPULSE-APP", 0)

    def resolve_count(queue_name):
        if not queue_name:
            return 0
        for part in str(queue_name).split("/"):
            key = part.strip()
            if key in counts:
                return counts.get(key, 0)
        return 0

    def shorten(text, max_len):
        s = str(text or "")
        if len(s) <= max_len:
            return s
        if max_len <= 1:
            return s[:max_len]
        return s[:max_len - 1] + "…"

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
        ("postTestC-man1",      postTestC_man1,      ""),
        ("postTestC-serverdown",postTestC_serverdown,""),
        ("postTestC-404",       postTestC_404,       ""),
        ("postTestC-error500",  postTestC_error500,  ""),
        ("postTestC-timeout",   postTestC_timeout,   ""),
        ("postTestC-blocked",   postTestC_blocked,   ""),
        ("postTestC-out",       postTestC_out,       ""),
        ("postD-UI",            postD_UI,            "◀"),
        ("postD-man1",          postD_man1,          ""),
        ("postD-man",           postD_man,           ""),
        ("post-man",            post_man,            ""),
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

    # ── E2E dashboard (simplified) ───────────────────────────────────────────
    print("║  E2E-FLÖDE (ENKLARE VY)                                                     ║")
    print("║  ────────────────────────────────────────────────────────────────────────── ║")
    print("║  [A] FLOW-KARTA (KONFIG)                                                    ║")
    print("║  Steg          Aktiv  In-kö         Processor      Lyckad -> kö      Fel -> kö          Retry        ║")
    print("║  " + "·" * 154 + "║")
    for row in PIPELINE_STAGES:
        flow_line = (
            f"{shorten(row['stage'], 12):<12}  "
            f"{('ja' if row['enabled'] else 'nej'):<5}  "
            f"{shorten(row['input_queue'], 13):<13}  "
            f"{shorten(row['processor'], 13):<13}  "
            f"{shorten(row['success_queue'], 16):<16}  "
            f"{shorten(row['fail_queue'], 16):<16}  "
            f"{shorten(row['retry_queue'], 12):<12}"
        )
        print(f"║  {flow_line[:154]:<154}║")

    print("║  ────────────────────────────────────────────────────────────────────────── ║")
    print("║  [B] SENASTE KÖRNINGAR (FAKTISK HISTORIK)                                   ║")
    print("║  Steg          Senast (UTC)          In   Lyckade   Fel   SLA   Läge         ║")
    print("║  " + "·" * 154 + "║")
    for row in PIPELINE_STAGES:
        state_row = pipeline_state.get(row["stage"], {})
        in_count = state_row.get("in_count", 0)
        out_success = state_row.get("out_success", 0)
        out_fail = state_row.get("out_fail", 0)
        last_run = state_row.get("last_run", "-")
        run_line = (
            f"{shorten(row['stage'], 12):<12}  "
            f"{shorten(last_run, 20):<20}  "
            f"{str(in_count):>4}  "
            f"{str(out_success):>7}  "
            f"{str(out_fail):>4}  "
            f"{str(row['sla_sec']):>4}  "
            f"{shorten(row['mode'], 10):<10}"
        )
        print(f"║  {run_line[:154]:<154}║")

    print("║  ────────────────────────────────────────────────────────────────────────── ║")
    print("║  Tolkning: Flow-karta = hur stegen är konfigurerade. Senaste körningar = vad som faktiskt hände sist.  ║")
    total_fail = counts.get("postTestC-man", 0) + counts.get("postTestC-man1", 0) + counts.get("postD-man1", 0) + counts.get("postD-man", 0) + counts.get("post-man", 0)
    conversion = (preUI / total * 100.0) if total > 0 else 0.0
    fail_rate = (total_fail / total * 100.0) if total > 0 else 0.0
    stuck = counts.get("postB-preC", 0) + counts.get("postTestC-man", 0) + counts.get("postTestC-man1", 0)
    print(f"║  KPI: conversion->preUI {conversion:5.1f}% | fail-rate {fail_rate:5.1f}% | stuck-sources {stuck:<5}                           ║")
    print("║  ────────────────────────────────────────────────────────────────────────── ║")
    sp_counts, sp_total = pre_ui_e2e_path_counts()
    print("║  runtime · e2ePath (17/18, riktig A–D)  api | network | html | render | pending | unset                 ║")
    for key, label in E2E_EVENTS_PATH_ORDER:
        c = sp_counts.get(key, 0)
        inner = f"     {label:<42} {c:>5}"
        print(f"║  {inner:<154}║")
    inner_total = f"     {'TOTAL källor':<42} {sp_total:>5}"
    print(f"║  {inner_total:<154}║")
    print("║  ────────────────────────────────────────────────────────────────────────── ║")
    print("║  EVENTS/KÄLLA — runtime intervall (eventsFound: 0,1,2-5,…,2001+)             ║")
    ev_hist = events_per_source_histogram()
    if not ev_hist:
        print("║     (ingen data)                                                            ║")
    else:
        for label, nsrc in ev_hist:
            inner = f"     {nsrc:>5} källor  {label}"
            print(f"║  {inner:<154}║")
    print("║  Kommandon: legacy-run <tool-id> | 17=E2E batch | 18=E2E töm preA | e2e-run | e2e-step <stage>            ║")
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

def run_e2e_drain_prea_interactive(tool):
    """
    Verktyg 18: samma batchar som e2e_drain_prea.py men uppdaterar dashboard efter varje lyckad batch.
    """
    e2e_main = PROJECT_ROOT / "Alltools-E2E" / "e2e.py"
    if not e2e_main.is_file():
        print(f"  ⚠ Saknas: {e2e_main}")
        return 2

    logs_dir = RUNTIME_DIR / "logs"
    logs_dir.mkdir(exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    log_path = logs_dir / f"run-{tool['id']}-{ts}.log"
    batch_cap = 10

    print()
    print(f"  ┌──────────────────────────────────────────┐")
    print(f"  │  KÖR: {tool['label'][:36]:<36}│")
    print(f"  │  LOG: {str(log_path)[:36]:<36}│")
    print(f"  └──────────────────────────────────────────┘")
    print()
    sys.stdout.flush()

    batch_no = 0
    final_rc = 0
    with open(log_path, "w", encoding="utf-8") as log_file:
        while True:
            n = count_pre_a_queue()
            if n == 0:
                done_msg = "\n[E2E-18] preA är tom — alla batchar klara.\n"
                print(done_msg)
                log_file.write(done_msg)
                break

            lim = min(batch_cap, n)
            batch_no += 1
            hdr = f"\n[E2E-18] ─── Batch {batch_no} ─── preA kvar: {n} → limit={lim}\n"
            print(hdr)
            log_file.write(hdr)
            log_file.flush()

            proc = subprocess.Popen(
                [
                    sys.executable,
                    str(e2e_main),
                    "--limit",
                    str(lim),
                    "--apply",
                    "--sync-legacy",
                    "--from-preA",
                ],
                cwd=str(PROJECT_ROOT),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            stdout = proc.stdout
            if stdout is None:
                rc = proc.wait()
            else:
                while True:
                    line = stdout.readline()
                    if not line:
                        break
                    decoded = line.decode("utf-8", errors="replace")
                    print(decoded, end="")
                    log_file.write(decoded)
                    log_file.flush()
                    sys.stdout.flush()
                rc = proc.wait()
            if rc != 0:
                err = f"\n[E2E-18] Batch {batch_no} misslyckades (exit {rc}). Stoppar.\n"
                print(red(err))
                log_file.write(err)
                final_rc = rc
                break

            dash_note = f"\n  📊 Dashboard uppdaterad efter batch {batch_no} (preA kvar: {count_pre_a_queue()})\n"
            print(dash_note)
            log_file.write(dash_note)
            log_file.flush()
            show_dashboard(running_id="18")

    sys.stdout.flush()
    label = green("✓ KLAR!") if final_rc == 0 else red("✗ KLAR!")
    print(f"\n  {label} Exit code: {final_rc}  |  Log: {log_path}")
    sys.stdout.flush()
    return final_rc


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
        subprocess.run(["python3", "queue-mem.py", "sync-prea"])
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
            elif tool.get("special") == "e2e_drain_prea":
                run_e2e_drain_prea_interactive(tool)
                input("  Tryck Enter...")
            else:
                drain_until_empty(tool)
            time.sleep(1)

        elif cmd_raw in [m["id"] for m in MEM_CMDS]:
            handle_mem_cmd(cmd_raw, arg)

        elif choice in ("legacy-run", "lr"):
            tool_id = arg.strip()
            # Be tolerant if user accidentally types:
            # "legacy-run legacy-run <tool-id>"
            if tool_id.lower().startswith("legacy-run "):
                tool_id = tool_id.split(None, 1)[1].strip()
            if not tool_id:
                tool_id = input("  Tool-id (legacy): ").strip()
            if tool_id:
                run_tool_by_id(tool_id)
            time.sleep(1)

        elif choice == "e2e-step":
            stage_name = arg.strip()
            if not stage_name:
                stage_name = input("  Stage-namn: ").strip()
            if stage_name:
                run_pipeline_stage(stage_name)
            time.sleep(1)

        elif choice == "e2e-run":
            run_pipeline_auto()
            time.sleep(1)

        else:
            print(f"  Okänt val: {choice}")
            time.sleep(1)


if __name__ == "__main__":
    main()
