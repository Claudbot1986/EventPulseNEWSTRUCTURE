## C4-AI Analysis Round 1 (batch-20)

**Timestamp:** 2026-04-13T03:21:45.755Z
**Sources analyzed:** 4

### Overall Pattern
Top failure categories: 1× Network Unfetchable, 1× DNS Resolution Failure, 1× Redirect Loop

---

### Source: blekholmen

| Field | Value |
|-------|-------|
| likelyCategory | Network Unfetchable |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.55 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- C0 found 0 candidates
- C1 verdict unfetchable
- C2 unclear fetchHtml failed
- No timeTags or dateCount detected
- c1LikelyJsRendered=false suggests simple network issue

**suggestedRules:**
- Add retry with extended timeout since likelyJsRendered=false indicates server-side issue rather than JS rendering
- Investigate if site requires specific user-agent or headers

---

### Source: boplanet

| Field | Value |
|-------|-------|
| likelyCategory | DNS Resolution Failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.85 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND boplanet.se
- C1 unfetchable
- C2 unclear due to network failure
- Domain may be inactive or misspelled

**suggestedRules:**
- Verify domain registration and DNS configuration
- Check for typos in source configuration
- Flag for manual review since DNS failures cannot be resolved by retry

---

### Source: chalmers

| Field | Value |
|-------|-------|
| likelyCategory | Redirect Loop |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.72 |
| nextQueue | D |
| directRouting | D (conf=0.70) |

**discoveredPaths:**
(none)

**improvementSignals:**
- Redirect loop detected at https://www.chalmers.se/utbildning/hitta-program
- C0 winner is programs page not event page
- C1 unfetchable due to redirect
- C2 unclear with score=0
- Entry URL chalmers.se/ not matching event content

**suggestedRules:**
- Use headless browser for sites with redirect loops
- Events likely exist at a different URL requiring JS to load
- Consider adding event-specific path hints for known university event structures

---

### Source: mittuniversitetet

| Field | Value |
|-------|-------|
| likelyCategory | Low Score Event Page |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.58 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- C2 score=4 below threshold of 12
- Page has 'event-heading' class but low extraction score
- C0 winner is utbildning page not events
- C1 weak verdict with 0 timeTags
- No JSON-LD structured data found

**suggestedRules:**
- Events may be present but in non-standard HTML structure
- Consider lowering C2 threshold or adding more scoring factors
- Test alternative extraction patterns for Swedish university sites

---
