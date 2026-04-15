## C4-AI Analysis Round 2 (batch-41)

**Timestamp:** 2026-04-15T01:53:17.824Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 4× Domain not found, 2× Connection timeout, 1× Homepage lacks events, nav paths available

---

### Source: kb18

| Field | Value |
|-------|-------|
| likelyCategory | Homepage lacks events, nav paths available |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.82 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | network |

**humanLikeDiscoveryReasoning:**
c0LinksFound contains 17 candidates with Swedish event paths (score 10 down to -6). The positive-scoring paths (/events, /program, /kalender, /schema, /evenemang) indicate the site has a working event system but homepage lacks events. The c2 score=4 suggests HTML structure exists but scoring threshold not met. Recommendation: retry with direct paths like /events

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/schema|/evenemang`
- appliesTo: Swedish cultural venues and municipal sites
- confidence: 0.80

**discoveredPaths:**
- /events [derived] anchor="derived-rule" conf=0.85
- /program [derived] anchor="derived-rule" conf=0.80
- /kalender [derived] anchor="derived-rule" conf=0.75

**improvementSignals:**
- c0LinksFound contains 17 Swedish event-path candidates with positive scores
- c2Score=4 indicates page may be pre-render state with event links in nav
- Should test high-scoring paths /events, /program, /kalender

**suggestedRules:**
- For Swedish cultural/municipal sites: check /events, /program, /kalender paths from derived-rules
- Add Swedish language event anchors (evenemang, kalender, program, schema) to c0 candidates scoring

---

### Source: folkteatern

| Field | Value |
|-------|-------|
| likelyCategory | Subpage path found but screening failed |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events |

**humanLikeDiscoveryReasoning:**
C0 found 10 candidates with /events as winner URL (folkteatern.se/events). C2 screening failed with score=5. The events page exists but scoring mechanism may need venue-specific calibration. Retry with JS-render fallback option.

**candidateRuleForC0C3:**
- pathPattern: `/events`
- appliesTo: Theater and performing arts venues
- confidence: 0.82

**discoveredPaths:**
- /events [derived] anchor="derived-rule" conf=0.88

**improvementSignals:**
- c0WinnerUrl=https://folkteatern.se/events was identified but C2 screening failed with score=5
- c2Score=5 too low - may need JS render check or pattern adjustment for venue pages
- Consider lowering C2 threshold for known-venue event pages

**suggestedRules:**
- For performing arts venues: events page may have lower JSON-LD but higher venue-structured markup
- Consider venue-specific C2 scoring adjustments

---

### Source: rumble

| Field | Value |
|-------|-------|
| likelyCategory | Domain resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Domain rumblematch.se cannot be resolved via DNS. No paths to try. Recommendation: manual verification of domain status.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain rumblematch.se does not exist or is not registered
- All stages failed with fetchHtml error
- Consider verifying URL or removing from active sources

**suggestedRules:**
- Verify domain exists via WHOIS or manual check before retrying
- Remove from active pool if domain confirmed inactive

---

### Source: polismuseum

| Field | Value |
|-------|-------|
| likelyCategory | Connection timeout |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Domain polismuseum.se exists (DNS resolves) but server fails to respond within timeout. No event paths discovered. Manual review needed to determine if site is operational.

**discoveredPaths:**
(none)

**improvementSignals:**
- Connection timeout after 20000ms - server reachable but not responding
- Could be geographic blocking, server overload, or aggressive bot protection
- All stages failed consistently

**suggestedRules:**
- Add timeout threshold adjustment for slow-responding museums/institutions
- Consider alternative network paths or geographic routing

---

### Source: we-are-sarajevo

| Field | Value |
|-------|-------|
| likelyCategory | Domain not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Domain wearesarajevo.se fails DNS resolution. No path discovery possible. Manual check required to verify domain status.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain wearesarajevo.se cannot be resolved
- Could be domain expired or typo in source configuration

**suggestedRules:**
- Verify correct domain or check for URL typos
- Manual verification required

---

### Source: uppsala-domkyrka

| Field | Value |
|-------|-------|
| likelyCategory | Connection timeout |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Domain uppsaladomkyrka.se resolves DNS but times out on connection. No paths available for discovery. Manual review recommended.

**discoveredPaths:**
(none)

**improvementSignals:**
- Timeout after 20000ms - server overload or blocking
- Institution/church sites may have aggressive protection

**suggestedRules:**
- Add institutional sites to slower timeout pool
- Consider geographic routing adjustments

---

### Source: goteborgsoperan

| Field | Value |
|-------|-------|
| likelyCategory | Redirect loop detected |
| failCategory | robots_or_policy_blocked |
| failCategoryConfidence | 0.75 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://www.opera.se/goteborg |

**humanLikeDiscoveryReasoning:**
Redirect loop between opera.se/goteborg and www.opera.se/goteborg prevents any page from loading. The loop is enforced by the server. Manual review needed to determine correct canonical URL.

**discoveredPaths:**
(none)

**improvementSignals:**
- Redirect loop between opera.se/goteborg and www.opera.se/goteborg
- May indicate misconfigured domain routing or intentional blocking
- Could try www.opera.se directly or check for disambiguation

**suggestedRules:**
- Add redirect-loop detection handling - try both www and non-www variants
- Check canonical URLs for opera.se domain

---

### Source: linkoping-city

| Field | Value |
|-------|-------|
| likelyCategory | Domain not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Domain linkopingcity.se cannot be resolved. No paths available. Manual verification needed.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - linkopingcity.se does not exist
- Possibly typo or expired domain

**suggestedRules:**
- Verify domain spelling and registration
- Manual check required

---

### Source: skovde-if

| Field | Value |
|-------|-------|
| likelyCategory | Domain not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Domain skovdeif.se fails DNS resolution. Sports club may have moved to new domain. Manual check needed.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - skovdeif.se does not exist
- Sports club site may have moved to different domain

**suggestedRules:**
- Search for alternative domains or social media
- Manual verification required

---

### Source: gamla-uppsala

| Field | Value |
|-------|-------|
| likelyCategory | Domain not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Domain gamlauppsala.se fails DNS resolution. Historical museum site may have moved. Manual verification needed.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - gamlauppsala.se cannot be resolved
- Historical site may have changed domain

**suggestedRules:**
- Check alternative domains or social media presence
- Manual verification required

---
