## C4-AI Analysis Round 3 (batch-23)

**Timestamp:** 2026-04-13T16:53:58.690Z
**Sources analyzed:** 3

### Overall Pattern
Top failure categories: 1× network timeout, 1× unknown fetch error, 1× dead domain

---

### Source: bk-hacken

| Field | Value |
|-------|-------|
| likelyCategory | network timeout |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.45 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- Site consistently times out at 20000ms threshold — may need extended timeout budget
- c0LinksFound is empty suggesting fetch never completed enough to parse links
- Two consecutive failures both network-related — possible rate limiting or IP block
- c1LikelyJsRendered=false but fetch never succeeded so JS render status is unconfirmed

**suggestedRules:**
- If fetchHtml returns timeout and consecutiveFailures <= 2, re-queue with 40000ms timeout before escalating
- If site consistently times out across 3+ attempts, flag for manual review to check if scraper IP is blocked
- Use HEAD request to probe site liveness before committing to full fetch

---

### Source: blekholmen

| Field | Value |
|-------|-------|
| likelyCategory | unknown fetch error |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.38 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- c2Reason is 'fetchHtml failed: unknown' — error type is unclassified, making diagnosis impossible
- c0LinksFound is empty and c0Candidates is 0, indicating fetch never returned usable HTML
- Two consecutive failures with no error detail — error logging may need improvement upstream
- c1LikelyJsRendered=false cannot be trusted when fetch itself failed

**suggestedRules:**
- Improve error capture in fetchHtml to surface specific error codes (ECONNREFUSED, ETIMEDOUT, etc.) instead of 'unknown'
- On 'unknown' fetch error, retry once with a different user-agent or proxy before marking as failed
- If consecutiveFailures reaches 3 with 'unknown' errors, escalate to manual-review for domain health check

---

### Source: boplanet

| Field | Value |
|-------|-------|
| likelyCategory | dead domain |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- ENOTFOUND error confirms DNS resolution failure — domain boplanet.se does not resolve
- Domain is likely expired, transferred, or permanently offline
- Two consecutive failures both returning DNS failure — not a transient error
- No links, no candidates, no fetch possible — source has zero recoverability without domain change

**suggestedRules:**
- If fetchHtml fails with ENOTFOUND (DNS), immediately mark source as 'dead-domain' and skip retry-pool
- Route all ENOTFOUND sources directly to manual-review for domain status verification and possible source removal
- Add a pre-flight DNS check step before full fetch to catch dead domains cheaply and early
- If domain is confirmed dead after manual review, remove from source list and log removal reason

---
