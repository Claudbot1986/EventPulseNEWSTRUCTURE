## C4-AI Analysis Round 2 (batch-68)

**Timestamp:** 2026-04-16T20:47:11.773Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 4× DNS resolution failure, 1× SSL certificate mismatch blocks all access, 1× Redirect loop indicates JS-routing

---

### Source: roda-kvarn

| Field | Value |
|-------|-------|
| likelyCategory | SSL certificate mismatch blocks all access |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot attempt discovery - SSL certificate mismatch prevents any HTTP requests from succeeding. The domain resolves but SSL handshake fails.

**discoveredPaths:**
(none)

**improvementSignals:**
- Certificate mismatch: Host rodakvarn.se not in *.one.com cert altnames
- HTTPS/SSL configuration issue prevents any page fetching

**suggestedRules:**
- Investigate if rodakvarn.se has relocated to a different domain or subdomain
- Verify SSL certificate coverage with hosting provider (one.com)

---

### Source: studio-acusticum

| Field | Value |
|-------|-------|
| likelyCategory | Redirect loop indicates JS-routing |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.88 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | /evenemang/ |
| directRouting | D (conf=0.88) |

**humanLikeDiscoveryReasoning:**
c0WinnerUrl=https://studioacusticum.se/evenemang/ was identified as candidate but fetchHtml failed with redirect loop. This pattern suggests the page exists but client-side JavaScript handles URL routing, requiring JS rendering (D queue) to break the loop.

**discoveredPaths:**
(none)

**improvementSignals:**
- Redirect loop detected on /evenemang/ page
- c0WinnerUrl=/evenemang/ suggests events exist but JS routing blocks direct access

**suggestedRules:**
- Route to D (render fallback) for JS-rendered event pages
- Redirect loop on event pages is strong indicator of client-side routing

---

### Source: songkick

| Field | Value |
|-------|-------|
| likelyCategory | High-scoring page yielded no events |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.82 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /festivals |

**humanLikeDiscoveryReasoning:**
c0WinnerUrl=/festivals page shows promise with 49 time tags and C2 score=323, but extraction returned 0 events. This suggests structural mismatch between detection signals and actual event extraction patterns. Should retry with different extraction strategy.

**discoveredPaths:**
(none)

**improvementSignals:**
- C2 score=323 (high) but C3 extraction returned 0 events
- 49 time tags found (c1TimeTagCount) but no events extracted
- c1Verdict=no-main suggests main content area not identified correctly

**suggestedRules:**
- Review extraction patterns for songkick.com - JSON-LD may use non-standard schema
- Investigate why high time-tag count yields zero events - extraction may be targeting wrong elements

---

### Source: ekero

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.97 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot attempt discovery - DNS resolution fails for ekeroif.se. Domain does not exist or is unreachable.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND ekeroif.se - domain does not resolve
- Multiple consecutive failures suggest persistent DNS issue

**suggestedRules:**
- Verify domain name spelling: try ekeroif.se alternatives (ekero.if.se, ekeroik.se)
- Check if organization has moved to new domain or uses different subdomain

---

### Source: globen

| Field | Value |
|-------|-------|
| likelyCategory | TLS protocol error blocks access |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.93 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot attempt discovery - TLS protocol error prevents any page fetching. Server appears reachable but has SSL/TLS configuration issues.

**discoveredPaths:**
(none)

**improvementSignals:**
- TLS alert number 112 - server may be misconfigured
- write EPROTO SSL error suggests TLS handshake failure

**suggestedRules:**
- Check if globen.se has migrated to globen.se (with www) or new domain
- SSL/TLS configuration may need update or SNI configuration fix

---

### Source: uppsala-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.97 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot attempt discovery - DNS resolution fails for uppsala-stadsteatern.se. Domain does not exist.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND uppsala-stadsteatern.se - domain does not resolve
- Consecutive failures indicate persistent DNS issue

**suggestedRules:**
- Verify domain spelling - try uppsala-stadsteater.se or uppsala stadsteater
- Check if theater has merged with other venues or uses different domain

---

### Source: grona-lund

| Field | Value |
|-------|-------|
| likelyCategory | Promising page score but zero events extracted |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /biljetter |

**humanLikeDiscoveryReasoning:**
c0WinnerUrl=/biljetter identified as promising page, but 0 time tags found and extraction returned 0 events. This page likely lists ticket categories rather than specific events. Should try alternative paths like /program or /evenemang for actual event listings.

**candidateRuleForC0C3:**
- pathPattern: `/program|/evenemang|/konserter`
- appliesTo: Swedish entertainment/venue sites
- confidence: 0.72

**discoveredPaths:**
(none)

**improvementSignals:**
- C2 score=8 (promising) but extraction returned 0 events
- c0WinnerUrl=/biljetter suggests ticket page but no time tags found
- c1TimeTagCount=0 indicates no date/time elements detected in HTML

**suggestedRules:**
- Investigate /biljetter page structure - event dates may be in images or loaded dynamically
- Try alternative path /program or /konserter for event listing pages
- Consider that biljett pages may list categories rather than specific events

---

### Source: goteborgs-domkyrka

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.97 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot attempt discovery - DNS resolution fails for goteborgsdomkyrka.se. Domain does not exist.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND goteborgsdomkyrka.se - domain does not resolve
- Consecutive failures indicate persistent DNS issue

**suggestedRules:**
- Verify domain spelling - try goteborgs-domkyrka.se or domkyrkan.se
- Check official website for correct URL - cathedral may use municipality domain

---

### Source: spanga-is

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.97 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot attempt discovery - DNS resolution fails for spanga.se. Domain does not exist.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND spanga.se - domain does not resolve
- Consecutive failures indicate persistent DNS issue

**suggestedRules:**
- Verify domain spelling - try spanga-is.se or spanga.se (different TLD)
- Check if sports facility has been renamed or merged

---

### Source: nationalmuseum

| Field | Value |
|-------|-------|
| likelyCategory | Low-scoring calendar page may have events |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.74 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /kalendarium |

**humanLikeDiscoveryReasoning:**
c0WinnerUrl=/kalendarium identified as calendar page for nationalmuseum.se. Score of 4 is just below threshold of 6, suggesting weak signals but potential event content. Should retry with D queue (JS rendering) or try alternative paths like /program, /utstallningar for exhibition schedules.

**candidateRuleForC0C3:**
- pathPattern: `/kalendarium|/program|/utstallningar|/exhibitions`
- appliesTo: Swedish museum and cultural institution sites
- confidence: 0.68

**discoveredPaths:**
- /kalendarium [derived] anchor="Kalendarium" conf=0.65

**improvementSignals:**
- c0WinnerUrl=/kalendarium identified as calendar page
- C2 score=4 (just below threshold of 6) but page exists
- Museum calendar pages often use JS-rendered event grids

**suggestedRules:**
- Try alternative path /program for Swedish museum event listings
- Consider that museum sites may need JS rendering (D queue) for calendar grids
- Score of 4 is borderline - page may contain events with weak HTML signals

---
