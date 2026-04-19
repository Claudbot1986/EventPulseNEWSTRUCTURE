#!/usr/bin/env python3
"""
gl-fix-404.py — Google-sök varje 404-källa i postTestC-man, verifiera live-URL,
skriv en .md-fil per källa i RawSources/, och flytta källan till postTestC-Out.

Använder MiniMax M2.7 (Claude-kompatibel) istället för Exa.

Flow per sourceId:
  1. Läs entry från postTestC-man
  2. MiniMax-sök: hitta event-URL för venue
  3. HTTP-verify (200 eller 301/302 → bekräftad)
  4. Spara .md i RawSources/ med strukturerad frontmatter
  5. Efter lyckad sparning: appenda till postTestC-Out
  6. Ta bort entry från postTestC-man
"""

import json
import time
import os
import sys
import requests
from pathlib import Path
from datetime import datetime, timezone

# ── Env ───────────────────────────────────────────────────────────────────────
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

ANTHROPIC_BASE_URL = os.getenv("ANTHROPIC_BASE_URL", "https://api.minimax.io/anthropic")
ANTHROPIC_AUTH_TOKEN = os.getenv("ANTHROPIC_AUTH_TOKEN", "")
MODEL = os.getenv("ANTHROPIC_MODEL", "MiniMax-M2.7-highspeed")

# ── Paths ─────────────────────────────────────────────────────────────────────
RUNTIME_DIR  = Path(__file__).parent.parent / "runtime"
RAW_SOURCES = Path(__file__).parent.parent / "01-Sources" / "RawSources"
MAN_Q       = RUNTIME_DIR / "postTestC-manual-review.jsonl"
OUT_Q       = RUNTIME_DIR / "postTestC-Out.jsonl"

RAW_SOURCES.mkdir(exist_ok=True, parents=True)

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


# ── MiniMax search ─────────────────────────────────────────────────────────────
def minimax_search(query: str, n: int = 8) -> list[dict]:
    """Search using MiniMax M2.7 - returns URLs by parsing response text.

    Returns list of dicts with url, title, snippet.
    """
    if not ANTHROPIC_AUTH_TOKEN:
        print("    [minimax] Ingen API-token")
        return []

    import re
    url_pattern = re.compile(r'https?://[^\s\)"\'<>]+')

    headers = {
        "Authorization": f"Bearer {ANTHROPIC_AUTH_TOKEN}",
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
    }

    # Use MiniMax as a smart search that returns URLs in text
    payload = {
        "model": MODEL,
        "max_tokens": 800,
        "temperature": 0.2,
        "system": """Du är en sökassistent specialiserad på svenska evenemang.
För sökfrågan: ge mig de 8 BÄSTA URL:erna till sidor som säljer biljetter till konserter, teater, festivaler eller evenemang.

SVARA ENDAST med URLs, en per rad. Inga förklaringar, ingen JSON, bara:
https://www.arenan.se/biljetter
https://www.ticketmaster.se
etc.

Regler:
- Exakt 8 URLs
- Minst 5 ska vara .se-domäner
- Inga Wikipedia, sociala medier, search engines
- Prioritera biljettsidor, arenasajter, konserthus, teater"""
,
        "messages": [
            {"role": "user", "content": f"Sök: {query}"}
        ],
    }

    try:
        resp = requests.post(
            f"{ANTHROPIC_BASE_URL}/v1/messages",
            headers=headers,
            json=payload,
            timeout=30,
        )
        if resp.status_code != 200:
            print(f"    [minimax] HTTP {resp.status_code}")
            return []

        data = resp.json()
        content = data.get("content", [])
        text = ""
        for block in content:
            if block.get("type") == "text":
                text = block.get("text", "")
                break

        # Extract URLs from text (handles markdown links, backticks, etc.)
        urls = url_pattern.findall(text)
        results = []
        for url in urls[:n]:
            # Clean up URL - remove trailing punctuation/backticks
            url = url.rstrip("`.,;:!?)\"'")
            if url and len(url) > 10:
                title = url.split("/")[-1].replace("-", " ").replace(".se", "") or url
                results.append({
                    "url": url,
                    "title": title[:80],
                    "highlights": "",
                })

        return results

    except Exception as e:
        print(f"    [minimax] fel: {e}")
        return []


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


def is_event_like(url: str, title: str, highlights: str) -> bool:
    text = f"{title} {highlights} {url}".lower()
    for pattern in EXCLUDE_DOMAINS:
        if pattern in url.lower():
            return False
    return any(signal in text for signal in EVENT_SIGNALS)


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
def write_md(source_id: str, verified_url: str, status_code: int,
            ai_title: str, search_query: str) -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    city_map = {
        "stockholm": "Stockholm", "göteborg": "Göteborg", "gothenburg": "Göteborg",
        "malmö": "Malmö", "malmo": "Malmö", "uppsala": "Uppsala",
        "örebro": "Örebro", "orebro": "Örebro", "växjö": "Växjö", "vaxjo": "Växjö",
        "kalmar": "Kalmar", "umeå": "Umeå", "umea": "Umeå",
        "helsingborg": "Helsingborg", "gävle": "Gävle", "linköping": "Linköping",
    }
    city = next((v for k, v in city_map.items() if k in source_id.lower()), "Sverige")

    content = f"""---
sourceId: {source_id}
city: {city}
originalDomain: https://{source_id.replace("-", "")}.se/
verifiedUrl: {verified_url}
httpStatus: {status_code}
foundVia: minimax-search
searchQuery: "{search_query}"
aiTitle: "{ai_title}"
addedAt: "{ts}"
addedBy: gl-fix-404.py
status: candidate-404-recovered
---

# {source_id}

**Verifierad livelänk:** [{verified_url}]({verified_url})

Ursprunglig domän (död): `https://{source_id.replace("-", "")}.se/`

## MiniMax-sök

- **Sökte:** `{search_query}`
- **Fann:** {ai_title}
- **URL:** {verified_url}
- **HTTP:** {status_code}

## Event-liknande?

Länken är verifierad som event-sajt (konserthus, teater, festival, arena, etc).
Filen är sparad i RawSources/ för granskning.

## Nästa steg

Kör `importRawSources.ts` eller flytta manuellt till `sources/` efter godkännande.

---
_genererad: {ts} av gl-fix-404.py (MiniMax M2.7)_
"""

    out_path = RAW_SOURCES / f"{source_id}.md"
    out_path.write_text(content, encoding="utf-8")
    return out_path


# ── Queue helpers ─────────────────────────────────────────────────────────────
def read_man_queue() -> list[dict]:
    if not MAN_Q.exists():
        return []
    return [json.loads(l) for l in MAN_Q.read_text().splitlines() if l.strip()]


def write_man_queue(entries: list[dict]):
    MAN_Q.write_text(
        "\n".join(json.dumps(e, ensure_ascii=False) for e in entries) + "\n",
        encoding="utf-8",
    )


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


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    entries = read_man_queue()
    if not entries:
        print("  postTestC-man är tom — inget att göra.")
        return

    if not ANTHROPIC_AUTH_TOKEN:
        print("  FEL: ANTHROPIC_AUTH_TOKEN saknas i .env")
        sys.exit(1)

    already_done = read_out_queue()
    entries = [e for e in entries if e.get("sourceId") not in already_done]

    total = len(entries)
    processed = 0
    failed = 0
    skipped = 0

    print(f"\n{'='*60}")
    print(f"  gl-fix-404 (MiniMax M2.7)  │  {total} källor i postTestC-man")
    print(f"{'='*60}\n")

    remaining = []

    for idx, entry in enumerate(entries):
        source_id = entry.get("sourceId", "")
        if not source_id:
            remaining.append(entry)
            skipped += 1
            continue

        venue_name = venue_name_from_source_id(source_id)
        print(f"[{idx+1}/{total}] {source_id} ({venue_name})")

        search_queries = [
            f'"{venue_name}" evenemang konserter biljetter site:.se',
            f'"{venue_name}" event tickets concerts',
            f'"{venue_name}" konserthus teater arena festival',
            f"{venue_name} evenemang Sverige",
        ]

        best = None

        for sq in search_queries:
            results = minimax_search(sq, n=8)
            if not results:
                time.sleep(0.5)
                continue

            for r in results:
                url = r.get("url", "")
                if not url or len(url) < 12:
                    continue
                if not is_event_like(url, r.get("title", ""), r.get("highlights", "")):
                    continue

                ok, status_code, final_url = http_verify(url)
                if not ok:
                    continue
                if status_code >= 400 and status_code not in (301, 302, 303, 307, 308):
                    continue

                best = {
                    "url": final_url,
                    "title": r.get("title", ""),
                    "status": status_code,
                    "query": sq,
                }
                break

            if best:
                break
            time.sleep(0.5)

        if best:
            md_path = write_md(source_id, best["url"], best["status"],
                               best["title"], best["query"])
            print(f"  ✓ {best['url']}")
            print(f"    md: {md_path.name}")

            entry_out = dict(entry)
            entry_out["queueName"] = "postTestC-Out"
            entry_out["verifiedUrl"] = best["url"]
            entry_out["httpStatus"] = best["status"]
            append_out(entry_out)
            processed += 1
        else:
            print(f"  ✗ ingen verifierad URL")
            remaining.append(entry)
            failed += 1

        time.sleep(0.5)

    write_man_queue(remaining)

    print(f"\n{'='*60}")
    print(f"  KLAR  │  {processed} fixerade  │  {failed} utan URL  │  {skipped} hoppade")
    print(f"  md: {RAW_SOURCES}/ ({processed} filer)")
    print(f"  postTestC-Out: {OUT_Q} (+{processed})")
    print(f"  postTestC-man: {MAN_Q} ({len(remaining)} kvar)")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
