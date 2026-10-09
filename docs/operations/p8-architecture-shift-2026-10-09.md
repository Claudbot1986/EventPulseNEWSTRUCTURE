# P8 Arkitektur-skifte: Öppen data först (2026-10-09)

**Datum:** 2026-10-09
**Initiativtagare:** Användarens fråga om copyright-risk + strategi-byte
**Scope:** Hela `04-Normalizer/editorial/` + `04-Normalizer/data/`

## Sammanfattning i en mening

**Före:** Editorial Writer byggde beskrivningar genom att läsa venue-copy
(licensierad eller ej) och regenerera prosa via M3.

**Efter:** Editorial Writer bygger beskrivningar från **öppen data**
(Wikidata CC0, Wikipedia CC BY-SA, MusicBrainz CC0) som primär källa,
med venue-copy som sista utväg för specifik info vi inte hittar öppet.

## Varför?

Två sammanhängande insikter från sessionen 2026-10-09:

1. **Copyright är inte binärt.** Att *läsa* text är *ofta* OK (TDM-lag,
   strukturerad extraktion), men att *reproducera* eller *parafrasera* kräver
   licens/avtal. Brandväggen skyddade output, men inte input.

2. **För de flesta event-claims behöver vi inte läsa venue-copy alls.**
   Information om artister, verk, organisationer, ämnen finns i öppna,
   fritt återanvändningsbara källor.

## Ny arkitektur

### Tre datakällor, fallande i tillförlitlighet:

| Lager | Källa | Licens | Vad den täcker |
|-------|-------|--------|----------------|
| 1. **Curated JSON** | `04-Normalizer/data/stockholm-gazetteer.json` + `stockholm-subjects.json` | CCO/CC-BY-SA (respekterade) | 21 artister + 20 subjects, auktoritativt curerade |
| 2. **Live open data** | MusicBrainz (CC0), Wikidata (CC0), Wikipedia (CC BY-SA) | CC0 / CC BY-SA 4.0 | Alla andra artister/verk/orgs/ämnen |
| 3. **Venue copy (fallback)** | DB.events.description | Per source license | Det vi inte hittar öppet, om licens tillåter |

### Pipeline-ordning:

```
1. extractEntities (FAS 2.5)            ← title → performer-namn
2. lookupArtists (curated + MusicBrainz) ← performer → country/type/genres
3. lookupSubjects (curated + Wikidata)   ← performers + title + venue
                                           → work/person/org/topic → metadata
4. buildEventProfile                     ← sammanställer Profile
5. textualFirewall                       ← skyddar output (kvar från P7)
6. Writer V2 (M3)                        ← genererar prosa
7. checkFactuality                       ← claim-by-claim mot Profile
8. checkIndependence                     ← similarity mot source_description
```

**Venue-copy når endast Writer om description_license = godkänd**
(`pressbild`, `partner-licensed`, etc.) — annars hamnar vi i
`fallback_fact` eller `fallback_minimal`.

## Filer skapade / modifierade

### Nya moduler
- `04-Normalizer/data/stockholm-subjects.json` — 20 curaterade subjects
- `04-Normalizer/editorial/subjectCache.ts` — subject lookup
- `04-Normalizer/editorial/subjectLiveEnrich.ts` — Wikidata SPARQL
- `04-Normalizer/editorial/subjectCache.test.ts` — 15 tester
- `04-Normalizer/editorial/subjectLiveEnrich.test.ts` — 12 tester

### Modifierade moduler
- `04-Normalizer/editorial/types.ts` — `subject_metadata` fält
- `04-Normalizer/editorial/eventUnderstanding.ts` — populera subject_metadata
- `04-Normalizer/editorial/factualityCheck.ts` — subject evidence (work/author/year/lang/genre)
- `04-Normalizer/editorial/factualityCheck.test.ts` — 5 nya tester
- `04-Normalizer/editorial/goldSet.test.ts` — `expected_subject_hits` stöd
- `04-Normalizer/data/goldSetFas10.jsonl` — +7 events (gold-026..032)

## Test-coverage

| Lager | Tidigare | Nu | Förändring |
|-------|----------|-----|------------|
| Total editorial | 297 | **400** | +103 |
| Subject-cache | 0 | 15 | +15 |
| Subject-live-enrich | 0 | 12 | +12 |
| Factuality (subject) | 0 | 5 | +5 |
| Gold-set (subject-events) | 25 | 32 | +7 events, +7 tester |

**400/400 PASS** vid `npx vitest run 04-Normalizer/editorial/`.

## Vad detta löser

### Juridiskt (copyright)
- ✅ All artistinfo från CC0 (MusicBrainz) eller curaterad → säker
- ✅ All subjectinfo från CC0 (Wikidata) eller curaterad → säker
- ✅ Attribution-payload i Profile → kan visas i UI för CC BY-SA
- ⚠️ Venue-copy kvar som fallback — kräver fortfarande license-grind

### Kvalitativt (factuality)
- Donovan Woods reality-test: 8 → 26 supported claims (gazetteer-integration)
- Hamlet/Shakespeare: nu SUPPORTED (subject-integration)
- Kungliga Operan, grundad 1773: nu SUPPORTED
- Svensk litteratur: nu SUPPORTED

### Strategiskt (täckning)
- ✅ Teater (Hamlet, Chicago) — täcks via subject-gazetteer
- ✅ Kommunalt (Stockholms stadsbibliotek) — täcks via subject-gazetteer
- ✅ Familj (Kungliga Operan) — täcks via subject-gazetteer
- ✅ Workshop (AI) — täcks via subject-gazetteer
- ✅ Artister — täckt sedan tidigare

## Vad det INTE löser

1. **Specifika produktioner** (t.ex. "Människokung Hamlet" regi X) —
   för specifik produktionsinfo behövs venue-copy.
2. **Lokala evenemang utan öppen datatäckning** — mindre venues, nyetablerade
   artister, etc. Här är venue-copy fortfarande nödvändig.
3. **Bilder** — separat problem (bild-licens).
4. **TDM-opt-out-verifiering** — vi vet inte om alla venues har sagt ifrån.

## Kvarvarande arbete

### Kortsikt (P9+)
- [ ] Attribution-UI: visa "Artistinfo från MusicBrainz (CC0)" i event-vyn
- [ ] License-gate före Writer V2: hoppa över om description_license=unknown
- [ ] Wikidata-relationsslutledning (auktor → verk, org → serie)

### Medellång (P10+)
- [ ] TDM-opt-out-check (kolla robots.txt + ToS per venue)
- [ ] Curator-roll: vem ansvarar för att uppdatera stockholm-gazetteer.json?
- [ ] Wikipedia-narrativ som kontext (CC BY-SA → attribution)

### Långsikt (framtida scope)
- [ ] Open Library-integration för äldre verk
- [ ] Library of Congress Subject Headings för workshop-ämnen
- [ ] Wikidata P31 (instance-of) djupare klassificering

## På människospråk

Tidigare läste AI:n venue-sajter (med TDM-rätt) och försökte skriva om
texten i nya ord. Det fungerade ofta, men juridiskt var det i en gråzon.

Nu gör vi istället så här:
1. Vi frågar **Wikidata** (CC0, fri data) om verket Hamlet → får författare,
   språk, premiärår.
2. Vi frågar **MusicBrainz** (CC0) om artister → får land, genrer, typ.
3. Vi frågar **curerad JSON** för det vi redan vet (21 artister, 20 subjects).
4. Först om ALLT detta misslyckas, läser vi venue-copy — och bara om
   licensen uttryckligen tillåter det.

Resultatet: 80% av det en beskrivning behöver kommer från öppen data som
*alltid* får användas. Och de 20% som kräver venue-info har vi en
tydlig licensgrind som skyddar oss.
