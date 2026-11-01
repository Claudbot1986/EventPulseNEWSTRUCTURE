---
name: verify-eventpulse-source-quality
description: |
  Verify the TRUTH and the RICHNESS of what EventPulse discovers — is what
  lands in the graph actually events (not blog articles), and does each row
  carry the information that sits on the event's own page. Use for
  /verify-eventpulse-source-quality, when a newly promoted source turns out to
  be a news/blog site, when events land without venue or description, or before
  deciding which legacy sources to purge. Surface is a CLI verification suite
  (scripts/verify-source-quality.mjs, scripts/audit-source-quality.mjs,
  scripts/enrich-event-details.mjs) reading the live Supabase project and the
  real extraction files — it inspects and enriches, it never deletes. Pipeline
  mechanics (stages, launchd, logs) live in verify-eventpulse-discovery;
  discovery→ingestion handoff in verify-eventpulse-ingestion-discovery.
disable-model-invocation: false
---

# verify-eventpulse-source-quality

Två frågor, en skill:

1. **Är det riktigt?** Är raderna som landat i grafen evenemang — eller
   artiklar från en blogg som såg ut som en evenemangslista?
2. **Är det riktigt innehåll?** Bär raden den information som står på
   evenemangssidan (beskrivning, plats, bild) — eller bara det lilla
   "biljettkortet" som listningen gav?

Denna skill mäter på **riktiga data**: live-Supabase och de faktiska
extraherade raderna. Inga fixtures, ingen simulering.

## Launch

Det finns ingen server att starta. EventPulse är en batch-pipeline som
launchd (`com.eventpulse.ingestion`) kör varje natt kl 02:00. Den här skillen
driver **skript**, inte kedjan.

**Förberedelse (engångs per maskin):**

```bash
cd /Users/claudgashi/EventPulse
npm ci                      # om node_modules saknas
test -f .env && echo ".env OK" || echo "SAKNAS .env — Supabase-nycklar saknas"
```

`.env` måste innehålla `SUPABASE_URL` och `SUPABASE_SERVICE_ROLE_KEY`. Utan dem
returnerar skripten tomma resultat, inte ett fel — kontrollera alltid att
raderna är nollor innan du drar slutsatser.

**Kör en verifiering:**

```bash
npx tsx scripts/verify-source-quality.mjs
```

`npx tsx` är **obligatoriskt**: skripten importerar `.ts`-moduler
(`eventLikeness.ts`, `pageProbe.ts`, `decision.ts`, `detailEnrichment.ts`)
direkt. `node` kan inte lösa dem och ger
`ERR_UNKNOWN_FILE_EXTENSION` eller "Cannot find module".

**Ready-signal:** raden `bevis: runtime/verification-reports/source-quality-<TS>.json`
och en avslutande rad `röda gater : ...`. Processen avslutas med kod 1 om
någon gate är röd, 0 annars.

**Isolering:** ingen låsfil. Gaten och auditen är **read-only mot databasen**
och skriver bara bevisfiler. Berikningen skriver till extraktionsfilerna om
den körs utan `--dry-run` — kör den alltid med `--dry-run` om du inte uttryckligen
ska ändra data.

**Starta aldrig ingestion-kedjan från denna skill.** Den ägs av launchd, och
`scripts/ingestion-cron.ts` vägrar starta om en levande kedja hittas
(`liveChainPids()`).

## Doctor

En read-only check som svarar på "är det här värt att verifiera just nu?".
Kör alltid först.

```bash
cd /Users/claudgashi/EventPulse

# 1. Finns .env med databasnycklarna?
grep -c "^SUPABASE_URL=\|^SUPABASE_SERVICE_ROLE_KEY=" .env
# → förväntat: 2

# 2. Får vi kontakt med Supabase? (räkna rader i events_public)
npx tsx -e "
(async () => {
  const dotenv = (await import('dotenv')).default;
  dotenv.config({path:'.env'});
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { count, error } = await sb.from('events_public').select('*', {count:'exact', head:true});
  console.log(error ? 'FEL: ' + error.message : 'events_public = ' + count);
})();
"
# → förväntat: events_public = <ett tal > 0
#   NOTERA: `npx tsx -e` kör som CJS — top-level await ger
#   "Top-level await is currently not supported with the cjs output format".
#   Kapsla därför i (async () => { ... })();

# 3. Kör en levande ingestion-kedja? (då ska vi inte röra extraktionsfilerna)
ps auxww | grep -E "scripts/ingestion-cron|runDaily" | grep -v grep
# → förväntat: tomt, eller en kedja som vi låter vara i fred.

# 4. Finns extraktionsfilerna som gaten läser?
ls 03-Queue/03-extractedevents/ | head -5
ls sources/*.jsonl | wc -l
# → förväntat: mappar med .jsonl, och ett hundratal källfiler.
#    0 ⇒ inget att verifiera (kedjan har aldrig kört).

# 5. Är själva gaten körbar?
npx tsx -e "
(async () => {
  const m = await import('./07-Discovery/src/sourceTesting/eventLikeness.ts');
  console.log('eventLikeness laddad:', typeof m.assessLikeness === 'function');
})();
"
# → förväntat: "eventLikeness laddad: true"
```

Doctor-failure = antingen ingen data att verifiera (OK — gör inget), eller
saknad `.env` / trasig installation (åtgärda först). Om steg 3 visar en levande
kedja: kör bara read-only-kommandona (gaten, auditen) — skriv inte till
extraktionsfilerna medan kedjan jobbar.

## Drive

Harness = shell + `npx tsx` + `jq` mot JSON-rapporter. Inga Playwright, ingen
UI, ingen egen sub-process-spawning utöver de tre skripten.

### Primär körning — hela gaten Q1–Q9

```bash
cd /Users/claudgashi/EventPulse
npx tsx scripts/verify-source-quality.mjs --window 48
```

| Gate | Frågan | Röd = ? |
|---|---|---|
| Q1 | producerar discovery nya kandidater? | ingen ny discovery → rött |
| Q2 | sparar P3D beslut? | inga beslut att bedöma |
| Q3 | skrev promote källfiler? | fil saknas → promote bruten |
| Q4 | når källorna databasen? | källa utan events → överlämning bruten |
| Q5 | **SANNING** — är det gaten släppt igenom evenemang? | artikelkälla igenom |
| Q6 | **RETRO-GATE** — blockerar P3D:s motor artiklar utan falsklarm? | gaten biter inte / falsklarm |
| Q7 | **RIKEDOM** — bär raderna sidans uppgifter? | sämre än baslinj (18 % plats) |
| Q8 | **NEGATIV KONTROLL** — fångas artiklar, släpps evenemang? | klassifikatorn kan inte skilja |
| Q9 | fyller berikningen fält på riktiga sidor? | berikningen är en no-op |

Förväntat utfall på oförändrad data (mätt 2026-11-01):

```
  OK      Q1 discovery producerar nya kandidater — 63 nya kandidater …
  OK      Q2 P3D testade kandidater och sparade beslut — 48 beslut (23 promote, 25 reject)
  OK      Q3 promote skrev källfiler — 20/20 källfiler finns (…)
  OK      Q4 de nya källorna når databasen — 19/20 källor har events i events_public (154 rader)
  UNKNOWN Q5 SANNING — … gaten har inte körts på ny data ännu
  OK      Q6 RETRO-GATE — 3/45 källor skulle blockats, 0 falsklarm
  OK      Q7 RIKEDOM — plats 211/518 (41 %, baslinj 18 %) · beskrivning 0/518
  OK      Q8 NEGATIV KONTROLL — 7/7 artiklar fångade · 8/8 evenemang släppta igenom
  OK      Q9 berikningen fyller fält på riktiga detaljsidor — 2/12 rader fick fält ifyllda
```

**Q5 är UNKNOWN tills en ny P3D-körning har skettit sedan gaten infördes.**
Det är inte ett fel — det betyder att gaten ännu inte prövats på ny data. Se
"Gotchas".

### Sekundär körning — källöversikt (radarar aldrig)

```bash
npx tsx scripts/audit-source-quality.mjs              # titlar + DB-statistik
npx tsx scripts/audit-source-quality.mjs --deep       # hämtar detaljsidorna
npx tsx scripts/audit-source-quality.mjs --json > /tmp/audit.json
npx tsx scripts/audit-source-quality.mjs --source kollaborationse,thatsupse
npx tsx scripts/audit-source-quality.mjs --deep --probe-limit 3
```

Utskriften listar varje källa med `event` / `artikel` / `okänt` + antal rader.
`--deep` hämtar detaljsidorna (långsammare, men ger sidbeviset) och lägger till
en signalkolumn som visar vilken signal som faktiskt användes.

**I `--json`-läge är stdout ren JSON** (mänsklig text går till stderr), så
`--json > fil` ger en fil som går att parsa direkt.

### Sekundär körning — berikning (utan skrivning)

```bash
npx tsx scripts/enrich-event-details.mjs --dry-run --per-source 2 --global 8
```

Utskrift: `filer genomskummade / rader granskade / rader hämtade / rader
berikade / fält ifyllda`. `--dry-run` skriver INTE tillbaka. Utan `--dry-run`
skrivs de extraherade raderna tillbaka — det är en dataändring, inte en
verifiering.

### Enhetsnivå — klassifikatorns beteende

```bash
npx vitest run 07-Discovery/src/sourceTesting/
# → 3 filer, 44 tester
```

Testerna innehåller **negativa kontroller med riktiga titlar från grafen** —
kända artiklar som ska fångas och kända evenemang som inte får fällas.

## Evidence

**Bevisfiler** (gitignorade, överlever cleanup):

| Fil | Vad |
|---|---|
| `runtime/verification-reports/source-quality-<TS>.json` | gaten Q1–Q9, fullständig |
| `runtime/verification-reports/audit-<TS>.json` | källöversikten (med `--json`) |
| `runtime/verification-reports/mini-ingestion-*.json` | grann-kedjans bevis |

Rapportens `gates[]` innehåller per gate: `id`, `title`, `ok`, `verdict`,
`detail` och gate-specifika data (`perSource`, `blocked`, `falseAlarms`,
`samples`).

**Databasspår** — vad gaten mäter:

```bash
npx tsx -e "
(async () => {
  const dotenv = (await import('dotenv')).default;
  dotenv.config({path:'.env'});
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await sb.from('events_public')
    .select('source,title_sv,venue_full_name,description_sv,image_url').limit(5);
  for (const r of data) console.log(r.source, '|', r.title_sv, '|', r.venue_full_name, '|', r.description_sv);
})();
```

**Verifieringsprovenok:**

- Kör mot riktig Supabase och riktiga extraktionsfiler. Inga fixtures.
- En gate som inte kan skilja artiklar från evenemang är trasig, oavsett hur
  grön den ser ut — därför finns Q8 och Q6:s falsklarmkontroll.
- "Okänd" är ett giltigt utfall och ska rapporteras som okänd, inte som
  grön.
- Berikningen får aldrig hitta på uppgifter: varje fält kommer från sidans
  eget innehåll, och fält som redan har ett värde skrivs inte över.

## Cleanup

Denna skill startar inga långlivade processer och dödar inga processer.

- Gaten och auditen är **read-only mot databasen** — de skriver bara
  bevisfiler.
- `enrich-event-details.mjs --dry-run` skriver ingenting.
- `enrich-event-details.mjs` **utan** `--dry-run` skriver tillbaka de
  extraherade raderna (`03-Queue/03-extractedevents/`). Det är en avsiktlig
  dataändring — kör den bara när det är meningen.
- `runtime/`, `sources/` och `03-Queue/03-extractedevents/` är gitignorade.
  Radering av dem är inte cleanup — det är dataradering och ett eget beslut.

Bevis (JSON-rapporter, DB-räkningar) lämnas intakta.

## Helpers

- `scripts/verify-source-quality.mjs` — gaten Q1–Q9. Flaggor: `--window <h>`,
  `--json`. Exitkod 1 om någon gate är röd.
- `scripts/audit-source-quality.mjs` — källöversikt. Flaggor: `--deep`,
  `--json`, `--source <id,id>`, `--probe-limit <n>` (default 3). Raderar aldrig.
- `scripts/enrich-event-details.mjs` — berikning. Flaggor: `--dry-run`,
  `--per-source <n>`, `--global <n>`, `--verbose`.
- `scripts/audit-source-quality.mjs` och `verify-source-quality.mjs` delar
  logik: `02-Ingestion/tools/detailEnrichment.ts` (HTML-parsning),
  `07-Discovery/src/sourceTesting/eventLikeness.ts` (klassificering),
  `07-Discovery/src/sourceTesting/pageProbe.ts` (sidhämtning),
  `07-Discovery/src/sourceTesting/decision.ts` (P3D:s beslutsfunktion).

## Gotchas

**`npx tsx`, inte `node`.** Alla tre skripten importerar `.ts`-moduler
direkt. `node` ger "Cannot find module" — det är inte ett trasigt repo.

**Q5 är UNKNOWN tills gaten körts på ny data.** Gaten infördes
2026-11-01 (`f1781596`). Promotes som skedde *innan* dess gick inte genom
gaten, så Q5 mäter dem inte — de mäts i stället av Q6 (retro-gaten) och
redovisas som skuldbank. För att få Q5 grön behövs en ny P3D-körning efter
gaten.

**Retro-gaten (Q6) är rätt sätt att mäta gaten på befintlig data.** Den kör
P3D:s **riktiga** `decideSourceCandidateOutcome` med de verkliga raderna från
varje promote:ad källa. Det svarar på "vad hade gaten blockat?" — mätt, inte
gissat. Mätt 2026-11-01: 3 av 45 källor blockas (thatsupse 65 rader,
kollaborationse 8, kulturfestivalenstockholmse 4), 0 falsklarm.

**Kategori-sidor är inte evenemangssidor.** En rad vars `url` är samma som
`sourceUrl` är en *listningsrad*; sidan beskriver hela listan, inte raden.
Mätt 2026-11-01 på musikaliskase.se: alla 30 raderna pekade på
kategorisidor (`/musikstilar/popmusik/`) som bär JSON-LD-typen `article` som
en mallartefakt. Gaten blockerade en källa med 30 riktiga evenemang.
`probeRowPages` läser därför **bara detaljrader** (`url ≠ sourceUrl`). Ändra
inte tillbaka utan att verifiera på musikaliskase igen.

**"En källa som deklarerar Event blockeras aldrig" gäller per RAD.** Koden
hoppar över Event-rader, men en källa med en Event-rad och två artikelrubriker
blockeras ändå. Att ingen deklarerande Event-källa blockas är en **mätning**
(retro-gatens falsklarmkontroll), inte en kodgaranti.

**Tröskeln är "minst 2 artikelrader OCH minst 30 % av de BEDÖMDA raderna".**
Sidodeklarerade artiklar räknas i samma täljare som artikelrubriker. En rad
utan `sourceUrl` räknas som detaljrad.

**Signalen är ensidig.** Sidans JSON-LD `Article`/`NewsArticle` **bevisar**
artikel. Frånvaro av `Event`-typ bevisar **inte** artikel — royaldjurgarden.se
är ett riktigt evenemang utan JSON-LD. `og:type=article` ensamt blockerar
aldrig, av samma anledning.

**Rubrikmönster är indikation, inte bevis.** Tröskeln är "minst 2 artiklar
OCH minst 30 % av raderna". En enda artikelrubrik blockerar inte — annars
fäller "Benjamin Ingrosso – What Happens Next?" (biljettnuse) ut en bra
källa.

**En del sajter svarar 429.** www.famgo.se rate-limitar → hämtningen ger 429
och raden ser tom ut. Q9 räknar nätverksfel separat. En källa bakom en
bot-vägg ser alltså tom ut i mätningen — det är inte samma sak som "källa
utan evenemang".

**Kolumnnamnen i `events_public`:** `title_sv`, `title_en`, `venue_full_name`,
`description_sv`, `description_en`, `image_url`, `source`. **Inte** `title`,
**inte** `url`, **inte** `source_id`.

**Beskrivning är fortfarande 0 % i grafen.** Mätt 2026-11-01 efter fixen av
berikningens villkor: 211/518 rader har plats (41 %, baslinj 18 %) men 0/518
har beskrivning. Berikningen skriver `description` i extraktionsfilerna —
importen mappar det vidare, men det har inte kommit igenom en hel kedja ännu.
Behandla det som **ej verifierat** tills en körning visar det.

**`.env` saknas → tomma resultat, inte fel.** Skripten laddar `.env` själva
via dotenv. Utan nycklar returnerar gaten nollor utan att klaga. Kolla
alltid Doctor steg 1–2 innan du tolkar en utdata.

## Maintenance

Kör `/maintain-verification-skill` när något händer:

- `eventLikeness.ts` får nya mönster eller nya trösklar → uppdatera Q8:s
  kontrolltitlar och `KNOWN_ARTICLE_TITLES` / `KNOWN_EVENT_TITLES`.
- P3D:s beslutsfunktion byter namn eller form → uppdatera retro-gatens import.
- En ny spalt i `events_public` → uppdatera `rowsForSources`.
- `GATE_INTRODUCED_AT` i `verify-source-quality.mjs` → datumet gaten infördes;
  ändra det bara om gaten flyttas.
- En ny konsolideringsmetod → ny feature-fil i `features/`.

## Feature map

| Feature | Feature-fil |
|---|---|
| Kvalitetsgaten (P3D) | `features/p3d-quality-gate.md` |
| Retro-gate på befintlig data | `features/retro-gate.md` |
| Detaljberikning | `features/detail-enrichment.md` |
| Källkvalitet och audit | `features/source-audit.md` |
