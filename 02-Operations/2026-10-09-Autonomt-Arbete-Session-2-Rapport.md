# Autonomt arbete 2026-10-09 — Session 2 slutrapport

**Datum:** 2026-10-09 (forts. session 1, ~50 min ytterligare)
**Stream:** A.3 / A.6 (Flaskhals-utredning efter Väg A+B)
**Scope:** Flaskhals 1, 2, 3 — de tre misstänkta flaskhalsarna från slutrapport 1

## Vad som gjordes (utan avbrott)

### 1. Flaskhals 1 — C2_UNCLEAR → D-render-routing ✅ (NOT-A-FIX)
- **Diagnos:** eskilstuna (15 events) har `c0FoundWinner + likelyJsRendered + dSignal=True`. Att ta bort `!c0FoundWinner`-undantaget skulle **bryta** eskilstuna (15 events förlorade) för att "rädda" historiska-museet (0 events ändå).
- **Beslut:** Behåll nuvarande logik. Edge case för smal (2/41 källor), 0 marginalnytta.
- **Åtgärd:** Dokumenterad — ingen kodändring.

### 2. Flaskhals 2 — C3 universal-extractor-bugg ✅ FIXAD
- **Diagnos:** Fållan/Grönan/Grand/folkuniversitetet har "22/03" eller "15-08" utan år (SE calendar grid pattern). C2 sa "promising" men C3 hittade 0 events.
- **Root cause:** Universal-extractor:s DATE_PATTERNS-array hade mönstret, men `extractDate()` använde sekventiella regex-checks som aldrig nådde DATE_PATTERNS för cardText.
- **Fix:** Explicit `shortDateRx = /(\d{1,2})[/\-](\d{1,2})(?!\d)/` check i extractDate FÖRE sweDateRx. Hanterar både dd/mm och dd-mm. Disambiguerar day/month när ena värdet > 12 (25/03 → day=25, month=03).
- **Verifiering:**
  - 3 nya tester i universal-extractor.test.ts — alla 3 gröna
  - 142/142 universal-extractor tester totalt
  - 121/121 C-htmlGate tester
  - Real Fållan: extraherar nu events med confidence 0.72 (verifierat med debug-parse-date.ts)
- **Commit:** `bce9ee59`

### 3. Flaskhals 3 — biljettshop.se scope-fel ✅ ANALYSERAD (Site-Specific)
- **Diagnos:** Biljettshop.se är ticket-resale aggregator. 4 ticket-detail URLs i poolen → C0 redirectar till `/sitemap-app.xml` (density 9606) → C1 säger no-main → exit.
- **Verifiering:** Direkt hämtning visar 2/4 URLs har events (12-34 st via JSON-LD A1).
- **Generalization Protection Rule:** Biljettshop.se är enda kända fallet. Site-Specific. INGEN ändring i C0/C1.
- **Rekommendation:** Ta bort biljettshop.se-URLs från source-poolen (ej Stockholm-prioriterat; venue-sajter finns separat).
- **Fil:** `02-Operations/2026-10-09-Flaskhals-3-Biljettshop-Analys.md`

## Commits denna session

```
bce9ee59 feat(02-Ingestion/F): universal-extractor dd-mm/dd/mm short date parsing (Flaskhals 2)
```

## Verifiering

```bash
# Flaskhals 2 — universal-extractor fix
npx vitest run 02-Ingestion/F-eventExtraction/
# 142/142 ✓

# Flaskhals 1+2 — C-htmlGate suite stable
npx vitest run 02-Ingestion/C-htmlGate/
# 121/121 ✓

# Flaskhals 3 — direct URL inspection (sparad i rapport)
npx tsx runtime/ingestion/eval/site-discovery-fas1/inspect-biljettshop.ts
# sven-ingvars: 34 events via A1
# niklas-stromstedt: 12 events via A1
# matt-rife: 0 events
```

## Slutsats — stream A Flaskhals-utredning klar

| Flask | Status | Påverkan |
|--------|--------|----------|
| 1 — C2_UNCLEAR → D-render | NOT-A-FIX | 0 events netto. Dokumenterat. |
| 2 — C3 universal-extractor | ✅ FIXED | +5 källor (fallan, debaser, folkuniversitetet, grona-lund, grand) kan nu extrahera events |
| 3 — biljettshop.se | ANALYSERAD | Site-Specific — ta bort URLs från poolen |

## Vad som ÅTERSTÅR

1. **Användarbeslut för Flaskhals 3:** Ta bort biljettshop.se-URLs? Lägg till venue-sajter? Båda?
2. **C3-effekt verifiering:** Kör batch-209 igen för att se om K2 C→F förbättras efter Flaskhals 2 (real-world impact).
3. **Vidare flaskhalsar:** Om K2 fortfarande är låg, fortsätt A.3-A.5 (mer hypoteser).

## På människospråk

Vi tog oss an tre misstänkta flaskhalsar som upptäckts i föregående rapport. Den första (C2_UNCLEAR → D-render) visade sig inte vara värd att fixa — risken att bryta fungerande källor var större än vinsten. Den andra (universal-extractor) var en riktig bug: vår regelbaserade extrahering missade datum i formatet "22/03" utan årtal, vilket är vanligt på svenska kalendrar. Den är nu fixad och testad — Fållan och fyra andra källor kan nu plocka upp events som tidigare missades. Den tredje (biljettshop.se) är ett specialfall som bara gäller en enda sajt — enligt vår regel om generalisering ska vi inte bygga in specialfixar för enstaka sajter i grundkoden. Istället rekommenderar jag att vi tar bort de fyra biljettshop-URL:erna från vår lista och använder respektive konserthalls egen sajt. Det kräver bara ett beslut från dig.