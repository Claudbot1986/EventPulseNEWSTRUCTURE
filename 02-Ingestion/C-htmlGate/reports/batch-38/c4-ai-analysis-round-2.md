## C4-AI Analysis Round 2 (batch-38)

**Timestamp:** 2026-04-14T19:12:42.855Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 3× Domain does not exist, 1× URL path returns 404, 1× Server connection refused

---

### Source: h-gskolan-i-sk-vde

| Field | Value |
|-------|-------|
| likelyCategory | URL path returns 404 |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://his.se/evenemang |

**humanLikeDiscoveryReasoning:**
The specified path /evenemang returns 404. The root domain his.se may contain working event paths like /events, /kalender, or /evenemang. Should retry with root URL.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang|/kalender|/program`
- appliesTo: Swedish university and educational institution sites
- confidence: 0.65

**discoveredPaths:**
(none)

**improvementSignals:**
- root URL his.se may have event listing
- 404 on /evenemang suggests path change or typo

**suggestedRules:**
- Try /events or /evenemang on root domain
- Check for URL structure changes in Swedish university event sites

---

### Source: inkonst

| Field | Value |
|-------|-------|
| likelyCategory | Server connection refused |
| failCategory | robots_or_policy_blocked |
| failCategoryConfidence | 0.85 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Site completely unreachable - connection refused by server. No discovery possible until site is accessible.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- Server actively refused connection on port 443
- Site may be down, behind firewall, or blocking IP

**suggestedRules:**
- Verify server is running
- Check if IP is blocked by firewall

---

### Source: varbergs-if

| Field | Value |
|-------|-------|
| likelyCategory | Domain does not exist |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Domain varbergsif.se does not resolve. No paths can be discovered for non-existent domains.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution failed - domain not found
- Domain may have expired or been mistyped

**suggestedRules:**
- Verify domain spelling
- Check if organization has alternative domain

---

### Source: melodifestivalen-svt

| Field | Value |
|-------|-------|
| likelyCategory | SVT section page 404 |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://svt.se/melodifestivalen |

**humanLikeDiscoveryReasoning:**
The melodifestivalen section returned 404. SVT uses /program paths - should try svt.se/program/melodifestivalen or svt.se/kalender.

**candidateRuleForC0C3:**
- pathPattern: `/program|/kalender|/temasidor`
- appliesTo: Swedish public broadcaster (SVT) event sections
- confidence: 0.70

**discoveredPaths:**
(none)

**improvementSignals:**
- SVT Melodifestivalen page returns 404
- Try /program or /kalender on svt.se

**suggestedRules:**
- Try /program/kalender or /temasidor/melodifestivalen on SVT
- SVT often uses /program prefix for event listings

---

### Source: ifk-stockholm

| Field | Value |
|-------|-------|
| likelyCategory | Rate limited, links available |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /kalender, /schema, /evenemang |

**humanLikeDiscoveryReasoning:**
Multiple event-indicating paths discovered with strong derived rule scores. Site accessible but rate-limited. Retry paths in order of confidence score. Sports clubs typically use /events or /program for match schedules.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/schema|/evenemang`
- appliesTo: Swedish sports clubs and associations with event schedules
- confidence: 0.85

**discoveredPaths:**
- /events [derived] anchor="derived-rule" conf=0.85
- /program [derived] anchor="derived-rule" conf=0.82
- /kalender [derived] anchor="derived-rule" conf=0.78
- /schema [derived] anchor="derived-rule" conf=0.75
- /evenemang [derived] anchor="derived-rule" conf=0.70

**improvementSignals:**
- HTTP 429 rate limiting - site accessible but throttling
- Multiple high-scoring event paths discovered: /events, /program, /kalender, /schema, /evenemang

**suggestedRules:**
- Retry with exponential backoff
- Prioritize /events and /program paths from discovered candidates

---

### Source: hasselblad-center

| Field | Value |
|-------|-------|
| likelyCategory | Domain does not exist |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Domain hasselbladcenter.se does not resolve to any DNS record. No discovery possible.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain not registered or expired

**suggestedRules:**
- Verify domain spelling
- Try hasselbladcenter.com or similar domains

---

### Source: malmo-konstmuseum

| Field | Value |
|-------|-------|
| likelyCategory | IDN encoding mismatch |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.80 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Unicode URL with Swedish å ö failed punycode conversion. Should retry with properly encoded IDN or simplified ASCII domain.

**candidateRuleForC0C3:**
- pathPattern: `/events|/utstallningar|/program`
- appliesTo: Swedish art museums and cultural institutions
- confidence: 0.75

**discoveredPaths:**
(none)

**improvementSignals:**
- Unicode domain failed DNS as punycode xn--malmkonstmuseum-ctb.se
- Try with proper IDN encoding or alternative domain

**suggestedRules:**
- Use proper IDN encoding for Swedish characters
- Try malmokonstmuseum.se without diacritics

---

### Source: kungliga-musikhogskolan

| Field | Value |
|-------|-------|
| likelyCategory | Extraction failed despite rich content |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.92 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /konserter---evenemang.html |

**humanLikeDiscoveryReasoning:**
Page has 82 time tags and strong event signals (C2 score 421) but extraction returned 0 events. This indicates extraction pattern mismatch - the HTML structure differs from expected patterns. The extraction logic may be looking for specific class names or container patterns that don't match this site's implementation.

**candidateRuleForC0C3:**
- pathPattern: `/konserter|/evenemang`
- appliesTo: Swedish music conservatory and concert venue sites
- confidence: 0.80

**discoveredPaths:**
- /konserter---evenemang.html [derived] anchor="C0 winner URL" conf=0.95

**improvementSignals:**
- 82 time tags found - page has event content
- C2 score 421 indicates strong event signals
- 0 events extracted - extraction patterns don't match HTML structure

**suggestedRules:**
- Investigate why 82 time tags yield 0 events - check extraction selectors
- Likely cards or list items with time tags but no proper date/event container classes
- Review kmh.se/konserter---evenemang.html HTML structure for nested event patterns

---

### Source: dalarna

| Field | Value |
|-------|-------|
| likelyCategory | SSL/TLS protocol error |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://dalarna.se/ |

**humanLikeDiscoveryReasoning:**
SSL/TLS handshake failed with unrecognized name alert. This often indicates SNI mismatch or certificate misconfiguration. Try HTTP or alternate subdomains.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang|/aktiviteter|/uppleva`
- appliesTo: Swedish regional tourism/municipal sites
- confidence: 0.70

**discoveredPaths:**
(none)

**improvementSignals:**
- TLS alert 112 indicates certificate/SNI issue
- Could try HTTP instead of HTTPS, or different SSL configuration

**suggestedRules:**
- Try HTTP (non-SSL) connection
- Check for www subdomain or alternate hostnames

---

### Source: din-gastrotek

| Field | Value |
|-------|-------|
| likelyCategory | Domain does not exist |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Domain gastrotek.se does not exist in DNS. Cannot perform any discovery.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - gastrotek.se not registered

**suggestedRules:**
- Verify if domain was registered differently
- Check if site moved to different domain

---
