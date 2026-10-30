---
name: verify-eventpulse-dedup
description: |
  Verify that EventPulse shows one card per event — no duplicate cards in
  Utforska, no duplicate rows in the events table, and no new duplicates
  written by ingestion. Use for /verify-eventpulse-dedup, when a duplicate
  event card is reported (e.g. "MAFFIA COMEDY SUPERWEEKEND" appearing twice
  under Comedy), after changing anything in 04-Normalizer/deduplication/,
  after the nightly ingestion cron runs, or before claiming the app is
  free of duplicates. Covers four surfaces: the DB identity gate, the app
  card gate, the write-time ingestion gate, and the post-ingestion audit.
disable-model-invocation: false
---

# verify-eventpulse-dedup

## Launch

There is no separate server for the duplicate check — it spans the database
and the Expo web build.

**Database (always needed).** The audit and gate scripts talk to Supabase
over `DATABASE_URL` (a `pg` connection string) from the repo root `.env`.
Nothing else is required; there is no schema to bootstrap. The **write-time
probe** (Gate 3) additionally needs `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` and a reachable Redis, because it imports the
real normalizer — see `features/ingestion-write-time-dedup.md`.

**App (needed for the card gate).** Web build via Metro. `06-UI` is served on
port **9090** — the port `06-UI/e2e/*.test.mjs` expects, not 8081.

```bash
cd /Users/claudgashi/EventPulse
npm --prefix . run start:agent &          # 08-Agent/server.ts → :8787
cd 06-UI
EXPO_PUBLIC_AGENT_URL=http://localhost:8787 ./scripts/launch-metro.sh
./scripts/doctor-metro.sh                 # exit 0 = körbar
```

Ready signal: the Metro log shows `Waiting on http://localhost:9090` and the
first `GET /` answers 200. Wait for `[Web] Bundled` before driving — the first
bundle takes 30–60 s.

Why a local agent and not prod: the prod API on `eventpulse-agent.fly.dev`
has an origin allowlist (`AGENT_ALLOWED_ORIGINS`). The web build sends
`Origin` → without an allowed origin the server answers `403
{"error":"origin not allowed"}` and the app logs "Failed to load events".
In dev the local agent on 8787 has empty `allowedOrigins` and open CORS.
This is the harness's job, not the app's.

`EXPO_PUBLIC_*` is read at **bundle time** — change `.env` and restart Metro.

Isolation: one Metro process owns 9090. To run side by side use `PORT=9091`
and `BASE_URL=http://localhost:9091`.

## Doctor

Run this before the first drive, and after every failed drive.

```bash
cd /Users/claudgashi/EventPulse

# 1. Databasen går att nå och identity-schemet finns.
node --env-file=.env -e "
const {Client}=require('pg');
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
const r=await c.query(\"select count(*)::int n from events where status='published'\");
const v=await c.query(\"select count(*)::int n from events_public\");
const col=await c.query(\"select count(*)::int n from information_schema.columns where table_name='events' and column_name in ('event_identity','merged_into')\");
console.log('events:',r.rows[0].n,'events_public:',v.rows[0].n,'identity-kolumner:',col.rows[0].n);
await c.end();})().catch(e=>{console.error('DB FEL:',e.message);process.exit(1)});"

# 2. Metro + agent-API är körbara.
cd 06-UI && ./scripts/doctor-metro.sh
```

Expected: `events: <n> events_public: <n> identity-kolumner: 2`, and
`doctor-metro.sh` exits 0. `events_public` may be **smaller** than `events` —
that is the point: rows merged with `merged_into` are hidden from the app.
A missing identity column means the migration has not been applied.

## Drive

Four gates. The first two are the ones the user actually feels; the last two
protect against the bug coming back.

### Gate 1 — DB identity gate (no two visible rows share an identity)

```bash
cd /Users/claudgashi/EventPulse
npx tsx scripts/audit-duplicates.ts --gate
```

Exit `0` = no duplicate group among rows visible in `events_public`.
Exit `1` = duplicates remain; the report lists the groups.

The gate groups the **stored** `event_identity`. After changing the key
algorithm in `04-Normalizer/deduplication/`, run the audit **without**
`--dry` once so the stored keys are backfilled — otherwise the gate checks
stale keys and can pass for the wrong reason.

### Gate 2 — App card gate (Utforska shows one card per event)

```bash
cd /Users/claudgashi/EventPulse/06-UI
BASE_URL=http://localhost:9090 npx playwright test e2e/dedup-no-duplicate-cards.test.mjs
```

Drives Utforska → each category in `DEDUP_CATEGORIES` (default
`Komedi,Musik,Drama`), reads the rendered card labels out of the DOM, and
fails if two cards carry the same title + date + time.

### Gate 3 — Write-time gate (ingestion does not insert duplicates)

```bash
cd /Users/claudgashi/EventPulse
npx tsx .cursor/skills/verify-eventpulse-dedup/scripts/probe-write-time-dedup.ts
```

Feeds the real normalizer an event that already exists in the database —
from a *different* source with a *different* ticket URL — and asserts that
no new row appears and that the existing row was updated instead. Exit `0`
= ingestion did not create a duplicate. The probe owns the rows it writes
and deletes them afterwards; it never touches a real event row.

### Gate 4 — Post-ingestion audit (the nightly cron step)

```bash
cd /Users/claudgashi/EventPulse
npx tsx scripts/audit-duplicates.ts --dry --limit 10   # rapport
npx tsx scripts/audit-duplicates.ts --apply             # slå ihop + verifiera
```

`--apply` merges, then re-checks and exits `1` if any duplicate group
survives. The cron chain runs this automatically after `worker-drain`
(step `dedup-audit` in `scripts/ingestion-cron.ts`).

## Evidence

- **DB-rapporter:** `runtime/verification-reports/merge-backup/merge-backup-<stamp>.json`
  (snapshot of every row the merge touched — this is the undo path:
  `UPDATE events SET merged_into = NULL WHERE id = ANY(...)`), written
  when `--apply` runs. A `--json <file>` report is written to exactly the
  path you pass.
- **App-bevis:** `06-UI/runtime/verification-reports/dedup-verify-<ts>/` —
  `dedup-cards.json` (every card that was read, plus any findings) and
  `utforska-last.png`. Gitignored — copy what you need to deliver.
- **Playwright-loggar:** `06-UI/playwright-report/` — gitignored, do not commit.
- **Metro-transcript:** `/tmp/eventpulse-metro-<port>.log`.

Proof standard: exercise the real user path (card → DOM → network → DB row),
not internal setters or mocked API responses. The DB gate reads the same
rows the app reads (`events_public`), so a green DB gate plus a green card
gate means the app really shows one card per event.

## Cleanup

```bash
cd /Users/claudgashi/EventPulse/06-UI && ./scripts/cleanup-metro.sh
```

Kills only the PID in `.runtime-metro.pid` and a stray listener on **PORT**
(default 9090). Never touch 8081 — it may be the user's own session. Leave
baseline screenshots and reports intact.

The write-time probe cleans up after itself: it owns the rows it creates
and deletes them in a `finally` block, so no real event row is ever
written to.

## Helpers

- `scripts/audit-duplicates.ts` — detect + merge. Flags: `--apply`,
  `--dry`, `--gate`, `--json <file>`, `--limit <n>`, `--quiet`.
- `.cursor/skills/verify-eventpulse-dedup/scripts/probe-write-time-dedup.ts`
  — write-time gate (test-only entrypoint).
- `06-UI/e2e/dedup-no-duplicate-cards.test.mjs` — app card gate.
- `04-Normalizer/deduplication/crossSourceIdentity.ts` — the identity key.
- `04-Normalizer/deduplication/duplicateGroups.ts` — the grouping rules.
  The audit script and the normalizer import these; they must not diverge.

## Maintenance

Keep this skill honest with `/maintain-verification-skill`. The feature map
in `features/` is the maintained source — if a category, a surface, or a
gate changes, update the map, not just the code.
