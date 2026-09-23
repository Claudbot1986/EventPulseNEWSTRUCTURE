# EventPulse Ingestion Audit Data (raw, read-only)

Generated 2026-09-23 for Jev decision model.

All counts marked `[VERIFIED]` come from real file reads. No estimates unless marked `[ESTIMATED]`.

---

## Artifact 1: Source state distribution

Sources truth: 299 files in `/Users/claudgashi/EventPulse/sources/` (`.jsonl`) `[VERIFIED]`
Sources in `runtime/sources_status.jsonl`: 459 entries `[VERIFIED]` (orphans: 160 status records with no matching sources/ file)
Sources in `runtime/sources_priority_queue.jsonl`: 382 `[VERIFIED]`

### Counts row

```
totalSourcesInRegistry       = 299  [VERIFIED]  (unique sources/ jsonl files)
totalSourcesInStatusFile     = 459  [VERIFIED]
totalInPriorityQueue         = 382  [VERIFIED]
success_status               = 63   [VERIFIED]  (all with lastEventsFound > 0)
fail_status                  = 396  [VERIFIED]
pending_render_gate_status   = 0    [VERIFIED]
pending_api_adapter_status   = 0    [VERIFIED]
pending_network_adapter_stat = 0    [VERIFIED]
triage_required_status       = 0    [VERIFIED]
routing_review_required_stat = 0    [VERIFIED]
sourcesWithEventsFound_eq_0  = 391  [VERIFIED]  (status=success w/ 0 events: 0; status=fail w/ 0 events: 391)
sourcesStuck_gt_30_days      = 0    [VERIFIED]  (lastRun within 30d for all 459)
never_run                    = 0    [VERIFIED]
attempts_gt_1                = 441  [VERIFIED]
```

### P0/P1/P2/P3 distribution (priority queue, mapped to lifecycle stages)

```
priority=1  count=258  [VERIFIED]  (P0/P1 = needs_recheck / never_run — main backlog)
priority=5  count=3    [VERIFIED]  (P2 = revalidation_due)
priority=7  count=121  [VERIFIED]  (P3 = registry_backfill / stale)
priority=2/3/4/6        = 0    [VERIFIED]  (none of pending_render/triage/adapter currently queued)
```

Mapping by ingestionStage:
```
completed  = 63   [VERIFIED]   (the 63 successes)
failed     = 396  [VERIFIED]
PENDING_x  = 0    [VERIFIED]   (no pending states in current status file)
```

### Top sources by current state (selected from sources_status.jsonl)

```
sourceId              | state    | ingestionStage | lastRun       | eventsFound | gateLastSeen         | stuckFor (days)
sthlmlist             | success  | completed      | 2026-09-09    | 864         | 2026-09-09 (A_or_B) | 0
berwaldhallen         | success  | completed      | 2026-09-10    | 206         | 2026-09-10 (A_or_B) | 0
eventbrite-stockholm  | success  | completed      | 2026-09-05    | 45          | 2026-09-05           | 0
stockholm-live        | success  | completed      | 2026-09-09    | 37          | 2026-09-09           | 0
mosebacke-2           | success  | completed      | 2026-09-05    | 37          | 2026-09-05           | 0
aik                   | success  | completed      | 2026-09-09    | 5           | 2026-09-09           | 0
billetto-stockholm    | fail     | failed         | 2026-09-05    | 0           | (none)              | 0  (err=403)
jarfalla              | fail     | failed         | 2026-09-11    | 100 (in C/D) | (D-render)          | 0
```

Notes:
- `gateLastSeen` derived from lastPathUsed + extractedevents path (A_or_B root, /C/, /D/)
- All 459 status records have lastRun within 30d, so stuckFor=0 universally `[VERIFIED]`
- (missing) `/Users/claudgashi/EventPulse/runtime/scraping-supervisor/EVENTPULSE-APP-queue.jsonl` — found at `/Users/claudgashi/EventPulse/runtime/EVENTPULSE-APP-queue.jsonl` instead (143 entries, priority=1 for all)
- (missing) `/Users/claudgashi/EventPulse/runtime/scraping-supervisor/preUI-queue.jsonl` — found at `/Users/claudgashi/EventPulse/runtime/preUI-queue.jsonl` instead (1862 entries)

### Dead-sources summary (`runtime/audit-dead-sources-summary.json`)

```
stockholm_total          = 121   [VERIFIED]
confirmed_dead_count     = 81    [VERIFIED]
confirmed_working_count  = 13    [VERIFIED]
partial_count            = 0     [VERIFIED]
untouched_count          = 27    [VERIFIED]
trace_batch_dirs_used    = 95    [VERIFIED]
```

---

## Artifact 2: Yield analysis (events per source)

Total events across all `03-Queue/03-extractedevents/*.jsonl`: **3212** `[VERIFIED]` (sum of 269 files)
Unique sources with extracted events: **254** `[VERIFIED]`
Source-event files total: 269 (143 root + 100 /C/ + 26 /D/) `[VERIFIED]`

### Counts row

```
totalEventsInSystem      = 3212  [VERIFIED]
uniqueSourcesWithEvents = 254   [VERIFIED]
medianEventsPerSource    = 1.0   [VERIFIED]
meanEventsPerSource     = 12.6   [VERIFIED]
topSourceYield (sthlmlist) = 864 [VERIFIED]
```

### Top 10 sources by event count

```
sourceId              | eventsFound | gateUsed | lastExtractionDate
sthlmlist             | 864         | A_or_B   | 2026-09-09
lokalhelhet-calendar  | 224         | C        | 2026-09-09
berwaldhallen         | 206         | A_or_B   | 2026-08-25
white-guide           | 136         | C        | 2026-04-26
jarfalla              | 100         | D        | 2026-09-11
kth-2                 | 74          | A_or_B   | 2026-09-05
downtown-2            | 71          | C        | 2026-09-10
globen-3              | 71          | C        | 2026-09-10
lulea-hf-2            | 71          | C        | 2026-09-10
halmstad-konserthus-2 | 71          | C        | 2026-09-10
```

Note: when a source has files in both root and /C/ or /D/, the max-count file's gate is used.

### Bottom 10 sources (>0 events, low yield)

```
sourceId                  | events | gate
uppsala-stadsteatern-1    | 1      | A_or_B
bokmassan                 | 1      | A_or_B
arbetets-museum           | 1      | A_or_B
stora-teatern-uppsala     | 1      | A_or_B
mall-of-scandinavia       | 1      | A_or_B
eggers-arena-ehco         | 1      | A_or_B
vasteras-art              | 1      | A_or_B
tekniska-museet           | 1      | A_or_B
ruddalen                  | 1      | A_or_B
trelleborgs-ff            | 1      | A_or_B
```

Many more sources have exactly 1 event (truncated at 10 here).

---

## Artifact 3: Failure mode taxonomy

Source: `runtime/sources_status.jsonl` lastError field + C-htmlGate batch traces.

### Counts row

```
totalSourcesWithLastError  = 459  [VERIFIED]  (every status record has a lastError)
classifiedErrorRecords     = 67   [VERIFIED]  (the 67 with non-empty lastError + recognized pattern)
timeout                   = 20   [VERIFIED]
network-fail (403/404/5xx)= 19   [VERIFIED]
ssl                       = 14   [VERIFIED]
redirect                  = 7    [VERIFIED]
no-jsonld                 = 7    [VERIFIED]
```

### Table (gate x errorClass)

```
gate   | errorClass    | count | sampleSources (top 3)
failed | timeout       | 20    | (sample from status: test-recovery, recovery-1789002012335-ccwpwd, recovery-1789002108593-ow5p8q)
failed | network-fail  | 19    | billetto-stockholm (403), various 404s
failed | ssl           | 14    | (TLS / cert failures)
failed | redirect      | 7     | classify-redirect-1789002012333-q6prky and similar
failed | no-jsonld     | 7     | classify-no-jsonld-1789002210510-6cwyri and similar
```

C-htmlGate c1 verdicts across all 100 batches (different angle — discovery verdicts):

```
c1Verdict=unfetchable | 1104 [VERIFIED]
c1Verdict=weak        | 353  [VERIFIED]
c1Verdict=no-main     | 366  [VERIFIED]
c1Verdict=unknown     | 220  [VERIFIED]
c1Verdict=medium      | 55   [VERIFIED]
c1Verdict=noise       | 45   [VERIFIED]
c1Verdict=strong      | 41   [VERIFIED]
```

### Top 5 most common error messages (verbatim)

```
12x  Fetch failed: HTTP 403
10x  Fetch failed: timeout
 7x  Fetch failed: Hostname/IP does not match certificate
 7x  Fetch failed: HTTP 404
 7x  SSL routines:ssl3_read_bytes:tlsv1 unrecognized name
```

(All `[VERIFIED]` — counts from `runtime/sources_status.jsonl` lastError substrings.)

---

## Artifact 4: D-AI adapter inventory + D-renderGate runs

Adapters dir: `/Users/claudgashi/EventPulse/runtime/adapters/` — 17 files total `[VERIFIED]`
JSON-parseable adapter files: **15** `[VERIFIED]` (others are `_dai-queue.jsonl` and `_manifest.jsonl` not adapters)
Validation passed: **6** `[VERIFIED]`
Validation failed: **9** `[VERIFIED]`

### Adapter inventory

```
adapterSourceId              | generatedAt  | aiConfidence | validationPassed | notes (truncated)
aik                          | 2026-08-19   | 0.25         | True             | containers=83; titles=34; dates=48
gratis-i-stockholm           | 2026-08-19   | 0.25         | False            | eventContainer "div.eventItemContainer, tr.eventRow, ta
konserthuset-2               | 2026-08-19   | 0.25         | False            | eventContainer ".event-item, .calendar-event, [data-eve
konstkalendern               | 2026-08-19   | 0.35         | True             | hand-fixed 2026-08-21 (T0038): title/link/venue/ticketU
kultur-stockholm-calendar    | 2026-08-19   | 0.15         | True             | hand-fixed 2026-08-21 (T0042): kultur.stockholm uses
kultur1-stockholm            | 2026-09-05   | 0.7          | False            | containers=1; titles=0; dates=0
kungstradgarden-2            | 2026-08-19   | 0.25         | False            | eventContainer ".eventbox, .event-box, .program-item
lokalhelhet-calendar         | 2026-08-19   | 0.3          | True             | hand-fixed 2026-08-21 (T0042): added .mec-start-date
medborgarhuset-2             | 2026-08-19   | 0.65         | False            | render-gate 2026-08-21 (T0047): SPA on medborgarhuset
nobel-prize-museum           | 2026-08-21   | 0.95         | False            | Hand-tuned 2026-08-21 (T0095-heal-nobel): 31 event c
slaktaren-2                  | 2026-08-19   | 0.25         | False            | eventContainer "div.event-item, article.event, li[da
stockholms-universitet-2     | 2026-08-19   | 0.25         | True             | validationPassed set 2026-08-21 after T0046 render-g
storkyrkan-2                 | 2026-08-19   | 0.65         | False            | render-gate 2026-08-21 (T0047): SPA on storkyrkan.se
thatsup-stockholm-events     | 2026-08-19   | 0.25         | False            | containers=1; titles=0; dates=0
tiqets-stockholm             | 2026-08-19   | 0.3          | True             | containers=19; titles=5; dates=0
```

### D-renderGate runs (last 30 days, from `pipeline-summary.jsonl`, step=runD-scrapingbee, not skipped, not dryRun)

```
date       | sourcesRouted | eventsExtracted | behaviorUsed | creditsSpent (est)
2026-09-23 | (unknown)     | (unknown)       | real run     | (not tracked in pipeline-summary.jsonl)
2026-09-23 | (unknown)     | (unknown)       | real run     | (not tracked)
2026-09-23 | (unknown)     | (unknown)       | real run     | (not tracked)
```

Counts:
```
dRenderGateRunsLast30d        = 3    [VERIFIED]   (all on 2026-09-23, all 459–541ms)
dRenderGateRunsFailedLast30d  = 0    [VERIFIED]
sourcesWithPendingRenderState = 0    [VERIFIED]   (no status='pending_render_gate' anywhere)
pendingRenderQueueFileLines   = 0    [VERIFIED]   (runtime/pending_render_queue.jsonl is empty)
candidatesBatchStatusPending  = 368  [VERIFIED]   (all C-candidates still untested)
```

`runtime/scraping-supervisor/d-render-lastrun.json`:
```
{ "lastRun": "2026-09-23T19:24:26.641Z" }   [VERIFIED]
```

---

## Artifact 5: Pre-decision source snapshot

Top 20 sources by events + selected stuck (fail, ≥2 consecFailures) sources. `nextPath` is Jev's input column — currently shows `lastPathUsed` for context; Jev should compute the actual next path.

```
sourceId                | state   | events | lastError                                | nextPath (=lastPathUsed)  | ageDays
sthlmlist               | success | 864    | (none)                                   | jsonld                     | 0
lokalhelhet-calendar    | fail    | 224    | (none)                                   | jsonld                     | 0
berwaldhallen           | success | 206    | (none)                                   | network                    | 0
white-guide             | (no status entry) | 136 | (unknown)                        | unknown                    | ?
jarfalla                | fail    | 100    | (none)                                   | unknown                    | 0
kth-2                   | fail    | 74     | (none)                                   | jsonld                     | 0
halmstad-konserthus-2   | fail    | 71     | (none)                                   | unknown                    | 0
lulea-hf-2              | fail    | 71     | (none)                                   | unknown                    | 0
globen-3                | fail    | 71     | (none)                                   | unknown                    | 0
downtown-2              | fail    | 71     | (none)                                   | unknown                    | 0
malmo-live              | fail    | 53     | (none)                                   | unknown                    | 0
billetto-stockholm      | fail    | 46     | Fetch failed: HTTP 403                   | jsonld                     | 0
eventbrite-stockholm    | success | 45     | (none)                                   | jsonld                     | 0
stockholm-live          | success | 37     | (none)                                   | jsonld                     | 0
mosebacke-2             | success | 37     | (none)                                   | jsonld                     | 0
dramaten                | fail    | 35     | (none)                                   | unknown                    | 0
molndals                | fail    | 26     | (none)                                   | unknown                    | 0
naturhistoriska-riksmuseet | (no status entry) | 25 | (unknown)                      | unknown                    | ?
konstkalendern          | fail    | 24     | (none)                                   | jsonld                     | 0
medborgarhuset-2        | fail    | 21     | (none)                                   | jsonld                     | 0
```

Stuck (fail, consecutiveFailures ≥ 2) — sample of 20 (380 total):

```
sourceId                          | events | lastError                                       | priority
classify-redirect-1789002012333-q6prky | 0 | Fetch failed: Exceeded 3 redirects              | ?
arkitekturgalleriet               | 1      | (none)                                          | 7
halmstad-konserthus               | 0      | (none)                                          | 1
malmo-stadsteatern                | 0      | (none)                                          | 1
partille                          | 0      | (none)                                          | 1
norrkoping-konserthus             | 0      | (none)                                          | 7
folkteatern                       | 0      | (none)                                          | 1
helsingborg-arena                 | 1      | (none)                                          | 7
ladan                             | 0      | (none)                                          | 1
skovde-if                         | 1      | (none)                                          | 7
classify-no-jsonld-1789002210510-6cwyri | 0 | no-jsonld-or-no-events                  | ?
kth                               | 0      | (none)                                          | 7
fyrfaderna-2                      | 0      | (none)                                          | ?
motala                            | 2      | (none)                                          | 1
kultur-stockholm-calendar         | 9      | (none)                                          | ?
karlstad-if                       | 1      | (none)                                          | 7
folkets-hus                       | 0      | (none)                                          | 1
vasteras-stadsteatern             | 1      | (none)                                          | 7
svenska-kulturhuset               | 0      | (none)                                          | 7
```

Note: `nextPath` here = `lastPathUsed`. Jev should re-derive via `computeNextPath` from status/ingestionStage/lastError.

---

## Summary (5 numbers)

```
totalSources        = 299  [VERIFIED]  (sources/*.jsonl truth files)
totalEvents         = 3212 [VERIFIED]  (sum across 269 extractedevent files)
totalAdapters       = 15   [VERIFIED]  (JSON-parseable adapter files)
totalDFailedRuns    = 0    [VERIFIED]  (D-renderGate runD-scrapingbee step failures last 30d; 3 real runs total)
totalSourcesStuck   = 0    [VERIFIED]  (sources with lastRun > 30 days ago — none)
```

(Alternative "stuck" definition: 380 sources with `status=fail AND consecutiveFailures≥2` — see Artifact 5 sample.)

---

## Surprises & caveats

1. **`runtime/scraping-supervisor/EVENTPULSE-APP-queue.jsonl` and `preUI-queue.jsonl`** were listed in the brief but live at `/Users/claudgashi/EventPulse/runtime/` (not under `scraping-supervisor/`). Found and used.
2. **`runtime/pending_render_queue.jsonl` exists but is EMPTY** — despite `audit-dead-sources-summary.json` showing 81 confirmed dead sources, no live "pending render" queue.
3. **459 status records vs 299 source files** — 160 status records are orphans (source file deleted/never existed). May inflate "sources" count if used naively.
4. **`status` field is bimodal**: only `success` (63) or `fail` (396). No `pending_render_gate` / `pending_api_adapter` / `triage_required` anywhere — all such intermediate states are either transient or already promoted/rejected.
5. **Zero stuck-by-time sources** because every source has been touched within 30 days. The real "stuck" cohort is by `consecutiveFailures ≥ 2` (380 records).
6. **C-htmlGate has 1104 `unfetchable` c1 verdicts across 100 batches** — the dominant failure mode at the discovery layer, not at extraction.
7. **No "PENDING_RENDER" or "D-PENDING" literal strings in C-candidates-queue.jsonl** — all 368 entries are simply `batchStatus=pending, verificationStatus=untested`.
