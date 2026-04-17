## C4-AI Analysis Round 1 (batch-88)

**Timestamp:** 2026-04-16T16:41:21.202Z
**Sources analyzed:** 8

### Overall Pattern
Top failure categories: 2× domain_not_found, 2× page_not_found, 2× server_timeout

---

### Source: linkoping-city

| Field | Value |
|-------|-------|
| likelyCategory | domain_not_found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS resolution failed completely. No HTML could be fetched. Domain 'linkopingcity.se' appears inactive. Similar municipal sites use 'linkoping.se'. Cannot attempt further discovery without manual domain verification.

**discoveredPaths:**
(none)

**improvementSignals:**
- ENOTFOUND error indicates domain may be inactive or typo
- c0LinksFound empty due to DNS resolution failure

**suggestedRules:**
- Verify domain spelling: 'linkopingcity.se' vs 'linkoping.se' (municipal site)

---

### Source: halmstad-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | page_not_found |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /konserthus |

**humanLikeDiscoveryReasoning:**
Page /konserthus returned 404. Attempted to discover alternative paths based on Swedish municipal URL patterns. Root domain halmstad.se likely contains event listings under standard paths like /evenemang or /konserter.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/konserter|/konsert|/program`
- appliesTo: Swedish municipal and cultural sites
- confidence: 0.72

**discoveredPaths:**
- https://halmstad.se/konserter [url-pattern] anchor="derived from /konserthus" conf=0.65
- https://halmstad.se/evenemang [url-pattern] anchor="standard Swedish events path" conf=0.70

**improvementSignals:**
- HTTP 404 on /konserthus path - page may have moved
- halmstad.se likely has events elsewhere (municipal site)

**suggestedRules:**
- Try halmstad.se root + /konserthall or /konserter subpages
- Swedish municipal concert halls often use /konsert or /evenemang

---

### Source: mora-ik

| Field | Value |
|-------|-------|
| likelyCategory | server_timeout |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | / |

**humanLikeDiscoveryReasoning:**
Server timeout prevented initial fetch. Based on domain analysis (mora IK = ice hockey club), likely paths would be /matcher, /hockey, or /spelschema. Recommend retry with extended timeout.

**candidateRuleForC0C3:**
- pathPattern: `/matcher|/hockey|/schema|/spelprogram`
- appliesTo: Swedish sports club sites
- confidence: 0.62

**discoveredPaths:**
- https://moraik.se/matcher [url-pattern] anchor="sports event path" conf=0.60

**improvementSignals:**
- Server timeout suggests slow/unresponsive server
- May be temporary network issue or overloaded server

**suggestedRules:**
- Retry with extended timeout (30-45s) or alternate network route
- moraik.se is ice hockey club - events may be under /matcher or /arena

---

### Source: orebro-hockey

| Field | Value |
|-------|-------|
| likelyCategory | server_timeout |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | / |

**humanLikeDiscoveryReasoning:**
Timeout occurred during fetch. Orebro hockey (SKODA IBF) likely has event schedule under /matcher or similar. Recommend retry pool with extended timeout.

**candidateRuleForC0C3:**
- pathPattern: `/matcher|/schema|/sasong|/biljetter`
- appliesTo: Swedish sports/hockey club sites
- confidence: 0.62

**discoveredPaths:**
- https://orebrohockey.se/matcher [url-pattern] anchor="derived from hockey club pattern" conf=0.62

**improvementSignals:**
- Server timeout on oreBro hockey domain
- Similar sports club URL pattern to mora-ik

**suggestedRules:**
- Retry with longer timeout
- Swedish hockey clubs typically have /matcher or /kontakt

---

### Source: stockholm-jazz-festival

| Field | Value |
|-------|-------|
| likelyCategory | domain_not_found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS resolution failed - domain 'stojazz.se' does not exist. Stockholm Jazz Festival likely uses a different domain. Manual verification needed for correct URL.

**discoveredPaths:**
(none)

**improvementSignals:**
- ENOTFOUND - domain 'stojazz.se' does not exist
- Stockholm Jazz Festival may have moved to different domain

**suggestedRules:**
- Verify correct domain: 'stockholmjazz.se' or 'jazzfest.se'
- Annual festivals often change domain or use event platforms

---

### Source: lulea-tekniska-universitet

| Field | Value |
|-------|-------|
| likelyCategory | extraction_failed_despite_signal |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /aktuellt/kalender |
| directRouting | D (conf=0.68) |

**humanLikeDiscoveryReasoning:**
C2 identified /aktuellt/kalender as promising (score=14). Extraction failed despite clear calendar signal. LTU is a university - their calendar likely uses JavaScript rendering or specific institutional markup. Retry with JS rendering or B-queue pattern detection.

**candidateRuleForC0C3:**
- pathPattern: `/aktuellt/kalender|/kalender|/nyheter/kalender`
- appliesTo: Swedish university and institutional calendar pages
- confidence: 0.78

**discoveredPaths:**
- /aktuellt/kalender [derived] anchor="Calendar/Events" conf=0.80

**improvementSignals:**
- C2 scored 14 - calendar page detected but extraction returned 0
- LTU uses institutional calendar likely with dynamic content

**suggestedRules:**
- LTU calendar may use JavaScript rendering or non-standard date markup
- Try C4 with JS rendering enabled or different date extraction patterns

---

### Source: kulturhuset-orebro

| Field | Value |
|-------|-------|
| likelyCategory | entry_page_missing_events |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.92 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /kalender |

**humanLikeDiscoveryReasoning:**
Kulturhuset Orebro entry page had no events but C2 scored 51 (promising) with strong time-tag signals. C0 derived rules found 23 event-indicating paths. /events scored highest (10) followed by /program (9). Human-like discovery: this cultural venue likely organizes events under /events or /program - retry pool should try these paths first.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/evenemang`
- appliesTo: Swedish cultural centers and municipal venues
- confidence: 0.88

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.88
- /program [nav-link] anchor="derived-rule" conf=0.82
- /kalender [nav-link] anchor="derived-rule" conf=0.78
- /evenemang [nav-link] anchor="derived-rule" conf=0.72
- /konserter [nav-link] anchor="derived-rule" conf=0.55

**improvementSignals:**
- C2 scored 51 (promising) - page has time-tag signals
- 23 event-indicating links found in c0LinksFound

**suggestedRules:**
- Primary event path /events scored 10 - should be primary retry target
- Kulturhuset (cultural center) likely uses /program or /events for listings

---

### Source: linkoping-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | page_not_found |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /konserthus |

**humanLikeDiscoveryReasoning:**
Page /konserthus returned 404. Linkoping concert hall likely moved or is under different path on linkoping.se. Swedish municipal concert venues typically use /konserter, /evenemang, or /program. Retry pool should attempt these standard paths.

**candidateRuleForC0C3:**
- pathPattern: `/konserter|/evenemang|/program|/kultur`
- appliesTo: Swedish municipal concert halls and venues
- confidence: 0.72

**discoveredPaths:**
- https://linkoping.se/konserter [url-pattern] anchor="derived from /konserthus" conf=0.68
- https://linkoping.se/evenemang [url-pattern] anchor="standard municipal events" conf=0.70
- https://linkoping.se/kultur [url-pattern] anchor="cultural section" conf=0.58

**improvementSignals:**
- HTTP 404 on /konserthus - Linkoping concert hall page moved
- linkoping.se is main municipal site with events elsewhere

**suggestedRules:**
- Try linkoping.se root + /konserthus or /konserter
- Concert halls often host events at /program or /biljetter

---
