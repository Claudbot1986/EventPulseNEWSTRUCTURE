---
name: verify-eventpulse-handoff
description: |
  Verify the EventPulse discovery→ingestion handoff: that candidates found by
  P3A/P3B/P3C reach `source_candidates`, are claimed by P3D, tested through the
  real A/B/C/D gates in a sandbox, and — if they pass — promoted into
  `sources/*.jsonl` where the A-gate can actually pick them up
  (07-Discovery/src/sourceTesting/{runSourceCandidateTests,runner,sandbox,
  decision,phases,supabaseRepository,realToolRunner}.ts,
  05-Supabase/migrations/*source-candidate*).
  Use when discovery finds venues that never reach ingestion, when P3D exits
  non-zero, when promote writes nothing, when `sources/*.jsonl` files lack
  `city`, or when the test queue is stuck in `processing`. The whole point of
  this skill is the SEAM: every other failure here is loud, but a missing
  `city` makes a promoted source invisible to `isInScope()` with no error at
  all. Surface is DB rows + JSONL files + one CLI; the gates themselves live
  in verify-eventpulse, and the discovery producers in
  verify-eventpulse-discovery.
disable-model-invocation: false
---

# verify-eventpulse-handoff

Det här är **sömsen** mellan discovery och ingestion. Inte kedjan — just
punkten där de möts.

Kedjan kan se helt grannat ut och ändå vara trossad. Exempel från
2026-10-23: 459 kandidater i databasen, 16 promote-beslut, filer på disk —
och noll av dem syntes för A-gatet, för att `city` inte existerade någonstans
i kedjan och `isInScope()` är en enda rad:

```ts
// 02-Ingestion/tools/sourceRegistry.ts:150
export function isInScope(source: SourceTruth): boolean {
  return (source.city ?? '').trim() === 'Stockholm';
}
```

Inget felmeddelande. Ingen röd. Bara tystnad. Den här skillen finns för att
den sortens tystnad inte ska få passera som "fungerar".

## Launch

Ingen server. Tre saker går att köra, i stigande kostnad:

| Steg | Kommando | Skriver | Kör tid |
|---|---|---|---|
| Claima + testa | `npx tsx 07-Discovery/src/sourceTesting/runSourceCandidateTests.ts --phase=smoke --limit=1` | DB + möjligen `sources/*.jsonl` | 1–5 min/kandidat |
| Promote (redan testad) | inget CLI — `runner.ts` promote:ar inom samma körning | `sources/<slug>.jsonl` + `runtime/discovery-ui-queue.jsonl` | — |
| Backfill av stad | `npx tsx 07-Discovery/src/sourceTesting/backfillCandidateCities.ts` | `source_candidates.city` + kön | 1–2 min |

**`--phase` är inte valfritt i praktiken.** `decision.ts:59` kan bara ge
`promote` när `phase === 'smoke'` — alla andra faser ger `manual_review` med
"requires smoke before promote". Kör `--phase=smoke` om du vill se en
promote.

**`--limit` är flaggad `--limit=`, inte `--limit `.** `argValue()`
(`runSourceCandidateTests.ts:9-11`) letar efter `--limit=` med likhetstecken.
`--limit 5` tyst ignoreras → default 1.

**Testet kör de riktiga gaten.** `RealAbcdSourceCandidateRunner`
(`realToolRunner.ts:63-69`) spawnar `Alltools-E2E/e2e.py --from-preA --limit 1
--apply` med `EVENTPULSE_SANDBOX_ROOT` satt till en temp-katalog. Ingen
syntetisk extraktion (CLAUDE.md:s regel om "no simulated extraction").
Därför är varje kandidat dyrt.

**Ready = JSON-raden per kandidat.** `runSourceCandidateTests.ts:44-51` skriver
en JSON-rad per kandidat med `{sourceCandidateId, phase, runId, decision,
reason}`. Ingen sådan rad = inget hände.

## Doctor

```bash
cd /Users/claudgashi/EventPulse
node .cursor/skills/verify-eventpulse-handoff/scripts/doctor-handoff.mjs
```

Skriver `runtime/verification-reports/handoff-doctor-<TS>.json`. Frågar:
kandidater med stad, kön per status, beslut per utfall, och hur många
promoteade filer som faktiskt bär `city: "Stockholm"`.

**Databasen nås via `DATABASE_URL` + `pg`, inte supabase-js.** Projektets
`SUPABASE_ACCESS_TOKEN`/`SUPABASE_PAT` är ogiltiga (HTTP 404 /
"Invalid access token") och det finns ingen `psql` på maskinen.
`08-Agent/scripts/apply-migration.ts` är den fungerande referensvägen.

Doctor FAIL = stoppa. En `promote > 0` med
`sourcesInStockholmScope == 0` betyder att sömsen är trossad igen — verifiera
inte något annat förr.

## Drive

Harness = `jq` mot DB via ett litet node-skript, `jq` mot JSONL, och
`grep` mot stdout. Se `scripts/dbq.mjs`.

**Stabila handtag:**

| Signal | Vem | Vad det betyder |
|---|---|---|
| `{"sourceCandidateId":…,"decision":"promote"}` | `runSourceCandidateTests.ts:44` | kandidaten skrevs till `sources/` |
| `reason` med `promote blocked: slug collision` | `runner.ts:81` | bara den kandidaten hoppades över |
| `{"status":"promoted_to_sources",…}` | `runtime/discovery-ui-queue.jsonl` | en rad per lyckad promote |
| `decision: 'manual_review'` | `decision.ts:87` | smoke persisterade 0 events → ingen promote |
| `decision: 'reject'` | `decision.ts:73` | sanity-fasen hittade ingen signal alls |

**Driv-mönster (sömsen, utan att köra något dyrt):**

```bash
cd /Users/claudgashi/EventPulse

# 1. Finns det kandidater som faktiskt kan nå Stockholm?
node .cursor/skills/verify-eventpulse-handoff/scripts/dbq.mjs \
  "SELECT btrim(city) AS city, engine, count(*)::int AS n
     FROM source_candidates GROUP BY 1,2 ORDER BY 3 DESC"

# 2. Bär de promoteade filerna city? (detta är själva sömsen)
node --input-type=module -e "
import {readdirSync,readFileSync} from 'node:fs';
let inScope=0, out=0, missing=[];
for (const f of readdirSync('sources').filter(x=>x.endsWith('.jsonl'))) {
  const c=readFileSync('sources/'+f,'utf8').trim();
  let o=null; try{o=JSON.parse(c);}catch{}
  const rows=o?[o]:c.split('\n').filter(l=>l.trim()).map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean);
  for (const r of rows) {
    if((r?.city??'').trim()==='Stockholm') inScope++;
    else { out++; missing.push(f); }
  }
}
console.log({inScope, outOfScope: out, examples: missing.slice(0,5)});
"

# 3. Har någon promote faktiskt passerat A-gatet?
node .cursor/skills/verify-eventpulse-handoff/scripts/dbq.mjs \
  "SELECT sc.url, d.decision, d.promoted_source_id
     FROM source_candidate_test_decisions d
     JOIN source_candidates sc ON sc.id = d.source_candidate_id
    WHERE d.decision = 'promote' ORDER BY d.created_at DESC LIMIT 10"

# 4. Mot den faktiska filen på disk
jq -c '{id, url, city, metadata}' sources/nalen.jsonl
jq -r 'select(.sourceId | test("nalen"))' runtime/sources_status.jsonl
```

## Evidence

**Beviset för sömsen är tre leder i samma mening**, i denna ordning:

1. **Beslutet** — en rad i `source_candidate_test_decisions` med
   `decision = 'promote'` och ett `promoted_source_id`.
2. **Filen** — `sources/<id>.jsonl` finns och bär `city: "Stockholm"`.
3. **Körningen** — samma `sourceId` har en rad i `runtime/sources_status.jsonl`
   med `status: "success"` eller `lastEventsFound > 0`.

(1) utan (2) = filen skrevs inte. (2) utan `city` = filen är osynlig för A.
(2) med `city` men utan (3) = filen syns men körs aldrig, för att raden i
`sources_status.jsonl` säger `fail` från en äldre körning.

Skriv bevis till `runtime/verification-reports/handoff-<feature>-<TS>.json`.
Det överlever cleanup.

## Cleanup

P3D-körningar avslutas själva. Det du behöver städa:

```bash
# Sandboxen tillhör varje kandidat och städas av runner.ts:94 i ett
# finally-block. Lämna den om du ser en vänsterprocess.
ls -d /tmp/eventpulse-source-candidate-* 2>/dev/null
```

Sandboxen tas bort även vid kast (`finally { removeSandboxSource(...);
rmSync(sandboxRoot, ...) }`, `runner.ts:92-95`).

**Promote skriver inte tillbaka.** En källa som P3D promote:ade ligger kvar i
`sources/` med `verifiedAt` satt. Att "köra tillbaka" är att ta bort filen
och raden i `discovery-ui-queue.jsonl` — gör det inte utan att veta varför.

Bevisfiler under `runtime/verification-reports/` lämnas kvar.

## Helpers

- `scripts/doctor-handoff.mjs` — hela Doctor-blocket, skriver JSON.
- `scripts/dbq.mjs "<SQL>"` — kör en SELECT mot `DATABASE_URL` och skriver
  TSV. Ingen `psql` på maskinen; detta är vägen.

```bash
node .cursor/skills/verify-eventpulse-handoff/scripts/dbq.mjs "SELECT status, count(*)::int AS n FROM source_candidate_test_queue GROUP BY 1 ORDER BY 2 DESC"
```

## Gotchas

**`city` är fältet som avgör allt.** Saknas det är källan osynlig för A utan
felmeddelande. Detta var bristen 2026-10-23 (migration `20261021-0003` la till
kolumnen i både `source_candidates` och `source_candidate_test_queue`, och
`city` bärs hela vägen query → kandidat → kö → CLI → promote).

**260 köposter har `city IS NULL` och är det av ett ärligt skäl.** Exa-vägen
slår ihop hela frågelistan till en URL-mängd, så `source_query` för en rad är
`"… | … | …"` och går inte att härleda stad ifrån i efterhand. De promote:as
utan stad och hamnar utanför Stockholms pool — konservativt och säkert, men
de matar inte appen. `backfillCandidateCities.ts` kan inte rekonstruera dem.

**Tre kandidaters stad är operatörsatt, inte härledd.** `konserthuset.se` ×2
och `nalen.com` har `city = 'Stockholm'` eftersom människan satte den. Båda är
Stockholmsinstitutioner och P3D:s smoke körning bevisade oberoende att de
serverar events. Skilj på detta när du rapporterar siffror.

**Slug-kollision är numera per kandidat, inte per batch.** Före 2026-10-23
kastade `promoteSourceCandidate` och dödade hela P3D-körningen. Nu loggar den
`[promote] slug collision for <id> … skipping` och returnerar `null`; `runner.ts`
vänder beslutet till `manual_review`. `decisions.promoteBlocked: 3` i doktorn
är alltså *rättat* beteende, inte ett pågående fel.

**Promote testar två sluggar.** Först den snygga domän-slugen
(`wwwmodernamuseetse`), sedan `candidate-<id8>-<slug>` om domänen redan
upptas av en annan URL. Utan detta kunde bara EN URL per domän någonsin
promote:as — varje evenemangssida på samma sajt slug:ar till samma namn.

**`hasCanonicalSourceUrl` hoppar över kandidatens egen post.** En rad i
`sources/` med `metadata.sourceCandidateId === <samma id>` räknas inte som
dubblett. Utan det kunde en kandidat aldrig uppdatera sin egen rad (t.ex.
sätta `city` på en tidigare promote).

**Stuck-rader i `processing` är historiskt 23 st.** `claim_source_candidate_test_queue(task_limit, target_phase)`
reclaimar rader med `locked_at < now() - interval '30 minutes'` (migration
`20261021-0003`). Utan migrationen ligger de där för alltid — det var 23 rader
som aldrig rörde sig igen.

**`eventsPersisted` och `eventsAfterNormalization` måste BÅDA vara > 0 för
promote** (`decision.ts:76`). Ett smoke som hittar events men inte persisterar
dem ger `manual_review`, inte `promote`. Det är rätt — men det gör att många
kandidater stannar i `manual_review` trots att de "hade events".

**Sandboxen sätter `EVENTPULSE_SANDBOX_ROOT`, och det ändrar C-gatets
rapportkatalog** till `$SANDBOX/07-Discovery/testResults/source-candidates/
c-htmlGate`. Letar du efter rapporter i repots `reports/` efter en P3D-körning
hittar du inget.

## Feature map

Se `features/README.md` för index.

| Feature | Feature-fil |
|---|---|
| Kandidatlivscykel i DB | `p3d-claim-loop.md` |
| Promote till `sources/*.jsonl` | `promote-to-sources.md` |
| Stadens väg genom kedjan | `city-carry-through.md` |
| Bryggan till A-gatet | `scope-reachability.md` |
| Köhälsa och backfill | `queue-health.md` |

## Maintenance

Kör `/maintain-verification-skill` när:
- `claim_source_candidate_test_queue(task_limit, target_phase)` eller RPC-nas signatur ändras.
- Någon ny producent skriver till `source_candidates` → `city-carry-through.md`.
- `promoteSourceCandidate` ändrar slug-strategi → `promote-to-sources.md`.
- `isInScope()` ändras → `scope-reachability.md` och `verify-eventpulse`.