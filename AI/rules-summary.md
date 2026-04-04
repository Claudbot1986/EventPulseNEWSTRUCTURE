# AI Rules Summary

## Global Rules (compressed)

**Domain boundaries — always identify the owning folder first:**
- `01-Sources` → source management
- `02-Ingestion` → pipeline (fetch, extract, normalize)
- `03-Queue` → BullMQ, job orchestration
- `04-Normalizer` → venue resolution, deduplication, category
- `05-Supabase` → database (schema, migrations)
- `06-UI` → presentation (components, screens)
- `07-Discovery` → intelligence (venue graph, expansion)

**Cross-domain rule:** A task may touch multiple domains, but you must identify which owns it and which are dependencies only.

## AI-Assisted Interpretation

Allowed: improve structure (titles, venues, categories, formats).
Forbidden: invent events, venues, dates, organizers, source status.
Traceability: every transformation must remain traceable to source input.

## Non-Negotiable Rules

1. No fake data as proof
2. No silent scope drift
3. No unnecessary redesign
4. Protect runtime behavior
5. Verification beats claims
6. One task at a time
7. Reports reflect reality

## Path Priority (02-Ingestion)

```
JSON-LD → Network → HTML → Render → Manual Review
Always test cheapest first.
Use Network only if demonstrably cleaner + more complete + stable.
```

## Source Testing Phases

```
Phase 1: Sanity (--mode=sanity) → 1-2 events
Phase 2: Breadth (--mode=breadth) → 10-20 events
Phase 3: Smoke (--mode=smoke) → 3 events/venue
```

## Data Loss Rule

Track: events fetched, events after normalization, events persisted.
If drop-off occurs: identify where, explain why, fix cause.
Never ignore drop-off.

## Quick Reference

| What | Where |
|------|-------|
| Source testing rules | `01-Sources/` |
| Pipeline rules | `02-Ingestion/` |
| Queue rules | `03-Queue/` |
| Normalizer rules | `04-Normalizer/` |
| DB rules | `05-Supabase/` |
| UI rules | `06-UI/` |
| Discovery rules | `07-Discovery/` |
| Full detailed rules | Project root `AI/rules/` |
