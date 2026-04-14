# C-Spår Statusmatris — Verklighet vs Plan

**Document Type: NEW CANONICAL MODEL / PRIMÄR SNABBÖVERSIKT**
**Skapad:** 2026-04-11
**Syfte:** Denna fil är DEN PRIMÄRA snabböversikten för C-spåret. Den ersätter alla äldre statusbeskrivningar.

**Kort sammanfattning av C-spårets dokumentlandskap:**

| Fil | Roll |
|-----|------|
| **C-status-matrix.md** | **← DU ÄR HÄR — PRIMÄR SNABBÖVERSIKT** |
| C-testRig1-2-3loop.md | Ny canonical målmodell (target semantics) |
| C-rebuild-plan.md | Ny rebuild-plan (steg-för-steg) |
| **C-testRig-reporting.md** | **NY — AUKTORITATIV RAPPORTSPECIFIKATION** — definierar alla fyra obligatoriska rapportlager (batch, source, round, C4-AI learnings) |
| **C-htmlGate.md** | Historical/legacy — föråldrad dokumentation, ersatt av status-matrix, testRig och rebuild-plan |
| 123.md | Workflow execution rules |
| C-BATCH-INFRASTRUCTURE.md | Legacy/historisk — kördes aldrig i förbättringsloop |
| PHASE5-INITIAL-ROUTING-REPORT.md | Historisk rapport |

---

---

## ⚠️ VARNING: NAMNRÖRA — DET HÄR ÄR PROBLEMET

**Läs detta FÖRST om du ska arbeta med C-spåret.**

Det finns en kvarvarande namnröra mellan nuvarande implementation och canonical målmodell:

| Nuvarande kodbenämning | Vad den GÖR i praktiken | Canonical målmodell | Match? |
|------------------------|-------------------------|--------------------|--------|
| `C0-htmlFrontierDiscovery/` | Discovery: hittar interna links, mäter density, väljer bästa candidate | **C1** (Discovery/Frontier) | ✓ Mappning klar |
| `C1-preHtmlGate/` | Screening: billig fetch + DOM-analys, avgör html/render/manual | **C2** (Grov HTML-screening) | ⚠️ **NAMNET ÄR VILSELEDANDE** |
| `C2-htmlGate/` | Weighted scoring + routing-signal | **C2** (Grov HTML-screening) | ✓ Match |
| `extractFromHtml()` i `F-eventExtraction/` | Första HTML-extraktionssteget | **C3** (HTML-extraktion) | ✓ Match |
| `C3-aiExtractGate.ts` | AI-fallback: körs endast när C2=promising men extract=0 | **C4-AI** (AI-fallback) | ✓ Match |

**DET VIKTIGASTE ATT FÖRSTÅ:**
- `C1-preHtmlGate/` heter "C1" men gör **screening**, inte discovery
- I canonical målmodell heter screening-steget **C2**
- Därför: **nuvarande C1 ≈ canonical C2**, inte canonical C1
- Nuvarande C0 är det som faktiskt gör discovery/frontier-arbete ≈ canonical C1

**Enkelt att komma ihåg:**
```
Nuvarande C0 = Canonical C1  (båda gör discovery/frontier)
Nuvarande C1 = Canonical C2  (båda gör screening)
Nuvarande C2 = Canonical C2  (samma)
extractFromHtml() = Canonical C3 (samma)
C3-aiExtractGate = Canonical C4-AI (samma)
```

---

## Översikt: Tre Parallella Sanningar

| Lager | Beskrivning | Status |
|-------|-------------|--------|
| **Canonical målmodell** | Det önskade slutläget (C1/C2/C3/C4-AI) | Beskrivet i `C-testRig1-2-3loop.md` |
| **Ny primär kandidat** | `run-dynamic-pool.ts` — dynamisk testpool, 2026-04-11 | **Aktiv experimentell runner — PENDING VERIFICATION** |
| **Current implementation** | Det som faktiskt körs i batch-loop | Delvis implementerad (se nedan) |
| **Legacy baseline batch mode** | Äldre engångs batch-script som kördes för att testa | `run-batch-001.ts` – `run-batch-010.ts` |

---

## Komponent-status

### <implemented_and_verified>
Functions that have been confirmed working in terminal execution.

| Komponent | Status | Anteckningar |
|-----------|--------|--------------|
| **discoverEventCandidates()** | Implemented and verified | Used as C0 in run-dynamic-pool.ts. Finds internal links, measures density, selects best candidate. |
| **screenUrl()** | Implemented and verified | Used as C1 in run-dynamic-pool.ts. Screening: cheap fetch + DOM analysis. |
| **evaluateHtmlGate()** | Implemented and verified | Used as C2 in run-dynamic-pool.ts. Weighted scoring + candidate quality. |
| **extractFromHtml()** | Implemented and verified | Used as C3 in run-dynamic-pool.ts. First HTML extraction step. Returns {eventsFound, ...}. |
| **run-dynamic-pool.ts** | Implemented and partially verified | RUNNER_EXECUTES: confirmed. FLOW_PARTIALLY_VERIFIED: rounds 1-3 executed. NOT_CANONICAL_YET. |
| **Dynamic pool refill** | Verified | Refill between rounds confirmed working in batch-13. |
| **Pool state persistence** | Verified (write) | pool-state.json written after each round. |
| **Queue routing** | Verified | 10 sources correctly routed to output queues in batch-13. |
| **Resume from pool-state** | RESUME_VERIFIED | Resume tested 2026-04-11 — correctly loads state, continues from right round, no duplicate exits. See resume-verification-report.md. |
</implemented_and_verified>

### <implemented_but_unverified>
Code exists but verification is missing.

| Komponent | Status | Anteckningar |
|-----------|--------|--------------|
| **run-dynamic-pool.ts in production** | Not verified | Only tested in batch-13 as a single run. |
| **Improvements-bank** | Not verified | Structure exists in reports/ but not actively populated. |
</implemented_but_unverified>

### <placeholder_only>
Future function or empty layer — no real implementation.

|| Komponent | Status | Anteckningar |
|-----------|--------|--------------|
| **C3-aiExtractGate in loop context** | Not connected | Only runs as one-off fallback, not in the batch loop. |
| **Canonical model (C1/C2/C3/C4-AI naming)** | Not yet aligned | Current code uses C0/C1/C2/C3 naming. Canonical names not yet enforced in code. |
</placeholder_only>

### <experimental_partially_verified>
Komponenter som är experimentella och endast partiellt verifierade.

| Komponent | Status | Verifieringsnivå | Anteckningar |
|-----------|--------|------------------|---------------|
| **C4-AI (failCategory)** | EXPERIMENTAL | Partially verified | C4-AI körs i run-dynamic-pool.ts efter varje round. Tilldelar failCategory (ENTRY_PAGE_NO_EVENTS (2026-04-14 NY, ersätter WRONG_ENTRY_PAGE), NEEDS_SUBPAGE_DISCOVERY, LIKELY_JS_RENDER, EXTRACTION_PATTERN_MISMATCH, LOW_VALUE_SOURCE, no_viable_path_found (2026-04-14 NY), robots_or_policy_blocked (2026-04-14 NY), likely_js_render_required (2026-04-14 NY), ambiguous_multiple_paths (2026-04-14 NY), insufficient_html_signal (2026-04-14 NY), UNKNOWN). failCategory används för routing-beslut. Pilotfall: bk-hacken, blekholmen. **Gap:** suggestedRules genereras men kopplas INTE till C1/C2/C3-ändring. **batch-14:** c4-ai-learnings.md är fortfarande placeholder (`STATUS: IMPLEMENTATION GAP — C4-AI NOT YET CONNECTED`). |
| **C4-AI routing (C1/D/discard)** | EXPERIMENTAL | Partially verified | C4-AI föreslår routing: tillbaka till C1 (retry), D (render-gateway), eller discard (manual-review). routing-beslut baserat på failCategory + confidence. Ej verifierad i produktionskörning. |
| **Batch 10 → C1→C2→C3→C4-AI** | EXPERIMENTAL | Partially verified | Fullständig pipeline körs i run-dynamic-pool.ts. C1=Discovery, C2=Screening, C3=Extraction, C4-AI=AI-analys på fail. Körde 14 sources genom 3 rundor i batch-13. **batch-14:** 10 sources × 1 round. INTE canonical ännu. |

### <learning_loop_status_2026-04-12>

**123-loop Status: `partially learning` (uppdaterad från `analysis only`)**

||| Aspekt | Bevisat | Ej bevisat |
||--------|---------|------------|
||| C4-AI genererar suggestedRules | ✓ (c4-ai-analysis-round-1.md batch-14, 9 sources analyserade) | - |
||| C4-AI kör efter varje round | ✓ (batch-14: c4-ai-analysis-round-1.md producerad) | - |
||| suggestedRules sparas permanent | ✓ (c4-derived-rules.jsonl: 6 rules, batch-14) | - |
||| Rules lastas vid körning | ✓ (loadAllDerivedRules() fungerar) | - |
||| Rules påverkar routing för nya sources | ✓ (5 sources i batch-14 fick ändrad routing B/D) | - |
||| Rules kopplas till C1/C2/C3 | ✗ | C4-derived-rules.jsonl innehåller per-source routing hints, inte generella C1/C2/C3-ändringar |
||| C1/C2/C3-kod förbättrad | ✗ | Inga ändringar i discoverEventCandidates(), screenUrl(), evaluateHtmlGate(), extractFromHtml() |
||| Samma fail-set omkört | ✗ | batch-14 pool exhausted efter round 1, batch-15 krävs |
||| Före/efter-jämförelse | ✗ | c4-ai-learnings.md fortfarande "IMPLEMENTATION GAP" |
||| improvements-bank uppdaterad | ✗ | 8 entries från 2026-04-06, inga nya från batch-14 |
||| events extraction förbättrad | ✗ | batch-14: 0 events, 9 fail |

**Slutsats: `partially learning`**

**Vad som är nytt sedan 2026-04-11:**
- C4-AI genererar nu rules och sparar dem till c4-derived-rules.jsonl
- Rules påverkar routing (5 av 9 fail-sources fick ändrad väg: B eller D)
- Två separata rule stores: c4-derived-rules.jsonl (källspecifika routing hints) vs improvements-bank.jsonl (generella C1/C2/C3-förbättringar)

**Vad som fortfarande saknas för `operational learning loop`:**
1. Generella regler baserade på C4-AI:s observed patterns — måste testas på C1/C2/C3
2. Omkörning av samma fail-set efter generell ändring — batch-15 krävs
3. Före/efter-jämförelse som visar förbättrat utfall
4. improvements-bank.jsonl uppdaterad med verifierade generella regler
5. Lag 4 (c4-ai-learnings.md) fylld med verklig data, inte "IMPLEMENTATION GAP"

**Viktigt förbehåll:**
- c4-derived-rules.jsonl rules är **per-source routing hints**, inte generella C1/C2/C3-ändringar
- Dessa rules gäller specifika källor (mittuniversitetet→B, svenska-innebandy→D), inte universella mönster
- Inget i batch-14 bevisar att extractFromHtml() eller discoverEventCandidates() förbättrats

</experimental_partially_verified>

---

### Legacy status table (historical reference only)

| Komponent | Finns i kod? | Används i batch-loop? | Används i produktion? | Documenterad? | Status | Anteckningar |
|-----------|-------------|---------------------|----------------------|---------------|--------|--------------|
| **C0** (`C0-htmlFrontierDiscovery/`) | ✓ Ja | ⚠️ Delvis | ✗ Nej | ✓ Ja | **Legacy/Parallell** | Dokumentationen säger "C0 förekommer inte i målmodellen" (`C-testRig1-2-3loop.md` rad 19). I verklig körning används C0 som första steg (discoverEventCandidates). Call: `discoverEventCandidates()` → väljer bästa candidate från interna links. |
| **C1** (`C1-preHtmlGate/`) | ✓ Ja | ✓ Ja | ✗ Nej | ✓ Ja | **Current Implementation (⚠️ NAMNET ÄR VILSELEDANDE)** | Används i alla run-batch-*.ts script. Export: `screenUrl()`. Gör **screening** (billig fetch + DOM-analys), INTE discovery. ⚠️ **Matchar INTE canonical C1** (det gör C0). Matchar **canonical C2** (Grov HTML-screening). Körs före C2. |
| **C2** (`C2-htmlGate/`) | ✓ Ja | ✓ Ja | ✗ Nej | ✓ Ja | **Current Implementation** | Används i alla run-batch-*.ts script. Export: `evaluateHtmlGate()`. Weighted scoring + candidate quality. Gör routingbeslut: promising/maybe/unclear/low_value. |
| **C3** (`C3-aiExtractGate/`) | ✓ Ja | ⚠️ Endast fallback | ✗ Nej | ✓ Ja | **Partial Implementation** | Körs ENBART när C2=promising MEN extractFromHtml()=0 events. Är INTE "första HTML-extraktionssteget" som canonical modell säger — `extractFromHtml()` från `F-eventExtraction/extractor.ts` är faktiskt första extraktionssteget. |
| **C4-AI** (`C3-aiExtractGate` alias) | ✓ Ja | ✓ Ja (run-dynamic-pool) | ✗ Nej | ✓ Ja | **IMPLEMENTED_EARLY_VERSION — INTE FULLSTÄNDIG** | I `run-dynamic-pool.ts` anropas `runC4Analysis()` efter varje round. Skriver c4-ai-analysis-round-X.md. C4-AI ger: likelyCategory, nextQueue, improvementSignals, suggestedRules, confidenceBreakdown. Pilotfall: bk-hacken, blekholmen. **Gap:** suggestedRules kopplade inte ännu till C1/C2/C3. C4-AI route:ar sources men påverkar inte C1/C2/C3 förändring. |
| **extractFromHtml()** | ✓ Ja | ✓ Ja | ✓ Ja | ✓ Ja | **Canonical Extraction** | Finns i `F-eventExtraction/extractor.ts`. Är den verkliga första HTML-extraktionssteget. Returnerar `{eventsFound, ...}`. |
| **batch-state.jsonl** | ✓ Ja | ⚠️ Delvis (ny modell) | ✗ Nej | ✓ Ja | **Under utveckling** | Används av `run-dynamic-pool.ts` för pool-state. `currentBatch=13, status=pending`. State-persistens mellan sessioner behöver förbättras (run-dynamic-pool.ts skriver inte tillbaka efter körning ännu). |
|| **run-dynamic-pool.ts** | ✓ Ja | ✓ Ja (ny) | ✗ Nej | ✓ Ja | **AKTIV EXPERIMENTELL RUNNER / NOT CANONICAL YET** | Ny primär kandidat för C-testRiggen (2026-04-11). Implementerar dynamisk testpool med refill från postB-preC. C4-AI är nu inkopplad (IMPLEMENTED_EARLY_VERSION). Full pipeline: Batch 10 → C1 → C2 → C3 → C4-AI → routing (C1 retry / D / discard). failCategory + routing är experimental. Körde batch-13: 14 sources × 3 rounds. State-persistens mellan sessioner behöver förbättras. Får INTE beskrivas som "canonical" förrän verifierad. |
| **run-batch-001.ts – run-batch-010.ts** | ✓ Ja (10 st) | ✗ Nej (engångs) | ✗ Nej | ✓ Ja | **Legacy baseline batch** | Engångs test-script med hardkodade sourcelistor. Ingen follow-loop. Ingen förbättringscykel. `cyclesCompleted=0` i batch-state visar att förbättringsloopen aldrig kördes. |
| **Improvements-bank** | ✓ Ja | ✗ Nej | ✗ Nej | ✓ Ja | **Planerad/Dokumenterad** | `reports/improvements-bank.jsonl` + `reports/IMPROVEMENTS-BANK.md` finns. Dokumenterar struktur för generella förbättringar. Används ej aktivt. |
| **batch-001/2/3 rapporter** | ✓ Ja | ✗ Nej | ✗ Nej | ✓ Ja | **Historik** | Reports/batch-{N}/ finns med baseline-resultat och summary. Är dokumentation av körda tester, inte aktiv pipeline. |

---

## C-Pipeline Jämförelse: Canonical vs Verklig

| Stage | Canonical definition (`C-testRig1-2-3loop.md`) | Verklig implementation | Match? |
|-------|----------------------------------------------|----------------------|--------|
| **C1** | Discovery / Frontier: hitta candidate pages, mät density, välj bästa | `discoverEventCandidates()` i `C0-htmlFrontierDiscovery/` + `screenUrl()` i C1-preHtmlGate | ⚠️ Delvis — C0 och C1 överlappar |
| **C2** | Grov HTML-screening + routing-signal (routear till A/B/D) | `evaluateHtmlGate()` i `C2-htmlGate/` med weighted scoring | ✓ Match |
| **C3** | Första HTML-extraktionssteget (icke-AI) | `extractFromHtml()` i `F-eventExtraction/extractor.ts` | ✗ **Mismatch** — C3 är AI-fallback, inte första extraktion |
| **C4-AI** | Separat AI-analys post-C, endast på fail-fall | `C3-aiExtractGate.ts` (körs endast när C2=promising men extract=0) | ⚠️ Delvis match |
| **Loop-cykler** | Max 3 förbättringscykler med mätning | Aldrig körda (`cyclesCompleted=0`) | ✗ **Mismatch** |

---

## Batch-artefakter: Legacy vs Aktiv

| Artefakt | Typ | Status | Åtgärd |
|----------|-----|--------|--------|
| `batch-state.jsonl` | Runtime-state | **Legacy/historisk** | Läs innehållet endast för att förstå att batchen är `completed` — aktiv styrning saknas |
| `run-batch-001.ts` – `run-batch-010.ts` | Engångsscript | **Legacy baseline batch** | Kördes för att testa batchmetod. Ingen förbättringsloop. Ingen återanvändning. |
| `reports/batch-001/` etc. | Rapportshistorik | **Historik** | Dokumentation av genomförda tester, ej aktiv pipeline |
| `preRunResults: null` | Batch-state fält | **Död data** | Visar att batch-scripten aldrig populerade detta fält |
| `postRunResults: null` | Batch-state fält | **Död data** | Visar att förbättringsloopen aldrig kördes |
| `cyclesCompleted: 0` | Batch-state fält | **Död data** | Bekräftar att inga förbättringscykler genomförts |

---

## Dokument som behöver uppdatering

| Dokument | Nuvarande problem | Rekommendation |
|----------|-------------------|----------------|
| `C-htmlGate.md` | Beskriver "two-step pipeline" (C1/C2) — obsolet | Uppdatera till C0→C1→C2→C3 pipeline |
| `C1-preHtmlGate.md` | Refererar till "C0→C1→C2→extract" - äldre terminologi | Synkronisera med canonical namn |
| `123.md` | Mycket lång, definerar tre parallella sanningar | Behåll som workflow-styrning, uppdatera Steg 6 med rapporteringsreferens till C-testRig-reporting.md |
| `C-BATCH-INFRASTRUCTURE.md` | Beskriver batch-loop som om den körs | Markera som legacy/dokumentation |

**Ny fil tillagd:**
| `C-testRig-reporting.md` | Helt ny — saknades helt | Auktoritativ rapporteringsspecifikation med fyra obligatoriska rapportlager |

---

## Rekommenderad canonical modell (från `C-testRig1-2-3loop.md`)

```
postB-preC
    ↓
C1 (Discovery/Frontier) → interna links, density, välj candidate
    ↓
C2 (HTML-screening) → routing-signal till A/B/D, fortsätt till C3
    ↓
C3 (HTML-extraktion, icke-AI) → extractFromHtml() — faktiskt första extraktionssteget
    ↓
Om fail → C4-AI (AI-analys post-C, endast på fail-fall)
    ↓
postTestC-UI / postTestC-A / postTestC-B / postTestC-D
```

**Observera:** I nuvarande implementation är `extractFromHtml()` från `F-eventExtraction/extractor.ts` faktiskt det som körs som "C3" (extraktion), medan `C3-aiExtractGate.ts` är en AI-fallback som bara triggas när C2=promising men extract=0.

---

## Status-förklaring

| Status | Betydelse |
|--------|-----------|
| **Canonical** | Målmodellen beskriven i `C-testRig1-2-3loop.md` |
| **Current Implementation** | Finns i kod och används i batch-körning |
| **Legacy** | Äldre terminologi/arkitektur, delvis ersatt |
| **Planned** | Dokumenterat men ej implementerat |
| **Död data** | Fält som har värde men aldrig populerades aktivt |

---

## Slutsats

Den nuvarande implementationen kör **C0→C1→C2→extractFromHtml()** med **C3-aiExtractGate som fallback**. Den planerade förbättringsloopen (3 cykler med mätning) **har aldrig körts** (`cyclesCompleted=0`). Batch-scripten är **engångs-test-script**, inte en aktiv batch-loop. Den canonicala modellen (C1/C2/C3/C4-AI) är **dokumenterad men ej fullt implementerad**.