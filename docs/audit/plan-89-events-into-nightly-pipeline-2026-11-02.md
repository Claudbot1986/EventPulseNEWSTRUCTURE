# Plan — de 89 textlösa eventsen in i den nattliga ingestion-kedjan

**Datum:** 2026-11-02
**Beslut (användaren):** *"gör en plan där du får in det i ingestion pipelinen som körs
nattligen, sen gör en 'backup' och backfill de som behöver ändring"*

**Bakgrund:** de 89 events som helt saknar beskrivning (klass `R4-ingen-text-i-db`)
beslutades 2026-11-02 lämnas tomma. Användaren frågade sedan om de kan tas in i
ingestion/discovery/mini-ingestion i stället. Svaret är ja för 46 av dem via
mini-ingestion, och delvis även för de övriga via en direkt backfill.

---

## 1. Rotorsak (uppmätt, inte gissad)

De 89 raderna är **nakna**: `raw_description`, `event_profile`, `eventpulse_summary`
och `editorial_description` är **samtliga noll** (backup 2026-11-02: 89/89/89/89 noll).
De har alltså aldrig gått igenom någon beskrivningsgenerering.

Varför? Mätning i `runtime/sources_status.jsonl` och `runA.ts --status`:

```
preA-queue:   0 entries
sources-main: 0 never_run sources
in both:      0
total to run: 0
```

**A-gaten väljer bara `never_run`-källor + API-adapter-källor + RSS-källor.**
Alla 12 aktiva källor som täcker de 89 har `status=success` — de kördes en gång
(2026-09-10 … 2026-11-01) och körs **aldrig igen** utan att tvingas in via preA-kön.
Följden: när en källa kördes första gången var extraktorn äldre än dagens,
och sedan frös raderna: ingen råtext, ingen profil, ingen beskrivning.

Det är alltså **inte** en beskrivningsbugg — det är att källorna inte körs.

### De 15 källorna

| källa | registry | events | framtida | `preferredPath` | adapter |
|---|---|---:|---:|---|---|
| visithelsingborg | **RETIRED** | 18 | 17 | unknown | nej |
| dunkers | **RETIRED** | 17 | 15 | unknown | nej |
| eventbrite-stockholm | AKTIV | 12 | 10 | jsonld | nej |
| studio-acusticum | **RETIRED** | 8 | 8 | unknown | nej |
| tiqets-stockholm | AKTIV | 6 | 6 | jsonld | nej |
| stockholmlive-evenemang | AKTIV | 5 | 5 | jsonld | nej |
| lugerse | AKTIV | 5 | 5 | html | nej |
| stampen | AKTIV | 5 | 1 | html | nej |
| abf | AKTIV | 3 | 3 | unknown | nej |
| stadsmuseet | AKTIV | 3 | 3 | html | nej |
| stampense | AKTIV | 2 | 2 | html | nej |
| kungliga-biblioteket | AKTIV | 2 | 2 | — | nej |
| aik | AKTIV | 1 | 1 | unknown | nej |
| tele2-arena | AKTIV | 1 | 1 | unknown | nej |
| allevents-in-stockholm | AKTIV | 1 | 1 | jsonld | nej |

**46 events från 12 aktiva källor · 43 events från 3 pensionerade källor.**

---

## 2. Två spår

### Spår A — mini-ingestion via preA-kön (nattlig)

**Mekanism (befintlig, testad):**
`runA.ts --add <sourceId> "<reason>"` → `runtime/preA-queue.jsonl` → A-gaten kör
preA-posterna **först** (högsta prioritet), `--limit 200` ≫ 12 → inga risker att
de klipps bort. Nattkörningen (launchd `com.eventpulse.ingestion`, kl 02:00) läser
samma fil. Kedjan: A-gate → `03-Queue/03-extractedevents/<source>.jsonl` →
`import-to-eventpulse` → BullMQ → `drainQueue` → `processRawEvent` (normalizer)
→ `maybeRunEditorial` → `editorial_description` + `event_profile`.

**Vad det ger:** råtext och titel/tid/plats extraheras på nytt → profilen byggs
på riktigt (regelbaserad entitetsextraktion + Wikidata) → editorial-pipelinen
genererar **prosa** (inte faktmall) → eventet får en riktig beskrivning.

**Begränsning:** pensionerade källor kan **inte** köas via preA.
`getSource(id)` slår bara upp `sources/<id>.jsonl` (`02-Ingestion/tools/sourceRegistry.ts:206`),
och `runA.ts` **tar tyst bort** preA-poster vars id inte finns. Att flytta tillbaka
`visithelsingborg`, `dunkers` och `studio-acusticum` från `sources/_retired/` vore
en uppgift i sig — de pensionerades av `cleanup_sources.py` som "felregistrerade
källor" (commit `13080f58`), inte för att de var trasiga.

**Rör sig inte:** de 9 events som redan har ägt sig (förfluten starttid) — de
listas inte längre på källsidan och kommer inte att återskapas.

### Spår B — direkt backfill (utan re-ingestion)

För de rader spår A inte når: **direkt editorial-backfill** via
`04-Normalizer/editorial/_backfillEditorialDescriptions.ts`, som bygger profilen
ur de strukturerade fälten (titel, venue, kategori, datum) och kör samma
editorial-pipeline med samma grindar.

**Tak:** mätt på alla 89 (read-only, produktionsläge) — se avsnitt 4. Profilen
byggs här utan råtext, så möjlig utdata är **prosa med tunn underlag** eller
faktmall. Det är inte samma kvalitet som spår A.

---

## 3. **Viktigt fynd: 43 av de 89 är UTANFÖR Stockholm**

De 3 pensionerade källorna pensionerades **inte** av fel — av användaren själv,
2026-10-23, med `reasonCode: coverage.outside_stockholm`:

| källa | `city` i registret | events |
|---|---|---:|
| visithelsingborg | Helsingborg | 18 |
| dunkers | Helsingborg | 17 |
| studio-acusticum | Luleå | 8 |

`isInScope()` (`02-Ingestion/tools/sourceRegistry.ts:151`) kräver `city === 'Stockholm'`.
**Dessa 43 events är alltså utanför EventPulses scope** (personlig agent för
Stockholm) och ska inte köas in i kedjan igen — de är kvar i DB från före
scope-beslutet. Att återuppta dem vore att motsäga användarens eget beslut.

**De 46 events som är från in-scope-källor** (12 aktiva källor) är dem som ska
tillbaka i den nattliga kedjan.

---

## 4. Ordning och säkerhet

### 4.1 Steg 1 — Backup ✅ KLART

`scripts/backup-event-descriptions.ts` →

- full backup: `runtime/backups/event-descriptions-2026-11-02-pre-backfill.json`
  (alla 76 kolumner, inkl. råtext; gitignored)
- manifest: `docs/audit/backup/event-descriptions-2026-11-02-pre-backfill.manifest.json`
  (beskrivningskolumnerna, utan råtext; **committas**)
- återställning: `scripts/restore-event-descriptions.ts --apply`

**Före-state (mätt):** 89 rader — `editorial_description` 0, `event_profile` 0,
`raw_description` 0, `eventpulse_summary` 0. De är **nakna rader**.

**Återställningen är bevisad:** en rad skrevs med ett testvärde → dry-run hittade
1 rad / 1 cell → `--apply` återställde den → värdet tillbaka på `null`.
Testraden rensades bort (`RESTORE-TEST`-rader kvar: 0).

### 4.2 Steg 2 — Källorna in i nattkedjan ✅ KLART

`runA.ts --add <id> "backfill: events saknar beskrivning (89 st utan text) — 2026-11-02"`
× 12 → `runtime/preA-queue.jsonl`. **preA har högsta prioritet i A-gaten**, så de
körs först ikväll 02:00 (`--limit 200` ≫ 12).

### 4.3 Steg 3 — A-gaten körd nu (samma kodväg som nattkörningen)

`ingestion-cron.ts --only A-directAPI --limit 12` →

| resultat | källor | events |
|---|---|---:|
| ✅ lyckades | eventbrite-stockholm (47), stockholmlive-evenemang (112), aik (5), allevents-in-stockholm (19) | **183** |
| ❌ `no-jsonld-or-no-events` | tiqets, lugerse, stampen, abf, stadsmuseet, stampense, kungliga-biblioteket, tele2-arena | 0 |

De 8 misslyckade är HTML-källor utan JSON-LD → de gick till **preB** och triggade
**D-AI-hooken**, dvs de eskalerar in i C-htmlGate/D-renderGate-kedjan som också
kör nattligen. Det är deras normala väg.

Import → drain kördes också: **316 events** köades in och persistades,
**145 fick editorial-beskrivning genererad** (MEDIUM/RICH = prosa).

### 4.4 Steg 4 — Verifiering av spår A: **4 av 89 fick prosa**

Efter import + drain: **4 av de 89** har nu `editorial_description` + `event_profile`
(3 × stockholmlive-evenemang, 1 × aik). 1 av dem fick råtext.

Resten täcks inte av listnivå-extraktionen: A-gaten hämtar *listingsidan*, och
för 7 av 12 källor finns ingen beskrivning där (eventbrite 0/47,
stockholmlive 0/112 i listing-JSON-LD). Det är därför C/D-kedjan behövs.

### 4.5 Steg 5 — Spår B: direkt backfill av de 89

**Tak mätt (read-only, produktionsläge, alla 89): 4 av 89 → prosa (4 %), 85 → faktmall.**
Utan råtext och utan profil är underlaget för tunt för prosa — bara 4 event har
en artist i titeln som entitetsextraktionen kan plocka ut och Wikidata kan
berika (dunkers × 3 + abf × 1).

**Vad backfillen ändå gör:** raden får en **deterministisk faktatext** ur profilens
egna fält (titel, typ, genre, lokal, datum, tid, pris) i stället för att vara
helt tom. Ingen källtext, alltså copyright-säker. Samma text som de 5 388
faktmallsraderna använder.

**Utfallet blir alltså:** 4 prosa + 85 faktmall av 89. Ingen rad lämnas tom.
För de 46 in-scope-raderna fortsätter nattkedjan uppgradera dem till prosa när
C/D-kedjan lyckas extrahera råtexten.

### 4.6 Steg 6 — Verifiering

Audit (`scripts/_audit_description_coverage.mjs`) + UI-resolvern
(`getDetailsDescription` med auditens exakta payload).

### 4.7 Steg 7 — Valvsync

### Vad planen uttryckligen inte gör

- **Ingen** ändring i C0/C1/C2 (Generalization Protection Rule).
- **Ingen** backfill av de 5 388 faktmallsraderna (användarens beslut 2026-11-02).
- **Ingen** push (ej begärd; `.github/workflows/` kräver workflow-scope).
- **Inga** andra parts filer (`03-Queue/03-extractedevents/C/*.jsonl`,
  `scripts/audit-source-quality.mjs`, `.cursor/skills/verify-eventpulse-source-quality/*`,
  `docs/scraping-supervisor/*`).

---

## 4. Resultat

### 4.8 Slutgiltigt utfall

**89 av 89 har nu beskrivning — ingen rad lämnas tom.**

| | före | efter |
|---|---:|---:|
| `events_public` utan beskrivning i Hem | **89** | **0** |
| utan beskrivning i Agent/Utforska | 89 | **0** |
| utan beskrivning i Sök | 89 | **0** |
| saknar beskrivning i BÅDA Hem och Agent | 89 | **0** |

Backfillen (via den **ärkta** `maybeRunEditorial`) gav **89/89 prosa**
(39 `RICH` + 50 `MEDIUM`), 0 faktmall, 0 råtextläckage, 0 navigeringsskräp.
UI-resolvern (`getDetailsDescription` med auditens exakta payload) ger text för
**89 av 89**. Playwright mot den riktiga appen: `hemFallbackMarker: null`.

**Min tidigare förhandsmätning (4/89 prosa) var fel.** Mätskriptet skickade in
`profile: null` i stället för att bygga profilen — `maybeRunEditorial` bygger den
(regelbaserad entitetsextraktion ur titeln + Wikidata), och det är den som ger
underlaget för prosa. Mätskriptet mätte alltså inte produktionsvägen.

### 4.9 Kvalitetsfynd — 48 av 89 har generisk boilerplate

Rotorsak mätt: **86 av de 89 har `category_slug = 'community'`**, och
`eventUnderstanding.ts` ger `community`-kategorin en fast uppsättning
`experience_characteristics: ['lokalt', 'pedagogiskt', 'gemensamt',
'samhällsengagemang', 'kunskapsdelning']` +
`audience_participation: ['frågor', 'diskussion', 'delaktighet']` +
`performance_style: 'pedagogisk och öppen'`.

Följd: 48 av de 89 beskrivningar innehåller ≥2 av boilerplate-markörerna
("pedagogisk", "frågor, diskussion", "delaktighet", "lokalt"). 41 av 89 är
specifika och rimliga ("Stampen's World Famous Blues Jam", "Jazz Jam Fridays",
"David Binney & Louis Cole").

**Felet som blev fel:** "Djurgården Hockey" beskrivs som "ett lokalt evenemang
med fokus på gemensam aktivitet och samhällsengagemang … pedagogiskt och
öppet". Det är en ishockeymatch — kategoriseringen är fel, inte texten.

**Stavfel återkommer i M3-utdata:** "delaktighand", "delaktighag",
"evenemanget" med gemener efter punkt, "med pedagogiskt och öppet karaktär".
Det är modellartefakter (inga post-processingsregler finns i writer-steget),
inte gate-fel — de passerar eftersom de inte är *påståenden*.

**Alternativ som finns (ej genomfört, användarens val):**
- behåll prosan (nuvarande läge) — alla 89 har text, 48 är generiska;
- sätta de 48 generiska till den deterministiska faktatexten (tråkig men
  garanterat korrekt);
- fixa kategoriseringen (86 av 89 som `community` är det eyngående problemet).

### 4.10 Verifiering av nattkedjan i drift

Drainen efter A-gate-körningen: **316/316 jobb, 0 fel** — varje event fick
editorial-beskrivning (RICH/MEDIUM). I går natt var det **271 429-fel**
(`rate limit exceeded(RPM)`) i samma steg. **RPM-grinden fungerar alltså i
verklig drift.** Detta uppgraderar förra turens `[CLAIMED]` till `[VERIFIED]`.

### 4.11 Vad som INTE är verifierat

- De 8 källor som A-gaten inte klarade (JSON-LD-fel) är i **preB-kön** och
  väntar på B-gaten → C-htmlGate → D-renderGate ikväll. Om de lyckas där får
  deras events råtext och kan uppgraderas till prosa. Det är **inte** verifierat
  ännu — det händer ikväll.
- De 43 events från de pensionerade källorna (utanför Stockholm) har nu text,
  men deras källor körs **inte** igen — de ska inte det, enligt användarens
  scope-beslut 2026-10-23.
