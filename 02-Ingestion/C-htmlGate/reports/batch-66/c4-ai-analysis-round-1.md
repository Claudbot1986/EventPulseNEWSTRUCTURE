## C4-AI Analysis Round 1 (batch-66)

**Timestamp:** 2026-04-16T20:41:19.300Z
**Sources analyzed:** 8

### Overall Pattern
Top failure categories: 2× network_connectivity_issue, 1× network_timeout, 1× wrong_page_type_extracted

---

### Source: stockholms-stadsteater

| Field | Value |
|-------|-------|
| likelyCategory | network_connectivity_issue |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Connection refused (139.162.135.242:443) prevents any page access. This is a network-layer failure, not a content discovery issue.

**discoveredPaths:**
(none)

**improvementSignals:**
- ECONNREFUSED indicates server unreachable
- Temporary network failure or server down

**suggestedRules:**
- Retry strategy: implement exponential backoff for connection refused errors

---

### Source: helsingborg-arena

| Field | Value |
|-------|-------|
| likelyCategory | network_timeout |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.60 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Timeout of 20000ms exceeded indicates server responsiveness issue. Cannot attempt content discovery until page is reachable.

**discoveredPaths:**
(none)

**improvementSignals:**
- 20s timeout exceeded
- Server may be slow or overloaded

**suggestedRules:**
- Increase timeout threshold for Swedish venue sites known to be slow

---

### Source: liseberg

| Field | Value |
|-------|-------|
| likelyCategory | wrong_page_type_extracted |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.75 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | /parken/biljetter-priser/ |
| directRouting | D (conf=0.78) |

**humanLikeDiscoveryReasoning:**
C2 scored 64 on price-marker page which is not an event listing. Liseberg likely uses JS-rendered event calendar. Route to D for render fallback, then try /evenemang path.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/program|/aktuellt|/hitta-upplevelser`
- appliesTo: Swedish amusement parks and attractions
- confidence: 0.75

**discoveredPaths:**
- /evenemang [url-pattern] anchor="event listing" conf=0.70
- /program [url-pattern] anchor="program" conf=0.65

**improvementSignals:**
- c0WinnerUrl points to price page, not event listing
- C2 promising score=64 may be false positive on price markers
- Liseberg events likely on /evenemang or /program pages

**suggestedRules:**
- For theme parks, prefer event listing URLs over ticket/price pages
- Add Liseberg-specific path: /evenemang, /program, /hitta-upplevelser

---

### Source: inkonst

| Field | Value |
|-------|-------|
| likelyCategory | network_connectivity_issue |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Connection refused on 64.176.190.213:443 - this is a network-layer failure. Cannot analyze content until server is reachable.

**discoveredPaths:**
(none)

**improvementSignals:**
- ECONNREFUSED (64.176.190.213:443) - server unreachable
- May indicate site migrated or changed IP

**suggestedRules:**
- Verify Inköpst URL is current - 64.176.190.213 may be deprecated

---

### Source: visit-vasteras

| Field | Value |
|-------|-------|
| likelyCategory | redirect_loop_detected |
| failCategory | robots_or_policy_blocked |
| failCategoryConfidence | 0.60 |
| nextQueue | retry-pool |
| discoveryAttempted | false |
| discoveryPathsTried | /evenemangskalender/ |

**humanLikeDiscoveryReasoning:**
Redirect loop suggests either policy blocking or server misconfiguration. Try alternative paths like /evenemang, /kalender without the 'kalender' suffix.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/kalender|/program|/händer`
- appliesTo: Swedish tourism/visit sites with event calendars
- confidence: 0.60

**discoveredPaths:**
(none)

**improvementSignals:**
- Redirect loop on /evenemangskalender
- May indicate policy blocking or misconfigured redirects

**suggestedRules:**
- Investigate redirect chain for visitvasteras.se
- Check robots.txt for event calendar restrictions

---

### Source: teater-galeasen

| Field | Value |
|-------|-------|
| likelyCategory | strong_nav_paths_exist |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
galeasen.se has rich event navigation infrastructure. C2 detected 'event-heading' structure confirming this is an event-rich site. Primary candidates: /events, /program, /kalender. The network failure prevented initial fetch but these paths are high-confidence based on Swedish theater site patterns.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/schema|/evenemang`
- appliesTo: Swedish theater and performing arts venues
- confidence: 0.85

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.85
- /program [nav-link] anchor="derived-rule" conf=0.80
- /kalender [nav-link] anchor="derived-rule" conf=0.75
- /schema [nav-link] anchor="derived-rule" conf=0.65
- /evenemang [nav-link] anchor="derived-rule" conf=0.60

**improvementSignals:**
- c0LinksFound contains 10+ event-indicating paths with positive scores
- Top candidates: /events (10), /program (9), /kalender (8) are high-confidence
- Page has event-heading in C2 analysis - site has event content structure

**suggestedRules:**
- For Swedish theater sites, prioritize /events, /program, /kalender paths
- galeasen.se likely uses /program or /kalender for current season events

---

### Source: volvo-museum

| Field | Value |
|-------|-------|
| likelyCategory | js_rendered_event_page |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.80 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | /sv/live/ |
| directRouting | D (conf=0.85) |

**humanLikeDiscoveryReasoning:**
volvo-museum.se/sv/live/ identified as promising but extraction returned 0 events with 0 timeTags. This pattern (promising score + zero HTML dates) strongly indicates client-side rendering. Route to D-path for Playwright/maybe extraction.

**candidateRuleForC0C3:**
- pathPattern: `/live|/events|/kalender|/aktuellt`
- appliesTo: Swedish museum and exhibition sites
- confidence: 0.70

**discoveredPaths:**
- /sv/live/ [content-link] anchor="live events" conf=0.85

**improvementSignals:**
- C2 promising score=15 on 'price-marker' page
- c0WinnerUrl /sv/live/ suggests live events section
- 0 timeTags despite promising score indicates JS-rendering

**suggestedRules:**
- Museum live events typically use JS-rendered calendars
- Volvo Museum likely needs D-path for client-side rendered event listings

---

### Source: umea-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | incorrect_url_structure |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /konserthus |

**humanLikeDiscoveryReasoning:**
URL https://umea.se/konserthus returned 404. Umeå's concert house likely has a different URL structure. Try common Swedish concert hall patterns: /konserthuset, /program, /konserter. The site may have moved to konserthuset.umea.se or similar.

**candidateRuleForC0C3:**
- pathPattern: `/konserthuset|/program|/konserter|/biljetter|/kalender`
- appliesTo: Swedish municipal concert halls and music venues
- confidence: 0.70

**discoveredPaths:**
- /program [url-pattern] anchor="program" conf=0.70
- /konserter [url-pattern] anchor="concerts" conf=0.65
- /biljetter [url-pattern] anchor="tickets" conf=0.60

**improvementSignals:**
- HTTP 404 on current URL structure
- umea.se/konserthus may be incorrect - Umeå Konserthus may have different URL
- Common pattern: umea.se/konserthuset or konserthuset.umea.se

**suggestedRules:**
- Verify Umeå Konserthus canonical URL - /konserthus may be wrong path
- Try: /konserthuset, /konserter, /program, /biljetter

---
