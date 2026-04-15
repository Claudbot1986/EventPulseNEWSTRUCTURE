## C4-AI Analysis Round 1 (batch-24)

**Timestamp:** 2026-04-13T16:57:41.489Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 1× crawl_blocked_at_subpage_level, 1× timeout_causes_crawl_gap, 1× events_archived_or_scattered

---

### Source: folkuniversitetet

| Field | Value |
|-------|-------|
| likelyCategory | crawl_blocked_at_subpage_level |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.78 |
| nextQueue | manual-review |
| directRouting | D (conf=0.71) |

**discoveredPaths:**
- /events [url-pattern] anchor="derived-rule" conf=0.95
- /program [url-pattern] anchor="derived-rule" conf=0.90
- /kalender [url-pattern] anchor="derived-rule" conf=0.88
- /schema [url-pattern] anchor="derived-rule" conf=0.85
- /evenemang [url-pattern] anchor="derived-rule" conf=0.82
- /kalendarium [url-pattern] anchor="derived-rule" conf=0.80
- /aktiviteter [url-pattern] anchor="derived-rule" conf=0.75
- /kultur [url-pattern] anchor="derived-rule" conf=0.70
- /fritid [url-pattern] anchor="derived-rule" conf=0.65
- /matcher [url-pattern] anchor="derived-rule" conf=0.60
- /biljetter [url-pattern] anchor="derived-rule" conf=0.55

**improvementSignals:**
- C0 found 11 event-indicating paths but 0 candidates evaluated - crawl depth insufficient
- C2 promising score=305 indicates events exist at subpage level
- c1LikelyJsRendered=false suggests HTML content is available
- Root URL blocked before exploring discovered paths

**suggestedRules:**
- Increase crawl depth beyond root page to follow event-signaled paths (/events, /program, /kalender)
- Add path alias normalization for Swedish event keywords (/evenemang, /kalendarium, /aktiviteter)
- Implement fallback to direct path prefix matching when root fetch returns empty candidate pool

---

### Source: medborgarhuset

| Field | Value |
|-------|-------|
| likelyCategory | timeout_causes_crawl_gap |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.45 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- 20s timeout exceeded - server may be slow or overloaded
- C0 found 0 links - root page possibly blocked or renders empty nav
- Single consecutive failure - worth retry with extended timeout

**suggestedRules:**
- Increase fetch timeout for Swedish cultural venues (often shared hosting)
- Add retry with doubled timeout for timeout failures
- Investigate if CDN blocking affects Swedish .se domains

---

### Source: friidrottsf-rbundet

| Field | Value |
|-------|-------|
| likelyCategory | events_archived_or_scattered |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.72 |
| nextQueue | retry-pool |

**discoveredPaths:**
- /events [url-pattern] anchor="derived-rule" conf=0.88

**improvementSignals:**
- C2 low_value with score=0 - event content sparse or archived
- /events path found but C1 verdict noise with 0 timeTags
- Swedish athletics federation may publish events externally (calendar feeds)
- C0 winnerUrl=/events but extraction returned 0 events

**suggestedRules:**
- Add calendar feed detection for sports federations (iCal, .ics endpoints)
- Search for /kalender, /tavling, /resultat path variants common in Swedish sports
- Consider if events exist only in PDF archives or external ticketing systems

---

### Source: faith

| Field | Value |
|-------|-------|
| likelyCategory | redirect_loop_prevents_crawl |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.62 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- Redirect loop detected between faith.se and /sv subdirectory
- C0 found 0 links - root page unreachable due to loop
- Multiple errors (10) indicate persistent redirect issue
- Swedish sites often have /sv/ versioning that causes loops

**suggestedRules:**
- Add language-version handling for Swedish sites: prefer root or /en over /sv
- Detect redirect loops and attempt to extract from final destination URL
- Add /sv, /en, /en-gb path variations to redirect resolution logic

---

### Source: brommapojkarna

| Field | Value |
|-------|-------|
| likelyCategory | dns_failure_blocks_access |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.55 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS lookup failed for bpxf.se - domain may be misconfigured
- C0 found 0 links due to DNS failure
- Only 1 consecutive failure - transient DNS issue possible

**suggestedRules:**
- Add DNS resolution retry for subdomain variants (www.bpxf.se, bxf.se alternative)
- Check if site migrated to different domain (BPXf may now be bpxf.com)
- Add DNS failure to retry-trigger conditions

---

### Source: chalmers

| Field | Value |
|-------|-------|
| likelyCategory | redirect_loop_with_path_bias |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.58 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- Redirect loop at /utbildning/hitta-program/ - path triggers loop
- C0 candidates=2 found but C1 unfetchable
- Chalmers is large institution - events may be on subdomain or external system
- 19 errors indicate systemic issue with this entry URL

**suggestedRules:**
- Try alternative entry URLs: chalmers.se/en, chalmers.se/kalender
- Check for events.chalmers.se subdomain or external event platform
- Add path-based redirect loop detection and try parent paths

---

### Source: mejeriet

| Field | Value |
|-------|-------|
| likelyCategory | domain_redirect_blocks_crawl |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.60 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked: mejeriet.se → kulturmejeriet.se
- C0 found 0 links due to redirect blocking
- Site likely moved entirely to kulturmejeriet.se
- Only 1 consecutive failure - redirect may be intentional migration

**suggestedRules:**
- Add automatic domain migration detection and follow cross-domain redirects for same-organization redirects
- Update source URL to kulturmejeriet.se when redirect target is same organization
- Implement allowlist for cultural subdomain migrations (.se → kultur subdomain)

---

### Source: malmo-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | unicode_domain_dns_failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.58 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS failure for xn--malmstadsteatern-pwb.se (punycode)
- Swedish venue with Swedish characters in domain may have multiple variants
- C0 found 0 links due to DNS failure
- Single failure - punycode resolution may be intermittent

**suggestedRules:**
- Add punycode-to-unicode normalization and try both variants
- Check for ASCII-alternative domains: malmostadsteatern.se, malmo-stadsteater.se
- Add Swedish venue domain variants to DNS resolution strategies

---

### Source: volvo-museum

| Field | Value |
|-------|-------|
| likelyCategory | brand_migration_to_corporate |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect to worldofvolvo.com - brand consolidated
- C0 found 0 links - site migrated away
- Events likely now on Volvo corporate site or external ticketing
- Redirect appears intentional - site merged into larger corporate property

**suggestedRules:**
- Search worldofvolvo.com for event/visit pages
- Check if volvomuseum events now hosted on external ticketing platform
- Consider if venue events exist in corporate calendar rather than dedicated museum site

---

### Source: fotografiska

| Field | Value |
|-------|-------|
| likelyCategory | js_render_obscures_events |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.82 |
| nextQueue | D |
| directRouting | D (conf=0.86) |

**discoveredPaths:**
- /events [url-pattern] anchor="derived-rule" conf=0.92
- /program [url-pattern] anchor="derived-rule" conf=0.88
- /kalender [url-pattern] anchor="derived-rule" conf=0.85
- /schema [url-pattern] anchor="derived-rule" conf=0.80
- /evenemang [url-pattern] anchor="derived-rule" conf=0.78
- /kalendarium [url-pattern] anchor="derived-rule" conf=0.75
- /aktiviteter [url-pattern] anchor="derived-rule" conf=0.70
- /kultur [url-pattern] anchor="derived-rule" conf=0.65
- /fritid [url-pattern] anchor="derived-rule" conf=0.60
- /matcher [url-pattern] anchor="derived-rule" conf=0.55
- /biljetter [url-pattern] anchor="derived-rule" conf=0.50

**improvementSignals:**
- 11 event-indicating paths discovered but C2 score=1 (unclear)
- C1 verdict noise with 0 timeTags despite rich event paths
- Fotografiska is modern museum with SPA frontend likely
- C3 extraction failure despite promising path count
- 18 errors indicate JavaScript framework blocking HTML scraping

**suggestedRules:**
- Add Playwright/Puppeteer fallback for modern Swedish museums
- Detect Next.js/React SPA patterns in HTML and trigger D-stage rendering
- Add event-path prefix matching with JS-render for photography/arts venues

---
