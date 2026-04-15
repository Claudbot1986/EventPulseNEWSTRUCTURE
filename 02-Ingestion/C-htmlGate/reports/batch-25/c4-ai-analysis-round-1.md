## C4-AI Analysis Round 1 (batch-25)

**Timestamp:** 2026-04-14T16:06:27.156Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 3× DNS not found — dead domain, 1× Cross-domain redirect to cloud platform, 1× Domain redirect to malmotown.com

---

### Source: centuri

| Field | Value |
|-------|-------|
| likelyCategory | Cross-domain redirect to cloud platform |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.65 |
| nextQueue | manual-review |
| directRouting | D (conf=0.68) |

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked suggests centuri uses cloud platform (centuri.cloud)
- fetchHtml cannot resolve cross-domain redirect
- No c0 links found, no content fetched

**suggestedRules:**
- Check if source has moved to a different domain — investigate centuri.cloud directly
- Consider browser-based fetch to handle cross-domain redirects
- If cross-domain redirect loop, route directly to D (JS render fallback)

---

### Source: visit-malmo

| Field | Value |
|-------|-------|
| likelyCategory | Domain redirect to malmotown.com |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.60 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- Unicode domain xn--visitmalm-87a.com resolves but redirects to www.malmotown.com
- No c0 links found, no event content discovered
- Cross-domain redirect suggests events may exist on malmotown.com

**suggestedRules:**
- Investigate www.malmotown.com as the correct event source
- Try fetching visitmalmö.malmotown.com or similar subdomain
- Consider this as a redirect-based failure — retry with malmotown.com domain

---

### Source: vasteras-konstmuseum

| Field | Value |
|-------|-------|
| likelyCategory | 404 on museum event page |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.65 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 from https://vasteras.se/konstmuseum
- No c0 links found
- Domain resolves but specific page does not

**suggestedRules:**
- Research correct URL for Västera museum events page
- Check if events moved to /evenemang or /kalendarium subpath
- Consider vasterasmuseum.se as alternative entry point

---

### Source: visit-vasteras

| Field | Value |
|-------|-------|
| likelyCategory | Redirect loop on events page |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.80 |
| nextQueue | D |
| directRouting | D (conf=0.82) |

**discoveredPaths:**
(none)

**improvementSignals:**
- Redirect loop detected on /evenemangskalender/ — classic JS-rendered SPA behavior
- c1LikelyJsRendered=false but redirect loop is strong signal of client-side routing
- c0Candidates=5 found candidate but fetchHtml cannot resolve

**suggestedRules:**
- Redirect loop on event-calendar page indicates SPA — route to D (JS render fallback)
- Use browser-based fetch to handle JavaScript routing
- Consider if site uses client-side router that server-side fetch cannot follow

---

### Source: v-ster-s-konstmuseum

| Field | Value |
|-------|-------|
| likelyCategory | DNS not found — dead domain |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.80 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND for vasterasmuseum.se
- Domain does not exist or is not registered
- No network path can reach this source

**suggestedRules:**
- Verify domain spelling — vasterasmuseum.se may be incorrect
- Check if museum uses different domain (vasteras.se, vastras.se)
- Mark as permanently unavailable if domain continues to not resolve

---

### Source: visit-gothenburg

| Field | Value |
|-------|-------|
| likelyCategory | DNS not found — dead domain |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.80 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND for visitgothenburg.se
- Domain does not exist or is not registered
- All network paths fail

**suggestedRules:**
- Verify domain spelling — visitgothenburg.se may be incorrect
- Check if site uses .com vs .se or different TLD
- Consider official tourism site alternative (goteborg.com, goteborg.se)

---

### Source: vasalund

| Field | Value |
|-------|-------|
| likelyCategory | Cross-domain redirect to QVMCD platform |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.65 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked: vasalund.se → qvmcd.com
- DNS resolves but redirect blocked — common with ticketing/event platforms
- No c0 links found, no content fetched

**suggestedRules:**
- Investigate QVMCD platform for vasalund events directly
- Cross-domain redirect block suggests JS-heavy platform — route to D
- Consider checking qvmcd.com for event listings

---

### Source: visit-sweden

| Field | Value |
|-------|-------|
| likelyCategory | Wrong page selected from candidates |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.70 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- C0 winner URL is /about-sweden/passport-and-visas/ — not an event page
- Redirect loop on non-events page
- c0Candidates=1 but wrong page chosen

**suggestedRules:**
- Improve C0 candidate ranking — passport/visas pages should score low for events
- Find correct events URL for visitsweden.com
- Consider /events, /whats-on, or similar event-specific paths

---

### Source: vasteras-hockey

| Field | Value |
|-------|-------|
| likelyCategory | DNS not found — dead domain |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.80 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND for vasterasfh.se
- Domain does not exist or is not registered
- No network path can reach this source

**suggestedRules:**
- Verify domain spelling — vasterasfh.se may be incorrect
- Check if hockey club uses different domain or has been renamed
- Consider searching for Västera FH hockey on other platforms

---

### Source: botaniska-tradgarden

| Field | Value |
|-------|-------|
| likelyCategory | SSL cert mismatch — vgregion.se hostname |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.55 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- SSL error: hostname botaniska.se not in cert (vgregion.se)
- DNS resolves but SSL handshake fails
- Certificate mismatch suggests site behind vgregion.se proxy/cloud

**suggestedRules:**
- Investigate SSL certificate chain — cert for vgregion.se suggests cloud/WAF proxy
- Try fetching with SSL verification disabled to confirm site accessibility
- Check if botaniska.se events are behind vgregion.se infrastructure

---
