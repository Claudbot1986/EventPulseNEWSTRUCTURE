## C4-AI Analysis Round 1 (batch-60)

**Timestamp:** 2026-04-16T19:46:12.799Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 4× DNS resolution failure, 2× extraction mismatch promising C2, 1× municipality art museum 404

---

### Source: vasteras-konstmuseum

| Field | Value |
|-------|-------|
| likelyCategory | municipality art museum 404 |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.75 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | /konstmuseum |

**humanLikeDiscoveryReasoning:**
HTTP 404 indicates the specific /konstmuseum path does not exist. Västerås municipality site likely reorganized. No c0LinksFound available to discover alternative paths. Domain appears functional but specific content path missing.

**candidateRuleForC0C3:**
- pathPattern: `/konst|/museum|/galleri`
- appliesTo: Swedish municipal art institutions
- confidence: 0.45

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on /konstmuseum path suggests URL structure changed
- Municipality site may have reorganized content under /kultur or similar
- Verify if museum moved to subdomain like museum.vasteras.se

**suggestedRules:**
- Check if vasteras.se/konstmuseum redirects to alternative path
- Search for 'Västerås konstmuseum' site structure

---

### Source: sticky-fingers

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS resolution failed completely - getaddrinfo ENOTFOUND. The domain stickyfingers.se does not exist in DNS. This is a terminal failure requiring manual investigation.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND indicates domain no longer exists or is misconfigured
- Check if stickyfingers.co.uk or similar TLD was adopted

**suggestedRules:**
- Verify domain expiration or migration to new URL

---

### Source: malmo-konsthall

| Field | Value |
|-------|-------|
| likelyCategory | redirect chain exceeds limit |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.82 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /, /evenemang |
| directRouting | D (conf=0.65) |

**humanLikeDiscoveryReasoning:**
C0 derived rule correctly identified /evenemang path. The site is accessible but exceeds redirect limit - likely HTTPS enforcement or URL normalization issue. Path exists but needs different fetch strategy.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/utställningar|/exhibition`
- appliesTo: Swedish municipal art halls (Konsthall)
- confidence: 0.78

**discoveredPaths:**
- /evenemang [derived] anchor="derived-rule" conf=0.75

**improvementSignals:**
- C0 winner URL identified: /evenemang suggests events exist
- Exceeded redirects indicates possible HTTPS redirect or URL restructuring
- Try direct HTTPS or alternate protocol

**suggestedRules:**
- Force HTTPS protocol for konsthall.malmo.se
- Try /evenemang path directly with adjusted redirect handling
- Check if art hall moved to malmo.se/konst

---

### Source: vaxjo-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | concert hall with event program |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /, /events, /program, /kalender, /schema, /evenemang |

**humanLikeDiscoveryReasoning:**
C0 analysis found 31 event-indicating links with high confidence scores. Växjö Konserthus (concert hall) almost certainly has event listings accessible via /events, /program, or /kalender. The homepage failed to resolve but venue-specific event paths are well-defined by derived rules.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/schema|/konserter|/evenemang`
- appliesTo: Swedish concert halls and performing arts venues (konserthus, teater, scen)
- confidence: 0.88

**discoveredPaths:**
- /events [url-pattern] anchor="derived-rule" conf=0.92
- /program [url-pattern] anchor="derived-rule" conf=0.90
- /kalender [url-pattern] anchor="derived-rule" conf=0.88
- /schema [url-pattern] anchor="derived-rule" conf=0.85

**improvementSignals:**
- 31 event-indicating links found in C0 analysis
- Top candidates: /events (10), /program (9), /kalender (8)
- Venue marker detected in C2 suggests venue page, not events page

**suggestedRules:**
- Direct fetch to /events or /program should yield event content
- vx.se may use /konserthus prefix for venue-specific events

---

### Source: open-air

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS resolution failed - openair.se domain not found. Terminal failure requiring manual investigation.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain does not exist
- Open air venue may have moved to new domain or social media

**suggestedRules:**
- Verify if venue operates under different domain
- Check openair.nu or similar Swedish domain

---

### Source: masthuggskyrkan

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS resolution failed - masthuggskyrkan.se domain not found. Terminal failure requiring manual verification.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain does not exist
- Church may use svenskakyrkan.se subdomain

**suggestedRules:**
- Check masthuggskyrkan.svenskakyrkan.se or similar
- Verify if church merged with other parish site

---

### Source: lunds-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | municipality 404 path not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.72 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | /konserthus |

**humanLikeDiscoveryReasoning:**
HTTP 404 on Lund municipality /konserthus path. Municipality sites frequently reorganize. No c0LinksFound available. Requires manual verification of Lund's current event URL structure.

**candidateRuleForC0C3:**
- pathPattern: `/konserter|/musik|/kultur|/evenemang`
- appliesTo: Swedish municipal concert venues
- confidence: 0.55

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on /konserthus suggests Lund moved venue info
- Lund University Academy of Music may host concert info
- Lund City Hall concerts may be under different path

**suggestedRules:**
- Verify Lund municipality site restructure
- Check if Konserthus moved to /kultur or /musik path

---

### Source: junibacken

| Field | Value |
|-------|-------|
| likelyCategory | extraction mismatch promising C2 |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.85 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | / |
| directRouting | D (conf=0.88) |

**humanLikeDiscoveryReasoning:**
C2 analysis found promising event signals (score 60, 6 event cards) but extraction returned 0 events. HTML structure likely differs from extraction patterns - possibly custom CMS or Swedish character handling issue. Route to D for specialized extraction.

**discoveredPaths:**
(none)

**improvementSignals:**
- C2 score 60 promising: cards=medium(6/6) detected
- Junibacken is Pippi Longstocking museum - events exist
- HTML structure may differ from standard event patterns
- Date/content extraction failed despite visible event cards

**suggestedRules:**
- Inspect C2 promising page for non-standard HTML structure
- Junibacken may use custom CMS with different class naming
- Consider text-based date extraction for Swedish children's museum

---

### Source: uppsala-kommun

| Field | Value |
|-------|-------|
| likelyCategory | extraction mismatch promising C2 |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.78 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | / |
| directRouting | D (conf=0.82) |

**humanLikeDiscoveryReasoning:**
C2 analysis found promising event signals (score 11, event-heading detected) but extraction returned 0 events. Uppsala municipality likely uses Sitevision CMS with non-standard HTML. Route to D for specialized extraction patterns.

**discoveredPaths:**
(none)

**improvementSignals:**
- C2 score 11 promising with event-heading detected
- Uppsala municipality has extensive events
- Extraction pattern may not match Swedish municipal CMS
- 1 timeTag and 1 dateCount suggests partial structure found

**suggestedRules:**
- Swedish municipal CMS (sitevision?) may have unique event HTML patterns
- Check for JSON-LD or microdata patterns Uppsala uses
- Consider pagination or infinite scroll handling

---

### Source: repo-festival

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS resolution failed - repo.se domain not found. Terminal failure requiring manual investigation.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain does not exist
- repo.se may be inactive or festival concluded

**suggestedRules:**
- Verify if repo festival has new domain
- Check if annual festival ended operations

---
