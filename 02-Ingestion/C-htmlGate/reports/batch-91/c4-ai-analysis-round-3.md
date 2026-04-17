## C4-AI Analysis Round 3 (batch-91)

**Timestamp:** 2026-04-16T18:35:13.754Z
**Sources analyzed:** 1

### Overall Pattern
Top failure categories: 1× empty_link_set_but_path_discovered

---

### Source: folkteatern

| Field | Value |
|-------|-------|
| likelyCategory | empty_link_set_but_path_discovered |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /evenemang, /kalender, /program |
| directRouting | D (conf=0.68) |

**humanLikeDiscoveryReasoning:**
C0 winner URL is /events but c0LinksFound returned empty set — contradiction suggests links were detected via pattern/heuristic rather than extracted from HTML. Swedish cultural venue (Folkteatern) typically hosts events; common paths like /evenemang, /kalender, /program are likely. Recommend headless browser retry to verify actual page content behind potential JS-rendering or anti-bot protection.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang|/kalender|/program`
- appliesTo: Swedish theatre and cultural venues (e.g., *folkteatern*, *stadsteatern*, *kulturhuset)
- confidence: 0.70

**discoveredPaths:**
- /events [derived] anchor="unknown (c0LinksFound empty)" conf=0.65

**improvementSignals:**
- c0LinksFound is empty despite c0Candidates=10 — link extraction may have failed or timing issue
- c0WinnerUrl=/events exists but C3 still returned 0 events — path may be wrong or blocked
- c1TimeTagCount=0 and c1DateCount=0 — no temporal signals on entry page

**suggestedRules:**
- Investigate why c0LinksFound returned empty array when 10 candidates were reported
- Verify /events path returns actual event content via headless render before retry
- Check for anti-scraping measures on folkteatern.se/events endpoint

---
