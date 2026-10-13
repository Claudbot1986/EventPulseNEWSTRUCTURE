# P8 Klusteranalys — 11 407 future events (2026-10-13)

## Syfte
Identifiera naturliga grupperingar (kluster) i vår event-population för att
styra editorial description-engine. Mål: hitta mönster som gör att en strategi
per kluster ger 90%+ unika, icke-vilseledande beskrivningar.

## Aggregerad profil

```
Totalt events:               11 407
Per kategori (topp 10):
  community                  2 108
  music                      4 046
  theatre-drama              1 678
  theatre-comedy             823
  sports                     502
  exhibition                 478
  opera                      280
  dance                      276
  talks-lectures             172
  food                       175

Per source (topp 5):
  livespot-stockholm         6 478  (57%)
  spelning-se                  694
  dramaten                     246
  fb-events-stockholm-apify    367
  sthlmlist                    248
  (35 övriga källor, alla <300 events vardera)
```

**57% av alla events kommer från en enda källa (Livespot Stockholm)**. Det är
både bra (vi vet vad vi får) och dåligt (single point of failure).

```
Infrastruktur:
  with event_profile:   15 (0.13%)   ← i princip ingenting
  with editorial_desc:   0 (0%)

Rikhets-signaler i raw_data:
  performer:    7 654 (67%)    ← bara 7% av dessa är MusicGroup-formen
  organizer:    7 063 (62%)
  offers:       7 651 (67%)
  location:     7 072 (62%)
  image:        9 850 (86%)

raw_description:
  empty:        3 495 (31%)
  <50 tecken:   1 029 (9%)
  50-200:       2 481 (22%)
  200+:         6 202 (54%)

Performer-former (subtyp):
  noPerformer            10 358  (91%)
  list-MusicGroup         1 309
  single-Person              47
  single-MusicGroup           4
```

## Klustring

### Rikhets-baserad uppdelning (0-9 poäng)

| Poäng | # events | Dominanta kategorier | Beskrivning |
|---|---|---|---|
| 9 | 262 | music:212, exhibition:34, talks:7 | Full JSON-LD (performer + organizer + offers + location + lång desc) |
| 8 | 273 | music:179, exhibition:93 | Nästan full JSON-LD |
| 7 | 353 | music:353 | Music-heavy med performer |
| 6 | 212 | music:166, theatre-comedy:24 | Music med desc + performer |
| 5 | 167 | music:87, sports:24, community:23 | Blandat |
| 4 | 161 | music:87, theatre-comedy:30, community:23 | Medel |
| 2 | **5 998** | music:2248, theatre-drama:1039, community:714 | **STORMAJORITET** — har location + erbjudande men saknar performer/desc |
| 1 | 1 805 | theatre-drama:553, music:521, community:249 | Bara location eller bara lite |
| 0 | **2 167** | community:1089, sports:341, music:190 | **NÄST STÖRST** — saknar alla rikhetssignaler |

**Insikt**: ~8000 events (score ≤2) har *otillräcklig* rådata för editorial
description. Dessa måste genereras från en extern källa (Wikidata, MusicBrainz,
title-pattern) — inte från `raw_description`.

### Per-kategori × har performer

| Kategori | Med perf | Utan perf | % med perf | Kommentar |
|---|---|---|---|---|
| **music** | 3 168 | 878 | **78%** | MusicBrainz-vägen möjlig för 78% direkt, resterande 22% via title |
| **theatre-drama** | 1 678 | 0 | 100% | Livespot/Dramaten JSON-LD — men performer är oftast ett organizations-namn |
| **theatre-comedy** | 823 | 0 | 100% | Samma som drama |
| **sports** | 499 | 3 | 99% | AIK-specifikt (se nedan) |
| **exhibition** | 448 | 30 | 94% | Wikidata-visualartists kan täcka |
| **opera/dance** | 280/276 | 0/0 | 100% | Wikidata works täcker |
| **community** | 2 107 | 1 | 100% | Livespot + bibliotek |
| tal/föreläsning | 164 | 8 | 95% | Föreläsare ibland listad |

**Insikt 2**: Icke-musik-kategorier har 100% performer-täckning, men det är
oftast *organisations-namn som Livespot råkar räkna som performer* — inte en
riktig Wikidata-sökbar entitet.

### Source × kategori dominans

**Sport domineras extremt av AIK**:
- AIK källan: 173 events
- AIK SE-kalender: 150 events
- → 64% av alla 502 sport-events kommer från AIK direkt
- Andra sport: 179 events (livespot/ticketmaster)

**Teater domineras av Livespot + Dramaten**:
- Livespot Stockholm: 1102 events (66% av alla teater)
- Dramaten: 246 events (15%)
- → 81% av teater från två källor

## Kluster — sju identifierade strategier

| # | Kluster | Komposition | Datakälla | Beskrivnings-strategi |
|---|---|---|---|---|
| **A** | Music + performer (raw) | 1 309 events (music list-MusicGroup) | MusicBrainz live | Tier 3 med country/type/mbid i Profile |
| **B** | Music utan perf (title-baserad) | ~2 700 events | artistResolver → MB | Tier 1 attribution via MB |
| **C** | Theatre/Drama/Comedy (Livespot) | 1 700+ events | Wikidata works (redan 4 curaterade) | Tier 1 attribution + scoped subjects |
| **D** | Drama direkt från Dramaten | 246 events | Dramaten-org curaterad | Org-baserad attribution |
| **E** | Opera/Klassiskt | 280+76 events | Wikidata works + Operan-org | Composite Tier 3 |
| **F** | Sports AIK-koncentrerad | 323 events | AIK som organiserad entity | AIK-attribution för alla 323 |
| **G** | Exhibition + Wikidata-artists | 478 events | Wikidata persons (Zorn, Hilma af Klint…) | Tier 1 attribution per artist |
| **H** | Community/Talks/Sparse | ~3 500 events | Venue + topic + organiser | Tier 1 attribution via topic/venue |
| **L** | Long tail (food, workshop, family, kids…) | ~600 events | Ingen öppen datakälla | Faller tillbaka till Eventpulse summary |

## Kritiska observationer

1. **Music är INTE 432 events — det är 4 046 events** (10× så stort som min
   tidigare uppskattning). Mitt verify-script filtrerade på LIMIT 500 och
   gömde verkligheten.

2. **91% av events saknar performer** i raw_data — MusicBrainz är inte en
   magisk täckning. Title-extraction är obligatoriskt.

3. **Single-source concentration**: Livespot Stockholm levererar 57% av allt.
   Två källor (Livespot + AIK/Dramaten) levererar >70% av sport+teater.

4. **Sammanlagd Tier-1-täckbar yta** med befintlig infrastruktur:
   - Music A+B: ~4 000 events (95% via MusicBrainz efter title-resolver)
   - Theatre/Opera/Exhibition: ~3 500 events (60-70% via Wikidata subjects/org)
   - AIK-sport: 323 events (100% om AIK-curatering)
   - Övrig sport + community: ~4 500 events (möjlig Tier 1 via topic-orga)
   - Long tail: ~600 events (ingen källa → fallback summary)

   **Realistisk Tier 1-täckning: 80-85% av 11 407 med befintlig pipeline +
   kuraterade utökningar. Inte 90%.**

5. **Tier 3 (full beskrivande svensk prosa)** är ett hårdare problem —
   M3-anslutningen har 8 s timeout-fel i reality-tester. Räkna med 50-65%
   Tier 3-täckning, inte 90%.

## Rekommendation (operativ ordning)

| Fas | Kluster | # events | Mål |
|---|---|---|---|
| **1** | A + B (music 100%) | 4 046 | MusicBrainz live + artistResolver → event_profile för alla |
| **2** | D + AIK-sport (E) | 569 | Organiserad attribution (Dramaten + AIK), 100% |
| **3** | C + E (teater/opera/klass) | 2 758 | Wikidata works + 5 curaterade orgs → 70% Tier 1 |
| **4** | G (utställning) | 478 | Wikidata visual artists → 60% Tier 1 |
| **5** | H (community/sparse) | 4 500 | Topic + venue Tier 1, 50% |
| **6** | L (long tail) | 600 | Eventpulse summary-only, acceptans |

**Verifieringssteg**: provkör 200 events (50 per fas) → empirisk mätning →
justera scope per fas.

## Relaterade artifacts

- `runtime/events-future-2026-10-13.jsonl` — 11 407 events dataset
- `scripts/_clusterAnalysis.py` — återkörbar analys
- `04-Normalizer/editorial/_backfillEventProfile.ts` — batch-backfill som ska
  utökas till kluster-Aware routing

—

Generated 2026-10-13 med Python offline-analys. Inga LLM-anrop. Inga
nätverksanrop. Deterministisk output från JSONL-pull.
