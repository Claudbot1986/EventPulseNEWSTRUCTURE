## C4-AI Analysis Round 2 (batch-18)

**Timestamp:** 2026-04-12T18:51:40.494Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 2× Page returns 404, 2× DNS resolution failure, 1× Events page found but extraction failed

---

### Source: friidrottsf-rbundet

| Field | Value |
|-------|-------|
| likelyCategory | Events page found but extraction failed |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.72 |
| nextQueue | retry-pool |

**discoveredPaths:**
- /events [url-pattern] anchor="derived-rule" conf=0.85

**improvementSignals:**
- c0WinnerUrl /events exists with high confidence score
- C2 detected low_value but score=0 indicates breadth_nojsonld
- Extraction returned 0 events despite promising candidate

**suggestedRules:**
- Investigate /events page HTML structure for non-standard date/event markup
- Check if events are loaded via pagination or lazy-load mechanisms
- Consider broader time-tag patterns for Swedish athletic federation sites

---

### Source: vasteras-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | Page returns 404 |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on primary URL indicates page moved or deleted
- Multiple 404 errors suggest systematic URL structure change
- Municipal theater likely has new event page location

**suggestedRules:**
- Search for alternative URL structure for Västerås Stadsteater events
- Check if /stadsteatern moved to different section or subdomain
- Manual investigation needed to locate current event page

---

### Source: linkoping-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | Page returns 404 |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on primary URL indicates page moved or deleted
- Same pattern as Västerås Stadsteater - municipal theater URL issue
- Linköping municipal site likely restructured

**suggestedRules:**
- Search for alternative URL structure for Linköping Stadsteater events
- Check if /stadsteatern path changed to /teater or similar
- Manual investigation needed to locate current event page

---

### Source: sensus

| Field | Value |
|-------|-------|
| likelyCategory | Redirect loop on events page |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- c0Candidates=2 indicates site structure has event pages
- Redirect loop detected on /kurser-och-evenemang suggests broken routing
- Site may have moved to different domain or subdomain

**suggestedRules:**
- Investigate redirect chain for /kurser-och-evenemang
- Check if Sensus uses www.sensus.se or alternative subdomain
- Verify if event content is now on external booking platform

---

### Source: volvo-museum

| Field | Value |
|-------|-------|
| likelyCategory | Cross-domain redirect to worldofvolvo |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked from volvomuseum.se to worldofvolvo.com
- Events may now exist on World of Volvo main site
- Domain consolidation suggests event content migration

**suggestedRules:**
- Add worldofvolvo.com as alternative source for Volvo Museum events
- Verify if volvomuseum.se events are now under worldofvolvo.com events section
- Consider archiving or redirecting old source to new location

---

### Source: stora-teatern-g-teborg

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.65 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- ENOTFOUND error indicates subdomain DNS issue
- Site may use different subdomain structure for theater
- Could be temporary DNS propagation issue

**suggestedRules:**
- Verify correct subdomain for Stora Teatern Göteborg
- Check alternative URLs: goteborg.se/stora-teatern or teater.goteborg.se
- Retry after DNS cache expiration

---

### Source: bk-hacken

| Field | Value |
|-------|-------|
| likelyCategory | Request timeout |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.55 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- 20 second timeout suggests server overload or network issues
- c0LinksFound empty could indicate partial page load failure
- Single failure with timeout - likely transient issue

**suggestedRules:**
- Retry with increased timeout threshold
- Implement exponential backoff for timeout scenarios
- Verify if site has rate limiting or DDoS protection

---

### Source: blekholmen

| Field | Value |
|-------|-------|
| likelyCategory | Unknown fetch error |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.50 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- Unknown error type provides no diagnostic signal
- c0LinksFound empty prevents alternative path discovery
- Insufficient evidence for any category

**suggestedRules:**
- Add more detailed error logging to capture unknown errors
- Retry fetch to determine if error is transient
- Investigate if domain registration is active

---

### Source: boplanet

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.62 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- ENOTFOUND error indicates domain may be inactive
- c0LinksFound empty prevents link-based discovery
- Domain may have expired or been repurposed

**suggestedRules:**
- Verify domain registration status
- Check if boplanet.se redirects or has alternative TLD
- Investigate if organization uses different domain for events

---

### Source: bor-s-zoo-animagic

| Field | Value |
|-------|-------|
| likelyCategory | Rate limited, event pages exist |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |

**discoveredPaths:**
- /events [url-pattern] anchor="derived-rule" conf=0.85
- /program [url-pattern] anchor="derived-rule" conf=0.78
- /kalender [url-pattern] anchor="derived-rule" conf=0.71
- /schema [url-pattern] anchor="derived-rule" conf=0.65
- /evenemang [url-pattern] anchor="derived-rule" conf=0.60
- /kalendarium [url-pattern] anchor="derived-rule" conf=0.55

**improvementSignals:**
- HTTP 429 indicates rate limiting - site is alive
- c0LinksFound contains 17 event-indicating paths with varying scores
- Top candidates: /events (score 10), /program (score 9), /kalender (score 8)

**suggestedRules:**
- Implement rate limiting backoff strategy
- Use top-scoring paths (/events, /program) for initial discovery
- Apply longer delays between requests to avoid 429

---
