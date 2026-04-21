#!/usr/bin/env python3
"""
gl-fix-404.py — Sök varje 404-källa i postTestC-serverdown och postTestC-404 med Exa API,
verifiera live-URL, skriv en .md-fil per källa i RawSources/,
och flytta källan till postTestC-out.

Flow per sourceId:
  1. Läs entry från postTestC-serverdown OCH postTestC-404
  2. Exa-sök: hitta event-URL för venue (live webbsökning)
  3. HTTP-verify (200 eller 301/302 → bekräftad)
  4. Spara .md i RawSources/ med strukturerad frontmatter
  5. Efter lyckad sparning: appenda till postTestC-out
  6. Ta bort entry från båda köerna
"""

import json
import time
import os
import sys
import re
import requests
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse, urljoin

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

# ── Env ───────────────────────────────────────────────────────────────────────
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

EXA_API_KEY = os.getenv("EXA_API_KEY", "")

# ── Paths ─────────────────────────────────────────────────────────────────────
RUNTIME_DIR  = Path(__file__).parent.parent / "runtime"
LOGS_DIR     = RUNTIME_DIR / "logs"
RUN_LOG      = LOGS_DIR / f"gl-fix-404-{datetime.now().isoformat().replace(':', '-').replace('.', '-')}.log"
RAW_SOURCES = Path(__file__).parent.parent / "01-Sources" / "RawSources"
SOURCES_DIR = Path(__file__).parent.parent / "sources"
MAN_Q       = RUNTIME_DIR / "postTestC-serverdown.jsonl"
MAN_Q_404   = RUNTIME_DIR / "postTestC-404.jsonl"
OUT_Q       = RUNTIME_DIR / "postTestC-out.jsonl"

LOGS_DIR.mkdir(exist_ok=True, parents=True)
RAW_SOURCES.mkdir(exist_ok=True, parents=True)

# ── Log helper — terminal + per-run file ───────────────────────────────────────
def log(*args):
    ts = datetime.now().isoformat()
    msg = " ".join(str(a) for a in args)
    line = f"{ts}  {msg}"
    print(line, flush=True)
    RUN_LOG.write_text(line + "\n", encoding="utf-8")

# ── HTTP verify ────────────────────────────────────────────────────────────────
def http_verify(url: str, timeout: int = 8) -> tuple[bool, int, str]:
    """Return (success, status_code, final_url). Follows redirects."""
    try:
        req = requests.Request("GET", url, headers={"User-Agent": "Mozilla/5.0"})
        with requests.Session().send(req.prepare(), timeout=timeout, allow_redirects=True) as resp:
            return (True, resp.status_code, resp.url or url)
    except requests.exceptions.HTTPError as e:
        return (True, e.response.status_code, e.response.url)
    except Exception:
        return (False, 0, "")


# ── Exa search ─────────────────────────────────────────────────────────────────
def exa_search(query: str, n: int = 8) -> list[dict]:
    """Search using Exa API - live web search, returns actual URLs with highlights.

    Returns list of dicts with url, title, snippet.
    """
    if not EXA_API_KEY:
        log("    [exa] Ingen API-nyckel (EXA_API_KEY)")
        return []

    try:
        response = requests.post(
            "https://api.exa.ai/search",
            headers={"Authorization": f"Bearer {EXA_API_KEY}"},
            json={
                "query": query,
                "numResults": n,
                "contents": {"text": True, "highlights": True},
            },
            timeout=15,
        )

        if response.status_code != 200:
            log(f"    [exa] HTTP {response.status_code}: {response.text[:200]}")
            return []

        data = response.json()
        results = []
        for item in data.get("results", []):
            url = item.get("url", "")
            title = item.get("title", "") or url.split("/")[-1].replace("-", " ")
            snippet = item.get("highlights", "") or ""
            results.append({
                "url": url,
                "title": title[:120],
                "highlights": snippet[:300],
            })

        return results

    except Exception as e:
        log(f"    [exa] fel: {e}")
        return []


# ── Aggregator domains (hard reject) ─────────────────────────────────────────
AGGREGATOR_DOMAINS = {
    "biljettshop.se", "billetto.se", "ticketmaster.se",
    "livenation.se", "evently.se", "eventim.se", "ticket.se",
    "eventbrite.com", "songkick.com", "bandsintown.com",
}

# ── Event-like filter ─────────────────────────────────────────────────────────
EXCLUDE_DOMAINS = [
    "wikipedia.org", "wikidata.org", "wikimedia.org",
    "facebook.com", "instagram.com", "linkedin.com",
    "youtube.com", "vimeo.com", "flickr.com",
    "github.com", "gitlab.com", "bitbucket.org",
    "google.com/search", "duckduckgo.com", "bing.com",
    "tripadvisor.com", "yelp.com",
    "booking.com", "hotels.com", "airbnb.com",
    "soundcloud.com", "bandcamp.com", "spotify.com",
    "apple.com", "microsoft.com", "amazon.com",
]

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


def is_event_like(url: str, title: str, highlights: str) -> bool:
    text = f"{title} {highlights} {url}".lower()
    for pattern in EXCLUDE_DOMAINS:
        if pattern in url.lower():
            return False
    return any(signal in text for signal in EVENT_SIGNALS)


def get_domain_similarity(url: str, source_id: str, existing_ids: set) -> float:
    """
    Returns a domain similarity score for a URL given the original source_id.

    0.0 = hard reject (aggregator or exact match with existing sourceId)
    0.1 = same domain as original (low)
    1.5 = similar root domain (medium-high)
    2.0 = new domain (high)
    """
    parsed = urlparse(url)
    found_domain = parsed.netloc.lower().replace("www.", "")

    # Hard reject: aggregator domain
    for agg in AGGREGATOR_DOMAINS:
        if agg in found_domain:
            return 0.0

    # Hard reject: exact match with existing sourceId
    if source_id in existing_ids:
        return 0.0

    # Rebuild expected original domain
    orig_domain = source_id.replace("-", "").replace("_", "").lower()

    # Exact same domain as original source_id
    if orig_domain in found_domain and found_domain.replace(orig_domain, "") == "":
        return 0.1

    # Same root domain (e.g., globen.se vs globenarena.se)
    if orig_domain in found_domain:
        return 1.5

    # New domain
    return 2.0


def score_result(url: str, title: str, highlights: str, source_id: str,
                 existing_ids: set, status_code: int,
                 is_listing: bool) -> tuple[float, dict, bool]:
    """
    Score a search result.

    Returns (combined_score, breakdown_dict, accept/reject_bool).
    THRESHOLD = 1.0
    """
    breakdown = {}

    # domain_similarity (0–2)
    domain_sim = get_domain_similarity(url, source_id, existing_ids)
    breakdown["domain"] = round(domain_sim, 3)

    if domain_sim == 0.0:
        breakdown["reason"] = "AGG_DOMAIN" if urlparse(url).netloc.replace("www.", "") in {d.replace(".", "") for d in AGGREGATOR_DOMAINS} else "EXACT_MATCH"
        return 0.0, breakdown, False

    # event_signal (0–0.8)
    text = f"{title} {highlights} {url}".lower()
    signal_count = sum(1 for s in EVENT_SIGNALS if s in text)
    if signal_count == 0:
        event_sig = 0.0
    elif signal_count == 1:
        event_sig = 0.5
    else:
        event_sig = 0.8
    breakdown["event_signal"] = round(event_sig, 3)

    # http_score (0.7 or 1.0)
    http_score = 1.0 if status_code == 200 else 0.7
    breakdown["http"] = round(http_score, 3)

    # listing_bonus (0 or 0.3)
    listing_bonus = 0.3 if is_listing else 0.0
    breakdown["listing"] = round(listing_bonus, 3)

    # freshness (0 or 0.2) — look for future year in URL/title
    freshness = 0.0
    year_match = re.search(r"202[7-9]|203[0-9]", f"{title} {url}")
    if year_match:
        freshness = 0.2
    breakdown["freshness"] = round(freshness, 3)

    combined = domain_sim + event_sig + http_score + listing_bonus + freshness
    breakdown["combined"] = round(combined, 3)

    accept = combined >= 1.0
    breakdown["accept"] = accept

    return combined, breakdown, accept


def log_score_breakdown(url: str, breakdown: dict) -> None:
    """Log each score component at DEBUG level."""
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
    """Format score breakdown as a compact single-line string for frontmatter."""
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
IGNORE_PATH_PATTERNS = [
    "/nyheter", "/press", "/kontakt", "/om", "/om-oss",
    "/login", "/policy", "/privacy", "/cookies", "/social",
    "/instagram", "/facebook", "/linkedin", "/tiktok",
    "/bilder", "/galleri", "/archive", "/static",
]


def is_event_detail_link(href: str, base_domain: str) -> bool:
    """Return True if href looks like an individual event detail page."""
    if not href:
        return False
    parsed = urlparse(href)
    # Must be same domain
    if base_domain not in parsed.netloc.lower().replace("www.", ""):
        return False
    # Must not be ignored path
    path_lower = parsed.path.lower()
    for pat in IGNORE_PATH_PATTERNS:
        if pat in path_lower:
            return False
    # Must look event-like (contain date or event keywords)
    text = f"{href} {path_lower}"
    has_date = bool(re.search(r"\d{4}[-/]\d{2}[-/]\d{2}", href))
    has_event_keyword = any(s in text for s in EVENT_SIGNALS)
    return has_date or has_event_keyword


def collectEventDetailLinks(html: str, base_url: str) -> list[str]:
    """
    Parse HTML, find all event-detail candidate URLs.
    Returns deduplicated list of absolute URLs.
    """
    if not HAS_BS4:
        # Fallback: regex-based link extraction
        base_parsed = urlparse(base_url)
        base_domain = base_parsed.netloc.lower().replace("www.", "")
        links = set()
        for match in re.finditer(r'href="(/[^"]+)"', html):
            href = match.group(1)
            full_url = urljoin(base_url, href)
            if is_event_detail_link(full_url, base_domain):
                links.add(full_url)
        return list(links)

    soup = BeautifulSoup(html, "html.parser")
    base_parsed = urlparse(base_url)
    base_domain = base_parsed.netloc.lower().replace("www.", "")

    links = set()

    # Strategy 1: find <article>/<li>/<div> elements with a <time> child,
    # then look for <a href> inside them
    for time_el in soup.find_all("time"):
        # Walk up to 3 parents looking for a container with links
        parent = time_el.parent
        for _ in range(4):
            if parent is None:
                break
            for a in parent.find_all("a", href=True):
                href = a["href"]
                full_url = urljoin(base_url, href)
                if is_event_detail_link(full_url, base_domain):
                    links.add(full_url)
            parent = parent.parent

    # Strategy 2: find all links that contain a date pattern in the URL
    date_link_pattern = re.compile(r"/\d{4}[-/]\d{2}[-/]\d{2}")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        full_url = urljoin(base_url, href)
        if is_event_detail_link(full_url, base_domain):
            links.add(full_url)

    return list(links)


def extract_from_html_simple(html: str, source_id: str, base_url: str) -> list[dict]:
    """
    Simple extraction of events from a single HTML page.
    Returns list of event dicts with at least 'title' and 'url'.
    Falls back to universal-extractor if available.
    """
    # Try importing from the project's event extractor
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

    # Fallback: extract <title> + basic date scanning
    events = []
    title_match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    title = title_match.group(1).strip() if title_match else source_id
    date_match = re.search(r"\d{4}[-/]\d{2}[-/]\d{2}", html)
    date_str = date_match.group(0) if date_match else ""
    events.append({
        "title": title,
        "url": base_url,
        "startDate": date_str,
        "sourceId": source_id,
    })
    return events


def deepListPhase(verified_url: str, source_id: str) -> tuple[int, list[dict], bool]:
    """
    Phase 2: given a URL that returned <=1 event,
    find event detail links on the page and scrape each one.

    Returns (total_events_found, aggregated_events, success_bool).
    success=True means >= 2 events found via deep-list.
    """
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

    # Limit to 50 to avoid excessive scraping
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


# ── Write md ──────────────────────────────────────────────────────────────────
def slug_from_url(url: str) -> str:
    """Create a short slug from URL domain."""
    parsed = urlparse(url)
    domain = parsed.netloc.lower().replace("www.", "").replace(".se", "").replace(".com", "")
    return domain.replace("-", "").replace(".", "_")


def write_md(source_id: str, verified_url: str, status_code: int,
            ai_title: str, search_query: str, original_url: str,
            combined_score: float, breakdown: dict,
            events_found: int, phase2: bool,
            score_log: str) -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    city_map = {
        "stockholm": "Stockholm", "göteborg": "Göteborg", "gothenburg": "Göteborg",
        "malmö": "Malmö", "malmo": "Malmö", "uppsala": "Uppsala",
        "örebro": "Örebro", "orebro": "Örebro", "växjö": "Växjö", "vaxjo": "Växjö",
        "kalmar": "Kalmar", "umeå": "Umeå", "umea": "Umeå",
        "helsingborg": "Helsingborg", "gävle": "Gävle", "linköping": "Linköping",
    }
    city = next((v for k, v in city_map.items() if k in source_id.lower()), "Sverige")

    url_slug = slug_from_url(verified_url)
    out_name = f"404-agg-{source_id}-{url_slug}.md"
    out_path = RAW_SOURCES / out_name

    # Extract reject reason for frontmatter
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
foundVia: exa-search
searchQuery: "{search_query}"
aiTitle: "{ai_title}"
addedAt: "{ts}"
addedBy: gl-fix-404.py
status: candidate-404-recovered
scoreLog: "{score_log}"
---

# {source_id} → {urlparse(verified_url).netloc}

**Recovered URL:** [{verified_url}]({verified_url})

**Original (död):** `{original_url}`

## Score Breakdown

| Parameter | Värde |
|-----------|-------|
| domain_similarity | {breakdown.get("domain", 0):.3f} |
| event_signal | {breakdown.get("event_signal", 0):.3f} |
| http_score | {breakdown.get("http", 0):.3f} |
| listing_bonus | {breakdown.get("listing", 0):.3f} |
| freshness | {breakdown.get("freshness", 0):.3f} |
| **COMBINED** | **{combined_score:.3f}** |
| **ACCEPT** | {breakdown.get("accept", False)} |

## Deep-List (Phase 2)

- Phase 2 triggered: {phase2}
- Events found: {events_found}

## Exa-sök

- **Sökte:** `{search_query}`
- **Fann:** {ai_title}

## Nästa steg

Granska RawSources-kopian — godkänn eller rejecta innan import.

---
_genererad: {ts} av gl-fix-404.py (Exa API)_
"""

    out_path.write_text(content, encoding="utf-8")
    return out_path


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
    by_queue: dict[Path, list[dict]] = {MAN_Q: [], MAN_Q_404: []}

    for entry in entries:
        source_id = entry.get("sourceId", "")
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

        # Add recovery metadata
        if "metadata" not in source:
            source["metadata"] = {}
        source["metadata"]["404Recovery"] = {
            "recoveredAt": datetime.now(timezone.utc).isoformat(),
            "originalUrl": old_url,
            "newUrl": verified_url,
            "httpStatus": status_code,
            "recoveredBy": "gl-fix-404.py (Exa API)",
        }

        source_file.write_text(json.dumps(source, ensure_ascii=False) + "\n", encoding="utf-8")
        log(f"    [source] uppdaterad: {old_url} → {verified_url}")
        return True

    except Exception as e:
        log(f"    [source] fel vid uppdatering: {e}")
        return False


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    entries = read_man_queue()
    if not entries:
        log("  postTestC-serverdown + postTestC-404 är tomma — inget att göra.")
        return

    if not EXA_API_KEY:
        log("  FEL: EXA_API_KEY saknas i .env")
        sys.exit(1)

    already_done = read_out_queue()
    entries = [e for e in entries if e.get("sourceId") not in already_done]

    total = len(entries)
    processed = 0
    failed = 0
    skipped = 0

    log(f"gl-fix-404 (Exa API)  │  {total} källor i postTestC-serverdown + postTestC-404")

    remaining = []

    for idx, entry in enumerate(entries):
        source_id = entry.get("sourceId", "")
        if not source_id:
            remaining.append(entry)
            skipped += 1
            continue

        venue_name = venue_name_from_source_id(source_id)
        log(f"[{idx+1}/{total}] {source_id} ({venue_name})")

        search_queries = [
            f'"{venue_name}" evenemang konserter biljetter site:.se',
            f'"{venue_name}" event tickets concerts',
            f'"{venue_name}" konserthus teater arena festival',
            f"{venue_name} evenemang Sverige",
        ]

        accepted_results = []

        for sq in search_queries:
            results = exa_search(sq, n=8)
            if not results:
                time.sleep(0.5)
                continue

            for r in results:
                url = r.get("url", "")
                if not url or len(url) < 12:
                    continue

                title = r.get("title", "")
                highlights = r.get("highlights", "")
                is_listing = any(s in url.lower() for s in LISTING_PATH_SIGNALS)
                combined_score, breakdown, accept = score_result(
                    url, title, highlights, source_id,
                    existing_ids=set(), status_code=200,
                    is_listing=is_listing)

                # Always log every result
                decision = "REJECT" if not accept else "ACCEPT"
                log(f"    [{decision}] {url}")
                log_score_breakdown(url, breakdown)

                if not accept:
                    continue

                ok, status_code, final_url = http_verify(url)
                if not ok:
                    continue
                if status_code >= 400 and status_code not in (301, 302, 303, 307, 308):
                    continue

                # Phase 2: count events on the accepted URL
                events_found = 0
                phase2 = False
                try:
                    resp = requests.get(final_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
                    events_found = len(extract_from_html_simple(resp.text, source_id, final_url))
                except Exception:
                    pass

                # If only 1 (or 0) event found, try deep-list
                if events_found <= 1:
                    deep_count, _, deep_ok = deepListPhase(final_url, source_id)
                    if deep_ok:
                        events_found = deep_count
                        phase2 = True
                        log(f"    [phase2] deep-list found {events_found} events ✓")
                    else:
                        log(f"    [phase2] deep-list did not improve ({events_found} events)")

                accepted_results.append({
                    "url": final_url,
                    "title": r.get("title", ""),
                    "status": status_code,
                    "query": sq,
                    "combinedScore": combined_score,
                    "breakdown": breakdown,
                    "eventsFound": events_found,
                    "phase2": phase2,
                })
                time.sleep(0.5)

        if accepted_results:
            for res in accepted_results:
                original_url = entry.get("originalUrl", "unknown")
                score_log = format_score_log(res["url"], res["breakdown"])
                md_path = write_md(source_id, res["url"], res["status"],
                                  res["title"], res["query"], original_url,
                                  res["combinedScore"], res["breakdown"],
                                  events_found=res.get("eventsFound", 0),
                                  phase2=res.get("phase2", False),
                                  score_log=score_log)
                log(f"  ✓ {res['url']} (score={res['combinedScore']:.1f})")
                log(f"    md: {md_path.name}")

                entry_out = dict(entry)
                entry_out["queueName"] = "postTestC-out"
                entry_out["verifiedUrl"] = res["url"]
                entry_out["httpStatus"] = res["status"]
                entry_out["combinedScore"] = res["combinedScore"]
                append_out(entry_out)
                processed += 1
        else:
            log(f"  ✗ ingen verifierad URL")
            remaining.append(entry)
            failed += 1

        time.sleep(0.5)

    write_man_queue(remaining)

    log("")
    log(f"KLAR  │  {processed} fixerade  │  {failed} utan URL  │  {skipped} hoppade")
    log(f"  md: {RAW_SOURCES}/ ({processed} filer)")
    log(f"  postTestC-out: {OUT_Q} (+{processed})")
    log(f"  postTestC-serverdown + postTestC-404: {len(remaining)} kvar totalt")


if __name__ == "__main__":
    main()
