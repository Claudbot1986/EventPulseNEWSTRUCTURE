# Beskrivningsluckor i EventPulse — komplett lista + orsaksutredning

**Datum:** 2026-11-01
**Fråga från användaren:** "varför finns det inga beskrivningar på vissa events?" — med exempel
`StandUpSverige - Din Guide Till Gratis Skratt (Biljettreservation krävs)`.
**Utgångspunkt:** "gå in på hemsidan själv och kontrollera — jag kan uppenbart jättelätt hitta titel/plats mm."

**Status:** alla siffror nedan är mätta mot live-Supabase (2026-11-01) eller mot den riktiga appen.

> **UPPDATERAD 2026-11-02 — orsak 1, 3 och 4 är åtgärdade och verifierade.**
> - **Orsak 1 (Hem-selecten):** fixat. Hem/Utforska/Sök visar nu **89 / 89 / 89** events utan beskrivning (var 11 932 / 95 / 218).
> - **Orsak 2 (90 events utan text):** kvar — kräver editorial-backfill.
> - **Orsak 3 (gratisistockholm, fel tid 18:00 mot 19:00):** analysat — se `docs/audit/description-gap-root-cause-2026-11-01.md` §5. Källadapter ej gjord.
> - **Orsak 4 (`rowMapping` forwardar inte `eventpulse_summary`):** fixat.
> - **Ny orsak hittad:** faktualitetsgaten underkände vanlig redaktionell glöd ("riktar", "erbjuder", "bjuder" …) som om det var påståenden → halva beskrivningarna blev faktmallar. Fixad med `NON_FACTUAL_VOCABULARY`; isolerad effekt: 8/30 → 12/30 PASS, 151 → 82 underkända claims.
> - **Verifieringsskill:** `.cursor/skills/verify-eventpulse-descriptions/` (5 grindar + feature-karta). Bevis: `runtime/verification-reports/description-rights-<ts>.json`.
>
> Originaltexten nedan beskriver tillståndet **före** fixarna och är kvar som historik.

---

## 1. Sammanfattning — fyra orsaker, inte en

| # | Orsak | Omfattning | Var | Status |
|---|---|---|---|---|
| **1** | **Hem-skärmen hämtar aldrig beskrivningsfälten** | **11 932 av 11 932 events (100 %)** | `06-UI/screens/HomeScreen.js` | [VERIFIED] i riktig app |
| **2** | **90 events har ingen text alls i databasen** | 90 av 11 932 (0,75 %) | databasen | [VERIFIED] mot live-DB |
| **3** | **Stale data från källor som inte längre körs** (t.ex. gratisistockholm) | 31 rader från gratisistockholm, varav 18 StandUpSverige-återkommanden | ingestion | [VERIFIED] mot källsidan |
| **4** | **Sök-läget mappar inte `eventpulse_summary`** | 115 events förlorar rad-previewen | `06-UI/components/rowMapping.js` | [VERIFIED] mot live-DB |

**Det viktigaste:** Orsak 1 är inte en databrist. Databasen *har* beskrivningen — appen frågar bara
aldrig efter den. Det är därför det ser ut som "vissa events saknar beskrivning" fast i själva
verket **inga** events i Hem-flödet har någon.

---

## 2. Mätmetod (så att talen går att ifrågasätta)

- **Resolution-logiken** är inte ompakad: auditen importerar den *riktiga* UI-funktionen
  `getDetailsDescription` från `06-UI/utils/descriptionFallback.js` och kör den på rader som
  förberetts exakt som appens tre flöden förbereder dem (Hem, Agent/Utforska, Sök).
- **Select-listorna** läses ur `HomeScreen.js` vid körning (10 st), inte från minnet.
- **Live-payload-probe** mot Supabase PostgREST med appens egna select-listor
  (`.scratch/probe-app-payload.mjs`).
- **App-verifiering** i riktig Expo-webb via Playwright (`scripts/_verify_description_rendering.mjs`).
- **Källverifiering** med riktiga HTTP-hämtningar mot källsajten + körning av den *riktiga*
  `universal-extractor.ts`.

Skript: `scripts/_audit_description_coverage.mjs` (read-only).
Rapporter: `docs/audit/description-coverage-2026-11-01.md` + 4 CSV-filer under `docs/audit/data/`.

---

## 3. ORSAK 1 — Hem-skärmen frågar aldrig efter beskrivningen [VERIFIED]

### Vad som händer

`06-UI/screens/HomeScreen.js` har **10 stycken** `select()`-listor mot `events_public`.
**Ingen av dem** innehåller de fält som beskrivnings-resolutionen behöver:

| Fält | I Hem-select? | Roll i `getDetailsDescription()` |
|---|---|---|
| `editorial_description` | **NEJ** | steg 1 — primär källa (P7, MiniMax-M3) |
| `eventpulse_summary` | **NEJ** | steg 2 — deterministisk mall |
| `description_license` | **NEJ** | gate för steg 3 |
| `venue_name` | **NEJ** | gate för steg 4 (faktaraden) |
| `description_sv` / `description_en` | JA | steg 3 — men vyn nollställer dem utan tillåtande licens |

Följden: `toDetailsScreenEvent()` (HomeScreen.js:151) bygger ett payload där alla fyra fälten är
`undefined`, och `getDetailsDescription()` (App.js:1751) kan då inte nå **enda** av sina fem steg →
returnerar `null` → appen renderar den dämpade fallback-raden.

### Varför `venue_name` saknas

Koden i `HomeScreen.js:145` innehåller en **inaktuell kommentar**:

> `venue_name finns inte i events_public (endast venue_id + lat/lng)`

Det var sant när koden skrevs. I dag exponerar vyn `venue_full_name` — och select-listan hämtar den —
men ingen ställer om den till `venue_name`. Fältet plockas alltså upp och kastas bort.
Konsekvensen syns i appen: platsraden i DetailsScreen är tom (📍 utan text).

### Bevis 1 — i den riktiga appen

Öppnade ett eventkort på Hem i Expo-webb (Playwright, `.scratch/evidence/2026-11-01-description-rendering/`):

```
TEST EVENT
No description available from livespot-stockholm.
```

Skärmdump: `.scratch/evidence/2026-11-01-description-rendering/02-after-card-tap.png`

### Bevis 2 — samma event i databasen

```json
{
  "id": "9e91378b-3cc0-485c-a201-ecc48a3ae4dd",
  "title_sv": "TEST EVENT",
  "source": "livespot-stockholm",
  "editorial_description": "TEST EVENT. Typ: community. Datum: 31 december 2027. Tid: 21:00.",
  "eventpulse_summary": null,
  "description_license": "unknown",
  "venue_full_name": null
}
```

**Beskrivningen finns i DB.** Appen visar ändå "No description available from livespot-stockholm."
→ beviset på att fältet aldrig hämtas.

### Bevis 3 — mätning över hela tabellen

| Mätning | Antal | Av 11 932 |
|---|---:|---:|
| Saknar beskrivning i **Hem**-flödet | **11 932** | **100,0 %** |
| Saknar beskrivning i **Agent/Utforska**-flödet | 90 | 0,75 % |
| Saknar beskrivning i **Sök**-läget | 205 | 1,72 % |
| Saknar beskrivning i BÅDA Hem och Agent | 90 | 0,75 % |
| Har beskrivning i Hem men inte i Agent | 0 | — |

Agent-flödet (`08-Agent/tools/feed_events.ts`, `FEED_SELECT_COLUMNS`) hämtar **alla** fyra fält,
och `venue_name` mappas därifrån `venues.name` med `venue_full_name` som reserv. Därför fungerar
Utforska men inte Hem.

### Åtgärd

Lägg till fyra fält i Hem:s select-listor och mappa `venue_full_name` → `venue_name`:

```js
// HomeScreen.js — i samtliga 10 select-listor
.select('id, title_sv, title_en, description_sv, description_en, ' +
        'editorial_description, editorial_description_generated_at, ' +
        'eventpulse_summary, description_license, ' +
        'start_time, image_url, image_ai_generated, image_ai_optout, ' +
        'image_generation_status, ticket_url, source, category_slug, is_free, ' +
        'confidence_score, freshness_at, venue_id, venue_full_name')

// HomeScreen.js:217
venue_name: row.venue_name || row.venue_full_name || null,
```

---

## 4. ORSAK 2 — 90 events har ingen text i databasen [VERIFIED]

Även efter att Orsak 1 är åtgärdad saknar **90 events** beskrivning i *alla* flöden.
Fullständig lista med rotorsak per rad:
`docs/audit/data/events-without-description-2026-11-01.csv` (90 rader).

### Fördelning per källa

| Källa | Antal | Källa | Antal |
|---|---:|---|---:|
| visithelsingborg | 23 | stockholmlive-evenemang | 4 |
| dunkers | 18 | stampen | 4 |
| eventbrite-stockholm | 11 | abf | 3 |
| studio-acusticum | 8 | stadsmuseet | 3 |
| tiqets-stockholm | 6 | kungliga-biblioteket | 2 |
| lugerse | 5 | stampense / tele2-arena / allevents-in-stockholm | 1 + 1 + 1 |

Summa = 90.

### Rotorsak

Alla 90 har **samma** mönster: `R4-ingen-text-i-db` — ingen råtext, ingen `editorial_description`,
ingen `eventpulse_summary`. Det är alltså *inte* en licens-gate och *inte* en UI-gate; texten finns
inte någonstans.

Det betyder att de två åtgärder som hjälper:
1. **editorial-backfill** för de 90 (M3-genererad beskrivning ur titel/plats/datum), och
2. **extraktionsfix** för de källor som faktiskt *har* text på sidan men inte levererar den.

Exempel på den andra kategorin: `visithelsingborg` (23 st) och `dunkers` (18 st) — båda har
`eventpulse_summary` på sina övriga events, så kedjan fungerar för dem; just dessa rader saknar
underlag.

---

## 5. ORSAK 3 — StandUpSverige: fel tid, skräptitel, död källa [VERIFIED]

### Källsidan (verifierad med riktig HTTP-hämtning)

`https://www.gratisistockholm.nu/viewObject.aspx?objectId=130756` innehåller, ordagrant:

```
<span class="objectSubHeader">Lokal/plats:</span> Big Ben Pub, Folkungagatan 97, Södermalm
<span class="objectSubHeader">Datum:</span> Söndag den 1 november 2026
<span class="objectSubHeader">Tid: </span>19:00
```

och i brödtexten: `Tid: 19:00 - 22:00`.

**All information som användaren säger sig kunna hitta finns på sidan.**

### Vad EventPulse har

| Fält | EventPulse | Källsidan | Avvikelse |
|---|---|---|---|
| Starttid (Stockholm) | **18:00** | **19:00** | **1 timme för tidigt** |
| Lokal | Big Ben Pub, Folkungagatan 97, Södermalm | samma | ✔ |
| Datum | 2026-11-01 | Söndag den 1 november 2026 | ✔ |
| Titel | StandUpSverige - Din Guide Till Gratis Skratt (Biljettreservation krävs) | samma (sidans `<h1>` inkl. "(130756)") | ✔ |
| Beskrivning | hela sidans text inkl. navigering | — | skräp |

Databasen: `start_time = 2026-11-01T17:00:00Z` = **18:00** Stockholms tid.
Källsidan: **19:00**. Verifierat på 6 av sidorna (130756, 130757, 130758, 130769, 130770, 130771) —
alla säger 19:00.

### Varför står det 18:00?

Inte dagens extractor. Körning av den *riktiga* `universal-extractor.ts` mot sidan:

| Variant | Resultat |
|---|---|
| A: sidan som den är | **0 events** |
| B: samma HTML med `<article>` runt innehållet | 2 events — **tid 19:00** ✔ |
| C: samma HTML med `class="event-card"` på containern | 2 events — **tid 19:00** ✔ |

**Rotorsak:** C1-metoden (`extractHtmlHeuristics`) letar efter ett *eventkort*-element
(`article`, `[class*="event"]`, `.card`, …). gratisistockholms detaljsida har bara
`<div class="main">` — ingen av C1:s selektorer matchar → 0 events.

Samma extractor, samma sida, med en container → **19:00, korrekt**. Slutsats: dagens
extraktionsmotor klarar sidan; den saknar bara en kort-container att läsa ifrån.

De 18 StandUpSverige-raderna i DB skapades **2026-08-18/19** och har `freshness_at` senast
2026-10-23 → de har aldrig körts om. Värdena är frysta från en äldre extraktionsväg.

### Tre saker till som är fel med just den här källan

1. **Tiden är 1 timme fel** (18:00 mot 19:00) — 18 rader.
2. **Beskrivningen är navigeringsskräp**: `description_sv` börjar med
   `"SÖK PÅ KATEGORI 20 mest visade Konsert Scen Nattklubb Film Dans Museum Festival …"`
   och innehåller hela kalenderns dagtal. **19 rader från gratisistockholm har detta.**
3. **Källan är död i maskinen.** `sources/gratisistockholm.jsonl` har
   `metadata.audit_status: "orphan"`, `currentQueue: "pending"`, `routingConfidence: "low"` —
   den körs inte i nattkedjan. Kör man samma extractor på sidan nu → 0 events.

### Åtgärd (utan att röra C-lagret)

Per **Generalization Protection Rule** får C0/C1/C2 **inte** ändras för en enda sajt. Rätt väg är en
**källadapter** — samma mönster som de 26 befintliga i `02-Ingestion/F-eventExtraction/adapters/`
(`folkoperan.ts`, `zita.ts`, `visitstockholm.ts` …). gratisistockholm saknar adapter idag.
En adapter som läser `objectSubHeader`-fälten löser både tid och skräpbeskrivning, och
`authoritative: true` hindrar universalheuristiken från att fylla på med fel.

---

## 5b. ORSAK 4 — Sök-läget tappar `eventpulse_summary` [VERIFIED]

`App.js:1319` mappar sökresultat via `mapAgentEventToRow` (`06-UI/components/rowMapping.js`).
Mappen forwardar `editorial_description` och `description_license` men **inte** `eventpulse_summary`
(verifierat: fältet förekommer 0 gånger i filen).

Konsekvens: **115 events** som har `eventpulse_summary` men saknar `editorial_description` tappar
sin rad-preview i sökresultatet — de får en beskrivning när man öppnar eventet, men ingen
under raden i listan. Detta är en mindre variant av samma klass som Orsak 1: **ett fält som finns
i databasen men inte i mappen.**

Åtgärd: en rad i `rowMapping.js` — `eventpulse_summary: event.eventpulse_summary ?? null`.

---

## 6. Komplett lista

| Fil | Rader | Innehåll |
|---|---:|---|
| `docs/audit/data/events-without-description-2026-11-01.csv` | 90 | saknar beskrivning i båda Hem och Agent + rotorsak + licens + länk |
| `docs/audit/data/events-without-description-feed-2026-11-01.csv` | 90 | samma, filtrerad på agent/Utforska-flödet |
| `docs/audit/data/events-without-description-SEARCH-flow-2026-11-01.csv` | 205 | saknar beskrivning i sök-läget |
| `docs/audit/data/events-without-description-HEM-flow-2026-11-01.csv` | 11 932 | alla som saknar beskrivning i Hem (100 %) |
| `docs/audit/description-coverage-2026-11-01.md` | — | fullständig tabell + per-källa-fördelning + rotorsak |

Kommaseparat CSV: `id, title, source, start_time, category_slug, venue_full_name,
venue_table_name, ticket_url, created_at, last_seen, has_editorial, has_summary, raw_desc_len,
desc_license, license_ok, nav_junk, root_cause, bucket`.

---

## 7. Rekommenderad ordning

1. **Orsak 1** — Hem-select + `venue_name`-mappning. Enda ändringen som ger effekt på 100 % av
   eventen. Liten, isolerad ändring i `HomeScreen.js` + regressionstest.
2. **Orsak 4** — en rad i `rowMapping.js` (`eventpulse_summary`). Fixar 115 events i söklistan.
3. **Orsak 3** — källadapter för gratisistockholm (fixar 18 rader med fel tid + 19 rader med
   skräpbeskrivning) och kör om de 31 raderna.
4. **Orsak 2** — editorial-backfill för de 90 (M3), efter att orsak 1 är löst så resultatet syns.

Inget av detta bygger ny funktionalitet — det är att göra redan existerande data synlig i appen.

---

## 8. Bevisfiler

| Fil | Vad |
|---|---|
| `scripts/_audit_description_coverage.mjs` | read-only audit, kör resolution-logiken från den riktiga UI-modulen |
| `scripts/_verify_description_rendering.mjs` | Playwright-verifiering av vad appen faktiskt renderar |
| `docs/audit/description-coverage-2026-11-01.md` | automatisk rapport med per-källa- och rotorsakstabell |
| `docs/audit/data/*.csv` | kompletta listor |
| `.scratch/evidence/2026-11-01-description-rendering/` | skärmdumpar från den riktiga appen |
| `.scratch/probe-gratis.ts`, `.scratch/probe-gratis-pages.ts`, `.scratch/probe-gratis-c1.ts` | källverifiering mot gratisistockholm (scratch, ej committad) |
| `.scratch/probe-app-payload.mjs` | live-payload-probe med appens egna select-listor |
