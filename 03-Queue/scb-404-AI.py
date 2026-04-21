#!/usr/bin/env python3
"""
scb-404-AI.py — Sök varje 404-källa i postTestC-serverdown och postTestC-404 med Claude Code (MiniMax M2.7 via ollama),
öppnar separat terminal per källa, verifierar live-URL, skriver .md till RawSources (404-agg-*),
och flyttar källan till postTestC-out.

VERKTYG 13 — Fas 1+2:
  - Fas 1: score alla sökresultat (domain_similarity + event_signal + http + listing + freshness)
  - Hard reject: aggregatordomäner + exakt match mot sourceId
  - Fas 2: om ≤1 event → deep-list scraping av eventsidor
  - ÄNDRAR ALDRIG sources/ — skriver bara RawSources/404-agg-*.md + postTestC-out
  4. Ta bort entry från båda köerna

Använder: OLLAMA_MODEL=minimax-m2.7:cloud med ANTHROPIC_BASE_URL=http://localhost:11434
"""

import json
import time
import os
import sys
import re
import subprocess
import requests
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse

# ── Env ───────────────────────────────────────────────────────────────────────
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL   = os.getenv("OLLAMA_MODEL", "minimax-m2.7:cloud")

# ── Paths ─────────────────────────────────────────────────────────────────────
RUNTIME_DIR   = Path(__file__).parent.parent / "runtime"
LOGS_DIR      = RUNTIME_DIR / "logs"
RUN_LOG       = LOGS_DIR / f"scb-404-AI-{datetime.now().isoformat().replace(':', '-').replace('.', '-')}.log"
RAW_SOURCES  = Path(__file__).parent.parent / "01-Sources" / "RawSources"
SOURCES_DIR  = Path(__file__).parent.parent / "sources"
MAN_Q        = RUNTIME_DIR / "postTestC-serverdown.jsonl"
MAN_Q_404    = RUNTIME_DIR / "postTestC-404.jsonl"
OUT_Q        = RUNTIME_DIR / "postTestC-out.jsonl"
PROMPT_DIR   = Path(__file__).parent / "jobs" / "scb-404-AI"
PROMPT_DIR.mkdir(exist_ok=True, parents=True)

LOGS_DIR.mkdir(exist_ok=True, parents=True)
RAW_SOURCES.mkdir(exist_ok=True, parents=True)

# ── Log helper ────────────────────────────────────────────────────────────────
def log(*args):
    ts = datetime.now().isoformat()
    msg = " ".join(str(a) for a in args)
    line = f"{ts}  {msg}"
    print(line, flush=True)
    RUN_LOG.write_text(line + "\n", encoding="utf-8")

# ── Queue helpers ─────────────────────────────────────────────────────────────
def read_man_queue() -> list[dict]:
    """Read from both postTestC-serverdown and postTestC-404 queues."""
    entries = []
    for q in [MAN_Q, MAN_Q_404]:
        if q.exists():
            entries.extend(json.loads(l) for l in q.read_text().splitlines() if l.strip())
    return entries

def write_man_queue(entries: list[dict]):
    """Write remaining entries back to both queues (serverdown + 404)."""
    # Determine which source each entry came from based on current queue files
    # For simplicity: write all remaining to MAN_Q (serverdown)
    # Entries from 404 queue that fail stay in 404 queue
    by_queue: dict[Path, list[dict]] = {MAN_Q: [], MAN_Q_404: []}

    for entry in entries:
        source_id = entry.get("sourceId", "")
        # If it was in the 404 queue, put it back there
        if MAN_Q_404.exists():
            existing = [json.loads(l) for l in MAN_Q_404.read_text().splitlines() if l.strip()]
            if any(e.get("sourceId") == source_id for e in existing):
                by_queue[MAN_Q_404].append(entry)
            else:
                by_queue[MAN_Q].append(entry)
        else:
            by_queue[MAN_Q].append(entry)

    for q, q_entries in by_queue.items():
        if q_entries:
            q.write_text(
                "\n".join(json.dumps(e, ensure_ascii=False) for e in q_entries) + "\n",
                encoding="utf-8",
            )
        elif q.exists():
            q.unlink(missing_ok=True)

def read_out_queue() -> set[str]:
    if not OUT_Q.exists():
        return set()
    seen = set()
    for line in OUT_Q.read_text().splitlines():
        if line.strip():
            try:
                entry = json.loads(line)
                if entry.get("sourceId"):
                    seen.add(entry["sourceId"])
            except Exception:
                pass
    return seen

def append_out(entry: dict):
    with OUT_Q.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

# ── Update canonical source truth ─────────────────────────────────────────────
def update_source_truth(source_id: str, verified_url: str, status_code: int) -> bool:
    """Update the canonical sources/{id}.jsonl with the recovered URL."""
    source_file = SOURCES_DIR / f"{source_id}.jsonl"
    if not source_file.exists():
        log(f"    [source] fil saknas: {source_file.name}")
        return False

    try:
        source = json.loads(source_file.read_text(encoding="utf-8"))
        old_url = source.get("url", "")

        source["url"] = verified_url
        source["verifiedAt"] = datetime.now(timezone.utc).isoformat()
        source["needsRecheck"] = False

        if "metadata" not in source:
            source["metadata"] = {}
        source["metadata"]["404Recovery"] = {
            "recoveredAt": datetime.now(timezone.utc).isoformat(),
            "originalUrl": old_url,
            "newUrl": verified_url,
            "httpStatus": status_code,
            "recoveredBy": "scb-404-AI.py (Claude Code MiniMax)",
        }

        source_file.write_text(json.dumps(source, ensure_ascii=False) + "\n", encoding="utf-8")
        log(f"    [source] uppdaterad: {old_url} → {verified_url}")
        return True

    except Exception as e:
        log(f"    [source] fel vid uppdatering: {e}")
        return False

# ── Venue name helper ──────────────────────────────────────────────────────────
def venue_name_from_source_id(source_id: str) -> str:
    s = source_id.replace("-", " ").replace("_", " ")
    swaps = [
        ("goteborg", "göteborg"), ("g teborg", "göteborg"),
        ("orebro", "örebro"), ("vaxjo", "växjö"), ("kalmar", "kalmar"),
        ("uppsala", "uppsala"), ("stockholm", "stockholm"),
        ("malmo", "malmö"), ("umea", "umeå"), ("helsingborg", "helsingborg"),
        ("svenska ", ""), (" i ", " "), ("svenska ", ""),
    ]
    for old, new in swaps:
        s = s.replace(old, new)
    return s.strip().title()

CITY_MAP = {
    "stockholm": "Stockholm", "göteborg": "Göteborg", "gothenburg": "Göteborg",
    "malmö": "Malmö", "malmo": "Malmö", "uppsala": "Uppsala",
    "örebro": "Örebro", "orebro": "Örebro", "växjö": "Växjö", "vaxjo": "Växjö",
    "kalmar": "Kalmar", "umeå": "Umeå", "umea": "Umeå",
    "helsingborg": "Helsingborg", "gävle": "Gävle", "linköping": "Linköping",
}

def city_from_source_id(source_id: str) -> str:
    return next((v for k, v in CITY_MAP.items() if k in source_id.lower()), "Sverige")

def orig_domain_from_source_id(source_id: str) -> str:
    """Reconstruct original domain from source_id like 'falkbergs-arena'"""
    return source_id.replace("-", "") + ".se/"

# ── Aggregator domains (hard reject) ─────────────────────────────────────────
AGGREGATOR_DOMAINS = {
    "biljettshop.se", "billetto.se", "ticketmaster.se",
    "livenation.se", "evently.se", "eventim.se", "ticket.se",
    "eventbrite.com", "songkick.com", "bandsintown.com",
}

EVENT_SIGNALS = [
    "event", "biljett", "konsert", "festival", "evenemang",
    "kalender", "schema", "program", "spelschema", "match",
    "forestallning", "teater", "scen", "venue", "tickets",
    "concerts", "tickets", "shows", "upcoming", "calendar",
    "buy tickets", "köp biljett", "live", "spela", "match",
    "arrangemang", "livescener", "scenkonst",
]

LISTING_PATH_SIGNALS = [
    "/kalender", "/evenemang", "/program", "/schema", "/arkiv",
    "/events", "/calendar", "/program", "/konserter", "/biljetter",
    "/forestillingar", "/exhibition", "/utstallningar",
]

def get_domain_similarity(url: str, source_id: str) -> float:
    """
    Score domain similarity (0–2).
    0 = hard reject (aggregator or exact match)
    0–2 = progressive similarity score
    """
    parsed = urlparse(url)
    dom = parsed.netloc.lower().replace("www.", "")

    # Hard reject: aggregator domain
    for agg in AGGREGATOR_DOMAINS:
        if agg.replace(".", "") in dom.replace(".", ""):
            return 0.0

    # Hard reject: exact match against source_id
    slug = source_id.lower().replace("-", "").replace("_", "")
    if dom.startswith(slug) or dom == slug:
        return 0.0

    # Samma domän som original (reconstructed .se domain)
    orig = source_id.replace("-", "").lower() + ".se"
    if dom == orig:
        return 0.1

    # Likhet: shared substring > 3 chars with original slug
    slug = source_id.lower().replace("-", "").replace("_", "")
    shared = sum(1 for c in slug if c in dom)
    if shared >= 4:
        return 1.5

    # Helt ny domän
    return 2.0


def score_result(url: str, title: str, highlights: str, source_id: str,
                 is_listing: bool) -> tuple[float, dict, bool]:
    """
    Score a search result.
    Returns (combined_score, breakdown_dict, accept/reject_bool).
    THRESHOLD = 1.0
    """
    breakdown = {}

    domain_sim = get_domain_similarity(url, source_id)
    breakdown["domain"] = round(domain_sim, 3)

    if domain_sim == 0.0:
        breakdown["reason"] = "AGG_DOMAIN" if urlparse(url).netloc.replace(".", "") in {d.replace(".", "") for d in AGGREGATOR_DOMAINS} else "EXACT_MATCH"
        return 0.0, breakdown, False

    text = f"{title} {highlights} {url}".lower()
    signal_count = sum(1 for s in EVENT_SIGNALS if s in text)
    event_sig = 0.0 if signal_count == 0 else (0.5 if signal_count == 1 else 0.8)
    breakdown["event_signal"] = round(event_sig, 3)

    # http_score hardcoded to 1.0 here (verified by Claude terminal)
    http_score = 1.0
    breakdown["http"] = round(http_score, 3)

    listing_bonus = 0.3 if is_listing else 0.0
    breakdown["listing"] = round(listing_bonus, 3)

    freshness = 0.2 if re.search(r"202[7-9]|203[0-9]", f"{title} {url}") else 0.0
    breakdown["freshness"] = round(freshness, 3)

    combined = domain_sim + event_sig + http_score + listing_bonus + freshness
    breakdown["combined"] = round(combined, 3)
    accept = combined >= 1.0
    breakdown["accept"] = accept

    return combined, breakdown, accept


def log_score_breakdown(url: str, breakdown: dict) -> None:
    parts = [
        f"domain={breakdown.get('domain', 0):.2f}",
        f"event_sig={breakdown.get('event_signal', 0):.2f}",
        f"http={breakdown.get('http', 0):.2f}",
        f"listing={breakdown.get('listing', 0):.2f}",
        f"freshness={breakdown.get('freshness', 0):.2f}",
        f"combined={breakdown.get('combined', 0):.2f}",
    ]
    log(f"    scores: {', '.join(parts)}")


def format_score_log(url: str, breakdown: dict) -> str:
    parts = [
        f"domain={breakdown.get('domain', 0):.2f}",
        f"event_sig={breakdown.get('event_signal', 0):.2f}",
        f"http={breakdown.get('http', 0):.2f}",
        f"listing={breakdown.get('listing', 0):.2f}",
        f"freshness={breakdown.get('freshness', 0):.2f}",
        f"combined={breakdown.get('combined', 0):.2f}",
        f"accept={breakdown.get('accept', False)}",
    ]
    return " | ".join(parts)


def is_event_detail_link(href: str, base_domain: str) -> bool:
    IGNORE_PATH_PATTERNS = [
        "/nyheter", "/press", "/kontakt", "/om", "/om-oss",
        "/login", "/policy", "/privacy", "/cookies", "/social",
        "/instagram", "/facebook", "/linkedin", "/tiktok",
        "/bilder", "/galleri", "/archive", "/static",
    ]
    if not href:
        return False
    parsed = urlparse(href)
    if base_domain not in parsed.netloc.lower().replace("www.", ""):
        return False
    path_lower = parsed.path.lower()
    for pat in IGNORE_PATH_PATTERNS:
        if pat in path_lower:
            return False
    text = f"{href} {path_lower}"
    has_date = bool(re.search(r"\d{4}[-/]\d{2}[-/]\d{2}", href))
    has_event_keyword = any(s in text for s in EVENT_SIGNALS)
    return has_date or has_event_keyword


def collectEventDetailLinks(html: str, base_url: str) -> list[str]:
    """Parse HTML, find all event-detail candidate URLs."""
    links = []
    base_domain = urlparse(base_url).netloc.lower().replace("www.", "")
    try:
        for match in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\']', html, re.IGNORECASE):
            href = match.group(1).strip()
            if is_event_detail_link(href, base_domain):
                if href.startswith("http"):
                    links.append(href)
                elif href.startswith("/"):
                    from urllib.parse import urljoin
                    links.append(urljoin(base_url, href))
    except Exception:
        pass
    return list(dict.fromkeys(links))  # dedupe preserving order


def extract_from_html_simple(html: str, source_id: str, base_url: str) -> list[dict]:
    """Simple extraction of events from a single HTML page."""
    try:
        sys.path.insert(0, str(Path(__file__).parent.parent / "02-Ingestion"))
        from F.eventExtraction.universal_extractor import extractFromHtml
        result = extractFromHtml(html, source_id, base_url)
        if result.events:
            return [
                {"title": e.get("title", ""), "url": e.get("url", base_url),
                 "startDate": e.get("startDate", ""), "sourceId": source_id}
                for e in result.events
            ]
    except Exception:
        pass
    title_match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    title = title_match.group(1).strip() if title_match else source_id
    date_match = re.search(r"\d{4}[-/]\d{2}[-/]\d{2}", html)
    return [{"title": title, "url": base_url,
             "startDate": date_match.group(0) if date_match else "",
             "sourceId": source_id}]


def deepListPhase(verified_url: str, source_id: str) -> tuple[int, list[dict], bool]:
    """Phase 2: find event detail links and scrape each one."""
    try:
        resp = requests.get(verified_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
        html = resp.text
    except Exception as e:
        log(f"    [deep-list] fetch failed: {e}")
        return 0, [], False

    detail_links = collectEventDetailLinks(html, verified_url)
    if len(detail_links) < 2:
        log(f"    [deep-list] only {len(detail_links)} detail links found, skipping")
        return 0, [], False

    log(f"    [deep-list] found {len(detail_links)} event links, scraping...")
    detail_links = detail_links[:50]
    all_events = []

    for link in detail_links:
        try:
            r = requests.get(link, headers={"User-Agent": "Mozilla/5.0"}, timeout=10, allow_redirects=True)
            events = extract_from_html_simple(r.text, source_id, link)
            all_events.extend(events)
        except Exception:
            pass

    unique_events = []
    seen = set()
    for e in all_events:
        key = f"{e.get('title', '')}|{e.get('startDate', '')}"
        if key not in seen:
            seen.add(key)
            unique_events.append(e)

    log(f"    [deep-list] scraped {len(unique_events)} unique events")
    return len(unique_events), unique_events, len(unique_events) >= 2


def write_md(source_id: str, verified_url: str, status_code: int,
            ai_title: str, search_query: str, original_url: str,
            combined_score: float, breakdown: dict,
            events_found: int, phase2: bool,
            score_log: str) -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    city = next((v for k, v in {
        "stockholm": "Stockholm", "göteborg": "Göteborg", "gothenburg": "Göteborg",
        "malmö": "Malmö", "malmo": "Malmö", "uppsala": "Uppsala",
        "örebro": "Örebro", "orebro": "Örebro", "växjö": "Växjö", "vaxjo": "Växjö",
        "kalmar": "Kalmar", "umeå": "Umeå", "umea": "Umeå",
        "helsingborg": "Helsingborg", "gävle": "Gävle", "linköping": "Linköping",
    }.items() if k in source_id.lower()), "Sverige")

    url_slug = re.sub(r"[^\w]+", "-", urlparse(verified_url).netloc.replace("www.", ""))
    out_name = f"404-agg-{source_id}-{url_slug}.md"
    out_path = RAW_SOURCES / out_name

    reject_reason = ""
    if not breakdown.get("accept"):
        if breakdown.get("domain", 1) == 0:
            reject_reason = breakdown.get("reason", "LOW_SCORE")

    content = f"""---
originalSourceId: {source_id}
originalUrl: {original_url}
recoveredUrl: {verified_url}
domain: {urlparse(verified_url).netloc}
city: {city}
httpStatus: {status_code}
domainSimilarityScore: {breakdown.get("domain", 0):.3f}
eventSignalScore: {breakdown.get("event_signal", 0):.3f}
httpScore: {breakdown.get("http", 0):.3f}
listingBonus: {breakdown.get("listing", 0):.3f}
freshnessScore: {breakdown.get("freshness", 0):.3f}
combinedScore: {combined_score:.3f}
accepted: {str(breakdown.get("accept", False)).lower()}
rejectReason: {reject_reason}
phase2DeepList: {str(phase2).lower()}
eventsFound: {events_found}
foundVia: claude-ai-search
searchQuery: "{search_query}"
aiTitle: "{ai_title}"
addedAt: "{ts}"
addedBy: scb-404-AI.py
status: candidate-404-recovered
scoreLog: "{score_log}"
---

# {source_id} → {urlparse(verified_url).netloc}

**Recovered URL:** [{verified_url}]({verified_url})

**Original (död):** `{original_url}`

## Score Breakdown

| Komponent | Värde |
|-----------|-------|
| domain | {breakdown.get('domain', 0):.3f} |
| event_signal | {breakdown.get('event_signal', 0):.3f} |
| http | {breakdown.get('http', 0):.3f} |
| listing | {breakdown.get('listing', 0):.3f} |
| freshness | {breakdown.get('freshness', 0):.3f} |
| **combined** | **{combined_score:.3f}** |
| accept | {breakdown.get('accept', False)} |

## Events

- eventsFound: {events_found}
- phase2DeepList: {phase2}

_genererad: {ts} av scb-404-AI.py_
"""
    out_path.write_text(content, encoding="utf-8")
    return out_path

# ── Claude Code prompt template ────────────────────────────────────────────────
PROMPT_TEMPLATE = """Du ska hitta rätt event-URL för en svensk venue som tidigare gett 404. För varje sökresultat: SCORA först, acceptera eller rejecta, sen deep-lista om ≤1 event.

Källa: {source_id}
Venue-namn: {venue_name}
Ursprunglig domän (död): https://{orig_domain}

────────────── FÖRBJUDET ──────────────
★ ändra ALDRIG filen sources/{{source_id}}.jsonl
★ anropa ALDRIG update_source_truth()
────────────────────────────────────────

────────────── FAS 1: SÖK OCH SCORA ──────────────
1. Webbsök (t.ex. site:.se eller allmän) för {venue_name} evenemang
2. För VARJE sökresultat, räkna en COMBINED score:
   domain_similarity:
     • exakt samma domän som {orig_domain} → REJECT (0.0)
     • aggregatordomän (biljettshop, billetto, ticketmaster, eventbrite...) → REJECT (0.0)
     • snarlik domän (delar tecken med source_id) → 1.5
     • helt ny domän → 2.0
   event_signal: +0.5 om minst 1 event-signal finns i titel/URL, +0.8 om flera
     (event, biljett, konsert, festival, evenemang, kalender, schema, teater...)
   http_score: +1.0 (vi verifierar nedan)
   listing_bonus: +0.3 om URL:en innehåller /kalender, /evenemang, /program, /events
   freshness: +0.2 om framtida år (2027-2029) syns i titel/URL
   THRESHOLD = 1.0 — < 1.0 = REJECT, ≥ 1.0 = ACCEPT

3. För ACCEPT-resultat: HTTP-verify med curl att URL fungerar (200, 301, 302)

4. Logga ALLA resultat:
   [REJECT] {url} domain=0.0 reason=AGG_DOMAIN
   [ACCEPT] {url} combined=2.8 scores: domain=2.00, event_sig=0.50, http=1.00, listing=0.30, freshness=0.00

────────────── FAS 2: DEEP-LIST (om ≤1 event) ──────────────
5. Om en ACCEPT-URL returnerar ≤1 event:
   a) Hämta HTML från den URL:en
   b) Hitta ALLA <a href> som pekar på individuella eventsidor (undvik /nyheter, /om, /kontakt)
   c) Besök varje eventsida (max 50)
   d) Räkna unika events
   e) Om ≥ 2 events → GODKÄNN med aggregate count
   f) Om 0–1 events → rapportera count ändå (det är vad vi hittade)

────────────── OUTPUT (för VARJE ACCEPT-URL) ──────────────
6. Skriv en .md-fil till {raw_sources}/404-agg-{{source_id}}-{{domän}}.md med frontmatter:
---
originalSourceId: {{source_id}}
originalUrl: https://{{orig_domain}}
recoveredUrl: [VERIFIERAD_URL]
domain: [DOMAIN]
city: {city}
httpStatus: [STATUS]
domainSimilarityScore: [0.000-2.000]
eventSignalScore: [0.000-0.800]
httpScore: [0.700-1.000]
listingBonus: [0.000-0.300]
freshnessScore: [0.000-0.200]
combinedScore: [SUMMA]
accepted: true
phase2DeepList: [true/false]
eventsFound: [ANTAL]
foundVia: claude-ai-search
searchQuery: "[SÖKFRÅGA]"
aiTitle: "[TITEL]"
addedAt: "{ts}"
addedBy: scb-404-AI.py
status: candidate-404-recovered
scoreLog: "domain=X.XX | event_sig=X.XX | http=X.XX | listing=X.XX | freshness=X.XX | combined=X.XX | accept=True"
---

# {{source_id}} → [DOMAIN]

**Recovered URL:** [VERIFIERAD_URL]
**Original (död):** `https://{{orig_domain}}`

## Score Breakdown

| Komponent | Värde |
|-----------|-------|
| domain | X.XXX |
| event_signal | X.XXX |
| http | X.XXX |
| listing | X.XXX |
| freshness | X.XXX |
| **combined** | **X.XXX** |

## Events
- eventsFound: [ANTAL]
- phase2DeepList: [true/false]

_genererad: {ts} av scb-404-AI.py_

7. Appenda till {out_q} med JSON på EN rad:
{{"sourceId": "{source_id}", "queueName": "postTestC-out", "verifiedUrl": "[URL]", "httpStatus": [STATUS], "combinedScore": [SCORE], "eventsFound": [ANTAL], "phase2DeepList": [true/false]}}

8. Skriv "DONE:{source_id}:{verified_url}:{status}:{score}:{events}:{phase2}" till {done_marker}

Om ingen ACCEPT-URL hittas, skriv "FAIL:{source_id}" till {done_marker}.
"""

# ── Run Claude in new terminal ─────────────────────────────────────────────────
def run_claude_for_source(source_id: str, venue_name: str) -> Path | None:
    """
    Opens a new Terminal window and runs claude --print with MiniMax/ollama.
    Returns path to done marker on success, None on failure.
    """
    city = city_from_source_id(source_id)
    orig_domain = orig_domain_from_source_id(source_id)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    done_marker = PROMPT_DIR / f"done-{source_id}.marker"
    done_marker.unlink(missing_ok=True)

    prompt = PROMPT_TEMPLATE.format(
        source_id=source_id,
        venue_name=venue_name,
        orig_domain=orig_domain,
        city=city,
        ts=ts,
        raw_sources=str(RAW_SOURCES),
        out_q=str(OUT_Q),
        done_marker=str(done_marker),
    )

    prompt_file = PROMPT_DIR / f"prompt-{source_id}.txt"
    prompt_file.write_text(prompt, encoding="utf-8")

    project_path = "/Users/claudgashi/EventPulse-recovery/clawdbot2/project/00EVENTPULSEFINALDESTINATION/NEWSTRUCTURE"
    log_file = PROMPT_DIR / f"log-{source_id}.txt"

    # Build osascript to run claude in Terminal
    apple_script = (
        f'tell application "Terminal"\n'
        f'    do script "cd \\"{project_path}\\" && claude --print --model={OLLAMA_MODEL} --anthropic-base-url={OLLAMA_BASE_URL} --dangerously-skip-permissions --no-input < \\"{prompt_file}\\" > \\"{log_file}\\" 2>&1; echo \\"EXIT:$?\\" >> \\"{log_file}\\"; exit"\n'
        f'    activate\n'
        f'end tell'
    )

    log(f"  Terminal öppnas för {source_id}...")
    try:
        subprocess.run(["osascript", "-e", apple_script], check=True)
    except subprocess.CalledProcessError as e:
        log(f"  Kunde inte öppna terminal: {e}")
        return None

    return done_marker


def wait_for_marker(marker: Path, timeout: int = 120) -> str:
    """Wait for done marker file to appear with content."""
    start = time.time()
    while time.time() - start < timeout:
        if marker.exists():
            content = marker.read_text(encoding="utf-8").strip()
            if content:
                return content
        time.sleep(3)
    return ""


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    entries = read_man_queue()
    if not entries:
        log("  postTestC-serverdown + postTestC-404 är tomma — inget att göra.")
        return

    already_done = read_out_queue()
    entries = [e for e in entries if e.get("sourceId") not in already_done]

    total = len(entries)
    if total == 0:
        log("  Inga nya entries att processa.")
        return

    log(f"scb-404-AI (Claude Code MiniMax/ollama)  │  {total} källor i postTestC-serverdown + postTestC-404")
    log(f"  modell: {OLLAMA_MODEL} @ {OLLAMA_BASE_URL}")

    remaining = []
    processed = 0
    failed = 0

    for idx, entry in enumerate(entries):
        source_id = entry.get("sourceId", "")
        if not source_id:
            remaining.append(entry)
            continue

        venue_name = venue_name_from_source_id(source_id)
        log(f"[{idx+1}/{total}] {source_id} ({venue_name})")

        done_marker = run_claude_for_source(source_id, venue_name)

        if done_marker is None:
            remaining.append(entry)
            failed += 1
            continue

        result = wait_for_marker(done_marker, timeout=120)
        log_file = PROMPT_DIR / f"log-{source_id}.txt"

        if result.startswith("DONE:"):
            # Format: DONE:source_id:verified_url:status:score:events:phase2
            parts = result.rstrip("\n").split(":")
            verified_url = parts[1] if len(parts) > 1 else ""
            status_code = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 200
            combined_score = float(parts[3]) if len(parts) > 3 and parts[3] else 0.0
            events_found = int(parts[4]) if len(parts) > 4 and parts[4] else 0
            phase2_str = parts[5] if len(parts) > 5 else "false"
            phase2 = phase2_str.strip().lower() == "true"

            # Reconstruct breakdown from URL to pass to write_md
            is_listing = any(s in verified_url.lower() for s in LISTING_PATH_SIGNALS)
            _, breakdown, _ = score_result(verified_url, "", "", source_id, is_listing=is_listing)
            breakdown["combined"] = round(combined_score, 3)
            breakdown["accept"] = True

            original_url = "https://" + orig_domain_from_source_id(source_id)
            score_log = format_score_log(verified_url, breakdown)
            ai_title = ""

            # write_md uses Claude-generated filename, find it
            dom_slug = re.sub(r"[^\w]+", "-", urlparse(verified_url).netloc.replace("www.", ""))
            md_path = RAW_SOURCES / f"404-agg-{source_id}-{dom_slug}.md"

            # If Claude already wrote the file (per prompt instructions), no need to rewrite
            # Otherwise write it here as fallback
            if not md_path.exists():
                md_path = write_md(source_id, verified_url, status_code,
                                   ai_title, "", original_url,
                                   combined_score, breakdown,
                                   events_found, phase2, score_log)

            log(f"  ✓ {verified_url} (HTTP {status_code}, score={combined_score:.1f}, events={events_found})")
            log(f"    md: {md_path.name}")

            entry_out = dict(entry)
            entry_out["queueName"] = "postTestC-out"
            entry_out["verifiedUrl"] = verified_url
            entry_out["httpStatus"] = status_code
            entry_out["combinedScore"] = combined_score
            entry_out["eventsFound"] = events_found
            entry_out["phase2DeepList"] = phase2
            append_out(entry_out)
            processed += 1

        elif result.startswith("FAIL:"):
            remaining.append(entry)
            failed += 1
            log(f"  ✗ ingen verifierad URL")

        else:
            remaining.append(entry)
            failed += 1
            log(f"  ? timeout/okänt: {result[:80]}")
            if log_file.exists():
                log(f"     log: {log_file.read_text(encoding='utf-8')[:200]}")

        # Cleanup
        for f in [PROMPT_DIR / f"prompt-{source_id}.txt",
                  PROMPT_DIR / f"log-{source_id}.txt",
                  done_marker]:
            f.unlink(missing_ok=True)

        time.sleep(1)

    write_man_queue(remaining)

    log("")
    log(f"KLAR  │  {processed} fixerade  │  {failed} misslyckades  │  {len(remaining)} kvar i kö")
    log(f"  postTestC-out: {OUT_Q} (+{processed})")
    log(f"  postTestC-serverdown + postTestC-404: {len(remaining)} kvar totalt")


if __name__ == "__main__":
    main()
