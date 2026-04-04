# 04-Normalizer/notes

## Purpose

Operational notes about the normalization layer: known edge cases, debugging procedures, common failure modes, and improvement ideas.

## Known Edge Cases

### Ticketmaster venue_name = "undefined"
Ticketmaster API sometimes returns `venue.name = "undefined"` when venue data is missing.
Handled: `isValidVenueName()` rejects literal "undefined" strings.

### Kulturhuset uses `category`, others use `categories`
Handled: `const categories = raw.categories ?? (raw.category ? [raw.category] : undefined)`

### End time without date
Some sources return end_time as just `HH:MM` without a date component.
Handled: `end_time` is only stored if it contains `T` (ISO format).

### Swedish street names as venue names
When venue name looks like an address (e.g. "Sveavägen 24"), address-based matching kicks in.
This is intentional — better to match by address than to create a new venue with an address as name.

### Category slug default
If no category is found, defaults to `'community'`.
This ensures events always have a filterable category even if source provides none.

## Common Failures

### Events not appearing in UI
1. Check: events in `rawEventsQueue`? → check queue depth
2. Check: normalizer processed them? → look for `✅ Inserted` logs
3. Check: venue resolution succeeded? → look for `venue_id=` in logs
4. Check: Supabase `events` table has them? → direct query
5. Check: `ingestion_logs` populated? → per-source counts

### Venue explosion (too many near-duplicate venues)
Cause: Different source systems use different venue name formats for the same venue.
Current behavior: No venue name normalization beyond trim/collapse-spaces.
Fix idea: Fuzzy venue matching based on address proximity.

### Race condition on venue creation
Already handled: `unique_violation` → re-fetch existing.
This is expected behavior, not a failure.

## Debugging Procedure

```bash
# Check events in Supabase
node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
supabase.from('events').select('id, title_en, source, venue_id').limit(5).then(console.log);
"

# Check ingestion logs
node -e "
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
supabase.from('ingestion_logs').select('*').order('timestamp', { ascending: false }).limit(10).then(console.log);
"
```

## What belongs here

- Known edge cases and how they're handled
- Debugging procedures
- Improvement ideas

## What does NOT belong here

- Source code (lives in `services/ingestion/src/normalizer.ts`)
- Schema definitions (lives in `05-Supabase/schema/`)

## Status

**Status: Active**

Edge cases are documented as they are discovered. Update this file when new edge cases are found.
