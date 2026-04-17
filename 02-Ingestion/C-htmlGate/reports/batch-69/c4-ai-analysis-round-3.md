## C4-AI Analysis Round 3 (batch-69)

**Timestamp:** 2026-04-16T20:50:16.803Z
**Sources analyzed:** 4

### Overall Pattern
Top failure categories: 3× DNS resolution failure, 1× Rate limited with event links present

---

### Source: ruddalen

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Domain ruddalen.se returned ENOTFOUND error during DNS resolution. No HTML content was retrieved, so no link analysis was possible. This is a terminal infrastructure failure, not a discovery failure.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain ruddalen.se cannot be resolved - ENOTFOUND
- Verify if domain name is correct or if site has migrated
- Check if site requires www prefix

**suggestedRules:**
- Check domain DNS resolution before attempting network fetch

---

### Source: slottsskogen

| Field | Value |
|-------|-------|
| likelyCategory | Rate limited with event links present |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /, /events, /program, /kalender, /schema, /evenemang, /kalendarium, /aktiviteter, /utstallningar, /exhibition, /exhibitions |

**humanLikeDiscoveryReasoning:**
Site slottsskogen.se exists (received HTTP 429, not DNS error). C0 analysis found 15+ event-indicating link candidates in derived rules region, with /events (score 10), /program (score 9), /kalender (score 8) being top candidates. These are standard Swedish event paths. HTTP 429 indicates temporary rate limiting rather than permanent unavailability. Site should be retried with backoff.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/schema|/evenemang`
- appliesTo: Swedish park, zoo, and cultural institutions with event listings
- confidence: 0.82

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.85
- /program [nav-link] anchor="derived-rule" conf=0.80
- /kalender [nav-link] anchor="derived-rule" conf=0.75
- /schema [nav-link] anchor="derived-rule" conf=0.70
- /evenemang [nav-link] anchor="derived-rule" conf=0.70
- /kalendarium [nav-link] anchor="derived-rule" conf=0.65

**improvementSignals:**
- HTTP 429 indicates rate limiting - site exists but blocked temporarily
- 15+ event-indicating links found in nav region
- c1LikelyJsRendered=false but c1TimeTagCount=0 suggests content not fetched

**suggestedRules:**
- Implement retry-backoff for sites returning 429
- The /events, /kalender, /program paths are high-confidence candidates to try first

---

### Source: svenska-innebandyf-rbundet

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Domain svenskaif.se returned ENOTFOUND error during DNS resolution. No HTML content was retrieved, so no link analysis was possible. This is a terminal infrastructure failure.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain svenskaif.se cannot be resolved - ENOTFOUND
- Verify correct domain (may be svenskainnebandy.se or similar)
- Check if organization website has changed

**suggestedRules:**
- Verify domain spelling - sourceId suggests 'svenska-innebandyforbundet' but domain is 'svenskaif.se'

---

### Source: teater-tribunalen

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Domain tribunalen.se returned ENOTFOUND error during DNS resolution. No HTML content was retrieved, so no link analysis was possible. This is a terminal infrastructure failure.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain tribunalen.se cannot be resolved - ENOTFOUND
- Verify if this theater organization exists and has correct domain
- May have moved to different domain or social media presence

**suggestedRules:**
- Check if theater has merged, renamed, or moved online
- Verify tribunalen.se vs other possible T variants

---
