## C4-AI Analysis Round 2 (batch-24)

**Timestamp:** 2026-04-13T16:59:42.145Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 2× network timeout, 1× C0 scoring rejected valid paths, 1× events page has no HTML dates

---

### Source: folkuniversitetet

| Field | Value |
|-------|-------|
| likelyCategory | C0 scoring rejected valid paths |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.72 |
| nextQueue | manual-review |

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.95
- /program [nav-link] anchor="derived-rule" conf=0.88
- /kalender [nav-link] anchor="derived-rule" conf=0.82
- /schema [nav-link] anchor="derived-rule" conf=0.75
- /evenemang [nav-link] anchor="derived-rule" conf=0.68
- /kalendarium [nav-link] anchor="derived-rule" conf=0.60

**improvementSignals:**
- c0LinksFound contains multiple high-scoring event paths (score 10 to 1) but C0 rejected all candidates
- C2 shows promising score=305 with venue-marker but extraction returned 0 events
- Root fallback was false despite valid event paths being available

**suggestedRules:**
- Add C0 scoring threshold adjustment: if highest candidate score >= 6 and path matches known event patterns, bypass negative scoring decay
- Implement path preservation: when C0 finds paths with score > 0, do not reject them even if root fallback fails
- Add rule to check C2 promising verdict when C0 candidates are rejected — if score >= 100, force candidate selection

---

### Source: medborgarhuset

| Field | Value |
|-------|-------|
| likelyCategory | network timeout |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.58 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- fetchHtml failed with timeout after 20000ms
- No links found from root page — cannot assess site structure
- No distinguishing JS render signals detected

**suggestedRules:**
- Increase timeout threshold for Swedish cultural venues that may have slower servers
- Consider DNS resolution check before retry to avoid repeated timeouts

---

### Source: friidrottsf-rbundet

| Field | Value |
|-------|-------|
| likelyCategory | events page has no HTML dates |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.68 |
| nextQueue | D |
| directRouting | D (conf=0.72) |

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.90

**improvementSignals:**
- c0WinnerUrl confirmed as https://friidrott.se/events but C1 shows timeTags=0 and dateCount=0
- C1 verdict= noise suggests HTML content has no semantic event markers
- C2 low_value with pg=time-tag indicates pattern mismatch — events likely in JS
- Errors=1 and has_404s suggests site may use SPA framework

**suggestedRules:**
- Add JS-render trigger: if c0WinnerUrl exists and C1 finds 0 timeTags with verdict=noise, flag for D-stage immediately
- Add sports federation pattern to JS-render heuristics — many use React/Vue for event calendars

---

### Source: faith

| Field | Value |
|-------|-------|
| likelyCategory | redirect loop |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.62 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- fetchHtml failed: Redirect loop detected between faith.se and faith.se/sv
- Swedish locale redirect suggests language versioning but C0 cannot follow redirects
- Errors=10 indicates persistent issue

**suggestedRules:**
- Add redirect loop detection with automatic path hint: if loop between / and /sv, try /sv directly
- Implement language variant checking for Swedish sites — may need to append locale suffix

---

### Source: brommapojkarna

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failed |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.70 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND for bpxf.se — domain does not resolve
- has_404s diversifier present — site may be down or moved
- URL bpxf.se is short-form for brommapojkarnaarna IF — may need full domain

**suggestedRules:**
- Add domain verification step: check if domain resolves before attempting full scrape
- Store alternative domain mappings for known Swedish sports clubs (bpxf.se → brommapojkarnaarna.se)
- Flag for manual review when DNS fails after 2+ consecutive failures

---

### Source: chalmers

| Field | Value |
|-------|-------|
| likelyCategory | C0 selected wrong page type |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.75 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**

**suggestedRules:**
- Add semantic page type classification: if candidate URL contains utbildning/program/kurs without event keywords, reject it
- Implement event-specific anchor text matching: require anchor text to contain event-related terms (evenemang, kalender, schema)
- Add redirect following capability with loop detection bypass for known Swedish academic domains

---

### Source: mejeriet

| Field | Value |
|-------|-------|
| likelyCategory | site moved to different domain |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked: mejeriet.se → kulturmejeriet.se
- has_404s diversifier present
- Domain appears to have migrated to kulturmejeriet.se

**suggestedRules:**
- Add cross-domain redirect following: if source redirects to known cultural/event domain, continue with new domain
- Build redirect chain tracking to capture eventual event pages after domain migration
- Store domain migration mappings for Swedish cultural venues

---

### Source: malmo-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | Unicode domain not resolving |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.65 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND for xn--malmstadsteatern-pwb.se (punycode encoded Malmö Stadsteatern)
- Unicode domain failed to resolve — domain may have been registered incorrectly or moved
- needs manual verification of correct domain format

**suggestedRules:**
- Add punycode conversion validation: verify IDN domains resolve before attempting scrape
- Build IDN-to-ASCII fallback for Swedish venues: try malmostadsteatern.se as alternative
- Flag IDN domains for manual review after resolution failure

---

### Source: volvo-museum

| Field | Value |
|-------|-------|
| likelyCategory | site migrated to corporate domain |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.78 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked: volvomuseum.se → www.worldofvolvo.com
- Site appears to have been absorbed into Volvo corporate web presence
- No event paths found on current domain structure

**suggestedRules:**
- Add corporate domain redirect following: if subdomain redirects to main corporate site, search for events subsite
- Build museum-to-corporate site mapping for Swedish museums
- Flag for manual review when primary domain redirects to non-event corporate site

---

### Source: bk-hacken

| Field | Value |
|-------|-------|
| likelyCategory | network timeout |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.55 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- fetchHtml failed with timeout after 20000ms
- Only 1 consecutiveFailure (others have 2) — may be intermittent
- has_404s diversifier present

**suggestedRules:**
- Increase timeout threshold for Swedish sports club sites with potentially overloaded servers
- Add exponential backoff for timeout failures before retry

---
