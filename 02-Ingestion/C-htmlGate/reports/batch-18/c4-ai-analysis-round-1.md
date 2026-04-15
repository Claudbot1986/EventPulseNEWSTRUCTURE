## C4-AI Analysis Round 1 (batch-18)

**Timestamp:** 2026-04-12T18:50:37.272Z
**Sources analyzed:** 7

### Overall Pattern
Top failure categories: 2× Page returns HTTP 404, 1× Events page exists but no extractable structure, 1× Redirect loop prevents content fetch

---

### Source: friidrottsf-rbundet

| Field | Value |
|-------|-------|
| likelyCategory | Events page exists but no extractable structure |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.85

**improvementSignals:**
- C2 score=0 despite promising /events path
- c1 shows 0 timeTags and 0 date counts
- HTML appears to lack event markup patterns

**suggestedRules:**
- Investigate if /events page requires authentication or has dynamic content
- Check if events are in JSON-LD but C2 breadth scorer missed them
- Consider sitemap.xml or robots.txt for event discovery

---

### Source: vasteras-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | Page returns HTTP 404 |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.92 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 from root page
- No c0 candidates found
- Domain exists but specific path missing

**suggestedRules:**
- Verify if /stadsteatern is the correct path for Västerås
- Check if site structure changed - try /kultur or /evenemang paths
- Investigate if events are on a subdomain or external platform

---

### Source: linkoping-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | Page returns HTTP 404 |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.92 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 from root page
- No c0 candidates found
- Domain exists but specific path missing

**suggestedRules:**
- Verify if /stadsteatern is the correct path for Linköping
- Try alternative paths like /kultur or /evenemang
- Check if venue events are on main linkoping.se or separate subdomain

---

### Source: sensus

| Field | Value |
|-------|-------|
| likelyCategory | Redirect loop prevents content fetch |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.78 |
| nextQueue | D |
| directRouting | D (conf=0.72) |

**discoveredPaths:**
(none)

**improvementSignals:**
- Redirect loop on /kurser-och-evenemang/
- c0 found 2 candidates but couldn't fetch winner URL
- Events likely exist but inaccessible via standard fetch

**suggestedRules:**
- Route to D (JS render) to handle potential JavaScript-controlled redirects
- Investigate redirect chain - sensus.se to www.sensus.se with loop
- Consider if events are in a CMS requiring session/cookie handling

---

### Source: sundsvall

| Field | Value |
|-------|-------|
| likelyCategory | Promising page but JS-rendered content |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.72 |
| nextQueue | D |
| directRouting | D (conf=0.78) |

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.85
- /program [nav-link] anchor="derived-rule" conf=0.80
- /kalender [nav-link] anchor="derived-rule" conf=0.75
- /schema [nav-link] anchor="derived-rule" conf=0.70
- /evenemang [nav-link] anchor="derived-rule" conf=0.65
- /kalendarium [nav-link] anchor="derived-rule" conf=0.60
- /aktiviteter [nav-link] anchor="derived-rule" conf=0.55
- /kultur [nav-link] anchor="derived-rule" conf=0.50

**improvementSignals:**
- C2 score=13 (promising) but C3 found 0 events
- c1 shows 0 timeTags and 0 date counts despite promising score
- Multiple event-indicating paths found but lowest-scored /kultur was chosen
- Government site likely uses SPA framework

**suggestedRules:**
- Route to D (JS render) since c1LikelyJsRendered=false may be incorrect negative
- Re-evaluate timeTag/dateCount scoring - they were 0 which contradicts C2 promising verdict
- Try higher-scoring paths like /events, /program, /kalender instead of /kultur

---

### Source: volvo-museum

| Field | Value |
|-------|-------|
| likelyCategory | Cross-domain redirect to external site |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked: volvomuseum.se → www.worldofvolvo.com
- Events are on worldofvolvo.com, not volvomuseum.se
- Current sourceId no longer valid for event discovery

**suggestedRules:**
- Update sourceId to worldofvolvo.com or add it as alternate URL
- Check if volvomuseum.se has any original event pages before redirect
- Investigate if events are embedded from worldofvolvo on museum pages

---

### Source: stora-teatern-g-teborg

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.82 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS lookup failed: getaddrinfo ENOTFOUND
- Subdomain may not exist or DNS not propagated
- Site may have moved to different domain structure

**suggestedRules:**
- Try without subdomain: goteborg.se/stora-teatern
- Check if stora-teatern is now part of main goteborg.se
- Verify DNS configuration for goteborg.se subdomain

---
