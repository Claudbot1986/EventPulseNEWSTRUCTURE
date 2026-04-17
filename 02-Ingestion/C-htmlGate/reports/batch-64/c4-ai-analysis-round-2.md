## C4-AI Analysis Round 2 (batch-64)

**Timestamp:** 2026-04-15T19:33:35.499Z
**Sources analyzed:** 9

### Overall Pattern
Top failure categories: 6× DNS resolution failure, 1× Event links present but not fetched, 1× Request timeout

---

### Source: visit-gothenburg

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.95 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS failure prevented any HTML retrieval. Cannot perform human-like discovery without content. Site likely exists but network connectivity issue.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang|/kalender`
- appliesTo: Swedish tourism and event listing sites
- confidence: 0.75

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution failed for visitgothenburg.se - transient network issue likely
- No HTML content retrieved to analyze event structure
- Consider verifying domain DNS records

**suggestedRules:**
- Retry DNS resolution for Swedish tourism sites with standard delay
- If DNS succeeds, attempt /events or /evenemang subpage discovery

---

### Source: push

| Field | Value |
|-------|-------|
| likelyCategory | Event links present but not fetched |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /kalender, /schema, /evenemang, /kalendarium |

**humanLikeDiscoveryReasoning:**
C0 found 30+ derived rule event links with strong anchor text patterns. Site clearly has event content but entry page lacks direct event data. Human-like discovery would navigate to /events or /program subpages where event listings are likely located.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/schema|/evenemang`
- appliesTo: Swedish cultural, media, and entertainment sites
- confidence: 0.82

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.85
- /program [nav-link] anchor="derived-rule" conf=0.80
- /kalender [nav-link] anchor="derived-rule" conf=0.75

**improvementSignals:**
- Strong event link candidates found: /events, /program, /kalender, /schema, /evenemang
- C2 detected 'event-heading' signal with score 3
- Derived rule links suggest site has structured event navigation

**suggestedRules:**
- Fetch /events subpage directly - highest scoring derived rule link
- Try /program and /kalender as secondary candidates
- Site appears to have client-side event navigation

---

### Source: tekniska-museet

| Field | Value |
|-------|-------|
| likelyCategory | Request timeout |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.90 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Timeout prevented HTML retrieval. Cannot perform human-like discovery without content. Museum sites often have event calendars - retry with longer timeout.

**candidateRuleForC0C3:**
- pathPattern: `/events|/kalender|/utställningar|/program`
- appliesTo: Swedish museum and exhibition sites
- confidence: 0.70

**discoveredPaths:**
(none)

**improvementSignals:**
- Request timeout after 20000ms - server slow or overloaded
- No HTML content retrieved to analyze event structure
- Consider site may have heavy JS rendering

**suggestedRules:**
- Retry with extended timeout for museum and cultural sites
- If timeout persists, consider JS render fallback (D queue)

---

### Source: we-are-sarajevo

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.95 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS failure prevented any content retrieval. Site may have moved or domain expired. Cannot perform human-like discovery without content.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/calendar`
- appliesTo: Balkan/SEE event and venue sites
- confidence: 0.65

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution failed for wearesarajevo.se
- No HTML content retrieved
- Domain may have expired or DNS misconfigured

**suggestedRules:**
- Verify domain DNS records
- Retry after DNS propagation delay

---

### Source: malmo-hogskola

| Field | Value |
|-------|-------|
| likelyCategory | Event links present, low signal |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.82 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /schema, /program, /kalender, /evenemang, /kalendarium |

**humanLikeDiscoveryReasoning:**
C0 found 30+ derived rule event links typical of Swedish university sites. Entry page lacks events but subpages likely contain academic calendar and event listings. Human-like discovery would navigate to /schema or /events.

**candidateRuleForC0C3:**
- pathPattern: `/events|/schema|/program|/kalender`
- appliesTo: Swedish university and higher education sites
- confidence: 0.80

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.82
- /schema [nav-link] anchor="derived-rule" conf=0.78
- /program [nav-link] anchor="derived-rule" conf=0.72

**improvementSignals:**
- Strong event link candidates found: /events, /schema, /program, /kalender
- C2 detected 'time-tag' signal with score 0
- University site likely has structured event calendar

**suggestedRules:**
- Fetch /events or /schema subpage for university events
- University calendars often at /schema or /kalender
- Consider academic calendar patterns

---

### Source: orebro-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.95 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS failure prevented content retrieval. Theater sites typically have /program or /biljetter for performance schedules. Cannot discover without content.

**candidateRuleForC0C3:**
- pathPattern: `/program|/biljetter|/forestillinger|/repertoar`
- appliesTo: Swedish theater and performing arts venues
- confidence: 0.75

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution failed for orebro-stadsteatern.se
- No HTML content retrieved
- Theater site may have moved to different domain

**suggestedRules:**
- Verify current domain for Örebro Stadsteater
- Check if site moved to orebro.se/stadsteatern

---

### Source: gavle-if

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.95 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS failure prevented content retrieval. Sports club sites typically have /matcher or /arena for match schedules. Cannot discover without content.

**candidateRuleForC0C3:**
- pathPattern: `/matcher|/arena|/hall|/program`
- appliesTo: Swedish sports clubs and teams
- confidence: 0.70

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution failed for gavleif.se
- No HTML content retrieved
- Sports club site may have moved or closed

**suggestedRules:**
- Verify current domain for Gävle IF
- Check if club merged or moved to different platform

---

### Source: storsj-odjuret

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.95 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS failure prevented content retrieval. Local attraction sites typically have /biljetter or /oppet for opening times and events. Cannot discover without content.

**candidateRuleForC0C3:**
- pathPattern: `/biljetter|/oppet|/program|/konserter`
- appliesTo: Swedish local attractions and venues
- confidence: 0.65

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution failed for storsjoodjuret.se
- No HTML content retrieved
- Local attraction site may be inactive or moved

**suggestedRules:**
- Verify domain status for Storsjöodjuret attraction
- Check if site moved to municipal platform

---

### Source: g-teborgsoperan

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.95 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS failure prevented content retrieval. Opera/theater sites typically have /program or /repertoar for performance schedules. Cannot discover without content.

**candidateRuleForC0C3:**
- pathPattern: `/program|/repertoar|/forestillinger|/biljetter`
- appliesTo: Swedish opera and major theater venues
- confidence: 0.75

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution failed for goteborgsoperan.se
- No HTML content retrieved
- Opera house site may have moved to goteborgsoperan.se or operan.se

**suggestedRules:**
- Verify current domain for GöteborgsOperan
- Check canonical URL - may have moved to operaplatser.se

---
