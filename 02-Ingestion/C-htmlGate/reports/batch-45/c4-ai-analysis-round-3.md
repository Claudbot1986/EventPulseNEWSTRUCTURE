## C4-AI Analysis Round 3 (batch-45)

**Timestamp:** 2026-04-15T02:50:43.650Z
**Sources analyzed:** 1

### Overall Pattern
Top failure categories: 1× no_links_extracted_entry_page

---

### Source: sparvag-city

| Field | Value |
|-------|-------|
| likelyCategory | no_links_extracted_entry_page |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /evenemang, /kalender, /program, /schema |

**humanLikeDiscoveryReasoning:**
c0LinksFound is EMPTY which is anomalous for a museum site. The c0WinnerUrl was /skolor/skolprogram/ which is a school programs section, not public events. For Swedish cultural sites like sparvagsmuseet.se (tramway museum), common event paths include /evenemang, /kalender, /program. Since no links were found on entry page, attempted common Swedish event URL patterns. c1TimeTagCount=0 and c1DateCount=0 suggests events may exist on subpages not reached during initial crawl.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/kalender|/program|/schema`
- appliesTo: Swedish cultural/municipal sites (museums, theaters, libraries) where entry page c0LinksFound is empty or c0WinnerUrl points to wrong section
- confidence: 0.72

**discoveredPaths:**
- /evenemang [url-pattern] anchor="Evenemang (assumed nav)" conf=0.75
- /kalender [url-pattern] anchor="Kalender (assumed nav)" conf=0.70
- /program [url-pattern] anchor="Program (assumed nav)" conf=0.65

**improvementSignals:**
- c0LinksFound empty - no links parsed from entry page HTML
- c0WinnerUrl points to /skolor/skolprogram/ (school programs) not events
- Swedish museum site should have public events section

**suggestedRules:**
- For Swedish cultural/municipal sites: try /evenemang, /kalender, /program as fallback paths when c0LinksFound is empty
- If c0WinnerUrl contains /skolor/ (school programs), this is wrong entry - should target /kultur/ or /evenemang/

---
