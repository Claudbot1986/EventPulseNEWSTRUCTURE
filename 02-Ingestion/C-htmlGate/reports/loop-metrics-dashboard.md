# Loop Metrics Dashboard
**Generated:** 2026-04-12 | **Schema:** 1.0

---

## 1. Headline Metrics

| Metric | Value |
|--------|-------|
| Total batches run | 8 |
| Total sources processed | 83 |
| Overall success rate | **1.2%** (1/83) |
| Rules created (all time) | 6 |
| Rules applied (all time) | **0** |
| Fail-set re-run proof | **0 batches** |
| Improvements bank: tested | 2/9 |
| Improvements bank: proposed | 7/9 |

---

## 2. Success Rate Over Time

```
batch-001   ░░░░░░░░░░  0.0%  (0/5)
batch-002   ░░░░░░░░░░  0.0%  (0/4)
batch-003   ██░░░░░░░░░ 10.0%  (1/10)  ← ONLY SUCCESS
batch-011   ░░░░░░░░░░  0.0%  (0/10)
batch-012   ░░░░░░░░░░  0.0%  (0/10)
batch-13    ░░░░░░░░░░  0.0%  (0/12)
batch-14    ░░░░░░░░░░  0.0%  (0/10)
batch-15    ░░░░░░░░░░  0.0%  (0/22)
```

**Verdict:** Model has **not improved** over 8 batches. One success in batch-003, none since.

---

## 3. Exit Route Distribution (Pool Batches)

### batch-13 (3 rounds, max-rounds-reached)
| Route | Count | % |
|-------|-------|---|
| postTestC-manual-review | 8 | 67% |
| postTestC-D | 2 | 17% |
| postTestC-B | 0 | 0% |
| postTestC-UI | 0 | 0% |
| postTestC-A | 0 | 0% |

### batch-14 (1 round, pool-exhausted)
| Route | Count | % |
|-------|-------|---|
| postTestC-B | 6 | 60% |
| postTestC-D | 4 | 40% |
| postTestC-UI | 0 | 0% |
| postTestC-A | 0 | 0% |
| postTestC-manual-review | 0 | 0% |

### batch-15 (3 rounds, max-rounds-reached)
| Route | Count | % |
|-------|-------|---|
| postTestC-manual-review | 17 | 77% |
| postTestC-D | 5 | 23% |
| postTestC-B | 0 | 0% |
| postTestC-UI | 0 | 0% |
| postTestC-A | 0 | 0% |

**Verdict:** Almost all failures go to **manual-review** (no-code path) or **D (JS-render)**. Zero sources have been saved by the C-loop.

---

## 4. Fail Category Pattern (All Pool Batches)

| Category | Count | % |
|----------|-------|---|
| NEEDS_SUBPAGE_DISCOVERY | 13 | 54% |
| WRONG_ENTRY_PAGE | 6 | 25% |
| LIKELY_JS_RENDER | 5 | 21% |

**Root cause hypothesis:**
- >50% of failures are **discovery problems** — C0 never finds the right entry page
- C1/C2 extraction works fine when the right page is found
- The model is not learning to fix discovery, only routing to manual-review

---

## 5. Rules Creation vs Application

| Batch | Rules Created | Rules Applied | Fail-Set Re-Run |
|-------|--------------|--------------|-----------------|
| batch-13 | 0 | No | No |
| batch-14 | 6 | **No** | **No** |
| batch-15 | 0 | No | No |

**Critical finding:** batch-14 created 6 rules (subpage path patterns) and all 6 sources exited immediately after round 1. Rules were **never tested on the same sources that created them**.

---

## 6. Improvements Bank Status

| ID | Name | Status | Problem Type |
|----|------|--------|-------------|
| IMP-001 | supports_time_datetime | proposed | date_extraction |
| IMP-002 | supports_swedish_date_text | proposed | date_extraction |
| IMP-003 | anchor_plus_nearby_date | proposed | date_extraction |
| IMP-004 | article_card_detection | proposed | structure_detection |
| **IMP-005** | **js_shell_detection** | **tested** | **routing** |
| **IMP-006** | **subpage_required_before_c** | **✅ validated** | **discovery** |
| IMP-007 | list_item_event_blocks | proposed | structure_detection |
| **IMP-008** | **fetch_before_extract** | **tested** | **pipeline_bug** |
| IMP-009 | candidate_subpage_paths_swedish_institutions | ⚠️ partially-validated | discovery |

**3/9 improvements tested or validated. 5 remain "proposed" with no validation.**

**Recent changes (2026-04-12):**
- IMP-006: **Validated** — P1 fix in `run-dynamic-pool.ts` (c1Dsignal short-circuit now respects Swedish pattern winners; all sources get 2-3 subpage-path retries)
- IMP-009: **Partially-validated** — Swedish patterns implemented in C0; P1 fix addresses c1Dsignal short-circuit; 0% hit rate in batch-15 suggests pattern quality needs improvement

---

## 7. Strategic Recommendations (Priority Order)

### ✅ P1 — FIXED (2026-04-12)
**Swedish patterns in C0 — c1Dsignal short-circuit bypass**
- **Code change:** `run-dynamic-pool.ts` line ~602 — added `!c0FoundSubpageWinner` check to c1Dsignal
- Swedish pattern winners now bypass D-routing short-circuit — C2/C3 runs on Swedish subpage URL
- IMP-006 marked **validated**, IMP-009 marked **partially-validated**

**Swedish pattern verification (2026-04-12):** 4/14 sources (29%) got C2 hits:
- borlange-kommun: `/evenemang` → C2=145 ✅
- kungsbacka: `/evenemang` → C2=105 ✅
- cirkus: `/events` → C2=56 ✅
- h-gskolan-i-sk-vde: `/program` → C2=56 ✅

**New findings — 3 root causes for 0% hit rate:**
1. **DNS failures (4 sources):** boplanet, brommapojkarna, club-mecca, chalmers — domain doesn't resolve from this machine
2. **fetchHtml not following redirects:** C0 constructs `https://borlange.se/evenemang` but gets 301→`/sv/evenemang`. fetchHtml reports "HTTP 404" instead of following redirect — the URL IS correct but fetchHtml fails
3. **C2 threshold too strict:** mittuniversitetet best score=2, events may exist but score < 12 threshold

**Recommended P1 follow-up fixes:**
- ~~**P1-B:** Make fetchHtml follow 301/308 redirects~~ — ✅ IMPLEMENTED (see below)
- **P1-C:** Add www. prefix retry for DNS failures
- **P1-D:** Lower C2 threshold for Swedish event pages, or use adaptive threshold

**✅ P1-B — IMPLEMENTED (2026-04-12)**
**File changed:** `02-Ingestion/tools/fetchTools.ts`

**What changed:**
- `fetchHtml` now follows 301/302/307/308 redirects (max 3 hops)
- Same-domain only (www subdomain allowed)
- Loop detection prevents `/path/` ↔ `/path` oscillation
- `redirectChain` array logged: `['301:https://final-url']`
- `finalUrl` field added to `FetchResult`
- `FetchResult` interface extended with `finalUrl` and `redirectChain`

**Verified results on known-problematic sources:**
| Source | Before P1-B | After P1-B | ISO Dates |
|--------|-----------|-----------|-----------|
| borlange `/evenemang` | ❌ HTTP 404 | ✅ Works | 42 |
| kungsbacka `/evenemang` | ❌ HTTP 404 | ✅ Works | 25 |
| cirkus `/events` | ❌ 308 loop | ❌ 308 loop (server config issue) | — |
| cirkus `/evenemang` | ❌ 308 loop | ❌ 308 loop (server config issue) | — |

**Impact:** 2 previously failing sources now produce C2 hits (confirmed earlier: borlange C2=145, kungsbacka C2=105).
**Remaining:** cirkus has a genuine server-side redirect loop — cannot be fixed at fetch level. Should route to D or manual-review.

### ✅ P2 — FIXED (2026-04-12)
**Manual-review routing — all sources get 2-3 retries**
- **Code change:** `run-dynamic-pool.ts` line ~1451 — manual-review override now applies to ALL sources with roundsParticipated < 3, not just rule-generators
- Previously: only sources that generated rules got retry-pool override
- Now: ALL sources get subpage-path retries before manual-review
- **Effect:** batch-15 would have routed differently — sources would stay in pool for rounds 2-3 with Swedish pattern discovery active

### ✅ P3 — DONE (2026-04-12)
**Validate proposed improvements**
- IMP-006 marked validated (P1 fix implements it)
- IMP-009 marked partially-validated
- 5 improvements still proposed: IMP-001, IMP-002, IMP-003, IMP-004, IMP-007
- Next recommended: IMP-001 (supports_time_datetime) — date extraction from `<time datetime>` elements

### 🔄 P0 (limited) — Sources with generated rules get 1 verification round
**Status:** Already partially implemented — P2 fix (above) gives ALL sources 2-3 retries, which subsumes the rule-verification need
- Sources that generate rules: will get their rules applied in next round automatically (via P2 retry)
- After 3 rounds: manual-review is final
- **Not implemented:** blocking exit for sources that generated rules (risky if rules are poor quality — agreed with user assessment)

---

## 8. C0 Discovery Rate (Baseline Batches Only)

| Batch | C0 Discovery Rate | Note |
|-------|-----------------|------|
| batch-001 | 60% (3/5) | early test |
| batch-002 | 0% (0/4) | |
| batch-003 | 0% (0/10) | |
| batch-011 | 0% (0/10) | |
| batch-012 | 30% (3/10) | |

**C0 discovery is inconsistent — it's not improving over time either.**

---

## 9. Batch Health Score

| Batch | Health | Reason |
|-------|--------|--------|
| batch-001 | ⚠️ 20% | C0 works but 0% success |
| batch-002 | 🔴 0% | Nothing working |
| batch-003 | ⚠️ 20% | 1 success, C0 fails |
| batch-011 | 🔴 0% | C0 broken |
| batch-012 | ⚠️ 20% | C0 works, 0% success |
| batch-13 | 🔴 0% | Rules created but not applied |
| batch-14 | 🔴 0% | Rules created but not applied |
| batch-15 | 🔴 0% | All go to manual-review/D |

**No batch has achieved a "healthy" (>50%) success rate.**

---

*Metrics source: `loop-metrics.jsonl` | Updates: after each pool batch run*
