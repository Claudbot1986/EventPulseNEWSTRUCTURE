# AI/ — AI Operating Structure

## Purpose

This folder is a compressed reference point for AI operating rules. It does NOT replace the authoritative `AI/` in the project root. It summarizes and points forward.

## Structure

```
AI/
├── AI.md          ← You are here
├── rules-summary.md        ← Global + domain rules (compressed)
└── workflows-summary.md    ← Iterations + verification (compressed)
```

## What belongs here

- Very short summaries of global rules
- Navigation to the correct domain folder
- Workflow references
- Decision standards

## What does NOT belong here

- Full copies of rules from the root `AI/`
- Session-specific prompts (`current-task.md`, `handoff.md`)
- Reports or snapshots
- Backlog items

## How to use

When you start in this project:

1. Read `NEWSTRUCTURE/CLAUDE.md` for quick routing
2. Read `AI/rules-summary.md` for the global rules
3. Read the relevant domain folder's `.md`

## Root AI/ is authoritative

The full authoritative AI rules live in the project root's `AI/`. This folder (`NEWSTRUCTURE/AI/`) is a compressed navigation layer only. If in doubt, the root `AI/` is the source of truth.

## For domain-specific rules

See the relevant folder:
- `01-Sources/` → source testing, candidate lists
- `02-Ingestion/` → pipeline gates (A–H), path priority
- `03-Queue/` → BullMQ, Redis, job orchestration
- `04-Normalizer/` → venue resolution, deduplication, field mapping
- `05-Supabase/` → schema, migrations, queries
- `06-UI/` → UI rules, rendering, interaction
- `07-Discovery/` → venue graph, expansion, ranking
