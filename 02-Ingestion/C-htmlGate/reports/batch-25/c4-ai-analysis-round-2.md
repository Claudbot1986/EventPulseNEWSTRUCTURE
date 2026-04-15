## C4-AI Analysis Round 2 (batch-25)

**Timestamp:** 2026-04-14T16:08:13.689Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 3× domain no longer exists, 1× site migrated to new domain, 1× site merged into destination domain

---

### Source: centuri

| Field | Value |
|-------|-------|
| likelyCategory | site migrated to new domain |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.75 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect detected: centuri.se → centuri.cloud
- c0Candidates=0 suggests no event links found from entry page

**suggestedRules:**
- If fetchHtml fails with cross-domain redirect, query for canonical domain and retry with updated URL before marking failed

---

### Source: visit-malmo

| Field | Value |
|-------|-------|
| likelyCategory | site merged into destination domain |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.80 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked: xn--visitmalm-87a.com → www.malmotown.com
- Unicode URL encoding present (malmö), redirect target identified as malmotown.com

**suggestedRules:**
- If cross-domain redirect is blocked but target domain is identifiable, queue new entry with resolved URL (www.malmotown.com)
- Handle internationalized domain names (IDN) by normalizing before redirect detection

---

### Source: vasteras-konstmuseum

| Field | Value |
|-------|-------|
| likelyCategory | page no longer exists at URL |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on /konstmuseum path
- May need alternative URL discovery for Västerås museum

**suggestedRules:**
- For HTTP 404 errors, attempt root domain fallback and common event path patterns before final failure

---

### Source: v-ster-s-konstmuseum

| Field | Value |
|-------|-------|
| likelyCategory | domain no longer exists |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND for vasterasmuseum.se
- Domain appears to be defunct or never existed

**suggestedRules:**
- DNS ENOTFOUND should trigger manual-review with suggestion to verify domain existence via web search

---

### Source: visit-gothenburg

| Field | Value |
|-------|-------|
| likelyCategory | domain no longer exists |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND for visitgothenburg.se
- Domain appears to be defunct

**suggestedRules:**
- DNS ENOTFOUND should trigger manual-review with suggestion to verify domain existence via web search

---

### Source: vasalund

| Field | Value |
|-------|-------|
| likelyCategory | site redirected to ticketing platform |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.80 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked: vasalund.se → qvmcd.com
- Target domain qvmcd.com appears to be a ticketing/booking platform

**suggestedRules:**
- If redirect target is a known ticketing platform (qvmcd, ticketmaster, etc.), route to manual-review for platform-specific handling

---

### Source: visit-sweden

| Field | Value |
|-------|-------|
| likelyCategory | redirect loop or moved content |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.65 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- Redirect loop detected on fallback URL
- c0Candidates=1 but c0WinnerUrl triggered loop
- visit-sweden.com typically has events but may be under /events or /things-to-do subpath

**suggestedRules:**
- For redirect loops, attempt common event subpaths (/events, /things-to-do, /activities) before final failure
- Add loop detection with retry limit to prevent infinite redirects

---

### Source: vasteras-hockey

| Field | Value |
|-------|-------|
| likelyCategory | domain no longer exists |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND for vasterasfh.se
- Domain appears to be defunct

**suggestedRules:**
- DNS ENOTFOUND should trigger manual-review with suggestion to verify domain existence via web search

---

### Source: botaniska-tradgarden

| Field | Value |
|-------|-------|
| likelyCategory | site moved to parent organization |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.82 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- SSL cert mismatch: botaniska.se uses vgregion.se certificate
- Hostname mismatch indicates site is hosted under parent domain vgregion.se
- botaniska.se likely redirects to vgregion.se/botaniska or similar

**suggestedRules:**
- SSL hostname mismatch should trigger URL resolution: botaniska.se → vgregion.se subdirectory

---

### Source: uppsala-domkyrka

| Field | Value |
|-------|-------|
| likelyCategory | temporary timeout or network issue |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.55 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- Timeout of 20000ms exceeded
- Only 1 consecutive failure (others have 2)
- Timeout could indicate server overload, network latency, or temporary unavailability

**suggestedRules:**
- Single timeout failure should enter retry-pool rather than immediate failure
- Consider increasing timeout threshold for Swedish (.se) domains known to have slower servers

---
