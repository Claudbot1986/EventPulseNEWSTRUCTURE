## C4-AI Analysis Round 2 (batch-17)

**Timestamp:** 2026-04-12T17:45:20.452Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 2× Domain not found, 1× Extraction pattern mismatch, 1× Client-side rendering suspected

---

### Source: borlange-kommun

| Field | Value |
|-------|-------|
| likelyCategory | Extraction pattern mismatch |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.85
- /program [nav-link] anchor="derived-rule" conf=0.80
- /kalender [nav-link] anchor="derived-rule" conf=0.75
- /schema [nav-link] anchor="derived-rule" conf=0.70
- /evenemang [nav-link] anchor="derived-rule" conf=0.90

**improvementSignals:**
- C2 found 12 card candidates but C3 extracted 0 events
- Strong time-tag presence (18) and date presence (20) indicates content exists
- c0LinksFound shows multiple event paths discovered

**suggestedRules:**
- Investigate why card extraction fails despite medium-confidence card candidates
- Check if event cards use non-standard HTML structure (custom data attributes, shadow DOM)
- Consider broader selector patterns for municipal event sites

---

### Source: oland

| Field | Value |
|-------|-------|
| likelyCategory | Client-side rendering suspected |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.68 |
| nextQueue | D |
| directRouting | D (conf=0.72) |

**discoveredPaths:**
(none)

**improvementSignals:**
- 0 timeTags but 9 date counts suggests dates rendered via JS
- c1Verdict weak with no time tag presence
- C2 score barely meets threshold (12)

**suggestedRules:**
- Route to D (JS render fallback) to capture client-side rendered dates
- Check if calendar widget loads events dynamically
- Consider waiting for dynamic content in extraction

---

### Source: bk-hacken

| Field | Value |
|-------|-------|
| likelyCategory | Network timeout |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.55 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- fetchHtml timeout of 20000ms exceeded
- c1Verdict unfetchable
- No evidence of event content or structure

**suggestedRules:**
- Retry with extended timeout or retry-pool strategy
- Verify site accessibility before next attempt

---

### Source: blekholmen

| Field | Value |
|-------|-------|
| likelyCategory | Unknown fetch error |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.50 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- fetchHtml failed with unknown error
- c1Verdict unfetchable
- No content evidence available

**suggestedRules:**
- Retry fetch to determine if error is transient
- Investigate unknown error source

---

### Source: boplanet

| Field | Value |
|-------|-------|
| likelyCategory | Domain not found |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.85 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND boplanet.se - DNS resolution failed
- Domain appears to not exist
- No event content possible without site accessibility

**suggestedRules:**
- Verify correct domain name for BoPlanet
- Mark as low-value if domain is defunct or renamed

---

### Source: bor-s-zoo-animagic

| Field | Value |
|-------|-------|
| likelyCategory | Rate limited |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.60 |
| nextQueue | retry-pool |

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.85
- /program [nav-link] anchor="derived-rule" conf=0.80
- /kalender [nav-link] anchor="derived-rule" conf=0.75
- /schema [nav-link] anchor="derived-rule" conf=0.70
- /evenemang [nav-link] anchor="derived-rule" conf=0.85
- /kalendarium [nav-link] anchor="derived-rule" conf=0.70
- /aktiviteter [nav-link] anchor="derived-rule" conf=0.60
- /kultur [nav-link] anchor="derived-rule" conf=0.55
- /fritid [nav-link] anchor="derived-rule" conf=0.50
- /matcher [nav-link] anchor="derived-rule" conf=0.50
- /biljetter [nav-link] anchor="derived-rule" conf=0.45

**improvementSignals:**
- HTTP 429 rate limit response
- c0LinksFound shows multiple event path candidates
- Site has navigation structure for events

**suggestedRules:**
- Add to retry-pool with rate limit handling
- Implement backoff strategy for subsequent attempts
- Use discovered paths (/events, /program, /kalender) in retry

---

### Source: botaniska-tradgarden

| Field | Value |
|-------|-------|
| likelyCategory | SSL cert domain mismatch |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- SSL certificate mismatch: botaniska.se not in vgregion.se cert
- Hostname redirect to parent domain vgregion.se
- Site is subdomain of larger entity

**suggestedRules:**
- Update entry URL to use vgregion.se domain
- Investigate if botaniska.se is alias for vgregion.se/botaniska
- Add domain alias mapping for Västra Götaland region sites

---

### Source: brommapojkarna

| Field | Value |
|-------|-------|
| likelyCategory | Domain not found |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.85 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND bpxf.se - DNS resolution failed
- Domain bpxf.se does not exist
- Brommapojkarna (BPX) may use different domain

**suggestedRules:**
- Verify correct domain for Brommapojkarna (likely bpxf.se or similar)
- Search for official BPX website
- Mark as low-value if domain is defunct

---

### Source: centuri

| Field | Value |
|-------|-------|
| likelyCategory | Cross-domain redirect |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.82 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked: centuri.se → centuri.cloud
- Target domain is centuri.cloud not centuri.se
- Events may exist on cloud domain

**suggestedRules:**
- Update entry URL to use centuri.cloud
- Add domain redirect handling for centuri.se → centuri.cloud
- Update source registry with correct domain

---

### Source: chalmers

| Field | Value |
|-------|-------|
| likelyCategory | Redirect loop |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.80 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- Redirect loop detected on /utbildning/hitta-program
- c0WinnerUrl points to education program page not events
- Chalmers events likely on different section

**suggestedRules:**
- Find correct event page for Chalmers (check /events, /kalender, /evenemang)
- Avoid redirecting to /utbildning paths for event discovery
- Investigate Chalmers event calendar location

---
