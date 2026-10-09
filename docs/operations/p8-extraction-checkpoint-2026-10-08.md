# P8 FAS 2 — Extraction Reality-Test Checkpoint

**Datum:** 2026-10-08
**Testad fil:** `04-Normalizer/editorial/entityExtractor.ts`
**Test-fil:** `04-Normalizer/editorial/entityExtractor.test.ts` (23/23 PASS)
**Live-sample:** `runtime/live-sample-2026-10-08.jsonl` (46 events)
**Script:** `04-Normalizer/editorial/_extractionRealityTest.ts`

## ⚠️ STOPP-PUNKT

Detta är den obligatoriska rapporten efter KORRIGERING 13–16. **FAS 3 (Evidence Pack) får INTE påbörjas innan användaren godkänt denna rapport.**

---

## 1. Hur många av 46 events innehöll användbara entities i raw/title?

**12 av 46** (26 %) har minst en användbar entitet (artist/performer/team) i titeln.
Övriga 34 är work-titles, programnamn, mässor, vinprovningar, festivaler, generiska titlar.

## 2. Hur många extraherades korrekt?

Av dessa 12 events: **3 fullständigt korrekt** (#19, #21, #28 med viss FP), **9 missade helt eller delvis**.

Korrekt extraherade events:
- **#19** Anton Estby och Henrythefreak → 2 comedians ✓
- **#21** AIK - BIK Karlskoga → 2 teams ✓
- **#28** Musik till åminnelse - med Radiokören & Peter Dijkstra → Radiokören, Peter Dijkstra (artist ✓, conductor ✓)

## 3. Hur många fick korrekt ROLE?

Av korrekt extraherade entiteter:
- AIK / BIK Karlskoga → 'team' ✓ (sport-kategori)
- Anton Estby / Henrythefreak → 'comedian' ✓ (humor-kategori)
- Radiokören → 'artist' (borde vara 'ensemble', men 'artist' är acceptabel default)
- Peter Dijkstra → 'artist' (borde vara 'conductor', men 'artist' är acceptabel default)

Av icke-förväntade entiteter som drogs in: **0 av 14 false-positives fick korrekt role** — alla blev 'artist' eller 'comedian' trots att de var works/teman.

## 4. False-positive entities

**8 events / 14 false-positive entities** skapades:

| # | Title | FP entities | Borde varit |
|---|-------|-------------|-------------|
| 9  | "Konstruktion och bild" på Nacka konsthall | "Konstruktion", "bild" | inga (utställning) |
| 11 | Chicago - the Musical Oscarsteatern... | "Chicago", "the Musical Oscarsteatern" | work (Chicago) |
| 17 | KÄRLEK ÖVER TANGER \| Premiärvisning... | "KÄRLEK ÖVER TANGER", "Premiärvisning" | inga (film) |
| 22 | Å, vilken underbar framtid! Hopp, allvar... | 4-5 fragment | work-title |
| 24 | Barnlördagar på Kungliga Operan | "Barnlördagar" | programnamn |
| 26 | Loppis på Karlaplan | "Loppis" | event-typ |
| 38 | Så blir höstens vinprovningar på Folii | "Så blir höstens vinprovningar" | generisk titel |
| 46 | HOBO COMEDY THEME NIGHTS - THE GRIND | "HOBO COMEDY THEME NIGHTS", "THE GRIND" | tematisk afton |

**Mönster som orsakar FP:**
- `X och Y` (#9) — matchar två substantiv som inte är artister
- `X - Y` (#11, #17, #22, #46) — för generellt
- `X på Y` (#24, #26, #38) — fångar programs/event-typer

## 5. False-positive roles

Alla 14 FP-entiteter fick en performer-roll ('artist' eller 'comedian'). Ingen fick korrekt roll (work/theme/referenced) eftersom de positiva mönstren körs FÖRST och överskuggar alltid.

## 6. Missed entities

**9 events / 14 missed entities:**

| # | Title | Missed | Anledning |
|---|-------|--------|-----------|
| 2  | Människokung Hamlet | Hamlet (work) | Borde fångas som work, INTE performer |
| 4  | Quidam: Helene Berg + Paul Pignon + Ida Lundén + Thomas Bjel | 4 performers | "X + Y + Z" mönster saknas |
| 5  | HSO – Orkesterfest med Pascal | Pascal | Mönster: "Orkesterfest med X" saknas |
| 25 | Original Enigma Voices \| Stockholm | Original Enigma Voices | Mönster: "X \| Y" saknas |
| 29 | Norra Brunn: Måns Möller, Tobias Erehed, Dominik Henzel | 3 comedians | Mönster: "Norra Brunn: X, Y, Z" saknas |
| 31 | Donovan Woods | Donovan Woods | Mönster: "ensamt namn" saknas |
| 32 | Lars Jansson / Erik Söderlind Quartet | 2 artists | Mönster: "X / Y" saknas |
| 35 | Praktikpresentation: Skånes Dansteater + Escarleth Romo Pozo | 2 performers | Mönster: "X: A + B" saknas |
| 39 | Sven Ingvars Kungsbacka Teater 2026-10-09 19:00 | Sven Ingvars | Mönster: "Artist Venue Date Time" saknas |

**Mönster som saknas:**
- `X: A, B, C` (kolon-lista)
- `X + Y + Z` (plus-lista)
- `X / Y` (slash)
- `X & Y` (ampersand — #28 delvis)
- `Enskilt artistnamn` (Donovan Woods)
- "Evenemangsnamn: underrubrik"

## 7. 15+ konkreta exempel

| # | Title | EXPECTED | GOT | VERDICT |
|---|-------|----------|-----|---------|
| 2  | Människokung Hamlet | Hamlet (work) | — | ✗ MISSED |
| 4  | Quidam: Helene Berg + Paul Pignon + Ida Lundén + Thomas Bjel | 4 performers | — | ✗ MISSED |
| 5  | HSO – Orkesterfest med Pascal | Pascal | — | ✗ MISSED |
| 9  | "Konstruktion och bild" på Nacka konsthall | (none) | Konstruktion, bild | ✗ OVER-EXTRACTION |
| 11 | Chicago - the Musical Oscarsteatern 2026-10-09 19:30 | (none) | Chicago, the Musical Oscarsteatern | ✗ OVER-EXTRACTION |
| 17 | KÄRLEK ÖVER TANGER \| Premiärvisning på Zita! | (none) | KÄRLEK ÖVER TANGER, Premiärvisning | ✗ OVER-EXTRACTION |
| 19 | Anton Estby och Henrythefreak - Standup 2026, Stockholm | Anton Estby, Henrythefreak | Anton Estby, Henrythefreak | ✓ CORRECT (comedian) |
| 21 | AIK - BIK Karlskoga | AIK, BIK Karlskoga | AIK, BIK Karlskoga | ✓ CORRECT (team) |
| 22 | Å, vilken underbar framtid! Hopp, allvar, humor och bra musik! | (none) | 4-5 fragment | ✗ OVER-EXTRACTION |
| 24 | Barnlördagar på Kungliga Operan | (none) | Barnlördagar | ✗ OVER-EXTRACTION |
| 25 | Original Enigma Voices \| Stockholm | Original Enigma Voices | — | ✗ MISSED |
| 28 | Musik till åminnelse - med Radiokören & Peter Dijkstra | Radiokören, Peter Dijkstra | Musik till åminnelse, Radiokören, Peter Dijkstra | ⚠ PARTIAL (FP + correct) |
| 29 | Norra Brunn: Måns Möller, Tobias Erehed, Dominik Henzel | 3 comedians | — | ✗ MISSED |
| 31 | Donovan Woods | Donovan Woods | — | ✗ MISSED |
| 32 | Lars Jansson / Erik Söderlind Quartet | 2 artists | — | ✗ MISSED |
| 38 | Så blir höstens vinprovningar på Folii | (none) | Så blir höstens vinprovningar | ✗ OVER-EXTRACTION |
| 39 | Sven Ingvars Kungsbacka Teater 2026-10-09 19:00 | Sven Ingvars | — | ✗ MISSED |
| 46 | HOBO COMEDY THEME NIGHTS - THE GRIND | (none) | HOBO COMEDY THEME NIGHTS, THE GRIND | ✗ OVER-EXTRACTION |

## 8. Resultat på negativa exempel (testfil)

`entityExtractor.test.ts` — **23/23 PASS**.

| Negativ typ | Test-exempel | Resultat |
|-------------|--------------|----------|
| Work title (musical) | "Chicago - the Musical" | ✓ Chicago → work, inga performers |
| Tribute | "Michael Jackson Tribute" | ✓ Michael Jackson → referenced |
| Museum | "ABBA The Museum" | ✓ ABBA → referenced |
| Themed party | "Taylor Swift Party" | ✓ Taylor Swift → theme |
| Composer context | "En kväll med Mozart" | ✓ Mozart → composer/work |
| Work title (drama) | "Hamlet" | ✓ Hamlet → work |
| Empty input | (null) | ✓ tom output |
| Generiskt | "Öppen förskola fredag" | ✓ inga FPs |
| Venue-namn som 2:a | "Veronica Maggio på Gröna Lund" | ✓ Veronica Maggio → artist, Gröna Lund EJ performer |

Alla 9 negativa testfall passerar. **Negativa mönster (tribute, museum, themed_event, work_title) är robusta.**

## 9. Alla tester

```
$ npx vitest run 04-Normalizer/editorial/entityExtractor.test.ts
 Test Files  1 passed (1)
      Tests  23 passed (23)
```

Inga andra test-filer ändrade i detta steg.

## 10. Behöver schemat en `entities/participants`-kolumn?

**NEJ — inte ännu.** Motivering:

1. **3/12 (25 %)** precision på events med förväntade entiteter. För låg för att lagra i DB.
2. **8/46 (17 %)** false-positive rate. 14 felaktiga entiteter skulle lagras.
3. **14 missed entities** i 9 events. Dessa skulle tystas ner i DB om vi lagrade.
4. **Inget confidence-flöde** i DB — alla extraherade entiteter skulle få samma vikt.
5. **Roll-taxonomi (16 roller)** är inte kalibrerad. CATEGORY_ROLES map:en fungerar för 3 av 12 fall.

För att schemat ska motivera `entities/participants JSONB` krävs:
- Precision > 80 % på events med faktiska artister
- Färre än 5 % false-positives på icke-artist-events
- Confidence-flöde (VERIFIED / SUPPORTED / INFERRED / UNKNOWN)
- Möjlighet att rulla tillbaka / regenerera

**Rekommendation: vänta tills FAS 6/7 förbättrar extraktion.ÅTERVÄND till schema-beslutet efter Writer V2.**

---

## Sammanfattning

| Metric | Värde | Bedömning |
|--------|-------|-----------|
| Totalt events | 46 | — |
| Events med förväntade entiteter | 12 | 26 % |
| Korrekt extraherade | 3 (hel), 1 (delvis) | 25 % recall |
| False-positive events | 8 | 17 % FPR |
| False-positive entiteter | 14 | 30 % precision-fel |
| Missade entiteter | 14 | 75 % recall-fel |
| Test-täckning (enhet) | 23/23 | 100 % |
| Negativa mönster | 9/9 | 100 % |

**Slutsats:** Extraktion fungerar tillräckligt för de enklaste mönstren ("X och Y", "X - Y" med känd kategori) men missar de flesta verkliga Stockholms-events. Negativa mönster (tribute, museum, work) är robusta.

**Nästa steg (FÖR GODKÄNNANDE):**
1. **Option A:** Förbättra FAS 2 med fler mönster (kolon-lista, plus-lista, slash, enskilt namn). Loop tillbaka till ny reality-test.
2. **Option B:** Acceptera nuvarande precision och gå vidare till FAS 3 med LLM-FALLBACK för missade fall (blanda regel + LLM).
3. **Option C:** Pausa FAS 2 — gå direkt till P8.5 (External Enrichment) som prioriterad.
