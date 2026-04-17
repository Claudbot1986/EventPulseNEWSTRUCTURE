## C4-AI Analysis Round 2 (batch-72)

**Timestamp:** 2026-04-16T20:51:28.723Z
**Sources analyzed:** 2

### Overall Pattern
Top failure categories: 1× DNS/network unreachable, 1× JS-rendered calendar requires browser

---

### Source: g-teborgsoperan

| Field | Value |
|-------|-------|
| likelyCategory | DNS/network unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Site is completely unreachable at network level (DNS failure). Cannot perform human-like discovery because even the entry page cannot be fetched. Domain 'goteborgsoperan.se' cannot be resolved - this is a fundamental connectivity issue, not a content discovery issue. No alternative paths can be tested without first resolving the DNS failure.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution failure: getaddrinfo ENOTFOUND
- Domain appears unreachable from crawler infrastructure
- Source ID 'g-teborgsoperan' vs URL 'goteborgsoperan' - potential mismatch

**suggestedRules:**
- Verify domain DNS is correctly configured
- Check if site is blocking crawler IPs
- Confirm URL is correct (goteborgsoperan.se vs g-teborgsoperan)

---

### Source: nykoping

| Field | Value |
|-------|-------|
| likelyCategory | JS-rendered calendar requires browser |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.82 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /kalender, /program |
| directRouting | D (conf=0.75) |

**humanLikeDiscoveryReasoning:**
C0 found three high-confidence event paths (/events, /program, /kalender) from derived rules. C1 shows weak HTML signal (0 timeTags, 4 dates) suggesting client-side calendar rendering. C2 scored promising (10) on date-pattern but C3 extraction failed. Human-like reasoning: municipal .se sites typically structure events under /kalender or /events. The pattern mismatch indicates HTML parsing issue, likely due to JS-rendered content. Retry with browser-render enabled should capture events.

**candidateRuleForC0C3:**
- pathPattern: `/events|/kalender|/program`
- appliesTo: Swedish municipal and cultural sites (.se domains) with event listings
- confidence: 0.78

**discoveredPaths:**
- /kalender [url-pattern] anchor="derived-rule" conf=0.85
- /events [nav-link] anchor="derived-rule" conf=0.80
- /program [nav-link] anchor="derived-rule" conf=0.75

**improvementSignals:**
- c1DateCount=4 indicates date content exists but time tags absent (0) - calendar may use client-side rendering
- c2Score=10 but extraction returned 0 events - pattern mismatch on calendar page
- High-confidence navigation links found: /events, /program, /kalender

**suggestedRules:**
- Add browser-based extraction (D stage) for municipal Swedish sites with date patterns
- Pattern match /kalender as primary event path for .se domains
- Consider JS-render fallback when dateCount > 0 but timeTagCount = 0

---
