# C-htmlGate Batch {N} Report

**⚠️ NAMNRÖRA-VARNING:** Denna mall använder C0/C1/C2-terminologi från nuvarande implementation. Se [C-status-matrix.md](../C-status-matrix.md) för förklaring av hur dessa mappas till canonical C1/C2/C3/C4-AI.

## Batch Header

| Field | Value |
|-------|-------|
| batchId | batch-{N} |
| createdAt | {ISO timestamp} |
| status | {idle/pending/testing/completed} |
| eligibilityRulesVersion | {version} |
| selectionCriteria | {text} |
| subpageAwareAbStatus | {done/partial/missing} |

## Metrics

| Metric | Pre | Post | Delta |
|--------|-----|------|-------|
| sourcesTotal | {N} | {N} | 0 |
| successCount | {N} | {N} | {+/-N} |
| failCount | {N} | {N} | {+/-N} |
| eventsFoundTotal | {N} | {N} | {+/-N} |

## Sources Summary

| # | sourceId | sourceName | city/type | preEvents | postEvents | delta | preVerdict | postVerdict | methodCandidate | needsD |
|---|----------|------------|-----------|-----------|-------------|-------|------------|-------------|-----------------|--------|
| 1 | {id} | {name} | {city}/{type} | {N} | {N} | {+/-N} | {verdict} | {verdict} | {method} | {yes/no} |
... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

## Pattern Groups Found

- {pattern group 1} ({count} sources)
- {pattern group 2} ({count} sources)

## AI Analysis Summary

**Sources with improvement:** {N}
**Sources with no improvement:** {N}
**Major pattern:** {description}

## Changes Applied to C-Model

1. {change 1 description}
2. {change 2 description}
3. ...

## Unresolved Issues

- {count} sources still failing
- {count} sources need D-renderGate
- {count} sources have ambiguous signals

## Generalizable Learnings

- {learning 1}
- {learning 2}

## Linked Source Reports

- `sources/{source1}.md`
- `sources/{source2}.md`
- ...

## Source Reports

### sourceId: {id}

[Embedded compact source data - see sources/{id}.md for full report]