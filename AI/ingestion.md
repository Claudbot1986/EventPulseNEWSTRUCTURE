# Ingestion Rules

## Purpose

This file defines how ingestion must behave in EventPulse.

Ingestion is responsible for transforming external source data into structured, storable event data.

If ingestion is wrong → everything downstream becomes unreliable.

---

## Core Responsibility

Ingestion owns:

1. Source fetching
2. Raw data capture
3. Candidate-page discovery for HTML sources
4. AI-assisted interpretation (when needed)
5. Normalization preparation
6. Deduplication input
7. Queueing
8. Persistence handoff

Ingestion must produce clean, structured, traceable data.

---

## Rule of Simplification

Every step in the ingestion pipeline must justify its existence.
If a step can be removed without losing required functionality — remove it.

Do not add AI or rendering before simpler discovery has been proven insufficient.

---

## Ingestion Pipeline (Ground Truth)

The ingestion flow must follow this order:

1. Fetch source data
2. Capture raw payload
3. If HTML source: discover best candidate page(s)
4. Apply AI-assisted interpretation only if needed
5. Normalize structure
6. Deduplicate
7. Queue processing
8. Persist to database

No step may be skipped.

---

## Source Rules

- Every source must be real
- Every source must return real data
- Source failures must be debugged, not hidden

If a source returns too few events:

Allowed:
- investigate candidate-page selection
- inspect internal menus and category pages
- improve extraction
- compare root page vs candidate pages

Forbidden:
- inject fallback events
- reuse old events silently
- fabricate events

---

## HTML Path Strategic Rule

For no-jsonld sources without viable Network Path, the primary task is often:

**finding the right internal page before extraction begins**

Do not assume the root URL is the best extraction target.

Examples of important internal targets:
- program pages
- event listing pages
- category pages
- repertoire/show pages
- submenu pages under "evenemang", "program", "shows", "sport", etc.

---

## HTML Frontier Discovery Rule

Before evaluating a single HTML page deeply, the system should:

1. collect internal links from the root page
2. classify where links came from:
   - nav
   - header
   - submenu
   - content
   - footer
3. rank candidate pages
4. try several top candidates cheaply
5. choose the page with the strongest event-signal

Important:
The discovery goal is not "find a good word".
The discovery goal is "find the page that behaves like an event listing".

---

## Candidate Ranking Signals

Candidate pages may be ranked using signals such as:

### Link-level signals
- internal URL
- position in nav/header/submenu
- anchor text
- href tokens
- repeated menu presence
- proximity to event-like language

### Page-level signals
- repeated blocks
- many date/time occurrences
- many event-like detail links
- ticket CTA presence
- time tags
- titles that look like shows/events
- consistent listing structure

### Negative signals
- press/news/blog patterns
- contact/about/legal pages
- sponsor pages
- login/account pages
- generic static content
- footer-only low-value links

---

## AI-Assisted Routing Rule

AI is allowed only after rule-based candidate discovery has produced a small candidate set.

AI may help:
- compare candidate pages semantically
- understand unusual menu naming
- choose among 3–10 plausible candidate pages

AI may NOT:
- replace link discovery
- replace extraction
- replace verification
- invent event counts or page quality

AI output must always be verified by measured page signals and real extraction results.

---

## Render Path Rule

Render/headless is fallback only.

Use render only if:
- raw HTML lacks the relevant menus or content
- HTML candidate discovery was genuinely attempted
- candidate pages still produce weak or empty results
- evidence suggests meaningful JS-driven content is missing from raw HTML

Do NOT move to render simply because root-page extraction was weak.

---

## Metod vs. Verifiering: Facit

EventPulse har fem metodkategorier (A, B, C, D, E). En källa KAN vara
flera metodkandidater SAMTIDIGT före testning. Endast verifiering avgör
vilken som faktiskt fungerar.

### A — JSON-LD
- **Verifierad A:** Riktig schema.org/Event i `<script type="application/ld+json">`
- **Inte verifierad A:** Sajten HAR script-taggar men vi har inte testat om de innehåller events

### B — Network/API
- **Verifierad B:** Intern API/XHR hittad OCH returnerar structured event data OCH är stabil
- **Inte verifierad B:** Nätverksförfrågningar observerade, men vi har inte bekräftat att de ger events

### C — HTML
- **Verifierad C:** HTML-extraktion har bevisat sig ge events > 0
- **C-kandidat:** Sajten har `<main>`/HTML-struktur men extraktion är inte verifierad

### D — Render (PENDING)
- **D-pending:** Misstanke om JS-rendering baserat på weak/no-main i C1
- **D-integrerad:** EJ ännu — D-renderGate är inte integrerat i pipeline

### E — Manual
- **E-verklig:** Alla A→B→C→D testade och misslyckade, mänsklig granskning krävs

### Vanliga feltolkningar

| Feltolkning | Korrekt tolkning |
|-------------|------------------|
| "preferredPath: unknown betyder aldrig körd" | Fel. Betyder "path ej bestämd vid import". Kan ha körts men misslyckats ELLER aldrig körts. |
| "Rad i sources_status.jsonl = fullt testad" | Fel. Varje rad betyder att source TRIAGE-KÖRTS, inte att alla paths testats. |
| "Source i sources/ = verifierad" | Fel. sources/ innehåller source-definitions. Verifiering kräver events > 0. |
| "Root saknar API = hela källan saknar API" | Fel. /events, /kalender, /program kan innehålla API eller JSON-LD. |
| "C1=säger html_candidate = C är rätt path" | Fel. C1 är pre-check, inte verifiering. Extraktion kan fortfarande ge 0. |
| "D betyder source kräver render" | Fel. D-pending betyder MISSTANKE. Verifiering saknas. |

---

## Raw Data Rule

Raw data must always be preserved.

- Do not overwrite raw payload
- Do not lose original structure
- Always keep traceability to source

Raw data is the ground truth reference.

---

## AI-Assisted Interpretation Rules

AI may be used to improve structure when source data is weak.

AI may:
- clean titles
- compare candidate-page summaries
- rank internal candidate pages
- map categories
- standardize formats
- resolve inconsistencies

AI may NOT:
- invent events
- invent venues
- invent dates
- invent organizers
- hallucinate missing fields
- pretend a page is good without measurable evidence

Every AI transformation must remain traceable to source input.

---

## Normalization Rules

Normalization must:
- map fields consistently
- assign category_slug
- resolve venue_id correctly
- preserve event identity
- avoid aggressive filtering

Critical rule:
Losing valid events is worse than keeping slightly messy events.

---

## Deduplication Rules

- Deduplication must use stable identifiers
- Do not remove events unless clearly duplicate
- Avoid false positives

If unsure → keep event

---

## Queue Rules

- All ingestion must pass through queue
- No direct DB inserts bypassing queue
- Workers must process all jobs

Failures must be:
- logged
- visible
- debuggable

---

## Persistence Rules

When saving to database, each event should ideally have:
- title
- start_time
- source
- dedup_hash
- venue_id (if possible)
- category_slug (if possible)

Do not insert incomplete or broken objects silently.

---

## Data Loss Rule (CRITICAL)

At every stage, monitor:
- number of candidate pages
- number of tested pages
- number of extracted events
- number of dropped events

If data drops significantly:

You MUST:
1. identify where
2. explain why
3. fix cause

Never ignore drop-off.

---

## Forbidden Behaviors

- generating fake events
- hiding source failures
- silently dropping large volumes of data
- using AI as magic replacement for discovery
- jumping to render too early
- rewriting ingestion broadly without verification
- mixing ingestion with discovery logic

---

## Verification Rule

Ingestion is only considered working if:
- real sources produce data
- the correct candidate page is chosen
- extraction produces real events
- data passes full pipeline
- events exist in database
- events are visible in app

Anything less = incomplete ingestion

---

## Final Principle

Ingestion defines truth entering the system.

For HTML sources, truth often begins with the correct page choice.

Wrong page → weak extraction  
Right page → meaningful extraction

---

## Exit Rule

Every output must end with `__KLAR_MED_1_2_3_PROMPTEN__` as the very last line, alone on its own line. No exceptions, no matter the exit path.
