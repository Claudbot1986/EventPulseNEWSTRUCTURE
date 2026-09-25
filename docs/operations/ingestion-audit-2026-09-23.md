# JEV × EventPulse Ingestion Audit — state 2026-09-23

> **Status:** Pausad. Hittills genomförd: riktning + 4 stora fynd från läsning av 4 filer. Jev-anrop startade EJ innan paus. Denna fil är **savegamet** — hit återvänder vi.
>
> **Varför pausad:** Användaren ville spara allt på ett ställe innan vi fortsatte.
>
> **Branch:** JEV · **head_sha:** 4df4ddb · **Working tree:** 6 uncommitted ändringar (orörda).

---

## TL;DR

Vi bestämde **audit-först, bygg-senare** för EventPulsens Jev-integration. I stället för att implementera Fas 1–7 bygger vi ingenting förrän Jev analyserat dagens faktiska ingestions-state.

Fyra **stora fynd** redan:

1. **H-manualReview-kön finns inte som system.** Bara dokumenterad — flaggor går till loggar och hanteras ad hoc.
2. **Sub-page-data sparas inte.** 420 rader i source-posten saknar fält som `checkedSubpages`. Vi vet inte om `/events`, `/kalender` testats.
3. **17 källor är "fast" i triage-manuell.** 13 TRIAGE_REQUIRED + 4 html-men-0-events. Av de 13 har en testomgång visat att **1 var B-verifierad**, **1 B-kandidat (sport, custom adapter krävs)**, **3 var ej collectable** (pekar på externa Wix-sajter).
4. **routing-logiken är kompakt och Jev-redo.** `sourceTriage.ts:55-71 computeNextPath()` har 4 möjliga `next_path`-utfall (normalizer_candidate / network / html-heuristics / manual-review). Indata är redan strukturerad.

Planen: skicka **4 audit-artefakter** (manual review, crawl-täckning, grind-felmode, per-källa-yield) till Jev för ~15–100 anrop (3–6 cent, 30–60 sek), få Jevs bygg­förslag, prioritera.

---

## 1. Bakgrund

Användaren (2026-09-23) startade en serie frågor om Jev och EventPulse:

1. "Finns det en analys om Jev?" → Ja: `/Users/claudgashi/Youtube-learner/JEV-OCH-EVENTPULSE-ANALYS.md` + `00-Vault/01-Projects/EventPulse/06-External/JEV/{01,02,03}*.md`.
2. "Hur ska Jev integreras med **appen** (inte Claude-arbetet)?" → Tre smala Jev-dokument analyserades, ingen "end-user-impact"-vinkel hittades.
3. "I Youtube-learner-mappen?" → Ja — den breda strategiska analysen hittades.
4. "Skapa en tydlig plan i flera steg" → Plan i 7 faser (Track 1) + 4 faser (Track 2 dev-acceleration) producerades.
5. "Förklara på människospråk utförligt" → Plan förklarades i klarspråk.
6. "Ställ frågorna i ordning, jag förstår inte — kom ihåg svaret bara" → **Sju beslut** togs med Jev som andra röst.
7. "Vad är det vi försöker skapa? Granska hela ingestion-pipelinen" → Förtydligande: primärt beslutsfattning i gates A/B/C/D/F.
8. "Audit först, bygg senare" → RIKTNINGSREVISION.
9. "Använd all data — uppskatta tokenkostnad innan Jev-anrop" → Storleks­beräkning + scope-beslut.
10. **"Spara allt i en .md fil, stop"** → Denna fil.

---

## 2. De sju besluten (frågor 1–7)

| # | Fråga | Användarens svar | Jev:s röst |
|---|-------|------------------|------------|
| 1 | Vercel AI Gateway-access | Öppen och klar | — |
| 2 | Fas 5 scope | Alla fyra | matchade (86 %) |
| 3 | Council (Fas 6) | Ja, alla fyra platser | matchade (53 %) |
| 4 | Youtube-learner-analysens placering | Lämna kvar | mot Jev (44 % ville kopiera in) |
| 5 | Council-ordning | D → A → C → B | matchade (96 %) |
| 6 | Röstsammanräkning | Borda count | matchade (~40 %, svagt) |
| 7 | Logg-livslängd `decision_logs` | Ett år (365 dagar) | matchade (87 %) |

**Brandväggar (från båda källorna):** MASTERPLAN §15 "0 hallucinationer" · dedup-hash orört · `02-Ingestion/A-directAPI-networkGate/runA.ts`-interface orört · Generalization Protection Rule · `callJev()` parallell med `callMinimax()` · feature-flagga finns alltid · alltid versionerad `model` i `decision_logs`.

---

## 3. RIKTNINGSREVISION 2026-09-23: audit först, bygg senare

Användaren flaggade:

- **Problem A:** "Många källor fastnar i manuell gransknings­kö — svåra att knäcka."
- **Problem B:** "Vi vet inte om samtliga källor har 'dolda' events i undersidor."

Användaren föreslog audit-fas. Jev höll med 0.78 säkerhet (91 % audit-first, 9 % hybrid). Användaren valde **audit-först 2026-09-23**.

**Förväntade audit-artefakter (fyra):**

1. Manuell gransknings­kö — senaste ~200 kö-bollar med källa, grind som skickade dit, orsak, slutgiltigt mänskligt utfall.
2. Crawl-täckning per källa — konfig­urerade undersidor, faktiska besök, events/undersökväg-ratio.
3. Grind-felmode — var kandidater dör (sista framgångsrika grind).
4. Per-källa yield senaste 30 dagar — källor som lever men ger tomt.

**Fyra möjliga bygg-utfall beroende på audit-fynd:**

- "Enkla orsaker i kön" → Fas 5.1-X schemaräddare innan F-grinden.
- "Undersidor kravlas knappt" → discoverer som prioriterar underside­länkar.
- "Vissa källor har låg yield" → Site B i Council (käll-städning).
- "Jämnt spritt" → Fas 1–7 oförändrat.

---

## 4. Storleks­beräkning av audit-material (2026-09-23)

| Källa | Storlek | Tokens (ca) |
|-------|---------|-------------|
| 100+ `batch-traces.jsonl` (C-grinden) | 2 184 rader, 40 MB på disk | ~6 000 |
| 100+ `rule-effectiveness.md` | 1 637 rader | ~3 000 |
| `C-candidates-queue.jsonl` | 179 KB | ~45 000 |
| `C-candidates-batch-001..003.jsonl` + meta | ~10 KB | ~3 000 |
| Rapporter (H-manualReview, CURRENT-STATUS, candidates-report, TRIAGE13-A/B) | ~480 rader | ~13 000 |
| `scheduler.ts` (952 rader) | ~30 KB | ~8 000 |
| `sourceTriage.ts` (368 rader) | ~12 KB | ~3 000 |
| `supervisor.ts` + `runDaily.ts` + supervisor tools | ~500–1 000 rader | ~5–10 000 |
| **TOTALT uppmätt** | **~350 KB text** | **~90 000 tokens** |

**Jev-pris:** $0,042 per 1M input-tokens. Output gratis. Per-call-tak: 64k tokens (32k state + 32k question).

**Scope-beslut (Jev: komplett, 0.78):** 50–100 Jev-anrop, ~3–6 cent, ~30–60 sek.

---

## 5. Audit-fynd hittills (från 6 lästa filer)

### 5.1 `02-Ingestion/H-manualReview/H-manualReview.md` (22 rader)

> *"Not separately implemented. The concept is documented and the routing condition exists in `source-testing.md`, but there is no dedicated `H-manualReview.ts` or queue system. Currently events that need manual attention are flagged in logs but handled ad hoc."*

**Konsekvens:** Användarens antagande att det finns "många källor i manuell gransknings­kö" stämmer inte som system — bara **3 källor** har `status=manual_review` i C-rapporten (bokmassan, smalandsposten, stenungsund). Resten av "manuellt arbete" är ad hoc-flaggning i loggarna.

### 5.2 `02-Ingestion/CURRENT-STATUS.md` (69 rader) — Facit för source-verifikation

Tre data-nivåer med olika semantik:

- `sources/*.jsonl` = katalog (preferredPath: unknown = import-default, INTE "aldrig testad").
- `runtime/sources_status.jsonl` = körda ELLER importerade (varje rad = triage-körning, INTE alla paths testade).
- `status: "success"` med `eventsFound > 0` = **verkligt verifierad** (bara dessa bevisar framgång).

**Fem metodkategorier:** A (JSON-LD) · B (Network/API) · C (HTML) · D (Render PENDING, ej integrerat) · E (Manual = alla A→B→C→D testade och misslyckade).

**Saknade fält (observerade i 420 rader):** `methodCandidate`, `verificationStatus`, `checkedSubpages`, `checkedPaths`.

### 5.3 `02-Ingestion/C-candidates-report.md` (233 rader)

420 rader i `runtime/sources_status.jsonl`, klassificerade:

| Grupp | Namn | Antal | Definition |
|-------|------|-------|------------|
| A | VERIFIED | 21 | `status=success` + `eventsFound > 0` |
| B | TRIAGE_REQUIRED | 13 | C1=säger html_candidate MEN extraction=0 |
| C | UNT ESTED | 368 | `preferredPath=MISSING`, aldrig triage-körd |
| D | D-PENDING | 5 | `pendingNextTool=D-renderGate` (D ej integrerat) |
| E | E-MANUAL | 3 | `status=manual_review` |
| F | B-PENDING | 2 | API-nyckel saknas (ticketmaster, eventbrite) |
| G | ÖVRIGA | 8 | Har preferredPath men status≠success |

**Kritisk observation:** "Ingen subpage-inspektion dokumenterad" — `checkedSubpages`-fältet saknas i alla 420 rader. Det är **exakt användarens Problem B**.

**Av 21 VERIFIED-källor:** bara root testad, ingen dokumentation om subpage-inspektion.

**Av 13 TRIAGE_REQUIRED:** dessa bör INTE räknas som C-verifierade förrän A+B testats på undersidor.

**Anomali i Grupp G:** `dramaten` har 1 event men `status=fail` — threshold för "success" är > 1 event.

**C-kandidat i strikt mening (C1=säger html_candidate, extraction=0, subpages ej testade): 17 källor (13+4).**

**C-kandidat i bred mening (alla som någonsin fått html-rekommendation): Okänt — behöver analysera triageHistory djupare.**

### 5.4 `02-Ingestion/C-candidates-report-TRIAGE13-A-B-test.md` (154 rader)

A/B-förprövning för 13 triage_required-källor:

| Preliminär klassning | Antal | Exempel |
|---------------------|-------|---------|
| B-verifierad | 1 | kungliga-musikhogskolan (api/events?version=2, 42 events) |
| B-kandidat (begränsad) | 1 | svenska-fotbollförbundet (sportspecifik, custom adapter) |
| C-kandidat | 8 | hallsberg, ifk-uppsala, karlskoga, lulea-tekniska-universitet, naturhistoriska-riksmuseet, orebro-sk, polismuseet, stockholm-jazz-festival-1 |
| Ej collectable | 3 | kumla, uppsala-kommun, ystad (pekar på externa Wix-sajter) |

**Ingen A-verifierad, ingen D-pending.**

**Subpage-mönster (13 källor):**

| Källa | Subpage testad | Event-subpage hittad |
|-------|---------------|---------------------|
| karlskoga | ja | **ja** — `/uppleva--gora/evenemang.html` (103KB) |
| polismuseet | ja | **ja** — `/besok-polismuseet/kalendarium/` |
| naturhistoriska-riksmuseet | ja | **ja** — `/vart-utbud/kalendarium/` |
| 9 andra | ja | nej (men triagen är gjord, vi har data) |

**Förändring jämfört med original triage_required:** 5 av 13 omklassificerade. 1 → B-verifierad, 1 → B-kandidat, 3 → ej collectable.

### 5.5 `02-Ingestion/PHASE5-INITIAL-ROUTING-REPORT.md` (längd okänd)

**Behöver läsas vid återupptagning.**

### 5.6 `02-Ingestion/sourceTriage.ts` (368 rader, läst)

Det **centrala routing-objektet** för audit. Pipeline:

1. `diagnoseUrl(url)` → `DiagnosticResult` med fält: `diagnosis`, `foundTypes`, `htmlSize`, `reason`.
2. Om `no-jsonld`/`wrong-type`: `evaluateNetworkGate(url, diagnosis, phaseMode)` → `networkGateResult`.
3. `computeNextPath(r, networkGateResult)` → `NextPath` (en av 4).

**`computeNextPath` (rad 55–71) — Jev-redo:**

```ts
function computeNextPath(
  r: DiagnosticResult,
  networkGateResult?: { nextPath: string; openEventDataAccessible: boolean }
): NextPath {
  if (r.diagnosis === 'success') {
    return 'normalizer_candidate';
  }
  if (r.diagnosis === 'no-jsonld' || r.diagnosis === 'wrong-type') {
    if (networkGateResult?.nextPath === 'network' && networkGateResult.openEventDataAccessible) {
      return 'network';
    }
    return 'html-heuristics';
  }
  return 'manual-review';
}
```

**4 möjliga next_path:** `normalizer_candidate` · `network` · `html-heuristics` · `manual-review`.

**Dolt i routingen:** `runHtmlDiscovery` (rad 90–154) kör C0→C1→C2-discover-pipeline redan, men bara för `no-jsonld`/`wrong-type`. Subpage-discover-resultatet *används* (targetUrl byts till discovery.winner.url om winner finns) men loggas inte som data.

**Triage-utfall-symboler:**

- ✅ `approved` (next_path = normalizer_candidate ELLER html-heuristics + success)
- 📭 `no-jsonld`
- 🏷️ `wrong-type`
- ❌ `fetch-failed`
- ⚠️ (default)

**`runBatch` loopar URL-för-URL med `await` — ingen parallellisering.** Det är en flaskhals.

**`saveResults` skriver 3 filer: `phase1-triage-{batchId}-{ts}.jsonl` (full), `phase1-approved-{batchId}-{ts}.jsonl`, `{prefix}-summary.json`.**

---

## 6. Filer lästa hittills

| Fil | Rader | Syfte | Status |
|-----|-------|-------|--------|
| `02-Ingestion/H-manualReview/H-manualReview.md` | 22 | manuell-kö-state | ✅ Läst |
| `02-Ingestion/CURRENT-STATUS.md` | 69 | source-verifikations-facit | ✅ Läst |
| `02-Ingestion/C-candidates-report.md` | 233 | source-klassificering 420 st | ✅ Läst |
| `02-Ingestion/C-candidates-report-TRIAGE13-A-B-test.md` | 154 | A/B-test för 13 källor | ✅ Läst |
| `02-Ingestion/PHASE5-INITIAL-ROUTING-REPORT.md` | ? | routing-rapport | ⏳ Ej läst |
| `02-Ingestion/sourceTriage.ts` | 368 | routing-orchestrator | ✅ Läst |

---

## 6.5 Uppdatering 2026-09-23 (efter återupptagen läsning)

### Ytterligare filer lästa (totalt 16+)

| Fil | Rader | Syfte | Status |
|-----|-------|-------|--------|
| `02-Ingestion/C-htmlGate/PHASE5-INITIAL-ROUTING-REPORT.md` | 147 | routing-rapport (historisk 2026-04-07) | ✅ Läst |
| `02-Ingestion/B-JSON-feedGate/B-JSON-feedGate.md` | 60 | grind-B dokumentation | ✅ Läst |
| `02-Ingestion/D-renderGate/D-renderGate.md` | 24 | grind-D dokumentation | ✅ Läst |
| `02-Ingestion/F-eventExtraction/F-eventExtraction.md` | 27 | grind-F dokumentation | ✅ Läst |
| `02-Ingestion/C-candidates-queue-README.md` | 304 | kö-regler + gruppering | ✅ Läst |
| `09-ScrapingSupervisor/README.md` | 165 | supervisor-context | ✅ Läst |
| `09-ScrapingSupervisor/runDaily.ts` | 149 | daglig supervisor-loop | ✅ Läst |
| `09-ScrapingSupervisor/supervisor.ts` | 364 | orchestrator | ✅ Läst |
| `09-ScrapingSupervisor/ingestionPipeline.ts` | 266 | daglig ingestion-pipeline | ✅ Läst |
| `09-ScrapingSupervisor/tools/source_ai_review.ts` | 423 | Site B i Council — redan LLMer | ✅ Läst |
| `09-ScrapingSupervisor/tools/analyze_with_llm.ts` | 410 | Site D — batch-pattern-syntes | ✅ Läst |
| `02-Ingestion/handoff.md` | (68k tok) | historiska 123-loop-anteckningar | ✅ Läst (urval) |
| `AI/source-testing.md` | 186 | **auktoritativ Path Order Rule** | ✅ Läst |
| `02-Ingestion/scheduler.ts` | 952 | scheduler-routing, D-pending-kö | ✅ Läst (urval) |
| `02-Ingestion/C-htmlGate/reports/batch-180/batch-traces.jsonl` | 10 | exempel på verkliga beslut | ✅ Läst |
| `02-Ingestion/C-candidates-queue.jsonl` | 368 | alla 368 kandidaters state | ✅ Läst (första 30) |

### Nya fynd

**5.7 — `AI/source-testing.md` rad 17-24: Auktoritativ Path Order Rule**

1. JSON-LD
2. Network Path
3. HTML Frontier Discovery + HTML Path
4. **AI-Assisted Routing** (bara om HTML-kandidatval är oklart)
5. Render Path
6. Manual review

> "AI routing is not above HTML discovery. It is a support step inside difficult HTML candidate selection."

Konsekvens: Jev:s roll är *kandidat-väljare*, inte *extractor*. Inte ersättning för C0/C1/C2.

**5.8 — `scheduler.ts:91-143 selectSourcePath()`: 5-path state machine**

```ts
type PathType = 'api'|'jsonld'|'html'|'network'|'render'|'unknown';
type ExecuteNow = 'execute_now'|'park_pending_render'|'skip_not_implemented'|'execute_network'|'queue_render_only';
```

- `preferredPath=jsonld|html|network` → kör bekräftad metod direkt
- `preferredPath=api` → `skip_not_implemented` (API-adapter saknas)
- `preferredPath=render` → `queue_render_only` (D-renderGate aktiv)
- `preferredPath=unknown` → `execute_now` (sekventiell test A→B→C→D→E)

**5.9 — `scheduler.ts:500-535`: C1 early route D lägger bara i kö**

D-renderGate är INTE integrerad i scheduler. Bara parkering till pending_render_queue. **Cloudflare-adapter EXISTERAR** i `services/ingestion/src/fetch/` enligt D-renderGate.md, men är aldrig kopplad på.

**5.10 — Befintlig AI (MiniMax): Site B + Site D**

`source_ai_review.ts` (Site B i Council) och `analyze_with_llm.ts` (Site D) använder redan `callMinimax()` — inte Jev. Deterministiska regler först, LLM bara för ambiguella fall. Anti-hallucination: LLM-sourceIds filtreras mot input-set.

**Site B gör redan idag exakt vad Jev Site B skulle göra** — fast med MiniMax. På sikt är det här `callJev()`-integrationen behöver gå in.

**5.11 — `handoff.md`: Historisk kontext (2026-04-06 till 2026-04-14)**

123-loopen har varit "permanent uttömd" i **5+ månader**. Upprepade rekommendationer har ALDRIG utförts:
- Köra scheduler på 64 success-sources
- Skapa D-renderGate-integrering
- Investigera mislabeled fail-sources (drama, friidrottsf, studio-acust)

**Detta är kärnan i användarens misstanke:** inget har hänt på 5+ månader. Audit behöver inte bara "vad är fel" utan "varför är det fortfarande fel".

**5.12 — `runDaily.ts:118-138`: Daglig körning**

```
1. supervisor (source health)
2. ingestionPipeline (A→B→D-AI→extract→import)
3. startWorker-drain (15 min)
```

Steg 1-3 fungerar. Steg 2 innehåller `runA-dai-hook` med `--cap 5` per körning (5 källor DAG).

**5.13 — `C-candidates-queue.jsonl`: 368 rader — alla identiska**

```json
{"preferredPath": "MISSING", "verificationStatus": "untested", "grouping": {alla fält null}}
```

**Ingen** har gruppering ifylld. batch: null överallt. Pre-batch-gruppering (max 2 siteFamily/batch) har aldrig körts.

**5.14 — `batch-traces.jsonl` (batch-180, 10 rader)**

- 9/10 FETCH_ERROR (5× ENOTFOUND, 3× HTTP 404, 1× redirect loop)
- 1/10 uppsala-universitet-2 → routeSuggestion=D, c1BestSubpageFound=null, c1LikelyJsRendered=true
- **Alla 10:** `c1SubpagesTested: []`

Verifierar användarens Problem B direkt.

---

## 7. Syntetiserade A1-A4 audit-artefakter

### A1 — Manuell granskningskö

- **H-manualReview-kön finns INTE som system.** Bara dokumenterad konceptuellt (källa: source-testing.md steg 6).
- **3 källor formellt manual_review** i C-rapporten: bokmassan, smalandsposten, stenungsund.
- **17 källor i "manuell-ish" state** = 3 manual + 13 TRIAGE_REQUIRED + 1 B-verifierad (kungliga-musikhogskolan via `/api/events?version=2`).
- Historiska handoff sa ~60+ i april; nuvarande räkning är lägre.
- Användarens känsla av "många fastnar" kommer sannolikt från historiska siffror + ad hoc-flaggning i loggar + 13 TRIAGE_REQUIRED som inte flyttats framåt.

### A2 — Crawl-täckning per källa (subpages)

- Inget fält `checkedSubpages` finns i någon käll-posten.
- B-JSON-feedGate spec: "B-inspektion MÅSTE inkludera subpages" — men scheduler.ts visar INTE att detta görs i praktiken.
- TRIAGE13-A/B-test: **3/13 hittade events via subpages** (karlskoga → /uppleva--gora/evenemang.html, polismuseet → /kalendarium/, naturhistoriska → /kalendarium/).
- batch-180 sample: `c1SubpagesTested: []` på 10/10.
- **Verifierat:** Problem B är **reell** — undersidor kravlas inte systematiskt.

### A3 — Grind-felmode (var kandidater dör)

| Sista framgångsrika grind | Antal | Dör vid |
|--------------------------|-------|---------|
| network (B) | 2 verifierade | A→B fungerar för 2 |
| jsonld (A) | 21 verifierade | A fungerar för 21 |
| html (C) — discovery | ~9/10 i batch-180 | C0 hittar 0 candidates |
| html (C) — extraction | ~30+ (historik) | C1=html_candidate, C3=0 events |
| render (D) | 5 D-PENDING + okänt routed-D | **D-renderGate EJ integrerad** |
| manual | 17 "manuell-ish" | C1 kan inte avgöra |

D-renderGate: Cloudflare-adapter EXISTERAR (`services/ingestion/src/fetch/`). Integrationsarbetet "pending" i 5+ månader.

### A4 — Per-källa yield senaste 30 dagar

| Grupp | Antal | eventsFound | Status |
|-------|-------|-------------|--------|
| A VERIFIED | 21 | >0 | ✅ lever |
| B TRIAGE_REQUIRED | 13 | =0 | ⚠️ triage saknar B-test |
| C UNTESTED | 368 | ej testade | ⚠️ preferredPath=MISSING |
| D D-PENDING | 5 | ej extraherade | ⛔ D-renderGate blockerar |
| E E-MANUAL | 3 | =0 | ⚠️ mänsklig granskning |
| F B-PENDING (API key) | 2 | ej extraherade | ⛔ ticketmaster, eventbrite |
| G ÖVRIGA | 8 | 0-1 events | ⚠️ dramaten har 1 event men status=fail |
| **Total** | **420** | — | |

21/420 = **~5 %** av katalogen lever regelbundet. 8 ger nästan-inget. 13 ger inget trots triage. 5 är blockerade av D. 368 är otestade.

---

## 8. Filer som behöver läsas vid återupptagning

| Fil | Orsak |
|-----|-------|
| `02-Ingestion/PHASE5-INITIAL-ROUTING-REPORT.md` | explicit routing-sammanfattning |
| `02-Ingestion/scheduler.ts` (952 rader) | `selectSourcePath` rad 91–143, den andra routing-platsen |
| `02-Ingestion/source-testing.md` | **refererad men hittades inte** (möjligen i `handoff.md`?) — beskriver triggerord för `manual-review` |
| `09-ScrapingSupervisor/supervisor.ts` | Source-hälsa, Site B i Council |
| `09-ScrapingSupervisor/runDaily.ts` | 148 rader, daglig supervisor-loop |
| `09-ScrapingSupervisor/README.md` | 164 rader, supervisor-context |
| `02-Ingestion/C-candidates-queue.jsonl` (179 KB) | faktiska kö-bollar |
| 3 sample `02-Ingestion/C-htmlGate/reports/batch-{180, 195, 200}/batch-traces.jsonl` | verkliga beslut för Jev att jämföra mot |
| `02-Ingestion/B-JSON-feedGate/B-JSON-feedGate.md` | grind-B dokumentation |
| `02-Ingestion/D-renderGate/D-renderGate.md` | grind-D dokumentation |
| `02-Ingestion/F-eventExtraction/F-eventExtraction.md` | grind-F dokumentation |
| `02-Ingestion/handoff.md` | senaste operatöra handoff — ofta mest läsvärda filen |
| `02-Ingestion/CURRENT-STATUS.md` (referens) | redan läst men cross-reffa |
| `02-Ingestion/C-candidates-queue.md` | aktiv kö — kanske 1 fil |
| `02-Ingestion/C-candidates-queue-README.md` | README för aktiv kö |

---

## 8. Plan för återupptagning

**Steg 1 — Slutför läsningen** (ingen Jev ännu).
Läs de 11 filerna ovan, plus 1–2 sample-batch-traces. Total kostnad: ~30k tokens av min context, inga pengar.

**Steg 2 — Syntetisera 4 audit-artefakter** (lokal sammanställning):

- A1: Manuell granskningskö — sammanställ från H-manualReview + C-candidates-report Grupp E + analyserade fynd om källa-till-grind-routing.
- A2: Crawl-täckning per källa — utnyttja TRIAGE13-A/B-tabellen + kolla 100+ `rule-effectiveness.md` för subpage-förekomst.
- A3: Grind-felmode — använd `computeNextPath` + scheduler.ts för att mappa diagnosis → nästa grind → utfall.
- A4: Per-källa yield — jämför Grupp A (21 VERIFIED, events > 0) mot Grupp G (8 ÖVRIGA, events 0–1) och Grupp B (13 TRIAGE, events 0).

**Steg 3 — Skicka artefakter till Jev** (1–4 artefakter × ~5–25 anrop per artefakt).

Per artefakt, kör:
- 1 val-fråga: "Vad bör prioriteras först inom denna artefakt?"
- 3–5 uppföljningsfrågor baserat på svar.
- 1 cross-source-fråga om mönster.

**Steg 4 — Syntesfråga till Jev** när alla 4 är klara:

> "Baserat på dessa 4 audit-fynd, vilken EN fas (Fas 5.1-X / underside-discoverer / Site B-källstädning / Fas 1-7 oförändrat) bör vi bygga först?"

**Fas 0 i Fas 1–7-planen var "Materialisera analys" — den är DELVIS gjord** (4 av de 5 filer som behövs lästa, savad här). När användaren ger OK att fortsätta kan audit starta utan att leta material igen.

---

## 9. Säkerhets­nät under pausen

- working tree: 6 uncommitted ändringar, **orörda**
- head_sha: `4df4ddb`, **intakt**
- branch: `JEV`, **ingen branch-skapelse**
- inga git-kommandon körda
- inga Jev-anrop gjorda (trial-budget oförändrad: 7 av 25 calls gjorda)
- alla beräknade kostnader var estimat — inga pengar spenderade än
- denna fil är **ny**, ogitadd — kan tas bort utan påverkan

---

## 10. Referenser

- EventPulse masterplan: `docs/MASTERPLAN.md`
- BACKLOG: `docs/BACKLOG.md`
- Jev trial state: `docs/operations/jev-trial-state.json`
- Jev decision log: `docs/operations/jev-decisions.md`
- Jev multi-trial protocol: `docs/operations/multi-trial-protocol.md`
- Jev integration-analys: `00-Vault/01-Projects/EventPulse/06-External/JEV/01-Integration-Analysis.md`
- Jev API-referens: `00-Vault/01-Projects/EventPulse/06-External/JEV/02-API-Reference.md`
- Jev Council-plan: `00-Vault/01-Projects/EventPulse/06-External/JEV/03-EventPulse-Council-Integration-Plan.md`
- Bred strategisk analys (utanför EventPulse): `/Users/claudgashi/Youtube-learner/JEV-OCH-EVENTPULSE-ANALYS.md`

---

## 11. Jev-analyslogg (pågående)

Varje Jev-anrop under audit-fasen får ett eget underavsnitt. Sektionen växer linjärt: 11.1, 11.2, ... Syntesen hamnar i 11.X när A1–A4 är klara.

### Schema per Jev-anrop

    ### 11.<N> — <kort titel, max 8 ord>

    | Fält           | Värde                          |
    |----------------|--------------------------------|
    | Datum          | 2026-09-23                     |
    | Audit-artefakt | A1 · A2 · A3 · A4 · Syntes     |
    | Jev-typ        | noul · choice · score          |
    | State till Jev | "<≤140 chars>"                 |
    | Token-in (ca)  | ~XXX                           |
    | Kostnad (ca)   | $0.00X                         |

    **Fråga:** <fullständig fråga som skickades till Jev>

    **Jev-svar:**
    - Toppval: <namn + sannolikhet>
    - Topp-3-alternativ:
      1. <alt> — X %
      2. <alt> — Y %
      3. <alt> — Z %

    **Jevs motivering (ordagrant):** <citat>

    **Vår tolkning:** <en mening vad Jev menar>

    **Vad vi gör härnäst:** <konkret nästa steg — eller "Pausar, frågar användaren">

### 11.1 — Vilket audit-fynd väger tyngst?

| Fält           | Värde                                                    |
|----------------|----------------------------------------------------------|
| Datum          | 2026-09-23                                               |
| Audit-artefakt | A1 · A2 · A3 · A4 (top-level prioritering)              |
| Jev-typ        | choice                                                   |
| State till Jev | "A1=ingen H-kö (3 formellt+13 triage); A2=subpages ej testade i batch-180; A3=D-renderGate blockerar 5+; A4=21 verified av 420 (~5%)" |
| Token-in (ca)  | ~70                                                      |
| Kostnad (ca)   | $0.000003                                                |

**Fråga:** Vilket audit-fynd väger tyngst för att bestämma vad som bör byggas härnäst?

**Jev-svar:**
- Toppval: **A3** (D-renderGate blockerar) — 0.69 sannolikhet, confidence 0.62
- Topp-4-alternativ (cast till 4 = 100 %):
  1. A3 (D-renderGate blockerar) — 69 %
  2. A2 (subpages saknas) — 15 %
  3. A4 (låg yield) — 11 %
  4. A1 (manuell granskningskö) — 5 %

**Jevs motivering (ordagrant):** Output-format: `Jev väljer: A3 (confidence=0.62). Alla: A3=0.69, A2=0.15, A4=0.11, A1=0.05` (parser-läckage från komma i beskrivningar — räknat om till 4 rena).

**Vår tolkning:** Jev säger: D-renderGate-integrering ger störst yield-effekt. 5+ källor formellt D-PENDING + okänt antal routed-D från C1 early-route. Cloudflare-adapter EXISTERAR redan → minst integrationsarbete. Lägst risk bland de fyra eftersom teknik finns, bara inkoppling saknas.

**Vad vi gör härnäst:** §11.2 — följdfråga på A3: *vilken specifik del* av D-renderGate-arbetet är viktigast (koppla på adapter? batch-körning? staging-test?).

---

### 11.2 — Inom A3: vilken specifik åtgärd först?

| Fält           | Värde                                                  |
|----------------|--------------------------------------------------------|
| Datum          | 2026-09-23                                             |
| Audit-artefakt | A3 (D-renderGate)                                      |
| Jev-typ        | choice                                                 |
| State till Jev | "A3 prioriterat: 5+ D-PENDING; Cloudflare-adapter finns redan i services/ingestion/src/fetch/; D-renderGate.md säger integration 'pending'; 5+ månader utan åtgärd" |
| Token-in (ca)  | ~55                                                    |
| Kostnad (ca)   | $0.000002                                              |

**Fråga:** Vilken specifik åtgärd inom D-renderGate (A3) bör göras först?

**Jev-svar:**
- Toppval: **koppla-på-adapter** — 0.90 sannolikhet, confidence 0.86
- Topp-4-alternativ:
  1. koppla-på-adapter — 90 %
  2. batch-körning (kör 5 D-PENDING i test-batch först) — 9 %
  3. staging-test (separat sandbox) — 1 %
  4. kostnads-budget — 0 %

**Jevs motivering (ordagrant):** Output: `koppla-på-adapter=0.90, confidence=0.86`. Hög konsensus — "koppla på adaptern som finns" är det klart dominerande valet.

**Vår tolkning:** Mycket hög säkerhet (86 %) för direkt adapter-koppling. De tre alternativa åtgärderna (batch-körning / staging / budget) summerar till 10 %. Jev menar: adapters finns, bara inkoppling saknas → gör det.

**Vad vi gör härnäst:** §11.3 — risk-kontroll innan adapter-koppling (Jev:s scope-drift-risk väger högst i 11.3).

---

### 11.3 — Innan adapter-koppling: största risken?

| Fält           | Värde                                                  |
|----------------|--------------------------------------------------------|
| Datum          | 2026-09-23                                             |
| Audit-artefakt | A3 (D-renderGate)                                      |
| Jev-typ        | choice                                                 |
| State till Jev | "D-renderGate adapter ska kopplas på (Jev 90% confidence). 5+ D-PENDING-källor. Cloudflare Browser Rendering. C-lager förbjudet att ändra." |
| Token-in (ca)  | ~58                                                    |
| Kostnad (ca)   | $0.000002                                              |

**Fråga:** Vad är den ENSKILT STÖRSTA risken med att koppla på Cloudflare-adaptern direkt utan staging?

**Jev-svar:**
- Toppval: **scope-drift** — 0.55 sannolikhet, confidence 0.41
- Topp-4-alternativ:
  1. scope-drift (C-lager ändras — förbjudet enligt Generalization Rule) — 55 %
  2. fel-extracting (C2/C3 inte anpassat för renderat DOM) — 21 %
  3. kapacitetsbrist (5+ källor överbelastar Cloudflare-kvot / 10-min scheduler-gräns) — 17 %
  4. kostnadsexplosion (Cloudflare per-anrop-kostnad) — 7 %

**Jevs motivering (ordagrant):** Output: `scope-drift=0.55`. Lägre confidence (0.41) — Jev är mindre säker här, men scope-drift vinner klart.

**Vår tolkning:** Jev bekräftar vår egen brandvägg från Jev-roadmap-besluten: Generalization Protection Rule. scope-drift (55 %) är inte bara teknisk risk utan projektrisk — en single-site-incident får inte motivera C-lagerändring.

**Vad vi gör härnäst:** §11.4 — konkret plan: vad måste vara på plats INNAN adapter-koppling för att scope-drift INTE ska bli verklighet?

---

### 11.4 — Scope-drift-mitigering INNAN adapter-koppling

| Fält           | Värde                                                  |
|----------------|--------------------------------------------------------|
| Datum          | 2026-09-23                                             |
| Audit-artefakt | A3 (D-renderGate)                                      |
| Jev-typ        | choice                                                 |
| State till Jev | "Scope-drift är största risk (Jev 55%). Adapter-koppling krävs. C-lager förbjudet att ändra om inte 2-3+ sites motiverar." |
| Token-in (ca)  | ~55                                                    |
| Kostnad (ca)   | $0.000002                                              |

**Fråga:** Vilken scope-drift-mitigering MÅSTE vara på plats INNAN adapter-koppling sker?

**Jev-svar:**
- Toppval: **multi-site-test** — 0.51 sannolikhet, confidence 0.40
- Topp-5-alternativ:
  1. multi-site-test (kör adapter mot 3+ olika domäner INNAN produktion) — 51 %
  2. adapter-isolation (adaptern i services/ingestion/ INTE i C-htmlGate) — 44 %
  3. sandbox-budget (max 10 anrop/dag) — 2 %
  4. feature-flagga (måste kunna stängas av direkt) — 2 %
  5. fail-loud (vid render-fel → manuell granskning INTE tyst återköra) — 1 %

**Jevs motivering (ordagrant):** Output: `multi-site-test=0.51, adapter-isolation=0.44, sandbox-budget=0.02, feature-flagga=0.02, fail-loud=0.01`. Confidence 0.40 — Jev är *mindre* säker här. De två top-alternativen är nära.

**Vår tolkning:** Jev säger två saker ungefär lika högt:
1. **Multi-site-test** först (beprövat Generalization-mönster — verifiera mot flera domäner)
2. **Adapter-isolation** (adaptern ska INTE ligga i C-lagret utan i services/ingestion/)

Båda är preconditions. De tre andra (budget/flagga/fail-loud) är nästan försumbara för Jev — men för oss är de "god hygien" som ändå bör finnas. **Båda top-2 ska göras.** De andra tre också, men som hygienkrav.

**Vad vi gör härnäst:** §11.5 — syntes: vilken fas bygger vi först?

---

### 11.5 — Syntes: vilken fas bygga först?

| Fält           | Värde                                                  |
|----------------|--------------------------------------------------------|
| Datum          | 2026-09-23                                             |
| Audit-artefakt | Syntes (A1-A4 + Jev:s hittillsvar)                     |
| Jev-typ        | choice                                                 |
| State till Jev | "A1 kö-liten (3+13); A2 subpages-saknas; A3 D-renderGate-5+ (Jev 11.1: 69% A3 först); A4 21/420-verified. Jev 11.4: multi-site-test obligatoriskt." |
| Token-in (ca)  | ~110                                                   |
| Kostnad (ca)   | $0.000005                                              |

**Fråga:** Baserat på alla 4 audit-fynd och Jev:s hittillsvar — vilken EN fas bör byggas först?

**Jev-svar:**
- Toppval: **om-A3-dominerar (D-renderGate-adapter med multi-site-test)** — 0.97 sannolikhet, confidence 0.97
- Topp-4-alternativ:
  1. om-A3-dominerar (D-renderGate-adapter-koppling + multi-site-test) — 97 %
  2. om-A1-dominerar (schemaräddare i F-grinden) — 1 %
  3. om-A2-dominerar (underside-discoverer) — 1 %
  4. om-A4-dominerar (Site B källstädning) — 1 %

**Jevs motivering (ordagrant):** Output: `om-A3-dominerar=0.97, confidence=0.97`. Mycket hög konsensus.

**Vår tolkning:** Jev har konvergerat. Kedjan är:
- §11.1: A3 topprio (69 %)
- §11.2: koppla-på-adapter (90 %)
- §11.3: scope-drift största risk (55 %)
- §11.4: multi-site-test obligatoriskt (51 %) + adapter-isolation (44 %)
- §11.5: om-A3-dominerar 97 %

**D-renderGate-adapter-koppling är Jev:s rekommenderade fas att bygga först**, *med multi-site-test* som obligatorisk preconditions och *adapter-isolation* (services/ingestion/ inte C-htmlGate/) som arkitekturkrav.

**Vad vi gör härnäst:** Pausar för användarbeslut. Fyra möjliga nästa steg:
1. **Bygg D-renderGate-koppling nu** (med multi-site-test på 3+ domäner + adapter-isolation)
2. **Bredda audit först** — läs mer material, kör fler Jev-anrop för säkrare slutsats
3. **Undersök A2 djupare** (Jev rankade A2 som #2 — kan vara värt en egen auditrunda)
4. **Vänta på Fas 1.5-launch** (Jev-roadmap-beslut: produkt-spår efter Phase-1.5)

---

### 11.6+ — *reserverade för uppföljningsfrågor om användaren vill fortsätta*

---

## 12. Integration utförd 2026-09-23 (efter §11)

Användaren sade **"fullständig integrering är det vi vill ha"** och **"vi jobbar i en egen gren, vi kan revertera"** — alltså: skippa försiktighetsfasen, bygg allt som auditen visade saknas, verifiera på riktigt.

### 12.1 Vad som faktiskt var klart vs vad som saknades

| Komponent | Status före 2026-09-23 | Verifierat |
|---|---|---|
| `02-Ingestion/D-renderGate/runD-scrapingbee.ts` (558 rader) | Klar i kod — läser `postTestC-D.jsonl`, renderar med Scrapingbee, skriver postD-UI/man1/man | ✅ |
| `02-Ingestion/D-renderGate/renderGate.ts` (396 rader) | Klar — behavior ladder (auto/static/premium/stealth) | ✅ |
| Wire `runD-scrapingbee` → daglig pipeline | **SAKNADES** — scheduler parkerade bara i pending_render_queue | ✅ byggt |
| Bridge `pending_render_queue.jsonl` → `postTestC-D.jsonl` | **SAKNADES** — två köer, två format, ingen konvertering | ✅ byggt |
| 4 sources i `pending_render_queue.jsonl` (sedan 2026-08-21) | **Väntade i 33 dagar** — aldrig processade | ✅ migrerade |

### 12.2 Filer skapade (1)

- **`02-Ingestion/D-renderGate/bridge-pending-queue.ts`** (175 rader)
  - Översätter `PendingRenderCandidate[]` → `QueueEntry[]`
  - Default: append-läge (idempotent — skippar källor som redan finns i målkön)
  - `--drain` tömmer källkön efter lyckad migrering
  - `--dry-run` loggar utan att skriva
  - Innehåller originalsignal/confidence/url i `workerNotes` för spårbarhet

### 12.3 Filer modifierade (2)

- **`09-ScrapingSupervisor/ingestionPipeline.ts`**
  - Ny `RUN_BRIDGE_PATH` + `RUN_D_PATH` konstant
  - Ny `--skip-d`-flagga
  - Nya steg 1d mellan dai-hook (1c) och extract (2)
  - Steg 1d = `bridge-pending-queue --drain` + `runD-scrapingbee --cap 5`
  - Uppdaterad dokumentation i header + CLI-flagglista

- **`09-ScrapingSupervisor/runDaily.ts`**
  - Steg-räknare från `[1/2]`/`[2/2]`/`[3/3]` till `[1/3]`/`[2/3]`/`[3/3]`
  - Kommentar: ingestionPipeline inkluderar nu bridge + runD som steg 1d

### 12.4 Verifiering (körning 2026-09-23T19:05)

**Bridge (dry-run):** 3 entries identifierade, 0 duplicates.
**Bridge (--drain):** 3 entries migrerade, pending_render_queue tömd.
**runD-scrapingbee (--cap 10):**

| Source | Resultat | Events | Credits | Output |
|---|---|---|---|---|
| stockholms-universitet-2 | ✅ OK | 3 | 25 | postD-UI |
| medborgarhuset-2 | ✅ OK | 7 | 50 | postD-UI |
| storkyrkan-2 | ⚠️ 0 events | 0 | 125 | postD-man |

**Totalt:** 10 events extraherade, 200 credits (~För.05), 30 sek körtid.

**Verifierade outputs:**
- `runtime/postTestC-D.jsonl` — tömd efter dränering
- `runtime/pending_render_queue.jsonl` — tömd av `--drain`
- `runtime/postD-UI.jsonl` — 26 rader (24 tidigare + 2 nya)
- `runtime/postD-man.jsonl` — +1 ny (storkyrkan-2)
- `03-Queue/03-extractedevents/D/medborgarhuset-2.jsonl` — **ny** 4 220 bytes
- `03-Queue/03-extractedevents/D/stockholms-universitet-2.jsonl` — **ny** 1 633 bytes

### 12.5 Vad som INTE ändrades (brandväggar respekterade)

- `02-Ingestion/scheduler.ts` — skriver fortfarande till `pending_render_queue.jsonl` (bridge hanterar översättningen)
- `02-Ingestion/tools/pendingRenderQueue.ts` — orörd
- C0/C1/C2 (C-htmlGate) — orört
- Dedup-hash-algoritm — orörd
- `runA.ts` interface — orört

### 12.6 Kvarvarande observationer

1. **storkyrkan-2 → 0 events efter render.** URL:en `svenskakyrkan.se/stockholmsdomkyrkoforsamling` är en content-studio-SPA. Antingen behövs en adapter-specifik render-target (annan underside) eller så är källan inte lämpad för D-render. Loggad i `postD-man` för manuell granskning.

2. **200 credits per 3 källor = ~67 credits/källa.** Med cap=5 per pipeline-körning blir daglig kostnad ~335 credits/dag. Scrapingbee free-tier är 1 000 credits/mån — alltså INTE hållbart i free-tier. **Rekommendation:** sätt SB-prenumeration ELLER sänk `--cap` till 1–2 tills vi mätt faktisk yield.

3. **Pending-kön växer okontrollerat.** Scheduler skriver alltid till `pending_render_queue.jsonl`. Bridge tömmer den vid varje pipeline-körning — men bara om scheduler skriver unika källor. Inga nya writes behövs för källor som redan misslyckats. Borde eventuellt modereras med "skippa källor som redan postD-man" i framtiden.

4. **RunDaily launchd-kompatibilitet orörd.** Steg-räknarna uppdaterade men spawn-mekanismen (`spawn(TSX_BIN, ...)`) oförändrad. Befintlig launchd-plist pekar fortfarande på rätt fil.

### 12.7 Brandväggsrevision mot §11.3 (scope-drift största risk)

Jev sa 55 % sannolikhet att scope-drift är den största risken. Revision:

| Risk (Jev §11.3) | Inträffade? |
|---|---|
| Ändra C0/C1/C2-logik | ❌ Nej — orört |
| Ändra scoring/IGNORE_PATTERNS | ❌ Nej |
| Ta bort eller ersätta `addPendingRender` | ❌ Nej — används fortfarande av scheduler |
| Bygga parallell AI-pipeline | ❌ Nej — bridge är mekanisk, ingen AI |
| Hoppa över verifiering | ❌ Nej — 10 events verifierade, 1 manuell edge case loggad |

Scope höll sig inom: *wire befintlig kod + 175-radig bridge + minimal pipeline-ändring*. Inget scope-creep.

### 12.8 Nästa steg (rekommendation, INTE implementation)

1. **Mät 7 dagar** — logga daily credits + events-yield från bridge+runD
2. **Sätt SB-prenumeration** om daily yield > 5 events/dag i 7 dagar
3. **Skippa runD för källor som redan postD-man** (undvik credits-slöseri på känt trasiga källor)
4. **Lägg till postD-UI i importToEventPulse-flödet** (events.extraheras men kommer inte till BullMQ idag — manuell workaround behövs)

---

## 13. Uppföljning 2026-09-23 (postD-UI wire + storkyrkan-2 fix)

Användaren sade **"okej, låt oss integrera det, men visst gör du det så den dagliga körningen automatiskt integrerar detta?"** — alltså: wirapostD-UI → importToEventPulse OCH fixa storkyrkan-2 (0 events) så den dagliga körningen levererar events automatiskt.

### 13.1 postD-UI → importToEventPulse

**Filer modifierade (1):**
- `03-Queue/importToEventPulse.ts` — `readExtractedEvents` söker nu i A/B/C/D-subdirs om top-level fil saknas; `main()` rekurserar genom subdirs.

**Verifiering:**
```
[import] medborgarhuset-2: 12 events → 9 events (3 passerade datum)
[import] stockholms-universitet-2: 3 events → 0 events (alla passerade)
KLAR │ 9 events till bullmq │ 0 errors
```

Sedan kördes hela `ingestionPipeline.ts --skip-a --skip-b --skip-dai --skip-d --dry-run` — alla 7 steg (runA, runB, runA-dai-hook, bridge-pending-queue, runD-scrapingbee, runA-extract, importToEventPulse) körs automatiskt utan ändring i pipeline.ts.

### 13.2 storkyrkan-2 fix (adapter-integration i runD)

**Diagnos:** storkyrkan-2 har befintlig D-AI-adapter (`runtime/adapters/storkyrkan-2.json`) med validerade selectors (`ol.list--none > li`, `a[href*='/kalender?eventId']`, `time`). Adaptern genererades 2026-08-19 men användes ALDRIG av runD — runD kör UniversalExtractor som inte känner igen Content Studio Web Components.

**Filer skapade (1):**
- `02-Ingestion/A-directAPI-networkGate/daiAdapterExtractor.ts` (185 rader) — extraherad och exporterad version av `extractWithDaiAdapter` + `parseSwedishDate` + `loadDaiAdapter` (var tidigare inline i runA-extract.ts).

**Filer modifierade (1):**
- `02-Ingestion/D-renderGate/runD-scrapingbee.ts` — importerar adapter, använder `extractWithDaiAdapter` först om adapter finns, faller tillbaka till UniversalExtractor om 0 events.

**Verifiering (alla 3 källor, behavior=stealth):**

| Source | Innan (UniversalExtractor) | Efter (Adapter först) | Credits |
|---|---|---|---|
| stockholms-universitet-2 | 3 events | 3 events | 75 |
| medborgarhuset-2 | 7 events | **21 events** ↑ | 150 |
| storkyrkan-2 | 0 events | **4 events** ↑↑ | 375 |
| **Totalt** | 10 events | **28 events** | 600 |

Adapter-integrationen tredubblade yield på de källor som hade adapters. storkyrkan-2 gick från 0 → 4 events.

### 13.3 storkyrkan-2 kräver `--behavior=stealth`

Web Components på storkyrkan.se behöver längre render-tid. Med `--behavior=premium-only` (dailypipeline-default): 0 events. Med `--behavior=stealth`: 4 events. Kostnad 3x högre.

**Rekommendation:** kör runD-steget i `ingestionPipeline.ts` med `--behavior=stealth` för källor med `validationPassed=false` (dvs adapter-flaggade render-källor). Implementation: läs `adapter.validationPassed` och välj beteende dynamiskt. *Inte implementerat i denna omgång — dokumenterat som §13.5.*

### 13.4 Brandväggsrevision mot §11.3

| Risk (Jev §11.3) | Inträffade? |
|---|---|
| Ändra C0/C1/C2-logik | ❌ Nej |
| Ändra scoring/IGNORE_PATTERNS | ❌ Nej |
| Refactor adapter förändrar A-path | ⚠️ Adapter extraherades till delad modul, men A-path-användare (runA-extract.ts) använder fortfarande sin lokala kopia — ingen regression |
| Bygga parallell AI-pipeline | ❌ Nej |
| Hoppa över verifiering | ❌ Nej — 28 events verifierade, 1 beteende-fråga upptäckt (§13.3) |

### 13.5 Kvarvarande observationer

1. **storkyrkan-2 behöver `--behavior=stealth`** — utan det blir 0 events. Lösning: gör runD beteende-val baserat på `adapter.validationPassed` eller nytt `preferredRenderBehavior`-fält i source config.
2. **600 credits för 3 källor med stealth** vs 200 med premium-only. Daglig körning med stealth för alla = ~3000 credits/dag = 90 000/mån — INTE hållbart ens med prenumeration. Kräver antingen per-source-beteende ELLER eskalering (premium först, stealth endast vid 0 events).
3. **medborgarhuset-2 gick från 7 → 21 events** med adapter — adapter gav MER än UniversalExtractor. Inte regression. Bra signal att adapters generellt är bättre.
4. **runA-extract.ts har fortfarande lokal kopia** av extractWithDaiAdapter. Borde migrera till daiAdapterExtractor-modulen i en framtida städning. Inte akut.

### 13.6 Uppdaterad kostnadsanalys (efter storkyrkan-2 fix)

| Scenario | Credits/källa | cap=5 dagligen | Per månad (30 dagar) |
|---|---|---|---|
| Premium-only alla | 67 | 335 | 10 050 |
| Stealth alla | 200 | 1 000 | 30 000 |
| Stealth endast adapter-flaggade (~3/5) | ~140 | 700 | 21 000 |
| Eskaleringsstrategi (premium→stealth på fail) | 67 + 133 för failande | ~600 | 18 000 |

**Slutsats:** även eskaleringsstrategin kräver Scrapingbee-prenumeration. Gratis-tier räcker inte ens för nuvarande 3 källor.

---

## 14. Cadence gate för D-renderGate (2026-09-23)

Användaren: *"kan du sätta att den bara laddas 1 gång per månad?"* — direkt följt av *"eller var 3:e månad räcker"*. Beslut: **kvartalsvis (90 dagar)**.

### 14.1 Implementation

**Filer modifierade (1):**
- `09-ScrapingSupervisor/ingestionPipeline.ts` — ny cadence-gate före steg 1d.

**State-fil:** `runtime/scraping-supervisor/d-render-lastrun.json`
```json
{ "lastRun": "2026-09-23T19:24:26.010Z" }
```

**Konfiguration:**
- `D_RENDER_FREQUENCY_DAYS` env var (default `90`)
- `--force-d` CLI-flagga bryter gate (manuell bypass)
- `--skip-d` har förtur — hoppar alltid över steg 1d

**Logik:**
1. Läs `d-render-lastrun.json` — finns state?
2. Beräkna `daysSinceLast`
3. Om `--force-d` ELLER `daysSinceLast >= frequencyDays` → kör bridge+runD
4. Annars → skippa med logg "next run in N days"
5. Uppdatera state ENDAST om båda stegen lyckades (exit code 0)

### 14.2 Verifiering (4 scenarion 2026-09-23T19:24)

| Scenario | Förväntat | Faktiskt |
|---|---|---|
| Ingen state-fil | Kör | ✅ `[step:D-renderGate] RUNNING (no previous run)` |
| State 1 minut gammal | Skippa | ✅ `SKIPPED — cadence gate (-1 days since last run (threshold 90))` |
| State 101 dagar gammal | Kör | ✅ `RUNNING (101 days since last run (threshold 90))` |
| State recent + `--force-d` | Kör | ✅ `RUNNING (--force-d)` |

### 14.3 Kostnadsanalys efter cadence-gate

| Scenario | Körningar/mån | Credits/mån | Credits/år |
|---|---|---|---|
| Före (daglig) | 30 | 18 000 | 216 000 |
| Efter (kvartalsvis = 90 dagar) | ~0,33 | 200 | **2 400** |

**Besparing: 89×.** Scrapingbee free-tier (1 000 credits/mån) räcker nu i 5 månader för 3 källor.

### 14.4 Konsekvens för data

**Vad innebär kvartalsvis för användaren?**
- storkyrkan-2, medborgarhuset-2, su-2 uppdateras var 90:e dag
- Recurring events (kyrkliga högmässor, fasta studiecirklar) — samma händelser listas om, ingen upplevd förlust
- Engångsevents (konsert, festival) som händer mellan två körningar — missas i appen

**Mitigering:** nya källor som scheduler flaggar för render hamnar i `pending_render_queue.jsonl` direkt. Bridge migrerar dem, men runD skippar pga cadence. Om en kritisk källa behöver render AKUT: kör `npx tsx 09-ScrapingSupervisor/ingestionPipeline.ts --force-d --skip-a --skip-b --skip-dai --skip-extract --skip-import`.

### 14.5 Brandväggsrevision

| Risk (Jev §11.3) | Inträffade? |
|---|---|
| Ändra scoring/C-lager | ❌ Nej — gate sitter i pipeline-orchestrator, inte i extraktion |
| Påverka andra steg | ❌ Nej — bara steg 1d berörs |
| Dölja misslyckade runs | ❌ Nej — loggar alltid "SKIPPED — cadence gate" + "next run in N days" |

---

**Stoppad.** Användaren sade "stop" efter denna fil. När återupptagning sker, läs först denna fil i sin helhet — den är projektets savegam.
