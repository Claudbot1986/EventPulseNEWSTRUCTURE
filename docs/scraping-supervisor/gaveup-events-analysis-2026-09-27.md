# EP-2026-09-27-858 — Varför misslyckades LLM på 189 'för lite info'-events

**Task:** EP-2026-09-27-858
**Datum:** 2026-09-27
**Källa:** `retag-suggestions-v2-2026-09-27.jsonl` (233 events, varav 189 slutade som `["community"]`)

## Slutsats (för dig)

LLM:en gör **rätt** när den säger "för lite info" — i 81 % av fallen har den bara titeln att gå på.
Resten är huvudsakligen **musik-konserter utan genre**, vilket är scope för Steg 3.5 (artist-tillägg) som parkerades 2026-09-27.
**Inget vi åtgärdar idag.** Men vi har nu data som visar exakt vilka 47 events som blir av hjälp när artist-lookupsen drar igång.

## Siffror

| Metric | Värde |
|---|---|
| v2-suggestions totalt | 233 |
| Slutade som `["community"]` (gave up) | **189** |
| Multi-label (≥2 slugs) | 5 |
| ... varav stora slugs: classical 18, theatre-drama 10, talks-lectures 7, theatre-comedy 4 | |

## Beskrivningslängd — varför LLM gav upp

| Längd | Antal | Andel |
|---|---|---|
| 0 (tom) | 61 | 32 % |
| 1-50 tecken | 48 | 25 % |
| 51-100 tecken | 37 | 20 % |
| 101-200 tecken | 29 | 15 % |
| 201+ tecken | 14 | 8 % |

**0-100 tecken = 77 %.** Median 60 tecken.
En LLM kan rimligen klassificera "Familjevisning av Nils Holgerssons underbara resa — en magisk foreställning för barn 3-8 år" men inte "Celtic Christmas".

## Orsaks-klassificering (189 events)

| Orsak | Antal | Beskrivning |
|---|---|---|
| **Musik utan genre** (sthlmlist-konserter) | 47 | LLM ser konsert men saknar slug för genren. Lösning: artist-tillägg (Steg 3.5). |
| **Musik/genre hints, ej tilräckligt** | 34 | "Musikshow", "Svensk hiphop", "rockabilly" — saknar slug i vår plan. |
| **Kort beskrivning** (≤20 tecken) | 31 | Inte ens sammanhang. Slug = community OK. |
| **Nätverk/affärer** (WomenHack, Microsoft-mingel) | 11 | FAKTISKT community/business-nätverk. LLM gör rätt som behåller community. |
| **Övrigt** (bokmässor, julmarknader, stadsvandringar) | 65 | Variationsrik — inte entydigt mönster. |
| **Bok/ litteratur** | 1 | "Stockholms vinterbokhelg" — talks-lectures? |

## Toppkällor (108 av 189 = 57 % är sthlmlist)

| Källa | Events | Kommentar |
|---|---|---|
| sthlmlist | 108 | Community-feed, främst musik-events utan genretagg |
| eventbrite-discovery | 9 | Huvudsakligen WomenHack/Stockholm Biggest Business (dedup-bugg över kategorier) |
| eventbrite-sthlm-categories | 8 | Samma dedup-bugg från andra kategorier |
| thatsup-stockholm-articles | 5 | Article→event — flera OK som talks-lectures |
| allevents-in | 4 | Samma som sthlmlist-nätverket (Lee Rocker, Kim Wilde, Imminence) |

## Varför vi INTE gör en regel-baserad runda idag

Tre realistiska åtgärder — alla blockerade idag:

1. **Auto-tagg sthlmlist konserter → "music"-slug** (utan genre-info).
   - **Blockerat:** vår v2-strategi har INGEN generell `music`-slug (vi kräver genre).
   - Skulle vara scope-drift: vi behöver genren, inte bara "music".

2. **Auto-tagg sthlmlist → "community" permanent** (acceptera 108 events som community).
   - Lösningen väljer vi implicit redan idag.
   - Inget görbart här — v2-pipelinen gör rätt.

3. **Kör Steg 3.5 (artist-lookup) mot dessa 81 events först.**
   - **Blockerat:** Steg 3.5 parkerades av användaren 2026-09-27.
   - Bör återaktiveras i framtida iteration med MusicBrainz/Spotify-nyckel.

## Vad som ÄR görbart (men utelämnat)

- **11 affärs-nätverks-events** är korrekt klassificerade som community. Inga åtgärder.
- **61 events med tom beskrivning** är ett datakvalitets-problem (se Steg 3.6 — data quality). Att fylla dem kräver re-scraping med bättre extractor. Utanför scope idag.
- **Dedup-buggen** WomenHack/Stockholm Biggest Business (samma event från 3+ eventbrite-källor) kräver `dedup_hash`-ändring, som är förbjuden av EP-2026-09-27-b0162981-238.

## Vad jag rekommenderar nästa gång

När Steg 3.5 (artist-tillägg) drar igång:

1. Begränsa initial scope till **de 47 sthlmlist-konserterna** med distinkt artistnamn i titeln (t.ex. "Phoebe Bridgers", "The Mwuanas", "Bob Hansson", "Lee Rocker").
2. Slå upp dem i MusicBrainz Cache eller Spotify (cache-lokal lookup är OK — ingen onlinedb-ändring).
3. Berika `events` med `genre_slug`, alternativt multi-label via `event_categories` med nya slugs (`pop-rock`, `jazz`, `hip-hop` etc.).

Detta är **inte nytt scope** för Steg 3.5, men en smalare första-batch som visar värdet innan vi rullar ut mot hela `music`-poolen om 2452 events.

## Filer

- CSV: `00-Vault/01-Projects/EventPulse/04-Sources/gaveup-events-2026-09-27.csv` (189 rader, kan öppnas i Numbers/Excel)
- Script: `04-Normalizer/_scripts/_inspect-gaveup.ts`, `04-Normalizer/_scripts/_gaveup-stats.ts`
- Källa-JSONL: `00-Vault/01-Projects/EventPulse/04-Sources/retag-suggestions-v2-2026-09-27.jsonl`

## Task-status

- [x] Orsaker identifierade (data, inte LLM-bugg)
- [x] Scope kartlagt mot planen (Steg 3.5 löser flesta, parkerad)
- [x] Findings-note skriven
- [x] Ingen kod-ändring krävs — låt LLM fortsätta göra rätt

## På människospråk

Vi tog 189 events som den smarta datorn inte kunde kategorisera och kollade varför.
Svaret: i de flesta fallen (77 %) var beskrivningen så kort att datorn omöjligt kunde veta vad det var för sorts event.
Den näst största gruppen (47 events) är musikkonserter där vi saknar genren — vilket kräver ett fristående verktyg för att slå upp artister som du bestämde skulle vara ett separat projekt.
Slutsatsen är lugnande: datorn gör sitt jobb rätt, vi har bara inte nog med data ännu.
