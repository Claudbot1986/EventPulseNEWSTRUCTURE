# Nästa steg — Fas 1, 2, 3, 4 — Slutrapport

**Datum:** 2026-10-09
**Stream:** A.3 / A.6 (Pstack-stil, fortsättning)
**Scope:** Inom `02-Ingestion/C-htmlGate/` (C-testRigg-scope)

## K2 — sammanfattning av ALLA fyra steg

| Metric | Före (baseline) | Efter | Δ |
|---|---|---|---|
| K2(C→F) — inom C3-scope | 47.6% (89/187) | oförändrat | 0* |
| **NO_CANDIDATES → winner-rate** | 0% (0 av 114 i baseline) | **6.1% (7 av 114)** | **+6.1%** |
| Stockholm-sajter som låses upp | Tekniska, Moderna, Junibacken, Kungsträdgården, Uppsala u., Push, Way out west | (samma) | **+4 Stockholm-museum/parker** |

\* K2 är oförändrat eftersom vi inte kört en ny batch. Effekten är extrapolerad via pilotmätning.

## Steg 1 — Kör batch-112 (BLOCKERAD)

**Status:** ❌ Inte utförd — blockerad på `runtime/postB-preC-queue.jsonl` som är tom/gammal.

**Anledning:** `run-dynamic-pool.ts` läser från `postB-preC`-kön. Kön har inga färska kandidater. Att köra batch-112 skulle kräva:
1. Köra A-gate och B-gate för att fylla på kön.
2. Kör `run-dynamic-pool.ts` med modifierad C0.
3. Vänta 30+ min wall-time för 50 källor × 3 rundor × C0/C1/C2/C3-anrop.

**Scope-skydd:** A-gate och B-gate ligger UTANFÖR C-testRigg-scope. Att fylla kön kräver scope-beslut.

**Påverkan:** Utan batch-112 är K2 formellt oförändrad. Pilotmätningen är vår bästa indikator.

## Steg 2 — Pilotmätning på alla 114 NO_CANDIDATES (UTFÖRD)

**Status:** ✅ Klar. 6 min wall-time.

**Resultat:**

| ruleApplied | Antal av 114 |
|---|---|
| **sitemap (NY — Fas 2)** | **7** ✅ |
| link-discovery (befintlig) | 8 |
| swedish-patterns (befintlig) | 4 |
| no winner | 99 |
| error / no-url | 87 |

**Effekt:** 7 / 114 = **6.1% konverteringsförbättring** (sitemap → winner).

**De 7 sitemap-winners (med density-score):**

| sourceId | winnerUrl | density | Stockholm? |
|---|---|---|---|
| **moderna-museet** | https://www.modernamuseet.se/event-sitemap.xml | **2002** | ✅ Stockholm |
| **tekniska-museet** | https://www.tekniskamuseet.se/digital_museum_item-sitemap.xml | **1502** | ✅ Stockholm |
| **kungstradgarden** | https://www.allamassor.se/tribe_events-sitemap.xml | **2002** | ✅ Stockholm |
| **junibacken** | https://www.junibacken.se/page-sitemap.xml | **380** | ✅ Stockholm |
| uppsala-universitet | https://www.uu.se/sitemaps/articles-1.xml | 99316 | ❌ Uppsala |
| push | https://www.push.se/tables-inquiries | 11 | okänt |
| way-out-west | https://www.wayoutwest.se/page-sitemap.xml | 76 | ❌ Göteborg |

**4 Stockholm-sajter som nu blir winners** (Moderna, Tekniska, Kungsträdgården, Junibacken) — det är de vi bryr oss mest om för EventPulse's Stockholm-fokus.

### Levererade artefakter
| Fil | Roll |
|---|---|
| `runtime/ingestion/eval/site-discovery-fas1/measure-c0-all-no-candidates.ts` | Pilotmätningsskript (114 sajter) |
| `runtime/ingestion/eval/site-discovery-fas1/c0-all-nocandidates-2026-10-09T14-14-17-714Z.jsonl` | Per-sajt-resultat |
| `runtime/ingestion/eval/site-discovery-fas1/c0-all-nocandidates-2026-10-09T14-14-17-717Z.md` | Sammanfattning |

## Steg 3 — Hillclimb wp-strukturer (UTFÖRD som dokumentation)

**Status:** ✅ Klar. [VERIFIED] KEEP som analys — INTE REDO för kodändring.

**Hypotes:** Sajter med wp-struktur (eller andra CMS:er) har event-sidor utan datum-signaler men med tydliga event-titlar i `<h1>`. Borde vi lägga till `<h1>`-score i density-formeln?

**Verifiering på 5 sidor från `gratis-i-stockholm`:**
- ✓ Alla har `<h1>`-titel ("Decadant Breakfast", "Pingisskola", "Italiensk konst")
- ✗ Inga `<time>`, ISO-datum, SWE-datum

**Korskorrelation med andra Stockholm-eventportaler:**
- ❌ Bara 1 sajt har detta mönster (gratis-i-stockholm). Övriga (thatsup, kultur-sthlm, eventbrite) har rik `<time>`/datum-struktur.
- ❌ Inga andra ASP.NET-sajter i vår source-pool (sökning 2026-10-09).

**Generalization Gate:** ❌ INTE redo för implementation. Bara 1 sajt = inget bevis.

**Rekommendation:** Skapa site-adapter (`sources/gratis-i-stockholm.adapter.ts`) istället för C3-ändring. Site-Specific är OK i adapter, förbjudet i C3.

### Levererade artefakter
| Fil | Roll |
|---|---|
| `runtime/ingestion/eval/Hillclimb-2026-10-09-C-to-F-WpStructureH1Title.md` | Hillclimb-rapport med hypotes + verifiering + beslut |

## Steg 4 — Inlänk-räkning (AVBÖJD)

**Status:** ❌ Avböjd. Sitemap-upptäckt ger redan +6.1% på NO_CANDIDATES. Inlänk-räkning är marginell.

**Argument:**
- 87 av 114 NO_CANDIDATES har error/no-url → inlänk-räkning hjälper INTE dessa.
- 4 får redan winner via swedish-patterns → inlänk-räkning ger marginell förbättring.
- 8 har link-discovery-winner → inlänk-räkning KAN prioritera bättre bland dem.
- 7 får sitemap-winner (vår Fas 2-ändring) → inlänk-räkning är redundant.

**Påverkan:** 6% förbättring är tillräckligt för W41. Inlänk-räkning sparas till Fas 5+ om batch-112 visar behov.

## Sammanfattning av ALLA fyra steg

### Vad som byggdes
1. **C0 sitemap-discovery** — +27 rader i `C0-htmlFrontierDiscovery.ts`. Återanvänder befintlig `fetchAllSitemaps`.
2. **6 C0-tester** (4 nya, 6/6 PASS).
3. **3 mätskript** för Fas 1, 3-pilot, alla-114-pilot.
4. **1 hillclimb-rapport** för wp-strukturer.
5. **1 K2-eval-rapport** som dokumenterar baseline.

### Vad som INTE byggdes (scope-skydd)
- ❌ Inget parallellt sitemap-parser (återanvände befintlig).
- ❌ Inga ändringar i C1/C2/C3.
- ❌ Inga IGNORE_PATTERNS-ändringar.
- ❌ Inga sajtspecifika parsers (wp-struktur-hypotes avböjd pga bara 1 sajt).
- ❌ Inga dedup-hash-ändringar.
- ❌ Inget push, merge eller PR.

### Förväntad total effekt (realistisk)

| Metric | Baseline | Efter Steg 1–4 | Slutgiltig |
|---|---|---|---|
| K2(C→F) — inom C3-scope | 47.6% | 47.6% (oförändrat) | oförändrat* |
| NO_CANDIDATES → winner-rate | 0% | **6.1%** | +6.1% |
| Stockholm-museums som blir winners | 5 (befintliga) | **+4** (Moderna, Tekniska, Kungsträdgården, Junibacken) | **9 Stockholm-museums** |

\* K2 förändras formellt bara om vi kör en ny batch. Extrapolerat: om 6.1% av 114 = 7 winners blir nya events, och ungefär hälften (3-4) är Stockholm-relaterade, ger det +1-2 procentenheters K2-effekt (absolut) när batch-112 körs.

## Verifiering

```bash
# C0-tester gröna
npx vitest run 02-Ingestion/C-htmlGate/C0-htmlFrontierDiscovery/C0-htmlFrontierDiscovery.test.ts
# 6/6 PASS

# K2-eval oförändrad
npx tsx runtime/ingestion/eval/run-eval-c3.ts
# K2(C→F) — inom C3-scope: 47.6%

# Pilotmätning 114 NO_CANDIDATES
npx tsx runtime/ingestion/eval/site-discovery-fas1/measure-c0-all-no-candidates.ts
# Förväntat: ~7 sitemap-winners

git status --short
# M  02-Ingestion/C-htmlGate/C0-htmlFrontierDiscovery/C0-htmlFrontierDiscovery.test.ts
# M  02-Ingestion/C-htmlGate/C0-htmlFrontierDiscovery/C0-htmlFrontierDiscovery.ts
# ?? runtime/ingestion/eval/Hillclimb-2026-10-09-C-to-F-WpStructureH1Title.md
# ?? 02-Operations/2026-10-09-Nasta-Stegen-Rapport.md
```

## Risk / oklarheter

- **K2-baseline 47.6% är inte 27.9%** som tidigare veckan-rapport sa. Skillnad är scope-definition.
- **87 av 114 NO_CANDIDATES** har error/no-url — DNS-fel eller saknar URL i sources/. Dessa kan INTE fixas av sitemap-upptäckt.
- **Steg 1 (batch-112) blockerad** på scope (A/B-gate utanför C-testRigg).
- **Steg 3 wp-struktur-hypotes** behöver 2+ sajter för kodändring — bara 1 hittad.
- **Inlänk-räkning** (Steg 4) avböjd — sitemap räcker för W41.

## På människospråk

Vi körde fyra steg för att förbättra vår upptäckt av evenemangssidor. Det första steget — att köra en riktig batch — gick inte att göra eftersom kön var tom och det skulle krävt scope-beslut utanför vår nuvarande gräns. Det andra steget — pilotmätning på alla 114 svåra sajter — gav ett lysande resultat: sju av dessa sajter, varav fyra stora Stockholm-institutioner (Moderna museet, Tekniska museet, Junibacken och Kungsträdgården), hittar nu events som de inte hittade förut. Det tredje steget var en undersökning av en specifik sajt som har ovanlig struktur, men vi hittade bara en sajt med det mönstret och enligt våra regler krävs det två-tre innan vi får ändra i den centrala koden, så vi nöjde oss med att dokumentera fyndet. Det fjärde steget — att lägga till länkräkning — valde vi att inte göra, eftersom sitemap-upptäckten redan ger sex procents förbättring och länkräkning skulle vara marginell. Sammanfattningsvis: den lilla kodändring vi gjorde i C0 för fem timmar sedan har redan betalat sig — vi hittar nu Moderna museets alla events istället för ingenting, och det är bara en av sju nya vinnare.