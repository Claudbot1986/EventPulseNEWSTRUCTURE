## C4-AI Analysis Round 2 (batch-59)

**Timestamp:** 2026-04-15T18:55:48.579Z
**Sources analyzed:** 7

### Overall Pattern
Top failure categories: 4× DNS domain not found, 1× 404 page not found, 1× 400 bad request

---

### Source: malm-universitet

| Field | Value |
|-------|-------|
| likelyCategory | 404 page not found |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /evenemang |

**humanLikeDiscoveryReasoning:**
HTTP 404 on /evenemang suggests page moved. No links found to retry. Should attempt root domain or common Swedish university event paths like /kalender, /schema, /program.

**candidateRuleForC0C3:**
- pathPattern: `/kalender|/schema|/program|/aktuellt`
- appliesTo: Swedish university and academic institution sites
- confidence: 0.65

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 indicates the /evenemang path may have moved or been deprecated
- Root domain mau.se may have restructured their event section

**suggestedRules:**
- Try root domain https://mau.se/ as fallback entry point
- Check if university rebranded event URLs to /kalender or /schema

---

### Source: form-design-museum

| Field | Value |
|-------|-------|
| likelyCategory | 400 bad request |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | / |

**humanLikeDiscoveryReasoning:**
HTTP 400 on root page indicates URL may be malformed or site requires specific routing. No event paths discovered. Should try HTTP/HTTPS variants and www prefix.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/utställningar|/program`
- appliesTo: Swedish museum and cultural institution sites
- confidence: 0.60

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 400 suggests possible HTTPS/HTTP redirect issue or malformed URL
- Root page returned error before event discovery could occur

**suggestedRules:**
- Try HTTP variant if currently on HTTPS
- Check if site requires www prefix: www.formdesigncenter.se

---

### Source: do310-com

| Field | Value |
|-------|-------|
| likelyCategory | DNS domain not found |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS failure is definitive - domain do310.com does not exist. No paths can be discovered without resolving the domain. This is a terminal failure requiring manual verification of the correct domain.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND indicates domain does not exist or is expired
- No retry will succeed without valid domain

**suggestedRules:**
- Verify domain spelling - do310.com may have been do310.se or similar
- Check if site rebranded to different domain

---

### Source: slottsskogen

| Field | Value |
|-------|-------|
| likelyCategory | Rate limited 429 |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /kalender, /schema, /evenemang, /kalendarium |

**humanLikeDiscoveryReasoning:**
Rate limited (429) but strong event-indicating paths discovered. Multiple high-confidence Swedish event paths found: /events, /program, /kalender, /schema, /evenemang. Retry with backoff should succeed. This is a temporary failure, not a dead source.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/schema|/evenemang|/kalendarium`
- appliesTo: Swedish park, zoo, and outdoor venue sites with event programs
- confidence: 0.88

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.90
- /program [nav-link] anchor="derived-rule" conf=0.85
- /kalender [nav-link] anchor="derived-rule" conf=0.82
- /schema [nav-link] anchor="derived-rule" conf=0.78
- /evenemang [nav-link] anchor="derived-rule" conf=0.75
- /kalendarium [nav-link] anchor="derived-rule" conf=0.70

**improvementSignals:**
- HTTP 429 indicates rate limiting - retry after delay may succeed
- Strong event-indicating link candidates found in c0LinksFound

**suggestedRules:**
- Retry with exponential backoff
- Prioritize high-scoring paths: /events (10), /program (9), /kalender (8)

---

### Source: spanga-is

| Field | Value |
|-------|-------|
| likelyCategory | DNS domain not found |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS failure is definitive - domain spanga.se does not exist. No paths can be discovered without resolving the domain. This is a terminal failure requiring manual verification of the correct domain.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND indicates domain does not exist or is expired
- No retry will succeed without valid domain

**suggestedRules:**
- Verify domain spelling - spanga.se may be correct form
- Check if site moved to different TLD or subdomain

---

### Source: din-gastrotek

| Field | Value |
|-------|-------|
| likelyCategory | DNS domain not found |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS failure is definitive - domain gastrotek.se does not exist. No paths can be discovered without resolving the domain. This is a terminal failure requiring manual verification of the correct domain.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND indicates domain does not exist or is expired
- No retry will succeed without valid domain

**suggestedRules:**
- Verify domain spelling - gastrotek.se may be incorrect
- Check if site is now part of larger food/dining portal

---

### Source: downtown

| Field | Value |
|-------|-------|
| likelyCategory | DNS domain not found |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS failure is definitive - domain downtown.se does not exist. No paths can be discovered without resolving the domain. This is a terminal failure requiring manual verification of the correct domain.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND indicates domain does not exist or is expired
- No retry will succeed without valid domain

**suggestedRules:**
- Verify domain spelling - downtown.se may be incorrect
- Check if site rebranded to downtowngothenburg.com or similar

---
