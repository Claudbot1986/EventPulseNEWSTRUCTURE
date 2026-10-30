# EventPulse dedup verification map

This directory is the maintained source for verifying that EventPulse shows
**one card per event**. Read the index before driving the app, then use the
matching feature file as the recipe.

## Why this map exists

On 2026-10-30 the user reported duplicate event cards in Utforska →
Comedy ("MAFFIA COMEDY SUPERWEEKEND" appeared twice). The root cause was
not a UI bug:

- `dedup_hash = sha256(source::source_id)` — the source is part of the
  hash, so two sources describing the same event can never collide. Repo
  policy forbids changing that algorithm, so cross-source dedup needed a
  separate key.
- `ticket_url` + calendar day — the only existing cross-source path, but
  it requires the *identical* URL string. `livespot.se/event/…` vs
  `evensos.com/event/…` never matched.
- `canonical_event_id` existed for exactly this purpose but was NULL on
  99.5 % of rows (77 / 16 309), was not exposed by `events_public`, and its
  index was UNIQUE — which makes "many duplicates → one winner" impossible.

Measured before the fix: 16 309 events, 1 030 duplicate groups, 2 118 extra
rows. The app therefore rendered 2 118 cards too many.

## Baseline preconditions

- Launch the Expo web build at `http://localhost:9090` with the local agent
  API on `http://localhost:8787` (see `../SKILL.md` → Launch).
- `DATABASE_URL` must point at the live Supabase project. The gates read the
  same rows the app reads (`events_public`).
- Migration `05-Supabase/migrations/20261030-0001-events-event-identity.sql`
  must be applied: `events.event_identity` and `events.merged_into` exist.
- Never drive an instance that was not started by this verification run.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say
  otherwise.
- Prefer ARIA labels and accessible names over CSS selectors or DOM
  position. The Utforska row label format is `"<titel> — <datum · tid · venue · area>"`
  (`06-UI/components/UtforskaSection.js`).
- React Native Web's `Pressable` does not answer `.click()` — use the
  pointer-event helpers in `06-UI/e2e/helpers/ui.mjs`.
- Treat every command as literal. Keep quoted names and flags unchanged.
- Run the DB gates from the repo root, the Playwright gate from `06-UI/`.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- The card gate records every card it read in `dedup-cards.json` — that file
  is the proof that the check really looked at the rendered cards.
- The write-time gate prints the row counts before and after; both are proof.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet
  precondition. Do not report a skipped entry point as verified through a
  different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the
user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with <harness>` starts with `Preconditions:` and uses labeled
   bullets that pair each user action with an exact command and observable
   result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

| File | Gate | Level |
|---|---|---|
| [`db-identity-gate.md`](db-identity-gate.md) | No two visible rows share an identity | Database |
| [`utforska-no-duplicate-cards.md`](utforska-no-duplicate-cards.md) | Utforska shows one card per event | App |
| [`ingestion-write-time-dedup.md`](ingestion-write-time-dedup.md) | Ingestion does not insert duplicates | Integration |
| [`post-ingestion-audit.md`](post-ingestion-audit.md) | The nightly audit merges and verifies | Operator |
