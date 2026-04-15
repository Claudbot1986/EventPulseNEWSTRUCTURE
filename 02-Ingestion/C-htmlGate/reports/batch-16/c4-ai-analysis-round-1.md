## C4-AI Analysis Round 1 (batch-16)

**Timestamp:** 2026-04-12T16:25:45.145Z
**Sources analyzed:** 8

### Overall Pattern
Top failure categories: 2× Entry page HTTP 404, 1× HTTP 429 rate limit, 1× Cross-domain redirect blocked

---

### Source: slottsskogen

| Field | Value |
|-------|-------|
| likelyCategory | HTTP 429 rate limit |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.95
- /program [nav-link] anchor="derived-rule" conf=0.90
- /kalender [nav-link] anchor="derived-rule" conf=0.85
- /schema [nav-link] anchor="derived-rule" conf=0.80
- /evenemang [nav-link] anchor="derived-rule" conf=0.75
- /kalendarium [nav-link] anchor="derived-rule" conf=0.70
- /aktiviteter [nav-link] anchor="derived-rule" conf=0.65
- /kultur [nav-link] anchor="derived-rule" conf=0.60
- /fritid [nav-link] anchor="derived-rule" conf=0.55
- /matcher [nav-link] anchor="derived-rule" conf=0.50
- /biljetter [nav-link] anchor="derived-rule" conf=0.45

**improvementSignals:**
- HTTP 429 indicates rate limiting - implement exponential backoff
- 11 rule-derived event paths identified but not fetched
- C1 failure prevented verification of candidates

**suggestedRules:**
- Add rate limit detection with adaptive delay before retry
- Try fetching derived event paths (/events, /program, /kalender) instead of root URL
- Consider path-specific fetch order based on Swedish event URL patterns

---

### Source: vega

| Field | Value |
|-------|-------|
| likelyCategory | Cross-domain redirect blocked |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.45 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect to tobiasnygren.se blocked - target domain may have events
- No candidate links found from entry page
- C1 blocked at redirect stage

**suggestedRules:**
- Investigate target domain (tobiasnygren.se) for event content
- Update robots.txt or referrer handling for cross-domain redirects
- Manual URL discovery may be required for this source

---

### Source: vaxjo-lakers

| Field | Value |
|-------|-------|
| likelyCategory | Request timeout |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.40 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- Timeout of 20000ms exceeded suggests site slowness or temporary unavailability
- No candidate links found from entry page
- C2 failure prevents further analysis

**suggestedRules:**
- Increase timeout threshold for known slow Swedish sites
- Implement retry with extended timeout for timeout failures
- Manual investigation may reveal alternate entry points

---

### Source: svenska-fotbollf-rbundet

| Field | Value |
|-------|-------|
| likelyCategory | Event page lacks event data |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.80 |
| nextQueue | D |
| directRouting | D (conf=0.75) |

**discoveredPaths:**
- /biljett/ [url-pattern] anchor="derived-rule" conf=0.70

**improvementSignals:**
- C2 found promising score=12 with event-heading class but C3 extracted 0 events
- c1TimeTagCount=0 and c1DateCount=0 indicates no structured date/time data in raw HTML
- /biljett/ page selected but likely contains only purchase form, not event listings

**suggestedRules:**
- Look for separate event schedule/listings page beyond ticket pages
- Search for event-calendar or team-schedule patterns on football federation sites
- Consider that biljett/ is a purchase portal, not event discovery page

---

### Source: umea-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | Entry page HTTP 404 |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.85 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on umea.se/konserthus - URL structure may be incorrect
- Conserthus subsection may have moved to different URL path
- No candidate links found from failed entry

**suggestedRules:**
- Investigate correct URL for Umeå Konserthus events
- Try /konserthus/aktiviteter or similar Swedish cultural venue patterns
- Manual URL discovery recommended due to persistent 404

---

### Source: oland

| Field | Value |
|-------|-------|
| likelyCategory | Calendar page extraction failed |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.78 |
| nextQueue | D |
| directRouting | D (conf=0.72) |

**discoveredPaths:**
- /kalender [url-pattern] anchor="derived-rule" conf=0.85

**improvementSignals:**
- C2 found promising score=12 with date-pattern but C3 extracted 0 events
- c1DateCount=9 indicates date strings present but extraction failed
- Winner URL /kalender identified but HTML structure doesn't match patterns

**suggestedRules:**
- Expand date pattern detection for Swedish regional sites like oland.se
- Look for custom calendar widget patterns on municipality sites
- C3 patterns may not match Swedish municipal site HTML structure

---

### Source: orebro-vinterfest

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failed |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.65 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS lookup failed (ENOTFOUND) - domain may be defunct or misconfigured
- No candidate links found due to C1 failure
- Single consecutiveFailure suggests recent domain change

**suggestedRules:**
- Verify domain status - may have moved to new domain
- Check if Örebro Vinterfest is now part of larger regional event site
- Low priority for scraping if event is seasonal/archived

---

### Source: lunds-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | Entry page HTTP 404 |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.85 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on lund.se/konserthus - Lund University site structure differs
- Conserthus may be under different subdomain or path
- No candidate links found from failed entry

**suggestedRules:**
- Investigate correct URL for Lunds Konserthus (likely lund.se/konserthuset or ticket.lund.se)
- Try cultural venue patterns common to Swedish university cities
- Manual URL discovery recommended due to persistent 404

---
