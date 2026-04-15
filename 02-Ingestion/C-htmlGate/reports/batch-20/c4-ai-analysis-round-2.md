## C4-AI Analysis Round 2 (batch-20)

**Timestamp:** 2026-04-13T03:22:44.100Z
**Sources analyzed:** 3

### Overall Pattern
Top failure categories: 1× unreachable_site, 1× dns_resolution_failure, 1× js_rendering_probable

---

### Source: blekholmen

| Field | Value |
|-------|-------|
| likelyCategory | unreachable_site |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.72 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- fetchHtml failed with unknown error on root URL
- no links discovered in C0 crawl
- site may be down or blocking requests

**suggestedRules:**
- Add retry mechanism for sites returning unknown fetch errors
- Consider DNS resolution check before crawling
- Log HTTP status codes to differentiate 4xx/5xx from network errors

---

### Source: boplanet

| Field | Value |
|-------|-------|
| likelyCategory | dns_resolution_failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution failed: ENOTFOUND boplanet.se
- site may have been decommissioned or misconfigured
- alternative: wrong TLD or domain typo

**suggestedRules:**
- Detect ENOTFOUND errors and flag as retry-candidates after cooldown
- Cross-check domain against known Swedish event platforms
- Consider removing or flagging permanently unreachable domains

---

### Source: mittuniversitetet

| Field | Value |
|-------|-------|
| likelyCategory | js_rendering_probable |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.76 |
| nextQueue | D |
| directRouting | D (conf=0.78) |

**discoveredPaths:**
(none)

**improvementSignals:**
- c1TimeTagCount=0 and c1DateCount=0 despite being event page
- c2Score=4 well below threshold of 12
- c0RootFallback used wrong page (/utbildning/)
- likelyJsRendered=false but HTML may be empty due to blocking

**suggestedRules:**
- When timeTagCount=0 AND dateCount=0 on event-entry URL, trigger D-stage immediately
- Improve fallback logic to stay closer to event paths when c0Candidates=1
- Add JS-detection heuristics based on empty HTML with status 200

---
