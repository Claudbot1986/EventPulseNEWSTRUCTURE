## C4-AI Analysis Round 1 (batch-58)

**Timestamp:** 2026-04-15T18:48:29.844Z
**Sources analyzed:** 8

### Overall Pattern
Top failure categories: 2× HTTP 404 - path does not exist, 2× Homepage no events, nav links to event pages, 2× DNS failure - domain does not exist

---

### Source: norrkoping-museum

| Field | Value |
|-------|-------|
| likelyCategory | HTTP 404 - path does not exist |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
HTTP 404 indicates the URL path /museum does not exist on norrkoping.se. No links were found to analyze. Domain exists but specific path is invalid. No viable navigation path to attempt.

**discoveredPaths:**
(none)

**improvementSignals:**
- URL https://norrkoping.se/museum returns 404
- Domain norrkoping.se exists but /museum path invalid
- May need correct museum URL path

**suggestedRules:**
- Verify museum URL path is correct for Norrköping municipality
- Check if museum section moved to different URL structure

---

### Source: malarenergi-arena

| Field | Value |
|-------|-------|
| likelyCategory | Homepage no events, nav links to event pages |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Homepage has no events but contains multiple high-confidence event navigation links. Top candidates /events, /program, and /kalender have scores 10, 9, and 8 respectively. These are standard Swedish event paths. Should follow /events first as highest confidence path.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender`
- appliesTo: Swedish arena and venue sites with event listings on subpages
- confidence: 0.88

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.92
- /program [nav-link] anchor="derived-rule" conf=0.88
- /kalender [nav-link] anchor="derived-rule" conf=0.85

**improvementSignals:**
- c0LinksFound contains 30+ event-indicating paths
- Top candidates: /events (score 10), /program (score 9), /kalender (score 8)
- c1DateCount: 2 indicates some date content exists
- c2Score: 4 but page has event-heading class

**suggestedRules:**
- For Swedish arena/venue sites, follow /events or /program links from homepage
- These sites typically have event listings on dedicated subpages, not homepage

---

### Source: malmo-stadsbibliotek

| Field | Value |
|-------|-------|
| likelyCategory | URL encoding redirect blocked |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
URL encoding causes cross-domain redirect that is blocked. The punycode domain xn--malm-8qa.se redirects to malmo.se but this redirect is blocked by policy. No alternative path available without URL correction.

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked: xn--malm-8qa.se → malmo.se
- URL encoding issue with Swedish ö character
- Domain redirect policy blocking discovery

**suggestedRules:**
- Use punycode-decoded URL malmo.se/bibliotek instead of malmö.se
- Investigate if domain redirect can be handled in fetchHtml

---

### Source: vaxjo-teatern

| Field | Value |
|-------|-------|
| likelyCategory | DNS failure - domain does not exist |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS lookup failed completely - domain vaexjoe-teatern.se does not exist. No network path available. Requires manual verification of correct domain name.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS lookup failed: getaddrinfo ENOTFOUND vaexjoe-teatern.se
- Domain vaexjoe-teatern.se does not exist
- May be typo in domain name

**suggestedRules:**
- Verify correct domain for Växjö Teatern
- Possible correct domain: vaxjoteatern.se or something similar

---

### Source: junibacken

| Field | Value |
|-------|-------|
| likelyCategory | Homepage no events, nav links to event pages |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Homepage has no events but c2 analysis shows promising venue-marker with 6 cards. Multiple high-scoring event navigation links found. Should follow /events or /program paths. Junibacken is a cultural venue so events will be on dedicated subpages.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/aktiviteter`
- appliesTo: Swedish cultural venues and museums with events on subpages
- confidence: 0.85

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.92
- /program [nav-link] anchor="derived-rule" conf=0.88
- /kalender [nav-link] anchor="derived-rule" conf=0.85
- /aktiviteter [nav-link] anchor="derived-rule" conf=0.75

**improvementSignals:**
- c0LinksFound contains 30+ event-indicating paths
- c2Score: 60 with promising verdict
- venue-marker detected with 6 cards
- Top candidates: /events (10), /program (9), /kalender (8)

**suggestedRules:**
- Junibacken is a Swedish children's museum - follow /events or /program links
- c2 shows promising venue-marker signals - events likely on subpages

---

### Source: norrkoping-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | HTTP 404 - path does not exist |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
HTTP 404 indicates the URL path /konserthus does not exist on norrkoping.se. No links were found to analyze. Domain exists but specific path is invalid. No viable navigation path to attempt.

**discoveredPaths:**
(none)

**improvementSignals:**
- URL https://norrkoping.se/konserthus returns 404
- Domain norrkoping.se exists but /konserthus path invalid
- Concert hall may be under different URL or subdomain

**suggestedRules:**
- Verify concert hall URL path for Norrköping
- May be under norrkoping.se/kultur or similar subpath

---

### Source: vasteras-stad

| Field | Value |
|-------|-------|
| likelyCategory | Found kalender path but low extraction score |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.82 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /kalender.html |

**humanLikeDiscoveryReasoning:**
C0 already found kalender.html as winner with score 1. C2 extraction scored 3 which is below threshold but event-heading was detected. This is a valid event path that needs retry with adjusted extraction parameters.

**candidateRuleForC0C3:**
- pathPattern: `/kalender|/kalender.html|/evenemang`
- appliesTo: Swedish municipal sites with calendar-based event listings
- confidence: 0.82

**discoveredPaths:**
- /kalender.html [url-pattern] anchor="derived-rule" conf=0.90

**improvementSignals:**
- c0WinnerUrl already identified: https://vasteras.se/kalender.html
- c2Score: 3 but event-heading detected
- Score too low for extraction but path is valid
- May need different extraction approach for this site structure

**suggestedRules:**
- Retry extraction on /kalender.html with adjusted scoring thresholds
- Västerås city site has events but extraction pattern may need tuning

---

### Source: kalmar-energi-arena

| Field | Value |
|-------|-------|
| likelyCategory | DNS failure - domain does not exist |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS lookup failed completely - domain kalmarenergiarena.se does not exist. No network path available. Requires manual verification of correct domain name.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS lookup failed: getaddrinfo ENOTFOUND kalmarenergiarena.se
- Domain kalmarenergiarena.se does not exist
- May be typo in domain name

**suggestedRules:**
- Verify correct domain for Kalmar Energi Arena
- Possible correct domain: kalmararena.se or similar

---
