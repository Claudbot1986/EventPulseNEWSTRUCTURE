# Current Task

> **HISTORICAL ONLY — inactive after NEWSTRUCTURE migration.**
> 
> Active files now live in:
> - `NEWSTRUCTURE/02-Ingestion/current-task.md`
> - `NEWSTRUCTURE/02-Ingestion/handoff.md`
> 
> Do not use this file when domain-local files exist.
>
> **Future plan:** When current migration stabilizes, move git/repo root to `NEWSTRUCTURE` so that all relative paths, active context resolution and skills naturally use the correct project root.

## Purpose

This file defines the CURRENT task for the AI.

It is the ONLY valid task.
Nothing else may be worked on.

If unclear → STOP.

---

## Task Definition

### Domain

ingestion

---

### Problem (STRICT)

HTML Path är för root-fixad och missar ofta rätt interna programsidor eller undermenyer.

Nuvarande beteende:
- boten analyserar ofta endast root-sidan
- boten missar viktiga interna kandidatsidor som:
  - `/pa-scen/`
  - `/evenemang/musik-show`
  - `/evenemang/sport`
- därför hittar boten för få events trots att fler finns på samma domän

Det primära problemet är nu inte extraction i sig, utan **discovery av rätt sida**.

---

### New Direction

Nästa steg är att bygga ett tydligt steg för:

1. **HTML Frontier Discovery**
   - hitta och ranka interna kandidatsidor
   - samla interna länkar från nav, header, submenu och tydliga sektioner
   - prova flera toppkandidater billigt
   - välja sidan med bäst event-signal före extraction

2. **AI-Assisted Routing**
   - använd AI endast som beslutsstöd när flera kandidater ser rimliga ut
   - AI ska hjälpa till att välja mellan kandidatsidor
   - AI får inte ersätta hela discovery- eller extraction-logiken
   - AI måste alltid följas av verifierbar scoring och riktig extraction

---

### Entry Point (CRITICAL)

Primärt område:
- `services/ingestion/src/tools/`

Primära verktyg:
- `C1-preHtmlGate.ts`
- `C2-htmlGate.ts`
- `extract/extractor.ts`

AI-stöd får kopplas in endast som litet beslutssteg efter kandidatinsamling och före slutligt sidval.

---

### Goal (MEASURABLE)

Minst 2 verkliga testdomäner ska visa tydlig förbättring i sidval före extraction.

Mätetal:
- antal interna kandidatlänkar hittade
- antal toppkandidater provade
- vald slutlig kandidatsida
- antal extraherade events från vald sida
- jämförelse mot tidigare root-only-beteende

Målnivå:
- Folkoperan: boten ska hitta `/pa-scen/` eller motsvarande som stark kandidatsida
- Avicii Arena: boten ska hitta kategori-/undermenysidor under Evenemang, t.ex. Musik/Show eller Sport
- vald kandidatsida ska ge tydligt bättre event-signal än root-sidan

---

### Constraints

- Do not modify other domains
- Do not introduce fake data
- Do not redesign the whole system
- Make the smallest possible change
- Build discovery before extraction changes
- AI is support, not truth
- Render path remains fallback, not first solution

---

### Workflow

ingestion-loop.md

---

### Verification

verify-end-to-end.md

---

## Execution Rules (STRICT)

- ONE problem only
- DO NOT switch task
- DO NOT expand scope
- DO NOT refactor unrelated code
- DO NOT move to render unless HTML discovery clearly fails
- DO NOT use AI as a free-form crawler

---

## Status

- IN PROGRESS: move from root-fixed HTML path to candidate-page discovery
- Previous HTML path was too page-centric
- New focus: HTML Frontier Discovery + optional AI-assisted routing
- Render path is NOT the current task

---

## Progress Tracking (CRITICAL)

Track:
- how many internal links were collected
- where they came from (nav/header/submenu/content/footer)
- top-ranked candidate pages
- why they were ranked highly
- which page was selected
- how many events were extracted from selected page
- whether AI was used, and why

---

## Notes

The hard truth:
If the system opens the wrong page, better extraction will not save it.

Therefore:
- first fix page discovery
- then extraction
- then optional AI support for difficult candidate selection
