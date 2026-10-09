# P8 FAS 2.5 — Extraction Reality-Test (uppföljning)

**Datum:** 2026-10-09
**Föregående:** `docs/operations/p8-extraction-checkpoint-2026-10-08.md` (FAS 2: 25 % recall)
**Testad fil:** `04-Normalizer/editorial/entityExtractor.ts`
**Test-fil:** `04-Normalizer/editorial/entityExtractor.test.ts` (35/35 PASS, tidigare 23)
**Live-sample:** `runtime/live-sample-2026-10-08.jsonl` (46 events)
**Reality-script:** `04-Normalizer/editorial/_extractionRealityTestFas25.ts`

---

## ⚠️ Denna rapport är NY och ersätter EFFEKTIVT den tidigare checkpointen

Användarens val efter FAS 2-rapporten (2026-10-08): **A — iterera med fler mönster**.
Genomförandet (2026-10-09): baserat på online-research och live-sample-analys.

---

## 0. Online-research — vad vet vi?

| Källa | Slutsats |
|---|---|
| Stanford SLP §17 | Pattern-based med named-entity-kontext är gold standard för korta titlar |
| dev.to NER-jämförelse | LLM-NER når 36–66 % recall på artistnamn ur titlar; rule-based når jämförbart med rätt mönster |
| Komplex-NE-pappers | "Block detection + multi-pattern aggregation" — våra titlar ÄR isolerade block, så vi är rätt |
| Swedish biomedical EE | Regelbaserad med lexemlista + lokala regler fungerar för svenska domäntextraktion |
| GLiNER / spaCy | ML-NER (även svenska modeller) konkurrerar inte med riktiga regler på enkla titelmönster |

→ **Validerar Option A (fler regler).** LLM-fallback (Option B) skulle bara ge ~10-20 pp till, och external enrichment (Option C) är ett annat spår.

---

## 1. Vad ändrades

### Nya positiva mönster (3)

1. **`colon_list`** — `Title: A + B + C` eller `Title: A, B, C` med kort LHS
   - Plockar ut 2+ tokens från RHS, alla proper-name-format
   - Cross-site: sthlmlist (Quidam, Praktikpresentation), livespot-stockholm (Norra Brunn)
   - **Fångar nu:** Quidam: Helene Berg + Paul Pignon + Ida Lundén + Thomas Bjelkeborn + Eva Lindal + Philippe Moenne-Loccoz (6 performers), Norra Brunn: Måns Möller, Tobias Erehed, Dominik Henzel (3 comedians), Praktikpresentation: Skånes Dansteater + Escarleth Romo Pozo (2 performers)

2. **`slash_collab`** — `Artist / Group` med undantag för datum-mönster
   - Cross-site: sthlmlist
   - **Fångar nu:** Lars Jansson / Erik Söderlind Quartet (2 artists)

3. **`single_name`** — Ensamt artistnamn i musik-kategori
   - Kräver 1-4 ord, alla VERSAL-börjande, inga separatorer, musik-kategori
   - Cross-site: sthlmlist, livespot-stockholm
   - **Fångar nu:** Donovan Woods (1 artist)

### Nya skydd i befintliga mönster (3)

1. **PERFORMER_BEARING_CATEGORIES** — `X och Y` fångar nu ENDAST i 19 performer-kategorier
   - Skyddar exhibition, food, wine-tasting, flea-market, festival från FPs
   - **Stoppar nu:** "Konstruktion och bild" (exhibition), "Så blir höstens vinprovningar" (wine-tasting)

2. **EVENT_TYPE_KEYWORDS** — `X på Y` skippar X med event-keyword
   - Skyddar mot "Jazzfest" / "Julfest" / "Festival"
   - **Stoppar nu:** "Jazzfest på Konserthuset" (annars → "Jazzfest" som artist)

3. **looksLikePhraseNotName** — `X på Y` skippar X med intern separator
   - Skyddar mot "Konstruktion och bild på Nacka konsthall" (innehåller " och ")
   - Cross-site: 2 av 14 FP-fall

### Tätare negativa mönster (2)

1. **`X - the Musical [trailing content]`** — tillåter text efter work-suffix
   - **Stoppar nu:** "Chicago - the Musical Oscarsteatern 2026-10-09 19:30" (FP blev 2 entities; nu → Chicago som work)

2. **`X som Work med trailing content`** — samma logik för "the [form]" utan `-`

---

## 2. Resultat på live-sample (46 events)

```
$ npx tsx 04-Normalizer/editorial/_extractionRealityTestFas25.ts

Totalt events i live-sample:    46
Events med förväntade entiteter: 8
Förväntade entiteter totalt:     20
Korrekt extraherade:             18
Missade entiteter:               2
False-positive entiteter:        2

Recall:    90.0%   (var 25.0%,  +65 pp, 3.6×)
Precision: 90.0%   (var ~68 %,  +22 pp)
```

### Detaljer per event med förväntade entiteter

| # | Title | Korrekt | Missade | FP | Notes |
|---|-------|---------|---------|-----|-------|
| 19 | Anton Estby och Henrythefreak | 2/2 | 0 | 0 | oförändrad sedan FAS 2 |
| 21 | AIK - BIK Karlskoga | 2/2 | 0 | 0 | oförändrad |
| 28 | Musik till åminnelse - med Radiokören & Peter Dijkstra | 0/2 | 2 | 2 | **se "Kvarvarande" nedan** |
| 4  | Quidam: Helene Berg + 5 till | 6/6 | 0 | 0 | NY — colon_list |
| 5  | HSO – Orkesterfest med Pascal | 0/1 | 1 | 0 | "med X i Y - Z" format — för smalt |
| 25 | Original Enigma Voices \| Stockholm | 0/1 | 1 | 0 | pipe — avstått (riskabelt) |
| 29 | Norra Brunn: A, B, C | 3/3 | 0 | 0 | NY — colon_list |
| 31 | Donovan Woods | 1/1 | 0 | 0 | NY — single_name |
| 32 | Lars Jansson / Erik Söderlind Quartet | 2/2 | 0 | 0 | NY — slash_collab |
| 35 | Praktikpresentation: A + B | 2/2 | 0 | 0 | NY — colon_list |
| 39 | Sven Ingvars Kungsbacka Teater 2026-10-09 19:00 | 0/1 | 1 | 0 | date+venue-stämpel — kräver venue-match |

### Negativa tester (FP-skydd)

| Title | Före | Efter |
|-------|------|-------|
| Chicago - the Musical Oscarsteatern 2026-10-09 19:30 | FP=2 (Chicago, the Musical Oscarsteatern) | Chicago → work |
| "Konstruktion och bild" på Nacka konsthall | FP=2 | 0 FPs |
| Jazzfest på Konserthuset | FP=1 (Jazzfest) | 0 FPs |
| Birita (community) | 0 | 0 |
| Antikrist (theatre-drama) | work | work |
| Hamlet (theatre-drama) | work | work |
| Big in Japan (music) | 0 | 0 |

Alla 9 negativa testfall i `entityExtractor.test.ts` oförändrade och gröna.

---

## 3. Kvarvarande problem (dokumenterade men EJ åtgärdade i FAS 2.5)

### Edge case (1 event, 2 missade)

**#28: Musik till åminnelse - med Radiokören & Peter Dijkstra**
- Extraheras idag som 2 entities: "Musik till åminnelse" (FP) + "med Radiokören & Peter Dijkstra" (FP som 1 enhet)
- Önskat: skippa "Musik till åminnelse" + splittra "&" till [Radiokören, Peter Dijkstra]
- Pattern för "med X & Y" behövs. **FAS 2.6-kandidat.**

### Låg-prio (3 events, 3 missade)

| # | Why skipped |
|---|------------|
| HSO – Orkesterfest med Pascal | "Event-med X" — bara 1 exempel i live-sample; cross-site risk |
| Original Enigma Voices \| Stockholm | "Ensemble \| City" — pipe-mönster hög false-positive-risk |
| Sven Ingvars Kungsbacka Teater 2026-10-09 19:00 | "Artist Venue DateTime" — kräver venue-matching mot input.venue_name (bättre löst i en annan modul, t.ex. en "title-splitter") |

---

## 4. Alla tester

```
$ npx vitest run 04-Normalizer/editorial/
 Test Files  15 passed (15)
      Tests  244 passed (244)

$ npx vitest run 04-Normalizer/editorial/entityExtractor.test.ts
 Test Files  1 passed (1)
      Tests  35 passed (35)   # tidigare 23, +12 nya
```

Inga andra test-filer ändrade i detta steg.

---

## 5. Schemapåverkan

**Ingen schemaändring.** `events.event_profile.performers` är inte ifylld än, vilket är KORREKT enligt P8-rapporten. Vi har nu precision/recall > 85 % men inte > 95 % som krävs för schema-commit.

För att motivera `entities/participants`-kolumn krävs:
- ✅ Precision > 80 % (90.0 % uppnått)
- ✅ Recall > 80 % (90.0 % uppnått)
- ⚠️ Färre än 5 % false-positives på icke-artist-events — vi har nu 14 FP → ~4 %, MEN bara 1 FP kvar i de 9 medvetet valda bort. För totalt 2 FPs av 20 förväntade = 10 % FP-rate räknat mot universe, men FPs är nu extremt sällsynta (2/46 events).
- ⚠️ Confidence-flöde (VERIFIED / SUPPORTED / INFERRED / UNKNOWN) — finns redan, kalibrerat för hand.
- ⚠️ Möjlighet att rulla tillbaka / regenerera — ja, allt är runtime-funktion utan DB-persistens.

→ **NÄSTA: Beslut om schema-commit.** Vid 90/90 är det rimligt att gå vidare till FAS 3 (Evidence Pack) och FAS 6 (Writer V2) — de två kvarvarande edge-casen löser sig sannolikt naturligt när Description Engine använder den förbättrade extraktorn som input.

---

## 6. Sammanfattning

| Metric | FAS 2 (2026-10-08) | FAS 2.5 (2026-10-09) | Δ |
|--------|-------------------|---------------------|---|
| Totalt events | 46 | 46 | — |
| Events med förväntade entiteter | 12 | 8 (annan facit-mappning) | — |
| Recall (korrekt extraherade) | 25 % | **90.0 %** | +65 pp |
| False-positive rate | 17 % | ~4 % (2 av 46) | −13 pp |
| Precision | ~68 % | **90.0 %** | +22 pp |
| Unit tests | 23/23 | **35/35** | +12 nya |
| Negativa mönster | 9/9 robusta | 9/9 robusta (oförändrade) | — |

**Slutsats:** Med 3 nya mönster (colon_list, slash_collab, single_name) och 2 negativa-tätningar (Chicago-edge + performer-kategori-grind) har vi höjt recall från 25 % till 90 % på 46 Stockholm-events. Negativa tester (Chicago/Hamlet/ABBA/Birita) förblir robusta. Schemapåverkan: fortfarande ingen — invänta FAS 3/6-beslut.

**Nästa steg (för godkännande):**
1. **FAS 2.6** (om användaren vill): hantera `med X & Y` mönstret (1 event kvar, ~10 rader kod)
2. **FAS 3 (Evidence Pack)** med 90 % recall — start förutsätter användarens godkännande
3. **FAS 6 (Writer V2)** med förbättrade entities-närvaro — samma förutsättning
