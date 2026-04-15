## C4-AI Analysis Round 3 (batch-35)

**Timestamp:** 2026-04-14T19:02:48.289Z
**Sources analyzed:** 5

### Overall Pattern
Top failure categories: 2× dns_not_found, 1× fetch_failed_unknown, 1× events_behind_subpages

---

### Source: blekholmen

| Field | Value |
|-------|-------|
| likelyCategory | fetch_failed_unknown |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
No c0LinksFound entries present. Unable to extract event-indicating navigation links. Fetch failure (unknown) prevents human-like discovery. Recommend retry with extended timeout as failure may be transient.

**discoveredPaths:**
(none)

**improvementSignals:**
- C2 fetchHtml failed with 'unknown' - indicates transient fetch error
- c0LinksFound empty - no navigation structure retrieved
- consecutiveFailures=2 suggests persistent issue

**suggestedRules:**
- Add retry logic with backoff for sources with 'unknown' fetch failures
- Investigate whether blekholmen.se requires specific user-agent or headers

---

### Source: boplanet

| Field | Value |
|-------|-------|
| likelyCategory | dns_not_found |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.60 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS resolution failed for boplanet.se. No c0LinksFound entries to analyze. Domain appears inactive or misconfigured. Retry-pool allows potential DNS cache refresh.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND - DNS resolution failed completely
- Domain boplanet.se does not exist or is not configured
- c0LinksFound empty - cannot determine event paths

**suggestedRules:**
- Flag ENOTFOUND sources for domain verification before retry
- Consider alternate domain variants: boplanet.se might redirect to another domain

---

### Source: bor-s-zoo-animagic

| Field | Value |
|-------|-------|
| likelyCategory | events_behind_subpages |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.92 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /kalender, /schema, /evenemang |

**humanLikeDiscoveryReasoning:**
Animagic is a zoo/animation festival site. Despite HTTP 429 blocking initial fetch, C0 successfully extracted 16 navigation links. Top scoring paths /events, /program, /kalender strongly indicate event content exists behind these routes. Swedish cultural sites typically structure events under /evenemang or /kalender. Recommend retry with rate-limit backoff to reach these subpages.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/schema|/evenemang|/kalendarium`
- appliesTo: Swedish cultural venues, zoos, festivals with event programming
- confidence: 0.85

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.92
- /program [nav-link] anchor="derived-rule" conf=0.88
- /kalender [nav-link] anchor="derived-rule" conf=0.82
- /schema [nav-link] anchor="derived-rule" conf=0.75
- /evenemang [nav-link] anchor="derived-rule" conf=0.78

**improvementSignals:**
- HTTP 429 rate limit - temporary block, site is reachable
- 16 event-indicating links found in c0LinksFound with strong scores
- Top candidates: /events (10), /program (9), /kalender (8), /schema (7)

**suggestedRules:**
- Prioritize paths with anchor text matching Swedish event vocabulary: evenemang, kalender, program, schema
- Implement rate-limit detection: HTTP 429 should trigger exponential backoff retry
- Create domain-specific path rules for .se cultural/zoo sites

---

### Source: botaniska-tradgarden

| Field | Value |
|-------|-------|
| likelyCategory | ssl_mismatch_site_move |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.65 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
SSL certificate mismatch indicates botaniska.se is served through vgregion.se infrastructure. The site is likely operational but requires SSL verification adjustment or alternate URL. Cannot extract navigation links due to fetch failure. Retry-pool with SSL verification disabled may reveal event paths.

**discoveredPaths:**
(none)

**improvementSignals:**
- SSL certificate mismatch: botaniska.se resolves to vgregion.se infrastructure
- Site may have migrated to regional government domain
- c0LinksFound empty - certificate issue prevented HTML retrieval

**suggestedRules:**
- Add SSL verification bypass for known Swedish municipal domains with proper certificate chains
- Investigate whether botaniska.se should resolve to www.vgregion.se/botaniska or similar
- Flag certificate mismatch for manual domain verification

---

### Source: brommapojkarna

| Field | Value |
|-------|-------|
| likelyCategory | dns_not_found |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.55 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS resolution failed for bpxf.se with only 1 consecutive failure. Domain may be temporarily unavailable or misconfigured. With limited failure history, retry-pool is appropriate before escalating to manual-review. No c0LinksFound to analyze event paths.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND - bpxf.se domain not found
- consecutiveFailures=1 - only one failure recorded
- c0LinksFound empty - no navigation structure retrieved

**suggestedRules:**
- Verify domain bpxf.se is correct for brommapojkarna organization
- Consider alternate domains: brommapojkarna.se, bp.se, or similar
- DNS failures with 1 consecutive failure should retry before manual-review

---
