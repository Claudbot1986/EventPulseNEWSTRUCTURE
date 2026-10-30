# Ingestion does not insert duplicates

When ingestion writes an event that another source already published, the
normalizer must update the existing row instead of inserting a second one.
This is the layer that stops the duplicates from coming back after the
nightly merge has cleaned the backlog.

## Sub-features

- `cross-source-dedup` the same event from a second source updates the
  existing row instead of inserting a new one.
- `identity-key-written` the row carries an `event_identity` key.
- `no-orphan-row` no row is left behind by the probe.
- `venue-alias-dedup` a source that spells the venue differently still
  matches the existing row.

## How to get to it (user POV)

- The user never sees ingestion directly. They see the result: a new event
  appears once, not twice.
- An operator runs the nightly chain (`scripts/ingestion-cron.ts`) and sees
  the `dedup-audit` step report how many rows were merged.

## Driving it with probe-write-time-dedup.ts

Preconditions:

- `DATABASE_URL` points at the live Supabase project.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set — the normalizer
  creates its own Supabase client and fails without them.
- A reachable Redis. The normalizer imports the queue and the AI-image
  worker at module load, so the process needs a Redis connection even
  though the probe itself writes no job.
- The `events.event_identity` column exists and is indexed.

- **Run the probe.** Run
  `npx tsx .cursor/skills/verify-eventpulse-dedup/scripts/probe-write-time-dedup.ts`.
  It creates a row of its own (source `verify-dedup-probe`) with an identity
  key computed by the same module the normalizer uses, then feeds the real
  `processRawEvent` the same event from a **different** source
  (`verify-dedup-probe-second`) with a **different** ticket URL. That is
  the MAFFIA situation: same event, two sources, two URLs.
- **Read the verdict.** The probe prints
  `rader med samma identitetsnyckel: N`, `rader skapade av proben: N` and
  `föregångarraden uppdaterades: <tid>`. It exits `0` only when the count
  is `1`, no probe row was created, the row was actually updated, and the
  normalizer did **not** throw.
- **Check cleanup.** Run
  `select count(*) from events where source like 'verify-dedup-probe%'`. It
  must be `0` — the probe deletes its own rows in a `finally` block.

## How the write-time lookup works

The normalizer looks up an existing row in this order, and stops at the
first hit:

1. `ticket_url` (plus a calendar-day rule) — `deduplication/ticketUrlDedup.ts`
2. `dedup_hash` = `sha256(source::source_id)` — only if no ticket hit.
   The source is part of the hash, so it can never match another source.
3. `event_identity` — only if still no hit. The key contains **no source**,
   so it matches across sources. This is the lookup that catches MAFFIA.

On a hit the row is updated, never inserted. On a cross-source hit the
protected columns `dedup_hash`, `source` and `source_id` keep their old
values — the row stays owned by the source that first published it.

The identity match is **exact** — the whole key must be equal. There is no
time tolerance at write time. Date-only bridging (a row with an unknown
time matching a row with a known time) exists only in the audit path, see
[`post-ingestion-audit.md`](post-ingestion-audit.md).

## Gotchas

- The probe uses a **different ticket URL** on purpose. With the same URL
  the pre-existing `ticket_url` dedup would catch it and the probe would
  prove nothing about the new identity path. The same holds for the
  source: the two sources produce different `dedup_hash` values, so the
  **only** path that can match is `event_identity`.
- **The probe owns its rows — it never writes to a real event.** It
  creates its own predecessor row and deletes it again. It borrows a real
  `venues` row (a venue whose name is unique and is not an alias key) so
  the normalizer resolves an existing venue instead of creating one; any
  venue row created during the run is deleted afterwards.
- **The probe must fail when the normalizer throws.** Without that check
  the gate passes vacuously: on 2026-10-30 the normalizer threw
  `ReferenceError: venueId is not defined` on every write, the probe still
  reported "OK" because no row had been created — and the fatal bug
  stayed hidden. The probe now treats a thrown error as FAIL.
- The AI image pipeline is disabled by the probe itself — it sets
  `AI_IMAGE_PIPELINE_ENABLED=0` **before** importing the normalizer.
- The probe **owns** the row it writes to, so there is no state to restore
  afterwards — it deletes it in a `finally` block. It can still run while
  ingestion is running.
- `processRawEvent` rejects past events and generic titles. The probe
  uses a future date (40 days out) and a synthetic title that avoids the
  placeholder phrases the title-gate rejects ("test event", "sample
  event", …).
- The probe ends with an explicit `process.exit()` — the queue import
  keeps a Redis connection open, so the event loop would never end on its
  own.
- **Venue-alias duplicates are caught at write time**, not only by the
  audit: the venue part of the key is canonicalised through
  `VENUE_NAME_ALIASES` (`02-Ingestion/lib/sourceVenueRules.ts`), so
  "Garden" and "Garden, Konsert & Kongress" produce the same key.
- The key's fourth part is prefixed — `vfn:` for a venue name, `vid:` for
  a venue id — so `titel|dag|tid|vfn:garden`.
