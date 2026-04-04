# AI Workflows Summary

## Core Loop (all domains)

Work in strict loops:

1. **Analyze** — What is broken? Where?
2. **Select ONE problem** — Never fix multiple at once
3. **Fix** — Smallest possible change
4. **Verify** — Real code path, logs, or output
5. **Evaluate** — Did it improve? Did anything break?
6. **Repeat**

## Domain-Specific Workflows

| Domain | Workflow file |
|--------|-------------|
| Ingestion | `AI/workflows/ingestion-loop.md` (root) |
| Discovery | `AI/workflows/discovery-loop.md` (root) |
| UI | `AI/workflows/ui-loop.md` (root) |

### Ingestion Loop (short version)

Focus: increase coverage, reduce data loss, improve quality.

Track at each step:
- events fetched
- events after normalization
- events persisted
- errors encountered

If stuck: narrow problem, simplify approach, retry.

### Discovery Loop (short version)

Focus: quality over quantity. Better fewer high-quality venues than many irrelevant.

Track: candidate quality, relevance, graph growth, ranking improvements.

Traceability: every discovered entity must be traceable to origin.

### UI Loop (short version)

Focus: small verified improvements, real user experience.

Every screen needs: loading, error, empty states.

## E2E Verification Workflow

See `AI/workflows/verify-end-to-end.md` (root) for full steps.

Short version:

```
1. Source → 2. Ingestion → 3. Queue → 4. Normalizer → 5. Supabase → 6. UI
```

Verify each step:
- events flow through
- data is stored correctly
- data is visible in UI

If any step fails → system is NOT E2E working.

## Success Criteria

- Ingestion: real sources → real data in DB
- Discovery: high-quality candidates, controlled expansion
- UI: real events visible, navigation works
- E2E: all 6 steps verified end-to-end
