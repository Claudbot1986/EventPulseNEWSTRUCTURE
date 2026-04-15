## C4-AI Analysis Round 3 (batch-49)

**Timestamp:** 2026-04-15T02:50:36.615Z
**Sources analyzed:** 1

### Overall Pattern
Top failure categories: 1× page_fetch_timeout

---

### Source: paddan

| Field | Value |
|-------|-------|
| likelyCategory | page_fetch_timeout |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.65 |
| nextQueue | retry-pool |
| discoveryAttempted | false |
| directRouting | D (conf=0.68) |

**humanLikeDiscoveryReasoning:**
Could not attempt human-like discovery because c0LinksFound is empty — page fetch timed out before any link extraction could occur. No anchor text available to analyze for event-indicating paths. Would need successful page fetch to identify nav links like 'Evenemang' or '/kalender' patterns common in Swedish cultural sites.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang|/kalender|/program`
- appliesTo: Swedish cultural/municipal sites (timed out pages)
- confidence: 0.45

**discoveredPaths:**
(none)

**improvementSignals:**
- fetchHtml timeout indicates server-side blocking or heavy page requiring extended load time
- c0LinksFound empty suggests page was unreachable during discovery phase

**suggestedRules:**
- Consider increasing timeout threshold for Swedish cultural/municipal sites that may have heavier page loads
- If consecutive timeouts occur, suspect client-side rendering requiring D-queue processing

---
