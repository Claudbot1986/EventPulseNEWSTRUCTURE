# 11-Translation/

Event title/description translation cache worker — Språkstöd 2026-09-21.

## What

Reads future events from Supabase, translates `events.title_sv` and
`events.description_sv` into the requested locales via the MiniMax API
(same key as 08-Agent chat), and upserts the result into the
`event_translations` table (service_role only — anonymous never reaches it).

## Why a separate cache

- Source-of-truth text stays on `events.title_sv` (set by ingestion).
- 08-Agent's `/agent/feed`, `/agent/recommended`, `/agent/venues/:id/events`,
  and `/agent/chat` already accept a `locale` parameter (06-UI forwards it
  in every request via `agentClient.js`). They now read from this cache
  before falling back to Swedish.
- Single batched MiniMax call per (event, language); no LLM in the chat path.

## Required env

```bash
export MINIMAX_API_KEY="..."        # same as 08-Agent
export SUPABASE_URL="https://..."   # project URL
export SUPABASE_SERVICE_KEY="..."   # service_role (read+write event_translations)
```

## Usage

```bash
# Dry-run — print the plan, write nothing
node 11-Translation/translate.mjs --languages ar,fa,so --limit 50 --dry-run

# Translate 50 future events into Arabic + Persian
node 11-Translation/translate.mjs --languages ar,fa --limit 50

# Translate ALL future events to Polish + Turkish (use the count method)
node 11-Translation/translate.mjs --languages pl,tr --limit 10000

# Use a cheaper model for sweep work
node 11-Translation/translate.mjs --languages so,pl --limit 200 --model MiniMax-M2.7
```

Estimate at MiniMax-M3 (verify against your dashboard):
- ~$10–$35/year for 50,000 events × 7 languages (one-time cache fill + per-update re-translation).
- Idempotent: re-running is safe; unchanged translations are skipped on hit rate limit.

## Safety

- Dry-run mode is default if `--languages` is empty — refuses to run.
- Failures (MiniMax timeout / non-JSON response) are logged and the row is
  skipped; the worker never inserts partial output.
- Cost monitoring: pipe stdout through `tee translate.log` and grep for
  `[translate] error`. A spike in MiniMax 5xx often precedes a cost spike.
- Cache invalidation: when ingestion re-publishes an event title, delete
  the affected `(event_id, language)` rows and re-run. (Manual today; could
  become a trigger later — left out per "no synthetic extraction in cron".)

## What it does NOT do

- Translate UI strings (`06-UI/i18n/strings/<lang>.js`). That's manual
  translator work — strings are app chrome, not cached content.
- Run on a schedule. First version is invoked manually when needed.
- Touch Supabase schema, events table, or any other cached layer.

## Verification

After running for real:

```sql
SELECT language, COUNT(*) AS rows
FROM event_translations
GROUP BY language
ORDER BY language;

SELECT event_id, language, LEFT(title, 60) AS title_preview
FROM event_translations
WHERE language = 'ar'
LIMIT 5;
```

After running, the UI should show translated titles for the chosen events when
the user selects the matching language in Profile.
