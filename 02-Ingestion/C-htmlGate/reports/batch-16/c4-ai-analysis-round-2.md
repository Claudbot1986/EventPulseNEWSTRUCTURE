## C4-AI Analysis Round 2 (batch-16)

**Timestamp:** 2026-04-12T16:26:57.517Z
**Sources analyzed:** 9

### Overall Pattern
Top failure categories: 2× Site timeout, 2× 404 page not found, 2× DNS failure

---

### Source: vega

| Field | Value |
|-------|-------|
| likelyCategory | Domain redirect |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect from vega.nu to tobiasnygren.se suggests entry URL is deprecated or alias
- No candidate links found — C0 could not establish any event anchor

**suggestedRules:**
- If a source domain redirects to a different domain, mark as WRONG_ENTRY_PAGE and attempt to discover events on the redirect target
- Add domain-level aliasing for known Swedish event site redirects

---

### Source: vaxjo-lakers

| Field | Value |
|-------|-------|
| likelyCategory | Site timeout |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.62 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- 20s timeout on vaxjolakers.se — site may be slow, overloaded, or intermittently available
- c1/c2 both unfetchable with zero signals — likely infrastructure issue rather than content issue

**suggestedRules:**
- For timeout failures with <2 consecutive failures, increase timeout threshold and retry
- Track timeout patterns — if same source times out 2+ times across runs, flag as likely down or JS-rendered

---

### Source: umea-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | 404 page not found |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on https://umea.se/konserthus — URL structure may have changed
- umea.se is a municipal site likely with dynamic URL structure

**suggestedRules:**
- For municipal sites returning 404, attempt URL variations: /konserthus/, /konserthus/evenemang, /kultur/konserthus
- Query known event subpage patterns for umea.se domain before declaring failure

---

### Source: orebro-vinterfest

| Field | Value |
|-------|-------|
| likelyCategory | DNS failure |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- ENOTFOUND for orebrovinterfest.se — domain may have expired, been removed, or be temporarily unavailable
- No candidate links found — domain itself is unreachable

**suggestedRules:**
- ENOTFOUND on 2 consecutive failures strongly indicates domain is inactive — check if alternate domain or seasonal site
- For seasonal event sites, flag as 'potentially inactive outside event season'

---

### Source: lunds-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | 404 page not found |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on https://lund.se/konserthus — municipal site URL likely restructured
- lund.se likely hosts concert hall events at a different URL path

**suggestedRules:**
- Forlund.se sites, try paths: /konserthus, /kultur, /evenemang/konserthus, /konserthuset
- Municipal sites frequently restructure — add domain-specific fallback URL dictionary

---

### Source: bk-hacken

| Field | Value |
|-------|-------|
| likelyCategory | Site timeout |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.62 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- 20s timeout on hacken.se — site may be heavily loaded or have connection issues
- Only 1 consecutive failure — worth retry with extended timeout

**suggestedRules:**
- Single timeout with only 1 failure count should route to retry-pool with extended timeout
- Brottepliktig sites with timeouts may benefit from browser automation fallback

---

### Source: blekholmen

| Field | Value |
|-------|-------|
| likelyCategory | Unknown fetch error |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.58 |
| nextQueue | retry-pool |
| directRouting | D (conf=0.65) |

**discoveredPaths:**
(none)

**improvementSignals:**
- Unknown fetch error with no specific HTTP/code indicates internal error or network anomaly
- c1LikelyJsRendered=false but zero time tags — cannot determine if JS-rendered or simply unfetchable

**suggestedRules:**
- Unknown errors should be logged with full stack trace for pattern analysis
- Retry with browser automation (D path) to differentiate JS-render from fetch failure

---

### Source: boplanet

| Field | Value |
|-------|-------|
| likelyCategory | DNS failure |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.80 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- ENOTFOUND for boplanet.se on 1st failure — domain may be inactive or misspelled
- No other signals available due to DNS failure

**suggestedRules:**
- ENOTFOUND on first attempt should be cross-checked against known event site databases
- Verify if boplanet.se is a valid domain — search for archived content or alternative spellings

---

### Source: bor-s-zoo-animagic

| Field | Value |
|-------|-------|
| likelyCategory | Rate limited with rich links |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.95
- /program [nav-link] anchor="derived-rule" conf=0.90
- /kalender [nav-link] anchor="derived-rule" conf=0.88
- /schema [nav-link] anchor="derived-rule" conf=0.82
- /evenemang [nav-link] anchor="derived-rule" conf=0.78
- /kalendarium [nav-link] anchor="derived-rule" conf=0.72
- /aktiviteter [nav-link] anchor="derived-rule" conf=0.65
- /kultur [nav-link] anchor="derived-rule" conf=0.55
- /fritid [nav-link] anchor="derived-rule" conf=0.48
- /matcher [nav-link] anchor="derived-rule" conf=0.42
- /biljetter [nav-link] anchor="derived-rule" conf=0.38

**improvementSignals:**
- HTTP 429 rate limit — site is live and responding, but throttling requests
- c0LinksFound contains 12 high-confidence event paths including /events, /program, /kalender, /evenemang
- All links are derived-rule matches suggesting strong event-related URL patterns

**suggestedRules:**
- Rate-limited sources with candidate links should be queued for retry with exponential backoff
- Prioritize discovered paths by score and attempt subpage fetching in order: /events → /program → /kalender
- Add rate-limit cooldown period per domain before retry

---
