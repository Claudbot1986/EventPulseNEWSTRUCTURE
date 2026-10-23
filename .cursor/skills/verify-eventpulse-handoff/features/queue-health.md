# Köhälsa och backfill

## Sub-features

- **`claim_source_candidate_test_queue(task_limit, target_phase)`** — RPC som claimar rader och
  sätter `locked_at`. Efter migration `20261021-0003` reclaimar den
  `processing`-rader äldre än 30 minuter:
  ```sql
  WHERE (status = 'pending'
         OR (status = 'processing'
             AND (locked_at IS NULL OR locked_at < now() - interval '30 minutes')))
    AND (target_phase IS NULL OR phase = target_phase)
  ```
- **`enqueue_source_candidate_tests()`** — fyller kön från
  `source_candidates`. Väljer `sc.city` sedan migration 0003.
- **`sync_source_candidate_queue_city()`** — synkar `city` **och**
  `priority_score` från `source_candidates` till kön. Måste anropas efter
  varje backfill.
- **Idempotent frigörning** — migration 0003 frigör befintliga stuck-rader
  vid applicering (23 rader som satt fast i `processing` utan slut).
- **`backfillCandidateCities.ts`** — härleder `city` per engine. Skyddsregel:
  en känd stad får aldrig skrivas över med `null`. Avslutar med
  `sync_source_candidate_queue_city()`.

## How to get to it (user POV)

P3D verkar inte göra något, eller gör samma sak om och om igen. Du vill veta
om kön är tom, full, eller full av rader som är låsta av en process som
dog. Du vill också kunna fylla i städer som glömdes bort.

## Driving it

```bash
cd /Users/claudgashi/EventPulse
DBQ=".cursor/skills/verify-eventpulse-handoff/scripts/dbq.mjs"

# Köhälsa
node "$DBQ" "SELECT status, count(*)::int AS n,
                    min(attempt_count)::int AS min_attempts,
                    max(attempt_count)::int AS max_attempts
               FROM source_candidate_test_queue GROUP BY 1 ORDER BY 2 DESC"

# Reclaimbara rader (ska vara 0 i steady state)
node "$DBQ" "SELECT count(*)::int AS stuck FROM source_candidate_test_queue
              WHERE status='processing'
                AND (locked_at IS NULL OR locked_at < now() - interval '30 minutes')"

# Vilka fel ser workern?
node "$DBQ" "SELECT left(last_error, 80) AS err, count(*)::int AS n
               FROM source_candidate_test_queue
              WHERE last_error IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10"

# Synk: avviker kön från kandidattabellen?
node "$DBQ" "SELECT q.city AS queue_city, sc.city AS cand_city, count(*)::int AS n
               FROM source_candidate_test_queue q
               JOIN source_candidates sc ON sc.id = q.source_candidate_id
              WHERE coalesce(q.city,'~') IS DISTINCT FROM coalesce(sc.city,'~')
              GROUP BY 1,2 ORDER BY 3 DESC"
#    → noll rader = synkad. Rader = kör backfillen igen.

# Backfill (dry-run först)
npx tsx 07-Discovery/src/sourceTesting/backfillCandidateCities.ts --dry-run
npx tsx 07-Discovery/src/sourceTesting/backfillCandidateCities.ts
```

## Gotchas

**Stuck-rader är inte samma sak som `processing`-rader.** En pågående
körning har alltid några `processing`-rader med färsk `locked_at`. Det som
är fel är `locked_at` äldre än 30 minuter — då har processen dött utan att
uppdatera. Doktorn rapporterar båda som `processing` och
`stuckReclaimable`; det är den senare som ska vara 0.

**Migration 0003 måste vara applicerad, annars finns reclaim-logiken inte
alls.** Reclaim-predikatet lever i funktionens SQL-kropp, inte i klienten.
Utan migrationen ligger 23 rader där för alltid. Kontrollera så här:

```bash
DBQ=".cursor/skills/verify-eventpulse-handoff/scripts/dbq.mjs"

# Signaturen kräver två argument. Utan dem: "function does not exist".
node "$DBQ" "SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE p.proname LIKE '%source_candidate%' ORDER BY 1"
#    → claim_source_candidate_test_queue | task_limit integer, target_phase text

# Finns reclaim-predikatet? (migration 0003)
node "$DBQ" "SELECT position('30 minutes' in pg_get_functiondef(p.oid)) > 0 AS har_reclaim
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE p.proname = 'claim_source_candidate_test_queue'
                AND n.nspname = 'public'"
#    → false = migration 0003 saknas. Kör backfillen EFTER att du applicerat den.
#    → true  = applicerad (verifierat 2026-10-23).
```

**Hämta `pg_get_functiondef` via `pg_proc`-oid, inte via
`'namn'::regprocedure`.** Casten ger `expected a left parenthesis` — Postgres
klarar inte tolka strängliteralen till regprocedure här. Sök upp oid:t i
`pg_proc` och anrop funktionen med det, som i exemplet ovan.

**Backfillen måste köras EFTER migrationen.** Annars skriver den mot en
kolumn som inte finns.

**Backfillen måste avslutas med `sync_source_candidate_queue_city()`.**
Annars uppdaterar den bara `source_candidates` och kön ligger kvar med
`city NULL` — exakt vad som hände första gången (kön stod på 0 efter att
kandidattabellen hade 151 Stockholmsrader).

**Backfillen skrev en gång 31 korrekta stader till `NULL`.** Exa-vägens
`source_query` är den sammanslagna frågelistan, så härledningen gav `null`
och skrev över det som redan var rätt. Nu skyddar den här raden:
```ts
// En känd stad får aldrig skrivas över med "vet inte".
if (row.city !== null && derived === null) continue;
```
Om du ändrar den filen: behåll raden.

**`--dry-run` är faktiskt torr.** Koden har `if (dryRun) return;` efter
beräkningen — den skriver varken kandidater eller kön. Men kontrollera
stdout: en tidigare version returnerade tidigt på `toUpdate === 0` och
hoppade över queue-syncen *också* när den kördes på riktigt.

**`priority_score` synkas av samma RPC.** En handpålagd `priority_score: 100`
på alla pending-rader (som gjordes 2026-10-23 av misstag) repareras av att
 köra backfillen igen, eftersom `sync_source_candidate_queue_city()` skriver
båda kolumnerna.