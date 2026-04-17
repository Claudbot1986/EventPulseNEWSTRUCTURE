## C4-AI Analysis Round 2 (batch-70)

**Timestamp:** 2026-04-16T20:51:42.638Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 2× dns_failure, 2× timeout_unreachable, 1× redirect_blocked

---

### Source: goteborgsoperan

| Field | Value |
|-------|-------|
| likelyCategory | redirect_blocked |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.65 |
| nextQueue | D |
| discoveryAttempted | false |
| directRouting | D (conf=0.70) |

**humanLikeDiscoveryReasoning:**
Network fetch failed with redirect loop - static HTTP client cannot handle site's redirect behavior. JS render engine would follow redirects naturally.

**discoveredPaths:**
(none)

**improvementSignals:**
- fetchHtml exceeded 3 redirects - site may have redirect chain that only resolves with JS engine
- c1TimeTagCount=0 and c1DateCount=0 suggests content not loaded in static fetch

**suggestedRules:**
- Add redirect-following logic for opera.se domain - likely HTTPS/HTTP redirect loop
- Enable JS render fallback for sites with complex redirect chains

---

### Source: gavle-if

| Field | Value |
|-------|-------|
| likelyCategory | dns_failure |
| failCategory | robots_or_policy_blocked |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS failure is terminal - getaddrinfo ENOTFOUND means the domain does not exist or nameservers are unreachable. No navigation paths to attempt.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution failed for gavleif.se - domain may not exist or be permanently unavailable
- Two consecutive failures with same ENOTFOUND error indicates persistent issue

**suggestedRules:**
- Verify domain spelling - gavleif.se vs expected gavle.if.se pattern
- Mark as permanently blocked if DNS remains unresolved after 5 retries

---

### Source: jazzfestivalen-goteborg

| Field | Value |
|-------|-------|
| likelyCategory | timeout_unreachable |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Timeout failure suggests transient network issue or server overload. Swedish jazz festivals often have seasonal traffic spikes. Should retry with higher timeout.

**discoveredPaths:**
(none)

**improvementSignals:**
- Two consecutive timeouts at 20000ms - site may have slow response or be temporarily overloaded
- Zero timeTagCount and dateCount confirms no HTML received

**suggestedRules:**
- Increase timeout threshold to 45000ms for Swedish festival sites
- Add exponential backoff for timeout failures

---

### Source: malm-opera

| Field | Value |
|-------|-------|
| likelyCategory | extraction_mismatch |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.82 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /skolor/skolbiljetter |

**humanLikeDiscoveryReasoning:**
c0Candidates=10 suggests event-like links exist. C2 score=27 confirms event structure detected. Extraction failure likely due to wrong subpage or HTML structure variation. malmoopera.se typically uses /program for event listings.

**candidateRuleForC0C3:**
- pathPattern: `/program|/forest|/repertoar`
- appliesTo: Swedish opera/theater venues
- confidence: 0.75

**discoveredPaths:**
(none)

**improvementSignals:**
- C2 promising (score=27) but C3 extraction returned 0 events
- c0Candidates=10 and c1DateCount=20 confirms dates exist in HTML
- winningStage=C3 indicates HTML was fetched but extraction patterns failed

**suggestedRules:**
- Develop Opera-specific extraction patterns for Swedish opera houses
- c0WinnerUrl=/skolor/skolbiljetter may be wrong subpage - try /program or /forest

---

### Source: svenska-hockeyligan-shl

| Field | Value |
|-------|-------|
| likelyCategory | js_rendered_tickets |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.88 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | /biljetter |
| directRouting | D (conf=0.88) |

**humanLikeDiscoveryReasoning:**
Sports league ticket sites (SHL) use extensive client-side rendering for real-time schedule data. C2 score=1 confirms no structured data in static HTML. JS render required.

**candidateRuleForC0C3:**
- pathPattern: `/biljetter|/matcher|/schema`
- appliesTo: Swedish sports league/ticket sites
- confidence: 0.85

**discoveredPaths:**
- /biljetter [url-pattern] anchor="Biljetter" conf=0.92

**improvementSignals:**
- c0Candidates=5 with biljetter subpage suggests ticket/schedule listing
- C2 score=1 extremely low despite candidates - likely JS-rendered dynamic content
- Swedish hockey league sites heavily use client-side rendering for live schedules

**suggestedRules:**
- Enable JS render fallback for shl.se - tickets/schedules are likely dynamic
- Sports sites typically require browser engine for schedule data

---

### Source: grand

| Field | Value |
|-------|-------|
| likelyCategory | js_rendered_calendar |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.80 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | /event-calendar |
| directRouting | D (conf=0.82) |

**humanLikeDiscoveryReasoning:**
C2 score=32 with venue-marker pattern suggests event listing exists but requires JS rendering to extract. Grand Malmö is a venue that likely uses calendar widget.

**candidateRuleForC0C3:**
- pathPattern: `/event-calendar|/kalender|/program`
- appliesTo: Swedish venue/gallery sites with calendar widgets
- confidence: 0.78

**discoveredPaths:**
- /event-calendar [url-pattern] anchor="Event Calendar" conf=0.88

**improvementSignals:**
- C2 promising score=32 but C3 extraction=0 events
- c0WinnerUrl=/event-calendar suggests calendar exists but not extracting
- Venue marker detected (pg=venue-marker) indicates event listing structure present

**suggestedRules:**
- Enable JS render for grandmalmo.se event-calendar - calendar likely client-side rendered
- C2 venue-marker detection confirms event structure exists in JS content

---

### Source: lulea-tekniska-universitet

| Field | Value |
|-------|-------|
| likelyCategory | university_calendar |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /aktuellt/kalender |

**humanLikeDiscoveryReasoning:**
Ltu.se has event-list pattern but weak signal. University calendars often span multiple subpages (student events, research seminars, public lectures). Should try broader subpage discovery.

**candidateRuleForC0C3:**
- pathPattern: `/kalender|/aktuellt/kalender|/student/evenemang`
- appliesTo: Swedish university calendar systems
- confidence: 0.70

**discoveredPaths:**
(none)

**improvementSignals:**
- C2 score=14 (maybe) with event-list pattern detected
- c0Candidates=1 and c1Verdict=weak suggests sparse but present event signals
- Swedish university calendar sites often have multiple subpages

**suggestedRules:**
- Explore additional subpages at ltu.se - current /kalender may not be primary event source
- Swedish universities separate student events, research seminars, and public lectures

---

### Source: jazz-i-lund

| Field | Value |
|-------|-------|
| likelyCategory | timeout_unreachable |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Timeout failure - site may be temporarily unavailable or have bandwidth constraints. JazziLund is a smaller organization that may have limited hosting capacity.

**discoveredPaths:**
(none)

**improvementSignals:**
- Two consecutive timeouts at 20000ms
- c1TimeTagCount=0 and c1DateCount=0 confirms no HTML received
- Jazz festival sites may have seasonal traffic or maintenance periods

**suggestedRules:**
- Increase timeout threshold for small festival sites
- Add retry with delay for seasonal/bandwidth-constrained sites

---

### Source: triangeln

| Field | Value |
|-------|-------|
| likelyCategory | swedish_event_paths |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /kalender, /evenemang, /konserter |

**humanLikeDiscoveryReasoning:**
triangeln.se is Swedish shopping mall with strong event navigation signals. c0LinksFound shows 28 event-indicating paths including /events (score=10), /program (score=9), /kalender (score=8). Root page has no events but subpages clearly have event listings. ENTRY_PAGE_NO_EVENTS with clear navigation paths to retry.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/evenemang|/konserter`
- appliesTo: Swedish shopping centers, malls, and municipal sites with event calendars
- confidence: 0.88

**discoveredPaths:**
- /events [nav-link] anchor="Events (derived-rule)" conf=0.92
- /program [nav-link] anchor="Program (derived-rule)" conf=0.90
- /kalender [nav-link] anchor="Kalender (derived-rule)" conf=0.88
- /evenemang [nav-link] anchor="Evenemang (derived-rule)" conf=0.86
- /konserter [nav-link] anchor="Konserter (derived-rule)" conf=0.78

**improvementSignals:**
- c0LinksFound contains 28 event-indicating paths with strong anchor text
- Top paths: /events (10), /program (9), /kalender (8), /evenemang (6) - all high-signal Swedish event paths
- C2 low_value (score=0) but c1Verdict=no-main suggests root page lacks event anchor but paths exist

**suggestedRules:**
- triangeln.se appears to be Swedish mall/shopping center with event calendar
- Prioritize /events and /program paths - likely mall events/activities calendar
- Swedish mall sites often embed events in /evenemang or /aktiviteter

---

### Source: jonkoping-sodra

| Field | Value |
|-------|-------|
| likelyCategory | dns_failure |
| failCategory | robots_or_policy_blocked |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS failure (ENOTFOUND) is terminal - domain jonkopingsodra.se does not resolve. This is not a transient network issue but a domain-level problem. Manual verification needed to determine correct domain or confirm site shutdown.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution failed with ENOTFOUND for jonkopingsodra.se
- Domain structure suggests theater/performance venue but cannot resolve
- Two consecutive failures indicate persistent DNS issue

**suggestedRules:**
- Verify domain exists - possible typo: jonkopingsodra.se vs expected format
- Domain appears inactive or misconfigured - requires manual verification

---
