## C4-AI Analysis Round 2 (batch-47)

**Timestamp:** 2026-04-15T02:46:27.179Z
**Sources analyzed:** 5

### Overall Pattern
Top failure categories: 1× redirect blocking access, 1× subpage not found, 1× events on subpages

---

### Source: medeltidsmuseet

| Field | Value |
|-------|-------|
| likelyCategory | redirect blocking access |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.72 |
| nextQueue | retry-pool |
| discoveryAttempted | false |
| discoveryPathsTried | https://medeltidsmuseet.se/ |

**humanLikeDiscoveryReasoning:**
No c0LinksFound available - page fetched but redirected to medeltidsmuseet.stockholm.se. Cross-domain redirect prevents analysis of available links. Unable to perform human-like discovery because content is blocked by redirect policy.

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked - site functional but crawler blocked
- Domain redirects to medeltidsmuseet.stockholm.se - new domain should be tested
- c1Verdict=unfetchable with 0 links found indicates site architecture change

**suggestedRules:**
- Investigate redirect target medeltidsmuseet.stockholm.se as primary domain
- Add redirect-follow capability for domain migrations
- Test alternate domain before marking as blocked

---

### Source: halmstad-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | subpage not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |
| discoveryAttempted | false |
| discoveryPathsTried | https://halmstad.se/konserthus |

**humanLikeDiscoveryReasoning:**
Page returns 404 - no HTML content to analyze. No c0LinksFound available. Cannot perform human-like discovery on a non-existent page. Site may have moved venue pages.

**discoveredPaths:**
(none)

**improvementSignals:**
- URL /konserthus returns HTTP 404
- Site may have restructured or removed event section
- halmstad.se uses different URL structure for cultural venues

**suggestedRules:**
- Check if venue events are under /konserthuset or /kultur
- Verify site-wide URL structure changes at halmstad.se
- Consider crawling halmstad.se root to discover venue-specific paths

---

### Source: push

| Field | Value |
|-------|-------|
| likelyCategory | events on subpages |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.82 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /kalender, /schema, /evenemang, /kalendarium, /aktiviteter |

**humanLikeDiscoveryReasoning:**
push.se homepage contains 17 event-indicating candidate paths in c0LinksFound with varying confidence scores. Top candidates: /events (10), /program (9), /kalender (8), /schema (7). The homepage shows no events (c1TimeTagCount=0, c1DateCount=0) but has strong navigation structure suggesting events are on dedicated subpages. Human-like reasoning: Swedish sites typically host events on /events, /program, or /kalender subpages rather than homepage. Retry with top 3 paths should yield event discovery.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/schema`
- appliesTo: Swedish cultural/municipal/event sites with root pages lacking event content
- confidence: 0.82

**discoveredPaths:**
- /events [derived] anchor="derived-rule" conf=0.85
- /program [derived] anchor="derived-rule" conf=0.80
- /kalender [derived] anchor="derived-rule" conf=0.75

**improvementSignals:**
- 17 event-indicating links found in c0LinksFound: /events, /program, /kalender, /schema, /evenemang, /kalendarium, /aktiviteter, /kultur, /fritid, /matcher, /biljetter
- c1Verdict=weak with 0 timeTags indicates homepage lacks event content but subpages likely have it
- c2Score=3 with 'event-heading' page mention suggests content structure exists elsewhere

**suggestedRules:**
- Root pages of Swedish sites often lack events - probe /events and /program first
- High link density with event keywords indicates active event calendar
- Priority order: /events > /program > /kalender for Swedish cultural sites

---

### Source: summerburst

| Field | Value |
|-------|-------|
| likelyCategory | server down or blocking |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.85 |
| nextQueue | manual-review |
| discoveryAttempted | false |
| discoveryPathsTried | https://summerburst.se/ |

**humanLikeDiscoveryReasoning:**
Connection refused prevents any HTML retrieval and link analysis. Cannot perform human-like discovery because the server is unreachable. ECONNREFUSED on port 443 indicates either server down or network-level blocking.

**discoveredPaths:**
(none)

**improvementSignals:**
- Connection refused on 172.105.93.38:443 - server may be down temporarily
- c0LinksFound empty - cannot analyze alternative paths
- ECONNREFUSED suggests either server offline, IP blocked, or firewall blocking crawler IPs

**suggestedRules:**
- Add retry-after delay for ECONNREFUSED errors
- Check if summerburst.se has changed hosting provider
- Verify crawler IP is not blocked by their infrastructure

---

### Source: uppsala-universitet

| Field | Value |
|-------|-------|
| likelyCategory | event URL moved |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.82 |
| nextQueue | manual-review |
| discoveryAttempted | false |
| discoveryPathsTried | https://uu.se/evenemang |

**humanLikeDiscoveryReasoning:**
/evenemang URL returns 404 - the expected Swedish event path does not exist. No c0LinksFound available to analyze alternative paths. University sites frequently restructure their event portals. Manual review needed to discover correct current URL structure.

**discoveredPaths:**
(none)

**improvementSignals:**
- Target URL /evenemang returns HTTP 404
- uu.se may use different URL structure: /aktuellt, /kalender, /nyheter, or /events
- University sites often restructure event portals without redirects

**suggestedRules:**
- Crawl uu.se root to discover current event page URL
- Check for /kalender, /aktuellt, /nyheter, or /events paths
- University sites may require alternative discovery strategies

---
