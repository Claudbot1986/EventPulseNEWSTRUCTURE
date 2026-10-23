# Källstatus och scope

## Sub-features

- **`runtime/sources_status.jsonl`** — auktoritativ per-källa-status,
  skrivs om hela av `writeStatusFile` (`sourceRegistry.ts:358-361`).
- **`getSourceStatus(id)`** — saknas rad → standardobjektet med
  `status: 'never_run'`, `attempts: 0`, `lastEventsFound: 0`.
- **`isInScope(source)`** — en rad: `(source.city ?? '').trim() === 'Stockholm'`
  (`sourceRegistry.ts:150`). Ingen geografi, ingen fuzzy matchning.
- **`updateSourceStatus(id, result)`** — skriver tillbaka raden med
  `lastEventsFound`, `lastRoutingReason`, `lastPathUsed`, `triageResult`,
  `preferredPath`, `pendingNextTool`.
- **A-gatets filter** — `status === 'never_run'` (`runA.ts:259-262`). Endast
  det; `fail` körs aldrig om.
- **Kyrkograv** — `sources/_quarantine/` + `sources/_retired/`, vardera med
  `INDEX.json` (`{sourceId, url, movedAt, reasonCode, note, movedBy}`).
  `quarantineGuard.ts:134 isSkipped()` läser dem; A och B konsumerar
  skipset. Hanteras av `02-Ingestion/tools/lifecycle-admin.ts`
  (`quarantine` / `retire` / `restore` / `list`). **`retire` kräver `--by`** —
  begravning är ett mänskligt beslut, aldrig automatiskt.
- **`coverage.outside_stockholm`** är en giltig `ReasonCode`
  (`sourceLifecycle.ts:70`) och betyder "staden är inte Stockholm, så
  `isInScope()` släpper aldrig igenom den".
- **Utdata till bullmq** — inte A/B/C/D/I: de skriver JSONL. Se
  `queue-chain.md`.

## How to get to it (user POV)

Du har en ny venue som discovery hittade och promote:ade till
`sources/<slug>.jsonl`, och A-gatet säger "Both preA-queue and sources-main
are empty". Du vill veta varför. Svaret nästan alltid: raden i
`sources_status.jsonl` säger `fail` (aldrig omkörd), eller posten i
`sources/*.jsonl` saknar `city: "Stockholm"` och filtreras bort av
`isInScope()`.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# Statusfördelning
jq -r '.status' runtime/sources_status.jsonl | sort | uniq -c | sort -rn

# Specifik källa
jq -c 'select(.sourceId=="nalen")' runtime/sources_status.jsonl

# Scope-fälter: vilka promoteade/discovery-källor är synliga för A?
node --input-type=module -e "
import {readdirSync,readFileSync} from 'node:fs';
let inScope=0,out=0,total=0;
for (const f of readdirSync('sources').filter(x=>x.endsWith('.jsonl'))) {
  for (const line of readFileSync('sources/'+f,'utf8').split('\n')) {
    if(!line.trim())continue; total++;
    const s=JSON.parse(line);
    if((s.city??'').trim()==='Stockholm')inScope++; else out++;
  }
}
console.log({total,inScope,outOfScope:out});
"

# Saknar city helt? (vanligaste orsaken till tomma körningar)
jq -c 'select(.metadata.sourceCandidateId and (.city==null or .city=="")) | {id,city}' sources/*.jsonl | head -5

# Kyrkogravet — vad är begravt och varför
npx tsx 02-Ingestion/tools/lifecycle-admin.ts list --all

# Oanvändbara filer som INTE är begravda (ska vara tomt — gate e6)
node --input-type=module -e "
import {readdirSync,readFileSync} from 'node:fs';
const bad=[];
for (const f of readdirSync('sources').filter(x=>x.endsWith('.jsonl'))) {
  const s=JSON.parse(readFileSync('sources/'+f,'utf8').trim());
  if (s?.metadata?.sandbox) continue;
  if ((s.city??'').trim()!=='Stockholm') bad.push(f+' city='+(s.city??'(saknas)'));
}
console.log({outOfScope: bad.length, bad: bad.slice(0,5)});
"
```

## Gotchas

**En rad utan `city` är osynlig för A.** Detta var den största bristen
2026-10-23: `city` fanns ingenstans som kolumn, så promoteade filer fick ingen
stad, `isInScope()` var falsk, och A loggade "Both preA-queue and
sources-main are empty" med 8 giltiga källor osynliga. Nu finns
`city`-kolumnen i `source_candidates` och `source_candidate_test_queue`
(migration `20261021-0003`) och bärs hela vägen queue → CLI → promote.

**"Sweden" är inte en stad.** `isInScope()` kräver exakt `'Stockholm'`, så
ett fältvärde `Sweden` är precis så osynligt som `null`. Mätt 2026-10-23 fanns
9 filer märkta `Sweden` — 4 av dem (fallan, stadsmuseet, stampen, zita) var
faktiskt Stockholmskällor och fick `city: "Stockholm"` med belägg i
`metadata.cityEvidence`; de 5 återstående begravdes som
`coverage.outside_stockholm`.

**`metadata.cityEvidence` + `cityRepairedAt` finns på 14 filer.** De markerar
de stadslösa filer som fick `city` tilldelad i hand i stället för att härledas
ur URL:en automatiskt. Läs `cityEvidence` innan du ifrågasätter en `city`.

**92 filer var oanvändbara utan att begravas.** Mätt 2026-10-23: 73 med
uttrycklig annan stad, 10 utan stad, 9 märkta `Sweden` — samtidigt som A-gatet
kördes på tomma preA-körer. 78 begravdes, 14 fick stad. Noll kvar.
Kör `scripts/verify-fixes.mjs e6` för att hålla koll.

**`getSourceStatus` returnerar en standardrad, inte `undefined`.** En källa
utan rad är `never_run` — inte "saknas". Kod som förväntar sig `undefined`
ser aldrig det.

**Statusfilen skrivs om hela, inte append.** `wc -l` före/efter en A-körning
visar inte "hur många nya". Jämför innehåll per `sourceId`.

**`fail` är permanent för A.** Filtret är exakt `status === 'never_run'`.
256 av 332 källor har `fail`. De körs inte igen, och det är en medveten
design (planen avsäger automatisk återköning). Rapportera inte det som en bugg.

**`sources_audit.jsonl` är inte statusfilen.** Den är en quarantine-händelselogg
och räknas inte av `getSourceStatus`.

**`status`-värdena är `success` / `fail` / `never_run`.** En rad med något
annat är från en äldre kodväg. Verifiera formatet innan du tolkar en
distribution.

**`getAllSources()` läser både pretty-printad JSON och JSONL.**
(`sourceRegistry.ts:173-193` testar hela filen som ett objekt först, sedan
radvis.) Rått formaterade `sources/*.jsonl` är därför *inte* en rad per
post — `wc -l` ger 30 för en post. Räkna poster med parsern, inte `wc -l`:

```bash
node --input-type=module -e "
import {getAllSources} from './02-Ingestion/tools/sourceRegistry.ts';
" 2>/dev/null || npx tsx -e "
import {getAllSources} from './02-Ingestion/tools/sourceRegistry.js';
console.log(getAllSources({scope:'all'}).length);
"
```

**246 filer i `sources/` ≠ 246 källor.** Räkna med parsern om du vill
jämföra mot `jq '.status' runtime/sources_status.jsonl | sort | uniq -c`.