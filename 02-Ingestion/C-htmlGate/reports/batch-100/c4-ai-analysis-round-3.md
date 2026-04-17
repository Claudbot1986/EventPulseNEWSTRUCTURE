## C4-AI Analysis Round 3 (batch-100)

**Timestamp:** 2026-04-17T05:47:55.445Z
**Sources analyzed:** 3

### Overall Pattern
Top failure categories: 2× dns_unreachable, 1× weak_event_page_content

---

### Source: billetto-aggregator

| Field | Value |
|-------|-------|
| likelyCategory | weak_event_page_content |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /p/events-i-stockholm |
| directRouting | D (conf=0.85) |

**humanLikeDiscoveryReasoning:**
C0 found winner URL /p/events-i-stockholm which is a valid event path for Stockholm events. The low C2 score (4 vs threshold 6) with 0 timeTags suggests the event content may be loaded via JavaScript. Recommend routing to D for JS render fallback.

**candidateRuleForC0C3:**
- pathPattern: `/p/events-i-*|/events|/evenemang`
- appliesTo: Billetto and similar Swedish event aggregator platforms
- confidence: 0.78

**discoveredPaths:**
- /p/events-i-stockholm [derived] anchor="events-i-stockholm" conf=0.82

**improvementSignals:**
- c0WinnerUrl=/p/events-i-stockholm found but C2 score=4 below threshold 6
- 0 timeTags and 0 dateCount on event subpage suggests content may be JS-rendered
- c1LikelyJsRendered=false but no HTML date signals present

**suggestedRules:**
- For billetto.se: route to D (JS render fallback) since event subpage has no HTML date signals
- Consider lowering C2 threshold for known event aggregator domains

---

### Source: din-gastrotek

| Field | Value |
|-------|-------|
| likelyCategory | dns_unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS resolution failed for gastrotek.se - domain does not exist or is not reachable. No paths can be discovered or attempted. This is a terminal failure requiring manual domain verification.

**discoveredPaths:**
(none)

**improvementSignals:**
- fetchHtml failed with getaddrinfo ENOTFOUND gastrotek.se
- Domain is unreachable via DNS resolution
- No event content can be extracted from unreachable domain

**suggestedRules:**
- Mark domain as permanently unreachable after 2+ consecutive DNS failures
- Consider removing from active source list or flagging for manual domain verification

---

### Source: fangelset

| Field | Value |
|-------|-------|
| likelyCategory | dns_unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS resolution failed for fangelset.org - domain does not exist or is not reachable. No paths can be discovered or attempted. This is a terminal failure requiring manual domain verification.

**discoveredPaths:**
(none)

**improvementSignals:**
- fetchHtml failed with getaddrinfo ENOTFOUND fangelset.org
- Domain is unreachable via DNS resolution
- No event content can be extracted from unreachable domain

**suggestedRules:**
- Mark domain as permanently unreachable after 2+ consecutive DNS failures
- Consider removing from active source list or flagging for manual domain verification

---
