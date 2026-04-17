## C4-AI Analysis Round 1 (batch-63)

**Timestamp:** 2026-04-15T19:24:47.407Z
**Sources analyzed:** 8

### Overall Pattern
Top failure categories: 2× timeout, 1× wrong entry page, 1× redirect blocked

---

### Source: kungliga-musikhogskolan

| Field | Value |
|-------|-------|
| likelyCategory | wrong entry page |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /konserter---evenemang.html |

**humanLikeDiscoveryReasoning:**
C2 showed strong event signals (score=401, 39 card candidates) but C3 failed to extract. The c0WinnerUrl /konserter---evenemang.html was identified as the best candidate but not tested in extraction. This is a classic wrong-entry-page scenario where the homepage lacks events but a specific subpage likely contains them.

**candidateRuleForC0C3:**
- pathPattern: `/konserter|/evenemang|/events|/program`
- appliesTo: Swedish cultural institutions with concert/music programming
- confidence: 0.78

**discoveredPaths:**
- /konserter---evenemang.html [derived] anchor="concerts and events page" conf=0.82

**improvementSignals:**
- C2 found promising signals (score=401) but C3 extraction returned 0 events
- c0WinnerUrl points to /konserter---evenemang.html which may contain events
- c1TimeTagCount=78 indicates time-based content exists on page

**suggestedRules:**
- When C2 score >= 100 and C3 returns 0 events, try c0WinnerUrl subpage directly
- Swedish music schools often use /konserter or /evenemang paths

---

### Source: stromma

| Field | Value |
|-------|-------|
| likelyCategory | redirect blocked |
| failCategory | robots_or_policy_blocked |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |
| discoveryAttempted | false |
| directRouting | D (conf=0.60) |

**humanLikeDiscoveryReasoning:**
Fetch failed due to cross-domain redirect policy. The site redirects from www.stromma.se to www.stromma.com which is blocked. No navigation paths could be discovered.

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked: www.stromma.se → www.stromma.com
- Site may have policy requiring www.stromma.com instead

**suggestedRules:**
- Handle cross-domain redirects gracefully in fetchHtml
- Try www.stromma.com as alternative base URL

---

### Source: unga-teatern

| Field | Value |
|-------|-------|
| likelyCategory | DNS failure |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS resolution failed completely - the hostname ungateatern.se does not exist or is not reachable. This is a terminal infrastructure issue.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND ungateatern.se - DNS resolution failed
- Site hostname cannot be resolved

**suggestedRules:**
- Verify DNS propagation for Swedish cultural sites
- Check if site has moved to new domain

---

### Source: observatoriet

| Field | Value |
|-------|-------|
| likelyCategory | SSL mismatch |
| failCategory | robots_or_policy_blocked |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
SSL certificate mismatch prevents secure connection. The server's certificate is for a different domain (*.r103.websupport.se) indicating hosting misconfiguration.

**discoveredPaths:**
(none)

**improvementSignals:**
- Hostname/IP does not match certificate's altnames
- SSL certificate is for *.r103.websupport.se not observatoriet.se

**suggestedRules:**
- SSL certificate mismatch indicates misconfiguration or hosting issue
- Site may need certificate update or is behind misconfigured proxy

---

### Source: malmo-arena

| Field | Value |
|-------|-------|
| likelyCategory | timeout |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Site timed out after 20 seconds. Malmö Arena is a major venue that likely has events but the server is not responding within acceptable time limits.

**discoveredPaths:**
(none)

**improvementSignals:**
- timeout of 20000ms exceeded
- Site is slow or unresponsive

**suggestedRules:**
- Increase timeout threshold for known slow Swedish venues
- Try alternative URL formats (with/without umlauts)

---

### Source: kulturhuset-orebro

| Field | Value |
|-------|-------|
| likelyCategory | timeout |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Site timed out after 20 seconds. Kulturhuset Örebro is a municipal cultural center that likely has events but the server is not responding within acceptable time limits.

**discoveredPaths:**
(none)

**improvementSignals:**
- timeout of 20000ms exceeded
- Site is slow or unresponsive

**suggestedRules:**
- Increase timeout threshold for municipal Swedish sites
- Try common event paths like /evenemang or /kalender

---

### Source: linkoping-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | 404 page |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /kulturhuset, /scen |

**humanLikeDiscoveryReasoning:**
The URL https://linkoping.se/stadsteatern returns 404. This suggests the Stadsteater has moved or uses a different URL structure. Linköping municipal venues typically use /kulturhuset or similar paths.

**candidateRuleForC0C3:**
- pathPattern: `/kulturhuset|/scen|/teater|/scener`
- appliesTo: Swedish municipal theater venues under linkoping.se domain
- confidence: 0.65

**discoveredPaths:**
- /kulturhuset [url-pattern] anchor="cultural center" conf=0.60
- /scen [url-pattern] anchor="stage/theater" conf=0.55

**improvementSignals:**
- HTTP 404 - current URL structure is wrong
- Stadsteatern may be at different URL under linkoping.se

**suggestedRules:**
- Try /kulturhuset, /scen, /teater paths for municipal theaters
- Linköping Stadsteater may have moved to new URL structure

---

### Source: polismuseet

| Field | Value |
|-------|-------|
| likelyCategory | subpage discovery needed |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.82 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /kalender, /schema, /evenemang |

**humanLikeDiscoveryReasoning:**
Polismuseet homepage has strong event signals (c2Score=124, 24 time tags) but no events were extracted. The c0LinksFound contains 10+ event-indicating paths derived from common Swedish museum URL patterns. The highest confidence paths are /events, /program, and /kalender which should be tried in the next discovery round.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/schema|/evenemang|/kalendarium`
- appliesTo: Swedish museum and cultural institution sites with event listings
- confidence: 0.82

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.88
- /program [nav-link] anchor="derived-rule" conf=0.85
- /kalender [nav-link] anchor="derived-rule" conf=0.82
- /schema [nav-link] anchor="derived-rule" conf=0.78
- /evenemang [nav-link] anchor="derived-rule" conf=0.75

**improvementSignals:**
- C2 score=124 indicates promising event content exists
- c0LinksFound contains 10+ event-indicating paths
- c1TimeTagCount=24 shows time-based content on page

**suggestedRules:**
- When c0LinksFound has multiple event paths, try highest-scoring ones first
- Polismuseet likely has events at /events, /program, or /kalender

---
