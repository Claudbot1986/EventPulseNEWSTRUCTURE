## C4-AI Analysis Round 1 (batch-59)

**Timestamp:** 2026-04-15T18:54:40.323Z
**Sources analyzed:** 7

### Overall Pattern
Top failure categories: 2× DNS resolution failed, 1× 404 on entry page, 1× Extraction failed on /events

---

### Source: malm-universitet

| Field | Value |
|-------|-------|
| likelyCategory | 404 on entry page |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Entry page returned HTTP 404 - no HTML content to analyze. Cannot discover event paths without successful fetch. Retry with URL variations or check if site structure changed.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/kalender|/arrangemang`
- appliesTo: Swedish university and institutional event pages
- confidence: 0.60

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 suggests URL may have changed or page moved
- Root URL https://mau.se/evenemang returned 404 - verify correct event URL pattern

**suggestedRules:**
- For university sites, try /evenemang/ or /kalender/ subpaths
- Check if mau.se uses different event URL structure (e.g., /event, /arrangement)

---

### Source: folkteatern

| Field | Value |
|-------|-------|
| likelyCategory | Extraction failed on /events |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.78 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | /events |
| directRouting | D (conf=0.75) |

**humanLikeDiscoveryReasoning:**
C0 found /events as winner URL. C2 scored 5 (unclear) with venue-marker pattern. Extraction failed - likely JS-rendered content requiring D route.

**candidateRuleForC0C3:**
- pathPattern: `/events`
- appliesTo: Swedish theater and performance venues
- confidence: 0.82

**discoveredPaths:**
- /events [derived] anchor="derived-rule" conf=0.82

**improvementSignals:**
- C2 found /events page with venue-marker pattern
- Extraction returned 0 events despite promising C2 score
- c1TimeTagCount=0 suggests possible JS rendering

**suggestedRules:**
- Try D (render fallback) for folkteatern.se/events - likely JS-rendered event cards
- Check if events use dynamic loading with time-tag patterns

---

### Source: smalandsposten

| Field | Value |
|-------|-------|
| likelyCategory | Extraction failed on /sport |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.82 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | /sport |
| directRouting | D (conf=0.80) |

**humanLikeDiscoveryReasoning:**
C0 found /sport as winner URL. C2 promising (score=24) with card structure. 4 time tags detected but extraction failed - likely JS-rendered cards requiring D route.

**candidateRuleForC0C3:**
- pathPattern: `/sport`
- appliesTo: Swedish newspaper sports event pages
- confidence: 0.75

**discoveredPaths:**
- /sport [derived] anchor="derived-rule" conf=0.75

**improvementSignals:**
- C2 promising with score=24, cand=cards=medium(4/4)
- c1TimeTagCount=4 found - dates present in HTML
- Extraction returned 0 events despite clear card structure

**suggestedRules:**
- Try D (render fallback) for smp.se/sport - card extraction may need JS rendering
- Check if sports events use dynamic loading or lazy-load patterns

---

### Source: form-design-museum

| Field | Value |
|-------|-------|
| likelyCategory | 400 on entry page |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Entry page returned HTTP 400 - bad request. No HTML content to analyze. Retry with URL variations or check if site requires specific request headers.

**candidateRuleForC0C3:**
- pathPattern: `/exhibitions|/events|/utstallningar`
- appliesTo: Swedish museum and gallery sites
- confidence: 0.55

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 400 suggests malformed request or server configuration issue
- Root URL returned 400 - may need different URL pattern

**suggestedRules:**
- Try alternative URL patterns for museum sites (e.g., /exhibitions, /events)
- Check if site uses www prefix or different domain structure

---

### Source: do310-com

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failed |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.95 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS resolution failed - domain do310.com cannot be found. Site is unreachable. Retry later or mark as defunct.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain does not exist or is unreachable
- Site may be defunct or temporarily unavailable

**suggestedRules:**
- Verify domain spelling - do310.com may have moved to different domain
- Check if site redirects to www.do310.com or alternative

---

### Source: slottsskogen

| Field | Value |
|-------|-------|
| likelyCategory | Rate limited, paths found |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Site returned HTTP 429 (rate limited) but C0 derived rules found 30+ event-indicating paths. Top candidates: /events (score 10), /program (score 9), /kalender (score 8). Retry with backoff recommended.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/schema|/evenemang|/kalendarium`
- appliesTo: Swedish cultural venues, parks, and municipal sites
- confidence: 0.88

**discoveredPaths:**
- /events [url-pattern] anchor="derived-rule" conf=0.90
- /program [url-pattern] anchor="derived-rule" conf=0.85
- /kalender [url-pattern] anchor="derived-rule" conf=0.80
- /schema [url-pattern] anchor="derived-rule" conf=0.75
- /evenemang [url-pattern] anchor="derived-rule" conf=0.70
- /kalendarium [url-pattern] anchor="derived-rule" conf=0.65

**improvementSignals:**
- HTTP 429 rate limited - site is reachable but throttled
- C0 found 30+ derived event paths (/events, /program, /kalender, etc.)
- Multiple high-confidence event paths available for retry

**suggestedRules:**
- Retry with exponential backoff - site is rate limiting
- Try /events or /program paths which have highest confidence scores

---

### Source: spanga-is

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failed |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.95 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS resolution failed - domain spanga.se cannot be found. Site is unreachable. Retry later or mark as defunct.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain spanga.se cannot be resolved
- Site may be defunct, temporarily down, or domain expired

**suggestedRules:**
- Verify domain spelling - spanga.se may have moved
- Check if site uses www.spanga.se or alternative domain

---
