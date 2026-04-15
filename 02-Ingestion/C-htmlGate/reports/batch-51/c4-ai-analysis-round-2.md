## C4-AI Analysis Round 2 (batch-51)

**Timestamp:** 2026-04-15T02:49:03.776Z
**Sources analyzed:** 7

### Overall Pattern
Top failure categories: 2× domain not found, 1× events on subpages only, 1× domain redirect failure

---

### Source: kungliga-operan

| Field | Value |
|-------|-------|
| likelyCategory | events on subpages only |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /forestallningar/, /program/, /biljetter/ |

**humanLikeDiscoveryReasoning:**
C0 found 8 candidates and c0WinnerUrl reveals /forestallningar/ path pattern. Entry page (https://operan.se/) returned 0 events in C3 despite C2 promising (score=22), indicating events are on subpages. The URL /forestallningar/familjekonsert-med-hovkapellet shows individual events use /forestallningar/{slug} pattern. Recommended retry with /forestallningar/ as entry point for event listing extraction.

**candidateRuleForC0C3:**
- pathPattern: `/forestallningar|/forestallning|/programm|/program`
- appliesTo: Swedish opera/theater venues like operan.se
- confidence: 0.82

**discoveredPaths:**
- /forestallningar/ [url-pattern] anchor="Foreställningar" conf=0.82

**improvementSignals:**
- c0Candidates=8 but c0LinksFound empty - candidates were found but not documented in c0LinksFound
- c0WinnerUrl points to /forestallningar/ path containing specific events
- C2 promising score=22 indicates event signals exist but on deeper pages

**suggestedRules:**
- For operan.se specifically: /forestallningar/ is the event listing path for performances
- General Swedish opera/theater sites: try /forestallningar/, /forestallningar/, /program/, /biljetter/

---

### Source: visit-malmo

| Field | Value |
|-------|-------|
| likelyCategory | domain redirect failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Cross-domain redirect blocked prevents any HTML retrieval. c0Candidates=0 and c0LinksFound=[] because C1 could not fetch the entry page. Domain xn--visitmalm-87a.com (IDN for Visit Malmö) redirects to www.malmotown.com which is blocked. Exhausted network-level paths - no navigation possible without resolving cross-domain policy.

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked from xn--visitmalm-87a.com to www.malmotown.com
- c1Verdict=unfetchable despite likelyJsRendered=false
- No candidates found and no paths to discover due to redirect blocking

**suggestedRules:**
- Detect redirect chains that cross domains and flag for manual review
- For IDN domains (xn--) attempt punycode decoding to find alternative URLs

---

### Source: sensus

| Field | Value |
|-------|-------|
| likelyCategory | redirect loop blocking access |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.97 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | /kurser-och-evenemang/ |

**humanLikeDiscoveryReasoning:**
C2 failed with 'Redirect loop detected' on /kurser-och-evenemang/ which is the event listing path. C0 found 2 candidates and c0WinnerUrl points to this path, but it is inaccessible due to redirect loop between https://sensus.se and https://www.sensus.se. No alternative paths discovered. Exhausted network-level attempts.

**discoveredPaths:**
(none)

**improvementSignals:**
- Redirect loop detected at https://www.sensus.se/kurser-och-evenemang
- c0WinnerUrl known but unfetchable due to loop
- C1 verdict=unfetchable confirms page inaccessible

**suggestedRules:**
- Implement redirect loop detection with max hop count (e.g., 5)
- When redirect loop detected, try non-www variant or remove trailing slashes

---

### Source: goteborgs-litteraturhus

| Field | Value |
|-------|-------|
| likelyCategory | server timeout |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.93 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Fetch timed out after 20000ms. DNS resolution succeeded (domain exists) but server did not respond within timeout window. No HTML retrieved means no links discovered (c0LinksFound=[]). Could retry with extended timeout, but consecutiveFailures=2 suggests persistent issue. Exhausted reasonable network attempts.

**discoveredPaths:**
(none)

**improvementSignals:**
- fetchHtml timeout of 20000ms exceeded
- c1Verdict=unfetchable despite likelyJsRendered=false
- Domain appears alive but server unresponsive

**suggestedRules:**
- Distinguish between DNS failure (ENOTFOUND) and timeout (server alive but slow)
- Timeout suggests retry with higher timeout threshold or alternate User-Agent

---

### Source: kalmar-energi-arena

| Field | Value |
|-------|-------|
| likelyCategory | domain not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.99 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND means domain kalmarenergiarena.se does not exist. No HTML could be fetched, no navigation possible. Likely the venue moved to a different domain or the URL was mistyped. Possible correct domain: kalmarenergi.se or malardalsteatern.se. No viable path without manual domain verification.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND - DNS resolution failed
- Domain kalmarenergiarena.se does not exist
- No network path possible

**suggestedRules:**
- For ENOTFOUND, verify if domain was mistyped (kalmarenergiarena vs kalmarenergi?)
- Check if site moved to different domain (e.g., kalmarenergi.se or similar)

---

### Source: norrkoping-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | page not found (404) |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.96 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | /stadsteatern |

**humanLikeDiscoveryReasoning:**
HTTP 404 on /stadsteatern path. The Norrköping City Theater likely moved to a different URL structure. Common patterns to try: /kultur/stadsteatern, /scen/stadsteatern, or subdomain stadsteatern.norrkoping.se. However with c1Verdict=unfetchable and no candidates found, navigation cannot proceed without manual URL verification.

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 - URL https://norrkoping.se/stadsteatern returns not found
- Subdomain path likely incorrect
- City of Norrköping site structure may have changed

**suggestedRules:**
- For 404 on city subdomain paths, try alternative patterns: norrkoping.se/kultur/stadsteatern or stadsteatern.norrkoping.se
- Verify against sitemap or Google-indexed versions

---

### Source: norrkoping-art

| Field | Value |
|-------|-------|
| likelyCategory | domain not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.99 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND for norrkopingart.se. Domain does not exist. Likely the site was never registered, abandoned, or uses a different domain. No network path available without manual domain verification. Probable alternatives: norrkopingkonstmuseum.se or kultur.norrkoping.se/gallerior.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND - DNS resolution failed for norrkopingart.se
- Domain does not exist or is inactive
- Possible typo: norrkoping-art.se (with hyphen)?

**suggestedRules:**
- For art-related domains that ENOTFOUND, check norrkopingartmuseum.se or kultur.norrkoping.se
- Domain typos: norrkopingart vs norrkoping-art vs norrkopingsart

---
