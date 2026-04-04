# handoff.md — 2026-04-02 04:39

## Problem (Verifierat och löst ✓)

**HTML-path: ingen event-extraktion fanns**

C2-htmlGate gav `verdict: "promising"` för Konserthuset Stockholm men:
1. sourceTriage körde INTE htmlGate C2 som extractor
2. phase1ToQueue körde endast extractFromJsonLd (0 events för no-jsonld)
3. C2-htmlGate var endast en gate, inte en extractor

## Lösning implementerad ✓

1. La till `extractFromHtml()` i `F-eventExtraction/extractor.ts`
   - URL-datum extraktion (två mönster: YYYY-MM-DD-HHMM och YYYYMMDD-HHMM)
   - Svenska datum i text
   - Kalender-länk scanning med deduplicering

2. Modifierade `phase1ToQueue.ts`:
   - JSON-LD först, HTML fallback
   - Provar kalender-subpaths (/program-och-biljetter/kalender/, etc.)

## Verifiering ✓

### phase1ToQueue (Konserthuset Stockholm)
```
[phase1→queue] JSON-LD: 0 events, HTML on main page: 8 events
Queuing 8 events from https://www.konserthuset.se/
✅ extracted=8, queued=8
```

### Worker → Database
Worker startad och konsumerar jobb. Redis visar:
- bull:raw_events:konserthuset-konserthuset-* (7 keys)
- processedOn satt på alla jobb

### Database verification (2026-04-02 04:39)
```
SELECT id,title_en,source,dedup_hash FROM events WHERE source='konserthuset';
→ "Fredag 17 april 2026 kl 19"
→ "Konserthuset 100 år – Jazzigt med Belleville Trio"
→ "Belleville Trio spelar jazz i Django Reinhardt-stil"
→ "Fredag 13 november 2026 kl 19"
→ "Konserthuset 100 år – Utställningar"
```

### Berwaldhallen (tidigare verifierat 2026-04-02 02:33)
```
"Radiokören tolkar Palestrina - i Storkyrkan"
"Bach & Brahms enligt Stutzmann"
"Emelyanychev tolkar Salonen & Schumann"
"Strauss Elektra-svit"
```

## Commit ✓

`721aa22` — feat(ingestion): add HTML extraction fallback for no-jsonld sources

## HTML extraction URL-dubblering — FIXAT ✓

**Problem:** URL-dubblering: `/program-och-biljetter/kalender/konsert/...` blev dubbel sökväg.

**Orsak:** `resolveUrl()` i `extractFromHtml()` konkatenerade `base + href` för absoluta hrefs.

**Fix:** Använd `URL.origin + href` istället för `base + href` för absoluta hrefs.

**Verifiering:**
```
npx tsx -e "extractFromHtml(html, 'konserthuset', 'https://www.konserthuset.se/program-och-biljetter/kalender/')"
→ URL: https://www.konserthuset.se/program-och-biljetter/kalender/konsert/2026-04-17-19-00/ ✓
```

**Commit:** `a3b4f0e`

## Fryshuset JS-rendered upptäckt (2026-04-03)

**Problem:** Fryshuset har JS-rendered content. HTML innehåller bara 90 tecken i `<main>` - allt event-innehåll laddas via JavaScript.

**Förbättring:** Lagt till JS-render-detektion i C1-preHtmlGate och C3-aiExtractGate:

1. C1.screenUrl() returnerar `likelyJsRendered` (heuristik: tom main + låg text-densitet)
2. C3.returnerar `fallbackToRender` när sidan behöver rendering

**Ny fil:** `02-Ingestion/tools/pendingRenderQueue.ts`
- Mottager kandidater som behöver D-renderGate
- Status: `pending_render_gate`
- Signal: `js_rendered_c1` eller `js_rendered_c3`

## Source Management System (2026-04-03)

**Systematisk kaosriar och import av alla källspår.**

### Scan results

| Fil | Typ | Antal | Klassificering |
|-----|-----|-------|----------------|
| `01-Sources/100testcandidates.md` | Testrapport | 100 | Sources-dictionary |
| `01-Sources/candidate-lists/` | Scouting | ~100 | Sources-dictionary |
| `01-Sources/active/active.md` | Aktiva | 6 | Sources-dictionary |
| `02-Ingestion/sourceRunner.ts` | Hardkodade | 8 | Sources-dictionary |
| `sources/` | Source truth | 8 | ✓ Används |
| `runtime/sources_status.jsonl` | Runtime | — | ✓ Rättat |

### Rättningar

1. **runtime/sources_status.jsonl** — innehöll source truth istället för status. Rättat.
2. **sources/** — rensat och återuppbyggt med verifierade källor.
3. Lagt till `sources/fryshuset.jsonl`, `sources/debaser.jsonl`, `sources/gso.jsonl`

### sources/ nu

| ID | URL | Typ | Preferred Path |
|----|-----|-----|----------------|
| konserthuset | www.konserthuset.se/... | konserthus | html |
| berwaldhallen | www.berwaldhallen.se | konserthus | jsonld (tixly) |
| kulturhuset | www.kulturhuset.se | kulturhus | network |
| ticketmaster | www.ticketmaster.se | aggregator | api |
| eventbrite | www.eventbrite.se | aggregator | jsonld |
| fryshuset | fryshuset.se/kalendarium | arena | render |
| debaser | debaser.se | musik | unknown |
| gso | www.gso.se | konserthus | unknown |

### Schema separation (bekräftad)

- `sources/` = SourceTruth (discoveredAt, preferredPath, discoveredBy)
- `runtime/sources_status.jsonl` = SourceStatus (lastRun, status, consecutiveFailures)
- `runtime/pending_render_queue.jsonl` = D-renderGate kandidater
- `runtime/sources_priority_queue.jsonl` = Scheduler prioritet

## Nästa steg

1. ~~Bygga source management system~~ ✓ KLART
2. ~~Rensa sources/~~ ✓ KLART
3. ~~Rätta runtime/sources_status.jsonl~~ ✓ KLART
4. Köra scheduler mot alla sources
