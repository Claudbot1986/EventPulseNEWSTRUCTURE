# Bryggan till A-gatet

## Sub-features

- **`isInScope(source)`** (`sourceRegistry.ts:150`) — en rad:
  `(source.city ?? '').trim() === 'Stockholm'`. Ingen geografi, ingen fuzzy
  matchning, ingen url-matchning. Saknas `city` → `false` → osynlig.
- **`getAllSources({scope})`** — default `'stockholm'` (applies
  `isInScope`), `'all'` returnerar allt på disk. Läser både pretty-printad
  JSON och JSONL (`sourceRegistry.ts:173-193`).
- **`getSourceStatus(id)`** — saknas rad → standardobjekt med
  `status: 'never_run'`. Det är så en ny promotead källa blir körbar.
- **`getNextABatch(limit)`** (`runA.ts:251-288`) — preA-kön först, sedan
  `sources/*.jsonl` filtrerat på exakt `status === 'never_run'`.
- **Två filter, i ordning:** `city === 'Stockholm'` (registry) →
  `status === 'never_run'` (batch). Den första kastar uteslutningen tyst;
  den andra är synlig i loggen (`Both preA-queue and sources-main are empty`).

## How to get to it (user POV)

Du promote:ar en källa och ser filen i `sources/`. Du väntar att A-gatet ska
plocka upp den. Ingenting händer. Du vill veta exakt vilket filter som
stoppar den — det finns två, och de ger olika fel.

## Driving it

```bash
cd /Users/claudgashi/EventPulse
DBQ=".cursor/skills/verify-eventpulse-handoff/scripts/dbq.mjs"

# Promote-beslut → fil på disk → körad?
node "$DBQ" "SELECT DISTINCT d.promoted_source_id,
                    sc.city,
                    EXISTS (SELECT 1 FROM source_candidate_test_runs r
                             WHERE r.id = d.evidence_run_id) AS has_run
               FROM source_candidate_test_decisions d
               JOIN source_candidates sc ON sc.id = d.source_candidate_id
              WHERE d.decision = 'promote'
              ORDER BY d.created_at DESC"

for id in $(node "$DBQ" "SELECT DISTINCT promoted_source_id
                            FROM source_candidate_test_decisions
                           WHERE decision='promote' AND promoted_source_id IS NOT NULL" | tail -n +2); do
  file="sources/$id.jsonl"
  city=$(jq -r '.city // "(saknas)"' "$file" 2>/dev/null || echo "(fil saknas)")
  st=$(jq -r --arg id "$id" 'select(.sourceId==$id) | "\(.status)/\(.lastEventsFound)"' \
        runtime/sources_status.jsonl 2>/dev/null | tail -1)
  printf '%-42s city=%-12s status=%s\n' "$id" "$city" "${st:-( ingen rad )}"
done

# Vad ser A-gatets filter?
jq -r '.status' runtime/sources_status.jsonl | sort | uniq -c | sort -rn
#    → bara `never_run` körs. `fail` är permanent.
```

## Gotchas

**Observerad avvikelse 2026-10-23 — rapporterad, inte förklarad.** Körningen
ovan hittade en `promote`-rad i `source_candidate_test_decisions` med
`promoted_source_id = 'founders-allianceconfettievents'` och ett fullständigt
evidensunderlag (`events_found_total=1, events_after_normalization=1,
events_persisted=1, winning_path=html, report_complete=true`, beslutet taget
2026-10-21 21:14) — men **filen `sources/founders-allianceconfettievents.jsonl`
finns inte på disk**. Ingen kodväg i `07-Discovery/src/sourceTesting/` raderar
den: `removeSandboxSource()` (`sandbox.ts:78`) tar bort
`<sandboxRoot>/sources/<sandboxId>.jsonl`, och sandbox-root är alltid en
`mkdtemp`-katalog när `runSourceCandidateTests.ts` kör (den skickar inte
`--sandboxRoot`). Filen har aldrig committats (`git ls-files sources/` = 4
filer). Rotsaken är alltså inte etablerad — behandla som produktfynd, inte
som verifierad bugg, tills någon kan visa vad som raderade den.

Lärdom för den här filen: `promoted_source_id IS NOT NULL` bevisar **inte**
att filen finns. Kör alltid `[ -f "sources/$id.jsonl" ]` som tredje led.

**Två filter ger två helt olika symtom.**

| Filter | Var | Symtom i loggen |
|---|---|---|
| `isInScope()` (city) | `sourceRegistry.ts:150` | `[A-runner] Both preA-queue and sources-main are empty. Nothing to run.` |
| `status === 'never_run'` | `runA.ts:259-262` | samma rad |

Båda ger **samma loggrad**. Fördjupning krävs: `ls sources/` och
`jq '.status' runtime/sources_status.jsonl`. Testa alltid båda innan du
rapporterar "inget händer".

**`getSourceStatus` returnerar en standardrad, inte `undefined`.** En ny
promotead källa är automatiskt `never_run` — den är körbar direkt. Men bara
om filen överlever filtret ovan.

**246 filer på disk betyder inte 246 körbara källor.** 2026-10-23: 141 bar
`city = "Stockholm"`, resten inte. `getAllSources()` utan `scope` räknar
alla; A-gatet ser bara de 141.

**`fail` körs aldrig om.** Filtret är exakt `status === 'never_run'`. 256 av
332 rader har `fail`. Det är medvetet (planen avsäger automatisk återköning).
Ändra inte filtret utan ett uttryckligt beslut.

**`getAllSources()` tolkar en fil på två sätt.** Den testar hela filen som ett
JSON-objekt först, sedan radvis (`sourceRegistry.ts:173-193`). En
pretty-printad `sources/*.jsonl` är därför flera rader per post — `wc -l`
överdriver. Räkna med parsern.

**Kedjan har ingen sista port inom den här filen.** En källa som bär
`city = 'Stockholm'` och är `never_run` är *nåbar* för A — inte *körd*.
Utan `promoted` rad i `sources_status.jsonl` har ingen gate rört den. Skillens
bevis är därför tre led: fil → statusrad → events, inte bara filen.

**Backfill flyttar inte filer.** `backfillCandidateCities.ts` sätter `city` i
DB men skriver inte om `sources/*.jsonl`. En fil som redan promote:ats med
`city: undefined` förblir osynlig tills den promote:as om.