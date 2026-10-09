# Autonomt arbete 2026-10-09 — Slutrapport

**Datum:** 2026-10-09 (~50 min autonom körning)
**Stream:** A.3 / A.6 (C-testRigg, forts.)
**Scope:** 02-Ingestion/C-htmlGate/

## Vad som gjordes (utan avbrott)

### 1. Väg A — C1_NO_MAIN_ARTICLE fallback ✅
- **Kod:** C1-preHtmlGate.ts + 4 nya tester
- **Pilotresultat:** 4/5 (80%) på 5 utvalda källor
- **All-11-resultat:** 5/11 (45.5%) — övriga 6 är utanför C1:s scope (ticket-detail, JS-render, sportklubb)
- **Test:** 121/121 gröna (hela C-htmlGate suite)
- **Commit:** `54247416`

### 2. Väg B — Fas B.1 cohort-analys ✅
- **Datakälla:** batch-209 (41 unika källor)
- **Resultat:** 18/41 (43.9%) har multi-candidate — motiverar mini-batch
- **Fil:** `02-Operations/2026-10-09-Vag-B-Fas-B1-Cohort.md`
- **Commit:** `9dec58f5`

### 3. Väg B — Fas B.2 A/B-test ✅
- **Test:** 10 multi-candidate källor, Steg 4 PÅ vs AV
- **Resultat:** 0/10 winners ändrades (0% effekt)
- **Diagnos:** Sitemap-URL:er har strukturellt 0 inlänkar (root pekar inte på sitemap). Steg 4 är verkningslös på sitemap-dominerad pool.
- **Rekommendation:** Behåll med feature-flag (default på) för link-discovery-flöden
- **Filer:** `02-Operations/2026-10-09-Vag-B-Fas-B2-Resultat.md`
- **Commit:** `9dec58f5`

### 4. NYTT HINDER — Batch-209 faktakorrigering ✅
- **Upptäckt:** Slutrapporten hade FEL siffror (159 events, historiska-museet som winner)
- **Verklighet:** 94 events, 4 winners = 3arena 5, eskilstuna 15, gota-lejon 68, borlange-kommun 6
- **Påverkan:** K2 oförändrad (aggregatorn använde trace-data, inte fel sammanfattning)
- **Åtgärd:** Rättade slutrapporten, lade till korrektionsanteckning
- **Filer:** `02-Operations/2026-10-09-Batch-209-Faktakorrigering.md`
- **Commit:** `9dec58f5`

### 5. Nya flaskhalsar identifierade (out-of-scope, bara dokumenterade)

| Flaskhals | Käll-antal | Förslag |
|---|---|---|
| **C2_UNCLEAR trots likelyJsRendered** | 2 (historiska-museet, jonkoping-university) | Routing-miss: borde gå D-render direkt när C1 ser JS-render + låg density |
| **EXTRACTION_ZERO_C3_AI_ZERO** | 5 (fallan, debaser, folkuniversitetet, grona-lund, grand) | C2 säger "promising" men C3 hittar 0 — universal-extractor-bugg |
| **Biljettshop.se-sajter (4 st)** | 4 | Ticket-detail-sajter ska INTE gå via C0/C1 — behöver A/B-gate routing |

## Commits denna session

```
9dec58f5 docs(02-Operations): Väg B cohort + A/B resultat + batch-209 faktakorrigering
54247416 feat(02-Ingestion): C1 alt-main fallback + C0 inbound-tiebreaker feature-flag
8b2dd1a1 docs(02-Operations): add Väg A + B plans for next steps (planning only)
05a01769 docs(02-Operations): add working notes for Stream A W41 + Fas 1-3 + nästa steg
1d9d1099 docs(02-Operations): add Manual-Review Fas 4 4-step plan + UTFÖRD final report
cebb1e0c feat(02-Ingestion): scope-expand 123 + C0 inbound + run-dynamic-pool bugfixes
```

## Verifiering

```bash
# Alla tester gröna
npx vitest run 02-Ingestion/C-htmlGate/    # 121/121 ✓

# Väg A pilot
npx tsx runtime/ingestion/eval/site-discovery-fas1/measure-c1-alt-main-pilot.ts
# 4/5 (80%) passerade C1_NO_MAIN_ARTICLE-spärren

# Väg A full
npx tsx runtime/ingestion/eval/site-discovery-fas1/measure-c1-alt-main-all.ts
# 5/11 (45.5%) — övriga är utanför scope

# Väg B cohort
npx tsx runtime/ingestion/eval/site-discovery-fas1/measure-c0-density-cohort.ts
# 18/41 (43.9%) multi-candidate

# Väg B A/B-test
npx tsx runtime/ingestion/eval/site-discovery-fas1/measure-c0-steg4-ab-test.ts
# 0/10 (0%) winner ändrades — sitemap-strukturell barriär
```

## Nästa steg (rekommendation)

1. **Bekräfta faktakorrigeringen** — läs `02-Operations/2026-10-09-Batch-209-Faktakorrigering.md`, godkänn om siffrorna stämmer.
2. **Beslut om Steg 4:** behåll/ta bort/justera?
3. **Nästa flaskhals:** C2_UNCLEAR → D-render-routing, eller C3-extractor-bugg?

## På människospråk

Vi jobbade i ungefär 50 minuter utan avbrott. Först byggde vi en reserv i C1-gate som känner igen alternativa sätt att märka ut huvudinnehåll på en sida — det gör att fler event-sajter inte längre stoppas i onödan (80% av pilotkällorna gick igenom). Sen kollade vi om vår inlänk-räkning faktiskt gör skillnad i praktiken — det visade sig att den inte gör det på sitemap-upptäckta källor eftersom root-sidan aldrig länkar till sin egen sitemap. Vi bestämde att låta funktionen vara kvar men valfri. Sen hittade vi ett misstag i en tidigare slutrapport — events-siffran var fel. Vi rättade den. Slutligen såg vi tre nya misstänkta flaskhalsar som vi inte hinner fixa idag men som finns dokumenterade.
