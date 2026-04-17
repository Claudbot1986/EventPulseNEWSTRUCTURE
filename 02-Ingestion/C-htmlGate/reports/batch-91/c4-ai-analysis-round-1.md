## C4-AI Analysis Round 1 (batch-91)

**Timestamp:** 2026-04-16T18:34:52.514Z
**Sources analyzed:** 7

### Overall Pattern
Top failure categories: 4× Domain not resolving, 1× No events on homepage, links to event pages exist, 1× Site timeout/unreachable

---

### Source: visit-stockholm

| Field | Value |
|-------|-------|
| likelyCategory | No events on homepage, links to event pages exist |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /kalender, /schema, /evenemang |

**humanLikeDiscoveryReasoning:**
visit-stockholm.com is a Swedish tourism site. C0 derived 28 event-path patterns from Swedish locale rules but found 0 actual candidates on the homepage. C2 detected 'event-heading' page type (score=4) indicating some event content exists. For Swedish tourism sites, /events and /program are standard event listing paths. C4 should queue these paths for retry before manual review.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/evenemang`
- appliesTo: Swedish municipal/tourism sites (visit*, stad*, kommun*)
- confidence: 0.82

**discoveredPaths:**
- /events [url-pattern] anchor="derived-rule" conf=0.85
- /program [url-pattern] anchor="derived-rule" conf=0.82
- /kalender [url-pattern] anchor="derived-rule" conf=0.78

**improvementSignals:**
- c0LinksFound contains 28 event-indicating paths but none were actually discovered on page
- C2 detected 'event-heading' page type with score=4, suggesting some event content exists but sparse
- c0Candidates=0 means page has no actual /events etc links in DOM despite derived rules finding patterns

**suggestedRules:**
- Rule: For Swedish tourism/municipal sites (visit*, kommun*, stad*), the homepage typically lists featured events or links to /events, /program, /kalender via nav
- Rule: If C2 detects event-heading page type, even with low score, attempt direct navigation to discovered event paths
- Rule: C0 should treat derived-rule matches as 'suggested paths' for retry rather than just scoring signals

---

### Source: molndals-futsal

| Field | Value |
|-------|-------|
| likelyCategory | Domain not resolving |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.92 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Domain molndalsfutsal.se does not resolve to any IP address. Both C1 and C2 confirmed the fetch failure. No HTML content was retrieved, so no event discovery was possible. This is a network-level failure, not a content-level failure. Retry-pool appropriate for potential temporary DNS issues.

**candidateRuleForC0C3:**
- pathPattern: `N/A`
- appliesTo: Domain resolution failures only
- confidence: 0.95

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS failure (ENOTFOUND) indicates domain may be down, transferred, or typo
- Site may have expired or moved to new domain
- C1 and C2 both confirm fetch failure, not an event detection failure

**suggestedRules:**
- Rule: DNS ENOTFOUND failures should retry 1-2 times before marking as unreachable
- Rule: Cross-check source URL against known working domain patterns (e.g., .se, .com variations)
- Rule: If retry fails after 2 attempts, suggest manual URL verification

---

### Source: stenpiren

| Field | Value |
|-------|-------|
| likelyCategory | Site timeout/unreachable |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.90 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
stenpiren.se timed out after 20 seconds. No content was retrieved. Timeout could indicate heavy JS rendering, server overload, or network issues. Retry-pool with extended timeout may succeed. If consistently timing out, consider D-route for JS rendering or manual-review for URL verification.

**candidateRuleForC0C3:**
- pathPattern: `N/A`
- appliesTo: Timeout/unreachable failures only
- confidence: 0.90

**discoveredPaths:**
(none)

**improvementSignals:**
- Timeout after 20000ms indicates server is either overloaded, blocking requests, or network path issues
- No HTML retrieved, cannot assess event content
- C1 and C2 both confirmed timeout failure

**suggestedRules:**
- Rule: Timeout failures should be retried with increased timeout or from different network path
- Rule: Consider if site requires JS rendering (long load times for SPA)
- Rule: Timeout may indicate anti-scraping measures or rate limiting

---

### Source: folkuniversitetet

| Field | Value |
|-------|-------|
| likelyCategory | Entry page has nav links to events, site appears promising |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.94 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /kalender, /schema, /evenemang |

**humanLikeDiscoveryReasoning:**
folkuniversitetet.se is a Swedish educational/cultural institution. C2 detected 'venue-marker' page type with score=297 (very promising). Despite C0 finding 0 actual candidates on homepage, the C2 signal indicates the site has organized event/venue content. The 28 derived event-path patterns suggest standard Swedish institutional event navigation. Retry-pool should attempt direct navigation to these event paths.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/evenemang|/schema`
- appliesTo: Swedish institutional/cultural/educational sites (folkbildning, universitet, museum patterns)
- confidence: 0.88

**discoveredPaths:**
- /events [url-pattern] anchor="derived-rule" conf=0.90
- /program [url-pattern] anchor="derived-rule" conf=0.88
- /kalender [url-pattern] anchor="derived-rule" conf=0.86
- /evenemang [url-pattern] anchor="derived-rule" conf=0.85

**improvementSignals:**
- C2 verdict='promising' with score=297, detected 'venue-marker' page type - very strong event signal
- 28 derived event-path patterns found (same as visit-stockholm)
- c1Verdict='weak' but C2 found significant event content signals
- Venue-marker detection suggests site has organized event/venue structure

**suggestedRules:**
- Rule: When C2 returns 'promising' with score >200, route to retry-pool immediately with discovered paths
- Rule: 'venue-marker' page type is a strong indicator for Swedish cultural/educational sites
- Rule: C0 derived links for sites with promising C2 should be treated as discoveredPaths for retry

---

### Source: regionteatern

| Field | Value |
|-------|-------|
| likelyCategory | Domain not resolving |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.92 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Domain regionteater.se does not resolve. Both C1 and C2 confirmed fetch failure. No HTML content retrieved. This is a network-level failure, not content-level. Retry-pool for temporary DNS issues. If permanent, URL may need manual correction.

**candidateRuleForC0C3:**
- pathPattern: `N/A`
- appliesTo: DNS resolution failures only
- confidence: 0.95

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS failure (ENOTFOUND) indicates domain may be down or misconfigured
- No HTML content retrieved, cannot assess event content
- Domain 'regionteater' may have moved or rebranded

**suggestedRules:**
- Rule: DNS ENOTFOUND failures should retry before marking unreachable
- Rule: Check if domain has common Swedish TLD variations (.se, .nu, .com)
- Rule: 'teater' domain pattern often found under regional cultural site structures

---

### Source: orebro-vinterfest

| Field | Value |
|-------|-------|
| likelyCategory | Domain not resolving |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.92 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Domain orebrovinterfest.se does not resolve. DNS failure for this domain suggests it may have expired or the event has passed and site was taken down. Retry-pool to check for temporary issues, but likely permanent failure requiring manual URL verification.

**candidateRuleForC0C3:**
- pathPattern: `N/A`
- appliesTo: DNS resolution failures only
- confidence: 0.95

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS failure (ENOTFOUND) indicates domain may be down, expired, or typo
- 'vinterfest' suggests seasonal/temporary event site - may have moved or ended operations
- No HTML retrieved to assess content

**suggestedRules:**
- Rule: DNS ENOTFOUND failures should retry 1-2 times
- Rule: Seasonal event domains (vinterfest, sommar, etc.) often expire after event ends
- Rule: Consider if site moved to parent organization domain

---

### Source: parkteatern

| Field | Value |
|-------|-------|
| likelyCategory | Domain not resolving |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.92 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Domain parkteatern.se does not resolve. Both C1 and C2 confirmed fetch failure. No HTML retrieved. 'Parkteatern' suggests a Stockholm municipal theater. Swedish municipal cultural sites often consolidate to main city portals (stockholm.se). The domain may have expired or been merged. Retry-pool for temporary DNS, then suggest manual URL verification.

**candidateRuleForC0C3:**
- pathPattern: `N/A`
- appliesTo: DNS resolution failures only
- confidence: 0.95

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS failure (ENOTFOUND) indicates domain may be down
- 'parkteatern' is likely a Stockholm municipal theater site
- May have been consolidated under another URL (e.g., stockholm.se)

**suggestedRules:**
- Rule: DNS ENOTFOUND failures should retry before marking unreachable
- Rule: Swedish municipal theater sites often consolidated to stockholm.se or regional kultur portals
- Rule: Check parent organization domain patterns for municipal sites

---
