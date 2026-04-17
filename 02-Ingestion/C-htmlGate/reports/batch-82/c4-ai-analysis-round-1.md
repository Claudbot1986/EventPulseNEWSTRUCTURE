## C4-AI Analysis Round 1 (batch-82)

**Timestamp:** 2026-04-16T21:48:17.880Z
**Sources analyzed:** 7

### Overall Pattern
Top failure categories: 1× DNS resolution failure, 1× JS-rendered ticket page, 1× Homepage no events, subpages have them

---

### Source: spanga-is

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot attempt discovery on unreachable domain - DNS resolution failed with ENOTFOUND. No HTML content to analyze. Site may be offline or domain deprecated.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution failed (ENOTFOUND) - domain may be inactive or misspelled
- No HTTP response received before failure
- Consider verifying domain spelling: spanga.se vs spanga.is

**suggestedRules:**
- Add DNS resolution check before C1 to detect unreachable domains early
- Spanga-is: verify if 'is' TLD was intended vs 'se' for Swedish sites

---

### Source: svenska-hockeyligan-shl

| Field | Value |
|-------|-------|
| likelyCategory | JS-rendered ticket page |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.82 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | /biljetter |
| directRouting | D (conf=0.88) |

**humanLikeDiscoveryReasoning:**
C0 stage found /biljetter (tickets) as winning candidate. C2 shows 'event-heading' page class but score=1 indicating minimal markup. Zero time tags despite event-ticket context strongly suggests client-side rendering. Direct route to D will render JS and extract.

**discoveredPaths:**
- /biljetter [derived] anchor="biljetter" conf=0.78

**improvementSignals:**
- C0 identified /biljetter as top candidate but C2 shows only 'event-heading' class without structured data
- Zero time tags and date counts despite ticket page indicating events exist
- C2 score=1 suggests page lacks JSON-LD and has minimal event markup

**suggestedRules:**
- Route sports ticket pages to D (render fallback) when C1 shows 0 timeTags but C0 finds ticket/event links
- SHL: /biljetter likely requires JS rendering to load event list

---

### Source: hammarby

| Field | Value |
|-------|-------|
| likelyCategory | Homepage no events, subpages have them |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.91 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /kalender, /schema, /evenemang |

**humanLikeDiscoveryReasoning:**
Homepage is event-free (C1 no-main, C2 low_value), but C0LinksFound reveals strong event navigation signals: /events (10), /program (9), /kalender (8), /schema (7), /evenemang (6). These are Swedish sports club event paths. C0Candidates=0 while having 10+ scored links suggests rule-based candidate ranking missed nav-derived paths. Retry-pool should try top paths.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/schema|/evenemang|/kalendarium`
- appliesTo: Swedish sports clubs, football teams, athletic organizations with event schedules
- confidence: 0.87

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.95
- /program [nav-link] anchor="derived-rule" conf=0.92
- /kalender [nav-link] anchor="derived-rule" conf=0.88
- /schema [nav-link] anchor="derived-rule" conf=0.85
- /evenemang [nav-link] anchor="derived-rule" conf=0.83

**improvementSignals:**
- C0LinksFound contains 10+ highly-scored event paths (/events, /program, /kalender, /schema, /evenemang)
- C0Candidates=0 contradicts strong link signals - rule-based ranking may miss these
- C1: no-main verdict with 0 timeTags and 0 dateCounts for homepage
- C2: 'time-tag' page with score=0 despite visible event navigation

**suggestedRules:**
- Swedish sports clubs: prioritize /events, /program, /kalender, /schema, /evenemang paths even when homepage C0 candidates=0
- When c0LinksFound contains score>=6 event paths, route to retry-pool instead of discovery_failure

---

### Source: medborgarhuset

| Field | Value |
|-------|-------|
| likelyCategory | Network timeout on homepage |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.78 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot analyze c0LinksFound - homepage fetch timed out. Timeout may be transient (server overloaded) but cannot verify without successful fetch. No paths discovered to retry.

**discoveredPaths:**
(none)

**improvementSignals:**
- Timeout of 20000ms exceeded - server may be slow or blocking scrapers
- No c0LinksFound to analyze - couldn't retrieve homepage content
- C1 unfetchable despite only 1 consecutive failure

**suggestedRules:**
- Medborgarhuset: timeout may be transient - consider retry with longer timeout or alternate path
- Check robots.txt before assuming no path exists

---

### Source: uppsala-kommun

| Field | Value |
|-------|-------|
| likelyCategory | Extraction failed despite promising signals |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.87 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /kultur-idrott-fritid/evenemang, /kalender, /konserter |

**humanLikeDiscoveryReasoning:**
C2 promising (score=11, event-heading) but C3 extraction returned 0. C0 winner is /arrangera-evenemang/ (organize events) - informational page about hosting events, not event listings. Uppsala municipality likely has event listing under Kultur-och-fritid section. Retry-pool should try /evenemang and /kalender under municipal domain.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/kalender|/konserter|/kultur`
- appliesTo: Swedish municipal sites (kommun) with cultural/recreational event listings
- confidence: 0.82

**discoveredPaths:**
- /kultur-idrott-fritid/evenemang [url-pattern] anchor="derived" conf=0.75
- /kalender [url-pattern] anchor="derived" conf=0.72
- /konserter [url-pattern] anchor="derived" conf=0.68

**improvementSignals:**
- C2 promising (score=11) with 'event-heading' page, but extraction returned 0 events
- C1: medium verdict, 1 timeTag and 1 dateCount detected
- Mismatch between C2 score and actual event extraction
- C0 winner: /arrangera-evenemang/ - page about organizing events, not event listings

**suggestedRules:**
- Uppsala: C0 winner path is about 'organizing events', not 'event listings' - wrong entry page selected
- When C0 winner path contains 'arrangera' (organize), prefer alternative event listing paths like /evenemang or /kalender

---

### Source: norrkoping-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | 404 page not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
HTTP 404 confirms page permanently removed or path changed. Cannot discover event paths on non-existent page. Manual review needed to identify correct URL for Norrköping Konserthus.

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 - target URL path /konserthus does not exist
- Domain resolves (norrkoping.se accessible) but specific path is broken
- Consider that konserthus may have moved to different URL structure

**suggestedRules:**
- Norrkoping Konserthus: 404 suggests URL restructure - search for 'konserthus' on norrkoping.se landing page
- Add 404 detection to mark sources as permanently unavailable

---

### Source: form-design-museum

| Field | Value |
|-------|-------|
| likelyCategory | HTTP 400 bad request |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
HTTP 400 response indicates server is actively rejecting the request - likely bot detection or malformed request. Cannot discover event paths when all requests are rejected. Manual review required to determine if browser automation needed.

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 400 - server rejected request as malformed
- May indicate SSL/TLS issue, invalid headers, or bot detection
- Domain exists but is blocking scraper requests specifically

**suggestedRules:**
- Formdesigncenter: HTTP 400 may indicate bot detection or SSL handshake failure
- Check if site requires specific user-agent or accepts robots
- Consider using browser automation for sites that return 400 to scrapers

---
