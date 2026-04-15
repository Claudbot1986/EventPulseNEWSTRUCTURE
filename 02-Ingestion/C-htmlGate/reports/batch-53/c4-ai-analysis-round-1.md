## C4-AI Analysis Round 1 (batch-53)

**Timestamp:** 2026-04-15T02:45:03.750Z
**Sources analyzed:** 7

### Overall Pattern
Top failure categories: 3× DNS resolution failure - domain unreachable, 2× URL path does not exist (404), 1× Events exist but extraction scoring too low

---

### Source: uppsala-linn-science-park

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure - domain unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Cannot perform human-like discovery because linne.uu.se DNS resolution fails entirely. No HTML content available to analyze navigation links. This is a terminal network failure, not a content discovery issue.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND: hostname linne.uu.se does not resolve
- No c0LinksFound to analyze - page unreachable at network level
- Need to verify correct domain for Uppsala Linné Science Park

**suggestedRules:**
- Add DNS/connectivity verification step before entering C0-C3 pipeline
- Source may have an alternate domain like uu.se or another variant

---

### Source: karlstad-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | URL path does not exist (404) |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.85 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | /konserthus |

**humanLikeDiscoveryReasoning:**
The provided URL https://karlstad.se/konserthus returns 404 Not Found. Without access to the page content, no navigation analysis can be performed. Human-like discovery would require knowing the correct URL path which would need external verification.

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on /karlstad/konserthus path
- No c0LinksFound - 404 page yielded no event links
- Correct path may be /konserthuset, /konserthus-och-kongresshus, or a subdomain

**suggestedRules:**
- Verify correct URL structure for Karlstad Concert Hall via external search
- Karlstad municipal sites often use /evenemang or /konserthuset for venues

---

### Source: karlstad-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | URL path does not exist (404) |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.85 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | /stadsteatern |

**humanLikeDiscoveryReasoning:**
The provided URL https://karlstad.se/stadsteatern returns 404 Not Found. Without HTML content available, cannot perform navigation analysis. Correct URL structure unknown without external verification.

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on /karlstad/stadsteatern path
- No c0LinksFound - 404 page yielded no event links
- Correct path may be /stadsteatern-karlstad, /teater, or venue-specific subsection

**suggestedRules:**
- Verify correct URL structure for Karlstad City Theater via external search
- Municipal theater venues often located at /teater, /scen, or similar paths

---

### Source: stockholms-universitet

| Field | Value |
|-------|-------|
| likelyCategory | Events exist but extraction scoring too low |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /kalender, /evenemang |

**humanLikeDiscoveryReasoning:**
Entry page su.se/evenemang returned low score (1) despite event-heading signals. C0 winnerUrl points to /kalender as alternative event listing. Retry with direct /kalender path recommended since this is Stockholm University's official calendar system.

**candidateRuleForC0C3:**
- pathPattern: `/kalender|/evenemang`
- appliesTo: Swedish university and academic institution event pages
- confidence: 0.78

**discoveredPaths:**
- /kalender [derived] anchor="su.se/kalender" conf=0.82
- /evenemang [derived] anchor="evenemang" conf=0.70

**improvementSignals:**
- C0 found 2 candidates with winner /kalender at su.se
- C1 noise verdict despite event-heading signal in page
- C2 score 1 too low - JSON-LD breadth check insufficient
- Zero timeTags and zero dateCounts suggests date extraction fails

**suggestedRules:**
- Swedish university calendar pages scoring low should try /kalender directly
- Date extraction on academic sites may require Swedish month name patterns

---

### Source: orebro-festival

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure - domain unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Cannot perform human-like discovery because orebrofestivalen.se DNS resolution fails entirely. No HTML content to analyze. This is a terminal network failure requiring external verification of the festival's current web presence.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND: hostname orebrofestivalen.se does not resolve
- No c0LinksFound - page completely unreachable
- Festival may have moved, be seasonal, or use different domain

**suggestedRules:**
- Add DNS pre-check before attempting event discovery
- Seasonal festivals may have inactive domains during off-season

---

### Source: helsingborg-arena

| Field | Value |
|-------|-------|
| likelyCategory | Connection timeout - server unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Connection timeout prevents any HTML retrieval. Without content, cannot analyze navigation structure. Server may be down, firewalled, or require different access method (HTTPS vs HTTP).

**discoveredPaths:**
(none)

**improvementSignals:**
- Connection timeout of 20000ms exceeded
- Server at helsingborgarena.se unresponsive
- No c0LinksFound - network-level failure

**suggestedRules:**
- Add connection timeout handling with shorter initial timeout
- Site may be temporarily down or require different access method

---

### Source: stockholm-jazz-festival

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure - domain unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS failure on stojazz.se prevents any content analysis. Human-like discovery cannot proceed without reachable content. SourceId and URL suggest domain name mismatch may be the root cause.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND: hostname stojazz.se does not resolve
- c0LinksFound empty due to complete network failure
- Note: sourceId 'stockholm-jazz-festival' but URL uses 'stojazz.se' - possible domain mismatch

**suggestedRules:**
- Verify correct domain - Stockholm Jazz Festival may use stockholmjazz.se or stockholmjazzfestival.se
- Add domain pattern matching for Swedish festival sources

---
