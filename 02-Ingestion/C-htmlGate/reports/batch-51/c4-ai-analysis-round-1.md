## C4-AI Analysis Round 1 (batch-51)

**Timestamp:** 2026-04-15T02:45:00.986Z
**Sources analyzed:** 7

### Overall Pattern
Top failure categories: 1× extraction pattern mismatch, 1× cross-domain redirect blocked, 1× redirect loop timeout

---

### Source: kungliga-operan

| Field | Value |
|-------|-------|
| likelyCategory | extraction pattern mismatch |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /forestallningar, /konserter, /biljetter |

**humanLikeDiscoveryReasoning:**
C0 found 8 candidates and c0WinnerUrl points to /forestallningar/ path which contains event content. C2 scored 22 promising based on price-marker signals, but C3 extraction failed. This indicates the event structure exists but doesn't match current extraction patterns. The /forestallningar/ path is the primary event container for operan.se - must retry with this as entry point.

**candidateRuleForC0C3:**
- pathPattern: `/forestallningar|/konserter|/biljetter`
- appliesTo: Swedish performing arts venues (opera, theater, concert halls)
- confidence: 0.78

**discoveredPaths:**
- /forestallningar [derived] anchor="Productions/Performances listing" conf=0.82
- /forestallningar/familjekonsert-med-hovkapellet [url-pattern] anchor="Specific family concert event" conf=0.78

**improvementSignals:**
- C2 promising (score=22) but C3 extraction returned 0 events
- C0 found 8 candidates but c0LinksFound empty - needs path derivation
- c0WinnerUrl points to actual event page at /forestallningar/

**suggestedRules:**
- Add /forestallningar/ (productions) as event container path for Swedish opera/theater sites
- Retry with C0→C2 flow using /forestallningar/ as entry rather than root
- Configure C3 to handle structured event grids with price markers

---

### Source: visit-malmo

| Field | Value |
|-------|-------|
| likelyCategory | cross-domain redirect blocked |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /evenemang, /kalender |

**humanLikeDiscoveryReasoning:**
visit-malmö.com redirected to malmotown.com. Domain transition blocked C0 from discovering any event candidates. The original domain (IDN encoding) no longer serves content - all traffic redirected. Need manual investigation to determine if events exist at malmotown.com and update source mapping accordingly.

**candidateRuleForC0C3:**
- pathPattern: `/events|/kalender|/evenemang`
- appliesTo: Malmö-based tourism and event sources requiring domain migration tracking
- confidence: 0.45

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked: xn--visitmalm-87a.com → www.malmotown.com
- C0: no internal event candidates (0 candidates, 0 links)
- Domain transition suggests potential acquisition/rebrand

**suggestedRules:**
- Add malmotown.com as alternate domain for visit-malmö source
- Investigate whether event content moved to malmotown.com domain
- Update source URL from IDN encoding to www.malmotown.com for direct access

---

### Source: sensus

| Field | Value |
|-------|-------|
| likelyCategory | redirect loop timeout |
| failCategory | robots_or_policy_blocked |
| failCategoryConfidence | 0.72 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /kurser-och-evenemang/, /, /events, /kalender |

**humanLikeDiscoveryReasoning:**
Sensus.se has /kurser-och-evenemang/ as the event page path. C0 found 2 candidates and selected this as winner. The issue is redirect handling between sensus.se and www.sensus.se creating a loop. The target content exists - it's a server configuration issue not a content absence issue. Retry with different user-agent or follow-redirect mode.

**candidateRuleForC0C3:**
- pathPattern: `/kurser-och-evenemang|/evenemang|/utbildning`
- appliesTo: Swedish civic organizations and educational institutions with course/event sections
- confidence: 0.72

**discoveredPaths:**
- /kurser-och-evenemang/ [derived] anchor="Courses and events" conf=0.75
- / [nav-link] anchor="Root domain before loop" conf=0.60

**improvementSignals:**
- Redirect loop detected at /kurser-och-evenemang/
- C0 found 2 candidates before redirect loop blocked discovery
- Site appears functional but redirect handling is failing

**suggestedRules:**
- Implement redirect loop detection with fallback to alternate URL patterns
- Add /kurser-och-evenemang/ as known event path for Swedish civic/educational sites
- Configure C1 to handle Swedish domain redirects (sensus.se vs www.sensus.se)

---

### Source: goteborgs-litteraturhus

| Field | Value |
|-------|-------|
| likelyCategory | timeout on unreachable site |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /kalender, /program |

**humanLikeDiscoveryReasoning:**
Site timeout (20s) suggests either temporary unavailability, aggressive bot protection, or network routing issues. No content was fetched to analyze. Retry with extended timeout (45s) and consider adding to slow-site queue. Swedish literary venues typically have /events or /kalender paths.

**candidateRuleForC0C3:**
- pathPattern: `/events|/kalender|/program|/aktuellt`
- appliesTo: Swedish cultural institutions (libraries, literary houses, museums)
- confidence: 0.65

**discoveredPaths:**
(none)

**improvementSignals:**
- Timeout of 20000ms exceeded
- C0: no internal candidates (0 links found)
- Site may be temporarily unavailable or behind aggressive bot protection

**suggestedRules:**
- Increase timeout threshold for Swedish cultural institutions
- Add retry with different IP resolution for sites with intermittent timeouts
- Consider adding 'litteraturhuset' to slow-site priority queue

---

### Source: kalmar-energi-arena

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | / |

**humanLikeDiscoveryReasoning:**
DNS resolution failure (ENOTFOUND) means the domain kalmarenergiarena.se is either not registered, expired, or DNS records removed. This is a terminal failure - the site does not exist. Need manual verification to determine if venue has new domain or is permanently offline.

**candidateRuleForC0C3:**
- pathPattern: `N/A - no valid paths can be discovered for non-existent domain`
- appliesTo: Swedish sports venues that may have rebranded or lost domain registration
- confidence: 0.95

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND kalmarenergiarena.se
- DNS resolution completely failed - domain does not exist or is not registered
- C0: no candidates discovered (0 links, 0 candidates)

**suggestedRules:**
- Remove 'kalmarenergiarena' from active source list - domain appears defunct
- Check if venue rebranded to 'Kalmar Arena' or similar
- Verify correct domain for Kalmar energy arena events

---

### Source: norrkoping-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | 404 not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | / |

**humanLikeDiscoveryReasoning:**
HTTP 404 means the page at norrkoping.se/stadsteatern no longer exists. The /stads... path suggests cultural venues often move to /kultur or /scen. Need manual investigation to find current theater website - likely under norrkoping.se with different path structure.

**candidateRuleForC0C3:**
- pathPattern: `/kultur|/scen|/teater|/foretagsnamn`
- appliesTo: Norrköping municipal cultural venues on norrkoping.se domain
- confidence: 0.60

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 from norrkoping.se/stadsteatern
- URL structure suggests subsite under norrkoping.se, not standalone domain
- Page may have moved, been deleted, or renamed

**suggestedRules:**
- Update source URL to use current Norrköping stadsteater domain
- Check norrkoping.se for 'stadsteatern' section under new URL structure
- Verify if theater rebranded or merged with other Norrköping cultural sites

---

### Source: norrkoping-art

| Field | Value |
|-------|-------|
| likelyCategory | DNS failure - dead domain |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.97 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | / |

**humanLikeDiscoveryReasoning:**
DNS failure for norrkopingart.se indicates the domain is no longer active. This is a terminal failure - no content exists to discover. Manual verification needed to determine if venue has new online presence or is permanently offline.

**candidateRuleForC0C3:**
- pathPattern: `N/A - no paths available for non-existent domain`
- appliesTo: Norrköping art venues that may have moved to different domains
- confidence: 0.97

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND norrkopingart.se
- Domain registration expired or site permanently removed
- C0 found 0 candidates - no content could be fetched

**suggestedRules:**
- Remove norrkopingart.se from active sources - domain defunct
- Verify if art venue moved to different domain or social media presence
- Search for 'Norrköping Art' current website for manual review

---
