## C4-AI Analysis Round 2 (batch-45)

**Timestamp:** 2026-04-15T02:46:30.963Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 3× DNS resolution failure, 2× Wrong entry path - 404, 2× Low score on calendar page

---

### Source: uppsala-konserthus-1

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Network failure (ENOTFOUND) prevents any page analysis. Cannot perform human-like discovery until network connectivity is restored.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND suggests temporary network issue or domain transfer pending
- Verify domain still active via WHOIS

**suggestedRules:**
- For DNS failures: retry 3x with exponential backoff before marking permanent

---

### Source: lulea-hf

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Network failure (ENOTFOUND) prevents any page analysis. Cannot perform human-like discovery until network connectivity is restored.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND suggests temporary network issue or domain may have changed
- Check if domain expired or transferred

**suggestedRules:**
- For DNS failures: retry 3x with exponential backoff before marking permanent

---

### Source: sydsvenskan

| Field | Value |
|-------|-------|
| likelyCategory | Wrong entry path - 404 |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | false |
| discoveryPathsTried | /evenemang |

**humanLikeDiscoveryReasoning:**
The 404 error on /evenemang indicates the URL path is wrong. Should attempt root domain (sydsvenskan.se/) as fallback, then try common event paths like /kalender, /program, /nyheter/kalender.

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on /evenemang - path may have changed
- Should try root domain as fallback

**suggestedRules:**
- For 404 errors: try root domain path as fallback before marking failure

---

### Source: vasteras-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | Wrong entry path - 404 |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | false |
| discoveryPathsTried | /konserthus |

**humanLikeDiscoveryReasoning:**
The 404 error on /konserthus indicates the URL path is wrong or site structure changed. Should attempt root domain (vasteras.se/) as fallback, then try common Swedish cultural event paths like /konserthus/kalender, /evenemang, /konserter.

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on /konserthus - path may have changed
- Should try root domain as fallback

**suggestedRules:**
- For 404 errors: try root domain path as fallback before marking failure

---

### Source: vasamuseet

| Field | Value |
|-------|-------|
| likelyCategory | Candidate links found but score too low |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /kalender, /program, /events |

**humanLikeDiscoveryReasoning:**
Vasamuseet has high-confidence event paths (/events, /program, /kalender) that were derived by rules but the actual pages weren't fetched. The C2 score of 9 was from a price-marker page, not the event listing. Should retry with these specific paths.

**candidateRuleForC0C3:**
- pathPattern: `/kalender|/program|/events`
- appliesTo: Swedish museum and cultural institution websites
- confidence: 0.82

**discoveredPaths:**
- /kalender [derived] anchor="derived-rule" conf=0.85
- /program [derived] anchor="derived-rule" conf=0.80
- /events [derived] anchor="derived-rule" conf=0.75

**improvementSignals:**
- C0 found 3 event-indicating paths with high scores (10, 9, 8)
- C2 score was 9 - need deeper page analysis to confirm events exist

**suggestedRules:**
- For sites with high-scoring event path candidates: retry with path substitution to find actual event listing

---

### Source: uppsala-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Network failure (ENOTFOUND) prevents any page analysis. Cannot perform human-like discovery until network connectivity is restored.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND suggests temporary network issue or domain transfer pending
- Verify domain still active via WHOIS

**suggestedRules:**
- For DNS failures: retry 3x with exponential backoff before marking permanent

---

### Source: vasteras-stad

| Field | Value |
|-------|-------|
| likelyCategory | Low score on calendar page |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /kalender.html |

**humanLikeDiscoveryReasoning:**
Vasteras Stad had C0 candidate /kalender.html with score 1. The C2 score of 3 from event-heading page was too low. Should try fetching /kalender without .html extension, or explore root domain for better event section.

**candidateRuleForC0C3:**
- pathPattern: `/kalender|/evenemang|/program`
- appliesTo: Swedish municipal government websites
- confidence: 0.75

**discoveredPaths:**
- /kalender.html [derived] anchor="derived-rule" conf=0.60

**improvementSignals:**
- C0 found /kalender.html with score 1
- C2 score was 3 - need deeper page analysis
- Root domain might have better event landing page

**suggestedRules:**
- For municipal sites with low-score event paths: try root domain event sections or /kalender without .html

---

### Source: nationalmuseum

| Field | Value |
|-------|-------|
| likelyCategory | Low score on calendar page |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /kalendarium |

**humanLikeDiscoveryReasoning:**
Nationalmuseum had C0 candidate /kalendarium but score was 4 from venue-marker page. Swedish museums often use 'kalendarium' as their event listing. Should retry with this path and apply museum-specific scoring.

**candidateRuleForC0C3:**
- pathPattern: `/kalendarium|/utstallningar|/program`
- appliesTo: Swedish museum and gallery websites
- confidence: 0.78

**discoveredPaths:**
- /kalendarium [derived] anchor="derived-rule" conf=0.70

**improvementSignals:**
- C0 found /kalendarium with high score
- C2 score was 4 - might need different page structure detection
- Museum likely has extensive event program

**suggestedRules:**
- For museum sites with low-score event paths: use museum-specific scoring adjustments

---

### Source: malmo-hogskola

| Field | Value |
|-------|-------|
| likelyCategory | Many candidate paths but no main content |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.80 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /kalender, /schema, /evenemang, /kalendarium, /aktiviteter, /kultur, /fritid, /matcher, /biljetter |

**humanLikeDiscoveryReasoning:**
Malmo Hogskola had 12 candidate event paths but no main content on root page. The /schema path is particularly relevant for Swedish universities as it typically contains scheduled events, lectures, and public programs. Should prioritize /schema and /events paths.

**candidateRuleForC0C3:**
- pathPattern: `/schema|/events|/program`
- appliesTo: Swedish university and higher education websites
- confidence: 0.82

**discoveredPaths:**
- /events [derived] anchor="derived-rule" conf=0.85
- /schema [derived] anchor="derived-rule" conf=0.80
- /program [derived] anchor="derived-rule" conf=0.75
- /kalender [derived] anchor="derived-rule" conf=0.70

**improvementSignals:**
- C0 found 12 event-indicating paths including /events, /program, /kalender, /schema
- C1 verdict was no-main - root page lacks main event content
- Educational site likely has dedicated event section

**suggestedRules:**
- For educational sites: try /events or /schema paths which are common for university event listings

---

### Source: sparvag-city

| Field | Value |
|-------|-------|
| likelyCategory | School program path may be wrong target |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.65 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /skolor/skolprogram/ |

**humanLikeDiscoveryReasoning:**
Sparvagsmuseet (tramway museum) winner URL is /skolor/skolprogram/ which targets school groups, not general public events. Should retry with root domain to find visitor event sections, or try /evenemang, /biljetter paths for public events.

**candidateRuleForC0C3:**
- pathPattern: `/|/evenemang|/biljetter`
- appliesTo: Swedish museum and attraction websites with school programs
- confidence: 0.60

**discoveredPaths:**
- /skolor/skolprogram/ [derived] anchor="derived-rule" conf=0.50
- / [derived] anchor="root domain" conf=0.55

**improvementSignals:**
- Winner URL is /skolor/skolprogram/ which is a school program, not general events
- C2 score was 4 from event-heading page
- Tramway museum may have separate visitor event section

**suggestedRules:**
- For museum sites: check if root has visitor events separate from school programs

---
