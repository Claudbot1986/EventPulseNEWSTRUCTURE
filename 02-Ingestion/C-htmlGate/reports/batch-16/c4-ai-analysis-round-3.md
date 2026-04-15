## C4-AI Analysis Round 3 (batch-16)

**Timestamp:** 2026-04-12T16:28:26.291Z
**Sources analyzed:** 5

### Overall Pattern
Top failure categories: 1× unreachable_site, 1× dns_unresolvable, 1× domain_not_found

---

### Source: bk-hacken

| Field | Value |
|-------|-------|
| likelyCategory | unreachable_site |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.52 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution timeout - site may be down or blocking crawler IPs
- no C0 links discovered suggests site is inaccessible rather than empty

**suggestedRules:**
- Add DNS health check before crawl - verify domain resolves and accepts connections
- If consecutive timeouts continue, flag source as permanently unreachable and remove from active pool

---

### Source: blekholmen

| Field | Value |
|-------|-------|
| likelyCategory | dns_unresolvable |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.55 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- fetchHtml failed with 'unknown' error - site unreachable or blocking requests
- zero C0 candidates suggests complete fetch failure rather than empty page

**suggestedRules:**
- Distinguish between transient errors and permanent DNS failures
- Implement exponential backoff with longer delays for 'unknown' errors

---

### Source: boplanet

| Field | Value |
|-------|-------|
| likelyCategory | domain_not_found |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.62 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- ENOTFOUND error - domain boplanet.se does not exist or DNS cannot resolve it
- completely unfetchable with zero links discovered

**suggestedRules:**
- ENOTFOUND is a hard failure - verify domain spelling and existence
- Cross-check against source registry to confirm if domain was correct at registration

---

### Source: bor-s-zoo-animagic

| Field | Value |
|-------|-------|
| likelyCategory | rate_limited_but_reachable |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.90
- /program [nav-link] anchor="derived-rule" conf=0.85
- /kalender [nav-link] anchor="derived-rule" conf=0.80
- /schema [nav-link] anchor="derived-rule" conf=0.75
- /evenemang [nav-link] anchor="derived-rule" conf=0.70
- /kalendarium [nav-link] anchor="derived-rule" conf=0.65
- /aktiviteter [nav-link] anchor="derived-rule" conf=0.50
- /kultur [nav-link] anchor="derived-rule" conf=0.40
- /fritid [nav-link] anchor="derived-rule" conf=0.35
- /matcher [nav-link] anchor="derived-rule" conf=0.30
- /biljetter [nav-link] anchor="derived-rule" conf=0.25

**improvementSignals:**
- HTTP 429 indicates site is reachable but rate-limiting requests
- C0 discovered 17 candidate paths including /events, /program, /kalender - site clearly has event content
- likelyJsRendered=false but fetch failed due to rate limiting, not missing content

**suggestedRules:**
- Add longer delay between retries for 429 responses - implement 30-60s backoff
- C0 links strongly indicate event-related paths - prioritize /events and /program for subsequent attempts

---

### Source: borlange-kommun

| Field | Value |
|-------|-------|
| likelyCategory | extraction_failed_despite_promise |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.90
- /program [nav-link] anchor="derived-rule" conf=0.85
- /kalender [nav-link] anchor="derived-rule" conf=0.80
- /schema [nav-link] anchor="derived-rule" conf=0.75
- /evenemang [nav-link] anchor="derived-rule" conf=0.92

**improvementSignals:**
- C2 score=145 is highly promising but extraction returned 0 events
- 18 timeTags and 20 dates detected in C1 - content definitely exists on /evenemang
- c2Reason shows cards=medium(12/12) detected but nothing extracted

**suggestedRules:**
- Page has structured event cards (12 detected) but extraction patterns don't match - investigate card CSS selectors
- C2 saw time-tags and news-article negative - events may be embedded in article-like cards with non-standard markup
- Check if events are in a SPA framework with Shadow DOM or custom data attributes

---
