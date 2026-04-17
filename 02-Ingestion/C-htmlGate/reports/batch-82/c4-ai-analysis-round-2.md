## C4-AI Analysis Round 2 (batch-82)

**Timestamp:** 2026-04-16T21:49:32.399Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 3× Server timeout, 2× DNS failure, 2× Path 404

---

### Source: spanga-is

| Field | Value |
|-------|-------|
| likelyCategory | DNS failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Domain spanga.se cannot be resolved (DNS ENOTFOUND). No HTTP request could be made. No navigation paths available to attempt.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain spanga.se does not exist (DNS ENOTFOUND)
- No alternative paths available
- Consecutive failures: 2

**suggestedRules:**
- Verify domain spelling and existence before attempting scrape
- Add DNS lookup pre-check to prevent wasted crawl attempts

---

### Source: hammarby

| Field | Value |
|-------|-------|
| likelyCategory | Events on subpages |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.91 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /kalender, /schema, /evenemang, /kalendarium, /aktiviteter |

**humanLikeDiscoveryReasoning:**
Root page hammarbyfotboll.se/ has no events. C0 analysis found 30 event-indicating links. Top candidates: /events (score 10), /program (score 9), /kalender (score 8). Human-like reasoning: sports club sites organize events by fixtures/match schedules. Swedish sports sites commonly use /program (schedule), /events, /kalender for listings. C4 should route to retry-pool and test these navigation paths.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/schema|/evenemang`
- appliesTo: Swedish sports clubs (football, hockey) and municipal cultural sites
- confidence: 0.88

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.92
- /program [nav-link] anchor="derived-rule" conf=0.88
- /kalender [nav-link] anchor="derived-rule" conf=0.85
- /schema [nav-link] anchor="derived-rule" conf=0.82
- /evenemang [nav-link] anchor="derived-rule" conf=0.80

**improvementSignals:**
- c0LinksFound contains 30 event-indicating paths including /events (score 10), /program (score 9), /kalender (score 8)
- Navigation clearly shows events exist on site
- Root page has no events but subpage links are strong

**suggestedRules:**
- Swedish football club sites typically have /events, /program, /kalender for fixtures
- Site structure: homepage → events section via nav link
- Rule: always follow /events|/program|/kalender paths on sports club sites

---

### Source: medborgarhuset

| Field | Value |
|-------|-------|
| likelyCategory | Server timeout |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.85 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Server timeout after 20s - unable to fetch any HTML content. Without content, no navigation analysis possible. Timeout suggests site may be down, overloaded, or blocking requests. No discovered paths to retry.

**discoveredPaths:**
(none)

**improvementSignals:**
- fetchHtml timed out after 20000ms
- No links found (c0LinksFound empty)
- Site may be down or blocking requests

**suggestedRules:**
- Implement timeout handling with fallback to cached/alternative sources
- Timeout on medborgarhuset.se suggests server issues - verify site accessibility manually

---

### Source: uppsala-kommun

| Field | Value |
|-------|-------|
| likelyCategory | Extraction mismatch |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.87 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /kultur-idrott-fritid/arrangera-evenemang/ |

**humanLikeDiscoveryReasoning:**
uppsala.se found event-heading pattern (score 11) on subpage. Extraction failed despite promising signals. Municipal Swedish sites often use custom HTML structures for event listings. Need refined extraction patterns for Swedish municipal event formats.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/arrangera|/kultur|/fritid`
- appliesTo: Swedish municipal sites (kommun) with cultural/activity event pages
- confidence: 0.82

**discoveredPaths:**
- /kultur-idrott-fritid/arrangera-evenemang/ [url-pattern] anchor="c0WinnerUrl" conf=0.78

**improvementSignals:**
- C2 scored 11 (promising) with event-heading pattern detected
- C3 extraction returned 0 events despite positive signals
- Page has timeTagCount=1, dateCount=1 - some event structure exists

**suggestedRules:**
- Cultural/municipal sites may use custom event markup outside standard patterns
- Consider regex patterns for Swedish date formats (DD MMM, D MMMM YYYY)
- Extract from event-heading or event-listing containers even if no JSON-LD present

---

### Source: norrkoping-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | Path 404 |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.89 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
/konserthus returned 404. Without content, no alternative paths discovered. Could try root norrkoping.se to find correct concert hall path, but this is speculation. Best to send to manual-review.

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on norrkoping.se/konserthus
- c0LinksFound empty - no navigation from failed path
- Subpage may have moved or been removed

**suggestedRules:**
- Check if norrkoping.se/konserthus or /konserth all exist
- Consider /konserthuset or similar Swedish variations
- Municipal concert halls may be at different URL structures

---

### Source: form-design-museum

| Field | Value |
|-------|-------|
| likelyCategory | HTTP 400 error |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.86 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Received HTTP 400 Bad Request. Server is actively rejecting the HTTP request. No HTML content to analyze. Cannot perform human-like discovery without accessible content.

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 400 Bad Request on formdesigncenter.se/
- Server rejecting requests - may be blocked or misconfigured
- No navigation possible with 400 response

**suggestedRules:**
- HTTP 400 may indicate server-side blocking or wrong User-Agent
- Verify site accessibility manually
- Check if site requires specific headers or has protection

---

### Source: linkoping-city

| Field | Value |
|-------|-------|
| likelyCategory | DNS failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Domain linkopingcity.se cannot be resolved. DNS ENOTFOUND means domain does not exist. No HTTP request possible, no navigation paths to attempt. Human-like discovery requires accessible content.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain linkopingcity.se does not exist (DNS ENOTFOUND)
- No HTTP request possible
- Only 1 consecutive failure - new failure

**suggestedRules:**
- Verify domain spelling - may be linkoping.se or linkopingsstad.se
- Add DNS pre-check to prevent failed crawl attempts
- Consider alternative: https://visitlinkoping.se/

---

### Source: halmstad-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | Path 404 |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.87 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
HTTP 404 on /konserthus path. Without content from that specific path, no navigation analysis possible. Could theoretically try halmstad.se root but that is not derived from c0LinksFound (which is empty). Best to manual-review.

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on halmstad.se/konserthus
- Parent domain halmstad.se likely exists (municipal site)
- Subpage structure may have changed

**suggestedRules:**
- Halmstad Konserthus may be at /konserth all or /hallar/konserthus
- Try halmstad.se directly for navigation to event venue pages
- Municipal concert halls often under /kultur/ or /evenemang/

---

### Source: mora-ik

| Field | Value |
|-------|-------|
| likelyCategory | Server timeout |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Server timeout after 20s on moraik.se/. No HTML content received. Without content, no links discovered and no navigation paths available. Timeout suggests server unavailability.

**discoveredPaths:**
(none)

**improvementSignals:**
- fetchHtml timed out after 20000ms
- No links found (c0LinksFound empty)
- Server unresponsive - site may be down

**suggestedRules:**
- Implement retry with increased timeout for Swedish regional sports clubs
- Timeout may indicate overloaded server or geographic blocking
- Verify site accessibility manually before retry

---

### Source: orebro-hockey

| Field | Value |
|-------|-------|
| likelyCategory | Server timeout |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Server timeout after 20s on orebrohockey.se/. SHL team sites often have high traffic or protection. No HTML content received, no links discovered. Without content, human-like discovery impossible.

**discoveredPaths:**
(none)

**improvementSignals:**
- fetchHtml timed out after 20000ms
- No links found (c0LinksFound empty)
- SHL hockey team site - may have high traffic

**suggestedRules:**
- Swedish Hockey League (SHL) sites may have DDoS protection
- Consider browser automation (D route) for JS-rendered or protected sites
- Timeout may be deliberate blocking - verify manually

---
