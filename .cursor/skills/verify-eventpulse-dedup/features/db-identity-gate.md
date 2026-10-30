# No two visible rows share an identity

The database must never expose two rows in `events_public` that describe the
same physical event. This is the layer below the app: the app reads
`events_public`, so a green gate here means the app has one card per event
— provided the card gate also passes.

## Sub-features

- `identity-written` every published row **that can be identified** carries an
  `event_identity` key.
- `identity-unique` no two visible rows share the same `event_identity`.
- `merged-hidden` rows merged with `merged_into` are not in `events_public`.
- `lockdown-green` `assert_events_public_lockdown()` reports no FAIL.

## How to get to it (user POV)

- Open Utforska in the app. Every card you see comes from `events_public`.
- Search the app for an event you know. The result list must contain one
  card per performance.
- Ask the agent "what is on in Stockholm this weekend?". The list it
  answers with comes from the same view.

## Driving it with audit-duplicates.ts

Preconditions:

- `DATABASE_URL` points at the live Supabase project.
- Migration `20261030-0001-events-event-identity.sql` is applied: the
  `events.event_identity` and `events.merged_into` columns exist.

- **Gate.** Run `npx tsx scripts/audit-duplicates.ts --gate`. Exit code `0`
  and stdout `[audit] GATE OK: inga dubblettgrupper (N events skannade)`.
  Exit code `1` prints `[audit] GATE FAIL: N dubblettgrupper kvar bland
  synliga events (X grupper / Y extra rader).`
  The `N` in the OK line is **every published row read**, not the number of
  visible rows.
- **Full report.** Run `npx tsx scripts/audit-duplicates.ts --limit 10`. It
  prints the **10 largest** groups (`--limit` caps the list, it does not
  print every group) with member ids, sources and ticket URLs. Use this to
  judge whether a group is a real duplicate before merging.
- **Identity coverage.** Run
  `select count(*) filter (where event_identity is null) as nulls, count(*) as total from events where status='published'`.
  `nulls` is **not** expected to be `0`: measured 2026-10-30 it is `11` of
  `16309`. Those rows have non-Latin titles (Cyrillic, Arabic) that
  normalise to an empty string, so no identity can be built. The gate skips
  null keys — those rows are **not** covered by it.
- **Merged rows are hidden.** Run
  `select count(*) from events where merged_into is not null` and
  `select count(*) from events_public`. The first number is the number of
  rows hidden from the app; the second is what the app can see.
- **Lockdown.** Run `select * from assert_events_public_lockdown();`. Every
  row must report `OK`. Check `D.new_column_drift` specifically — it fails
  when a column in `events` is neither exposed nor registered in
  `events_public_expected_columns`.

## Gotchas

- **The gate reads the STORED key.** If the key algorithm changes, run the
  audit **without** `--dry` first so the stored keys are backfilled;
  otherwise the gate checks stale keys and passes for the wrong reason.
  Measured 2026-10-30: a one-day divergence in the key (see
  `ingestion-write-time-dedup.md`) hid 44 duplicate groups from the gate
  until the backfill ran.
- The audit writes `event_identity` on every run. That is a write in report
  mode — use `--dry` if you must not touch the database.
- `--quiet` hides the report summary and the "N events lästa" line, but the
  `--gate` verdict line is always printed.
- The gate groups by `event_identity`, which includes the local start time.
  Two rows for the same show with **different** listed times are not caught
  here — that class is caught by the grouping rules the audit uses when it
  reports and merges.
- Venue aliases **are** caught: the alias table is applied inside the key
  itself, so "Garden" and "Garden, Konsert & Kongress" produce the same
  key. Only a differing *time* escapes the gate.
- `events_public` filters `link_status = 'dead'`, so its count is lower
  than the number of published events even before any merge. The gate
  applies the same filter — but the **report** does not, so the report can
  show groups (all members dead) that the gate does not count.
- Merging is reversible: `UPDATE events SET merged_into = NULL` restores
  the rows. The pre-merge snapshot is in
  `runtime/verification-reports/merge-backup/merge-backup-<stamp>.json`,
  written only when `--apply` runs (not under `--dry` or `--gate`).
