# Plan: A.5 — kvarvarande flaskhalsar efter Flaskhals 1+2+3

**Skapad:** 2026-10-09
**Scope:** `02-Ingestion/F-eventExtraction/`, `02-Ingestion/C-htmlGate/`, `runtime/ingestion/eval/`
**Working tree:** Bevara 12 orörda ändringar (preservation-regel).
**Spegel:** `~/.claude/plans/witty-soaring-thompson.md` (samma innehåll, plan-mode-kopia).

## Kontext

Användarens senaste begäran (2026-10-09): göra en plan för SAMTLIGA förslag på vad som behöver förbättras (utifrån A.5-fynden), sen genomföra, testa, ändra, testa igen, föreslå nya steg.

### Vad som redan är gjort i denna session

| Åtgärd | Resultat |
|---|---|
| Flaskhals 1 (alt-main fallback) | Committad, 3 nya tester |
| Flaskhals 2 (dd/mm-datum i C3) | Committad, 3 nya tester |
| Flaskhals 3 (biljettshop-adapter) | Committad 4cb1518b, 11 tester |
| Batch-209 replay | 94 → 226 events (+132), 6/41 förbättrade |
| A.5.2 (FETCH_ERROR-klustret) | 9 persistent (TLS/DNS/cert), 2 transient |
| A.5.3 (EXTRACTION_ZERO-klustret) | 3 kvarvarande: debaser, grand, grona-lund |
| A.5.1 (C1-klustret) | 5 flaggade JS_RENDER, men replay visar 3 fungerar utan D-render |
| Biljettshop-mätning separat | 70/70 events nya mot DB |

### Tre saker som INTE är bekräftade (påverkar planen)

1. **Vad gör `C1_STRONG_JS_RENDER_D_SIGNAL`-exit?** Stoppar den vidare bearbetning eller routar den till D-render-pool? Replay-batch-209 körde bara universal-extractor på `effectiveUrl`, inte hela C0→C3-pipelinen. Om flaggan routar korrekt till D-render → 5-klustret är inte ett A.5-problem.
2. **Grand (grandmalmo.se/calendar) har 34 `<article>` + 3 JSON-LD + 115 ISO-datum**, men C3 returnerar 0. Det är en bug, inte data-brist. Behöver debug.
3. **Debaser har rätt struktur** (`event-row`, `event-date-hero`) men 0 ISO-datum. C3 behöver stöd för svenska månadsnamn — **men Generalization Gate kräver 3+ unrelated Stockholm-domäner med samma mönster**.

## Planen i tre faser

### Fas A — Verifiering & datainsamling (2–4 h, ingen kod)

**Mål:** bekräfta eller vederlägga de tre antagandena ovan.

| # | Åtgärd | Fil att läsa/skriva | Output |
|---|---|---|---|
| A1 | Läs C1-logiken och dokumentera vad `STRONG_JS_RENDER_D_SIGNAL` gör | `02-Ingestion/C-htmlGate/c1.ts` (eller motsv.) | Förståelse: routar till D-render ELLER exit? |
| A2 | Inspektera Grand-rå-HTML, kör C3 steg-för-steg med loggar | `runtime/ingestion/eval/site-discovery-fas1/grand-calendar-raw.html` (spara kopia) | Lokaliserad bugg i universal-extractor |
| A3 | Inspektera Debaser-rå-HTML, bekräfta textbaserade datum | `runtime/ingestion/eval/site-discovery-fas1/debaser-kalender-raw.html` | Verifiera regex mot `\d{1,2}\s+(jan\|feb\|...)\w*\s+\d{4}` |
| A4 | Hitta 3+ Stockholm-domäner med svenska månadsnamn i HTML | Grep mot `01-Sources/phase1-approved-*.jsonl` + Stage-direktivet | Lista: ja/nej för Generalization Gate |

**Leverans:** `runtime/ingestion/eval/site-discovery-fas1/a5-findings.md` med verifierade orsaker per kluster. Om A1 visar att C1-flaggan routar korrekt → 5-klustret flyttas ur A.5. Om A4 visar färre än 3 domäner → B2 avbryts.

### Fas B — Välj EN åtgärd i prioriteringsordning

Välj åtgärd **baserat på Fas A-resultat**. EN åtgärd i taget, ingen multi-fix.

**B1 — Grand-buggfix** (om A2 bekräftat bug)
- Scope: bara `02-Ingestion/F-eventExtraction/universal-extractor.ts` (eller `c3.ts`)
- Test: ny unit-test med grand-fixtur (`expect(events.length).toBeGreaterThan(0)`)
- Verifiering: `npx vitest run 02-Ingestion/F-eventExtraction/` + `npx tsx runtime/ingestion/eval/site-discovery-fas1/replay-extraction-zero.ts`
- Förväntat: grand går från 0 till > 0 events. Inga regressioner på 3arena/dn-kalendariet/eskilstuna.

**B2 — Svenska månadsnamn i C3** (om A4 har 3+ domäner)
- Scope: `02-Ingestion/F-eventExtraction/universal-extractor.ts` — ny pattern i dedikerad helper
- Generalization Gate: 3 unrelated Stockholm-domäner verifierade
- Test: unit-test + replay-batch-209 (ska inte regressera)
- Förväntat: debaser går från 0 till > 0 events.

**B3 — Förbättra C1 STRONG_JS_RENDER-bedömning** (om A1 visar flaggan stoppar)
- Scope: `02-Ingestion/C-htmlGate/c1.ts`
- Logik: kör universal-extractor som smoke-test på icke-render-flaggade URLs; om >0 events, nedgradera till weak istället för exit
- Risk: kan öka arbete på riktiga JS-render-sajter. Mät mot både dramaten/hallsberg/jonkoping (ska passera) och grona-lund (ska fortsatt flaggas)

### Fas C — Mät igen, föreslå nästa steg

Efter EN framgångsrik Fas B-åtgärd:

1. Kör `replay-batch-209.ts`, `replay-extraction-zero.ts`, `replay-fetch-errors.ts`.
2. Jämför delta mot tidigare körning (94 → 226 baseline).
3. Uppdatera A.5-task-status.
4. Skapa vault-anteckning: `00-Vault/01-Projects/EventPulse/02-Operations/2026-10-09-A5-Findings.md`.
5. Föreslå **nästa** åtgärd baserat på:
   - Vilken Fas B-åtgärd som gav mest effekt
   - Vilka kluster som krympt
   - Nya flaskhalsar som uppdagats

## Scope-respekt

**Rör INTE:**
- `02-Ingestion/A-directAPI-networkGate/runA.ts` (mission constraint)
- dedup-hash-algoritm (mission constraint)
- C0/C1/C2 IGNORE_PATTERNS eller scoring weights baserat på en site (Generalization Protection Rule)
- 12 working-tree-ändringar utanför A.5-scope (preservation-regel)

**Rör BARA:**
- `02-Ingestion/F-eventExtraction/universal-extractor.ts` (C3 — mönster)
- `02-Ingestion/C-htmlGate/c1.ts` (eventuellt — bedömning)
- `runtime/ingestion/eval/site-discovery-fas1/` (tester, fixtures, replay-script)
- Nya tester i `02-Ingestion/F-eventExtraction/*.test.ts`

## Verifiering per steg

| Steg | Kommando | Förväntat |
|---|---|---|
| Unit-tester | `npx vitest run 02-Ingestion/F-eventExtraction/` | 153+ passing |
| Batch-209 replay | `npx tsx runtime/ingestion/eval/site-discovery-fas1/replay-batch-209.ts` | ≥226 events (ingen regression) |
| Extraction-zero replay | `npx tsx runtime/ingestion/eval/site-discovery-fas1/replay-extraction-zero.ts` | 3-9-källan går från 0 till > 0 |
| Biljettshop-adapter | `npx tsx runtime/ingestion/eval/site-discovery-fas1/measure-biljettshop-adapter.ts` | 70 events (ingen regression) |
| Typecheck | `npx tsc --noEmit` | exit 0 |

## Riskbedömning

| Risk | Sannolikhet | Mitigation |
|---|---|---|
| Fas A visar att antaganden är fel | Hög | Omprioritera istället för att bygga fel fix |
| Generalization Gate misslyckas (B2) | Medel | Avbryt B2 — Debaser är Site-Specific |
| Grand-buggfix påverkar andra sajter | Medel | Testa 3arena/dn-kalendariet — får inte regressera |
| C1-ändring → oändlig loop på JS-render | Låg | Whitelist-fallback till D-render om smoke-test misslyckas |

## Vad INTE görs

- ❌ Implementera D-render (DO NOT BUILD YET i BACKLOG)
- ❌ Sweden-wide scraping
- ❌ Auto-promote källor baserat på en körning
- ❌ Ändra dedup-algoritm
- ❌ Ignorera C0/C1/C2-regler (Generalization Protection)

## På människospråk

Vi har listat fyra typer av problem som gör att 35 av 41 hemsidor fortfarande inte ger evenemang. Innan vi bygger något nytt tar vi reda på varför problemen finns — det är tre saker vi inte vet säkert än (vad en varning betyder i vårt system, varför Grand-sajten inte fungerar trots rätt HTML, och om Debaser har datum i text eller gömt bakom JavaScript). Den här planen säger: undersök först i 2–4 timmar, välj sedan EN åtgärd i taget — förmodligen buggfix för Grand eftersom det är minsta insatsen med störst chans till effekt. Vi tummar inte på de regler vi redan har (ingen Sweden-wide-scraping, inga generaliseringar utan tre olika hemsidor som bevisar mönstret).

## 👤 Min plan

1. **Bekräfta Fas A-antaganden** — läs C1-logik, inspektera 3–4 rå-HTML.
2. **Välj B1 (Grand-bugg) om det är en bug**, annars B2 (svenska månader) om tre olika Stockholm-sajter har samma mönster.
3. **Kör en åtgärd**, mät med replay-scriptet, jämför mot tidigare körning.
4. **Rapportera vad ändrades, vad som förbättrades, vad som är kvar.**
5. **Föreslå nästa steg** — antingen en till åtgärd i samma kluster, eller gå vidare till nästa kluster.

Jag har fått klartecken — startar Fas A1 nu: läs `02-Ingestion/C-htmlGate/c1.ts` och dokumentera vad `STRONG_JS_RENDER_D_SIGNAL` gör.