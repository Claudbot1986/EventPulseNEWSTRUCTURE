# The post-ingestion audit merges and verifies

After the nightly ingestion run, the audit script finds events that describe
the same thing, merges them, and proves that nothing is left. This is the
catch-all: it sees duplicates that the write-time path cannot catch
(venue-alias rows, rows written by direct insert scripts, rows written
before the identity key existed).

## Sub-features

- `audit-detects` the report lists every duplicate group with member ids,
  sources and ticket URLs.
- `audit-merges` `--apply` copies dependent rows to the winner and points
  the duplicate at it via `merged_into`.
- `audit-verifies` after merging, the script re-checks and exits `1` if any
  duplicate group survived.
- `audit-undoable` the merge is reversible; the pre-merge snapshot is written
  by the script itself, with the exact loser→winner mapping.
- `cron-wired` the nightly chain runs the audit after `worker-drain`.

## How to get to it (user POV)

- The operator sees the result in the app: one card per event, and the
  nightly chain reports `dedup-audit` as a green step.
- An operator can run the audit by hand before merging, to judge whether a
  group is a real duplicate.

## Driving it with audit-duplicates.ts

Preconditions:

- `DATABASE_URL` points at the live Supabase project.
- Run it from the repo root so `.env` is found. The imports are
  file-relative, so the working directory only matters for `dotenv/config`.

- **Report only.** Run `npx tsx scripts/audit-duplicates.ts --limit 10`.
  It prints the group count, the extra-row count, how many groups each rule
  produced, and the largest groups with their members. It also backfills
  `event_identity` — that is a write, so use `--dry` if the database must
  stay untouched.
- **Preview the merge.** Run
  `npx tsx scripts/audit-duplicates.ts --apply --dry`. It reports how many
  rows *would* be merged and writes nothing.
- **Merge.** Run `npx tsx scripts/audit-duplicates.ts --apply`. It prints
  `sammanslagna rader i events : N`, `synliga rader i events_public : M`
  and `OK: inga dubblettgrupper kvar`. Exit code `1` means groups survived
  the merge — investigate before shipping.
- **Write the report.** Run
  `npx tsx scripts/audit-duplicates.ts --json runtime/verification-reports/dedup-audit.json`.
  The JSON contains the group list, the rule breakdown and the merge count.
- **Gate (read-only).** Run `npx tsx scripts/audit-duplicates.ts --gate`. It
  exits `1` and prints `GATE FAIL: N dubblettgrupper kvar bland synliga
  events` when two visible rows still share an identity; otherwise it prints
  `GATE OK: inga dubblettgrupper (N events skannade)`. It writes nothing.
- **Confirm the cron step.** Read `scripts/ingestion-cron.ts` and find the
  `dedup-audit` step. It runs `scripts/audit-duplicates.ts --apply --quiet`
  after `worker-drain`, and `--dry --limit 5` in smoke mode. `--quiet`
  suppresses the per-group listing, not the three summary lines.

## Gotchas

- The grouping rules live in `04-Normalizer/deduplication/duplicateGroups.ts`
  and are used by the audit script and its test. The *identity key* lives in
  `04-Normalizer/deduplication/crossSourceIdentity.ts` and that one IS shared
  with the normalizer (the write-time path). If you change a grouping rule,
  the audit and the write path can disagree — the identity key is the part
  they must agree on.
- The merge **copies** `event_categories`, `event_translations`,
  `user_favorites` and `event_provenance` to the winner row (`ON CONFLICT
  DO NOTHING`), and **repoints** `user_interactions`. It does not delete the
  loser rows, and the copies are not undone by an undo — only the pointer is.
- The loser rows stay in `events` with `merged_into` set and are excluded
  by `events_public`. To undo:
  `UPDATE events SET merged_into = NULL WHERE id = ANY(<loser ids>);`
  — the loser ids come from the backup file.
- The pre-merge snapshot is written by the script itself to
  `runtime/verification-reports/merge-backup/merge-backup-<ts>.json`. It
  contains the full loser→winner mapping, the affected rows and the undo
  statement. Keep it with the run it belongs to.
- The merge used to run one query per row and took ten minutes for 2 079
  rows. It is set-based now and takes seconds. If it is slow again, look
  for a per-row loop.
- The merge picks the **most complete** row as the winner (description,
  image, category, venue), with three deliberate exceptions:
  a row whose link is dead (`link_status = 'dead'`) can never win — it is
  already hidden in `events_public`, and letting it win would take a live
  event out of the app; a row whose title repeats its own venue
  ("Terra – Garden") loses to a row with a clean title; and when the sources
  disagree about the clock, the time most of them agree on wins.
- The post-merge check groups by `event_identity` only. Residue that the
  venue-alias and cross-source rules would have caught does not fail it.
  The `--gate` mode runs the full rule set and is the stronger check.
- `04-Normalizer/deduplication/duplicateGroups.test.ts` has one failing
  test: it documents a date-only bridging rule (a row without a clock links
  to a timed row when there is exactly one candidate) that was never
  implemented. Treat that rule as unimplemented until it lands.
