## C4-AI Analysis Round 1 (batch-96)

**Timestamp:** 2026-04-16T18:56:39.767Z
**Sources analyzed:** 9

### Overall Pattern
Top failure categories: 2× DNS unresolvable domain, 2× 404 on base path, 1× Event page needs retry

---

### Source: stora-teatern-uppsala-1

| Field | Value |
|-------|-------|
| likelyCategory | DNS unresolvable domain |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://storateaternuppsala.se/ |

**humanLikeDiscoveryReasoning:**
DNS resolution failed for storateaternuppsala.se - domain does not exist or is unreachable. No network path available to discover event content.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- verify domain spelling: 'storateaternuppsala.se'
- check for alternate TLD: .com, .org
- try with/without www prefix

**suggestedRules:**
- For ENOTFOUND errors, attempt common Swedish domain variants: www.domain.se, domain.se without trailing slash

---

### Source: stockholms-universitet

| Field | Value |
|-------|-------|
| likelyCategory | Event page needs retry |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://su.se/kalender |

**humanLikeDiscoveryReasoning:**
Entry page /evenemang found no events. C0 discovered /kalender as winner URL. This Swedish university calendar path should be tested in retry pool - page exists but needs better extraction strategy.

**candidateRuleForC0C3:**
- pathPattern: `/kalender|/evenemang|/program`
- appliesTo: Swedish university and academic institution event pages
- confidence: 0.65

**discoveredPaths:**
- /kalender [derived] anchor="Kalender" conf=0.72

**improvementSignals:**
- su.se/kalender page returned weak/noise verdict - likely needs JS rendering or different extraction
- C0 candidates found but C1 classified as noise - investigate structure

**suggestedRules:**
- For Swedish university event pages scoring low in C1 noise, try pattern-based extraction focusing on date-patterns and h2/h3 headings
- Consider that academic calendars may use schema.org markup inconsistently

---

### Source: vasteras-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | 404 on base path |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.85 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://vasteras.se/konserthus |

**humanLikeDiscoveryReasoning:**
vasteras.se domain exists but /konserthus returned HTTP 404. No alternative paths discovered in C0. Domain may have restructured event pages or the specific path is deprecated.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain resolves (vasteras.se exists), but /konserthus path returns 404
- May need /konserthuset or different path structure
- Check municipality's current event URL structure

**suggestedRules:**
- For 404 errors on Swedish municipal sites, try variants: /konserthuset, /konserthall, /evenemang/konserthus
- Municipal event URLs frequently restructure

---

### Source: halmstad-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | 404 on base path |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://halmstad.se/stadsteatern |

**humanLikeDiscoveryReasoning:**
halmstad.se domain exists but /stadsteatern returned HTTP 404. No C0 links found to alternative paths. Venue may have been deprecated or moved under municipal event pages.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain resolves (halmstad.se exists), but /stadsteatern returns 404
- Venue may have been renamed or merged with other municipal pages
- Check /kultur, /evenemang as alternatives

**suggestedRules:**
- For 404 on Swedish theater venues, try /teater, /scen, /kultur
- Municipal theater pages often consolidated under /kultur or /evenemang

---

### Source: uppsala-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | DNS unresolvable domain |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://uppsalakonserthus.se/ |

**humanLikeDiscoveryReasoning:**
DNS resolution failed for uppsalakonserthus.se - domain does not exist. The concert hall may have consolidated under uppsala.se domain.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain 'uppsalakonserthus.se' does not exist
- Verify correct domain: uppsalakonserthuset.se, uppsala.se/konserthus

**suggestedRules:**
- For Swedish concert hall DNS failures, try: uppsala.se/konserthuset, konserthuset-uppsala.se

---

### Source: ystad

| Field | Value |
|-------|-------|
| likelyCategory | Event page needs better extraction |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.82 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://ystad.se/uppleva-och-gora/evenemang |

**humanLikeDiscoveryReasoning:**
Entry page found no events. C0 discovered /uppleva-och-gora/evenemang as winner URL with 2 candidates. Page exists (HTTP 200) but C2 score was 4 - needs better extraction strategy. This is a standard Swedish municipal event path that should be retried with adjusted patterns.

**candidateRuleForC0C3:**
- pathPattern: `/uppleva-och-gora/evenemang|/uppleva/gora/evenemang|/evenemang`
- appliesTo: Swedish municipal event pages using 'uppleva och göra' (experience and do) navigation structure
- confidence: 0.75

**discoveredPaths:**
- /uppleva-och-gora/evenemang [derived] anchor="Event page path" conf=0.80

**improvementSignals:**
- C0 found /uppleva-och-gora/evenemang with 2 candidates
- C1 scored weak despite page existing
- C2 score 4 - page exists but extraction failed
- event-list class detected - scraping pattern may need adjustment

**suggestedRules:**
- For Swedish municipal event pages scoring <6 in C2 but showing event-list class, use relaxed extraction focusing on article/event-card patterns
- YSTAD municipal site uses /uppleva-och-gora/evenemang structure

---

### Source: malmo-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | DNS punycode domain error |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://malmökonserthus.se/ |

**humanLikeDiscoveryReasoning:**
Punycode encoding for 'malmökonserthus.se' failed DNS resolution. The site may have moved to malmo.se/konserthus or uses different domain structure. No accessible paths discovered.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- Punycode domain xn--malmkonserthus-ypb.se failed DNS
- Correct domain should be 'malmokonserthus.se' or 'malmo.se/konserthus'
- Check for Swedish character encoding issues

**suggestedRules:**
- For Swedish domain names with special characters (ö), use proper punycode encoding OR try ASCII equivalent
- Malmö should map to malmo without umlaut

---

### Source: medeltidsmuseet

| Field | Value |
|-------|-------|
| likelyCategory | Redirect loop blocking access |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://medeltidsmuseet.se/ |

**humanLikeDiscoveryReasoning:**
medeltidsmuseet.se (Medieval Museum Stockholm) exceeded redirect limit. Site may have moved to stockholm.se/stadsmuseum or similar municipal structure. Manual investigation required to resolve redirect chain.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- Exceeded 3 redirects on medeltidsmuseet.se
- Site may have moved to new domain or have canonical redirect issues
- Try museum's parent municipality or cultural site

**suggestedRules:**
- For redirect loops, check robots.txt and examine final redirect destination manually
- Swedish museum redirects may point to stockholm.se or similar municipal portals

---

### Source: ois

| Field | Value |
|-------|-------|
| likelyCategory | Extraction failed on promising page |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.88 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | https://ois.se/events |
| directRouting | D (conf=0.85) |

**humanLikeDiscoveryReasoning:**
ois.se/events showed very promising signals (C2=80, 6 timeTags, 20 dateCounts, strong card patterns) but extraction returned 0 events. This indicates extraction patterns don't match the page's HTML structure. Despite likelyJsRendered=false, routing to D for full DOM rendering may reveal hidden event content. Alternatively, extraction patterns need adjustment for this specific site's markup.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang|/program`
- appliesTo: Swedish sports club and organization event pages using /events routing
- confidence: 0.82

**discoveredPaths:**
- /events [derived] anchor="derived-rule" conf=0.90

**improvementSignals:**
- C2 score 80 (promising) with 6 timeTags and 20 dateCounts
- 6/6 card candidates found in C1
- Extraction returned 0 events despite strong signals
- LikelyJsRendered=false but extraction still failed - structural mismatch

**suggestedRules:**
- For high C2 score with extraction failure, examine if timeTag/dateCount signals are embedded in non-standard structures
- ois.se may use custom event markup that doesn't match standard extraction patterns

---
