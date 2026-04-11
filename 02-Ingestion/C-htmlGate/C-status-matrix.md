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
| **Current implementation** | Det som faktiskt körs i batch-loop | Delvis implementerad (se nedan) |
| **Legacy baseline batch mode** | Äldre engångs batch-script som kördes för att testa | `run-batch-001.ts` – `run-batch-010.ts` |

---

## Komponent-status

| Komponent | Finns i kod? | Används i batch-loop? | Används i produktion? | Documenterad? | Status | Anteckningar |
|-----------|-------------|---------------------|----------------------|---------------|--------|--------------|
| **C0** (`C0-htmlFrontierDiscovery/`) | ✓ Ja | ⚠️ Delvis | ✗ Nej | ✓ Ja | **Legacy/Parallell** | Dokumentationen säger "C0 förekommer inte i målmodellen" (`C-testRig1-2-3loop.md` rad 19). I verklig körning används C0 som första steg (discoverEventCandidates). Call: `discoverEventCandidates()` → väljer bästa candidate från interna links. |
| **C1** (`C1-preHtmlGate/`) | ✓ Ja | ✓ Ja | ✗ Nej | ✓ Ja | **Current Implementation (⚠️ NAMNET ÄR VILSELEDANDE)** | Används i alla run-batch-*.ts script. Export: `screenUrl()`. Gör **screening** (billig fetch + DOM-analys), INTE discovery. ⚠️ **Matchar INTE canonical C1** (det gör C0). Matchar **canonical C2** (Grov HTML-screening). Körs före C2. |
| **C2** (`C2-htmlGate/`) | ✓ Ja | ✓ Ja | ✗ Nej | ✓ Ja | **Current Implementation** | Används i alla run-batch-*.ts script. Export: `evaluateHtmlGate()`. Weighted scoring + candidate quality. Gör routingbeslut: promising/maybe/unclear/low_value. |
| **C3** (`C3-aiExtractGate/`) | ✓ Ja | ⚠️ Endast fallback | ✗ Nej | ✓ Ja | **Partial Implementation** | Körs ENBART när C2=promising MEN extractFromHtml()=0 events. Är INTE "första HTML-extraktionssteget" som canonical modell säger — `extractFromHtml()` från `F-eventExtraction/extractor.ts` är faktiskt första extraktionssteget. |
| **C4-AI** (`C3-aiExtractGate` alias) | ✓ Ja | ✗ Nej | ✗ Nej | ✓ Ja | **Dokumenterad som alias** | I `123.md` rad 28 står: "C4-AI = '123-loopen' = samma koncept, olika terminologi." I praktiken körs C3-aiExtractGate inte i loop-format utan endast som engångs-AI-fallback. |
| **extractFromHtml()** | ✓ Ja | ✓ Ja | ✓ Ja | ✓ Ja | **Canonical Extraction** | Finns i `F-eventExtraction/extractor.ts`. Är den verkliga första HTML-extraktionssteget. Returnerar `{eventsFound, ...}`. |
| **batch-state.jsonl** | ✓ Ja | ⚠️ Endast läsning | ✗ Nej | ✓ Ja | **Legacy/halvfärdig** | Visar `status=completed`, `cyclesCompleted=0`, `preRunResults=null`, `postRunResults=null`. Dokumenterar batchens struktur men körs inte som aktiv styrning. |
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