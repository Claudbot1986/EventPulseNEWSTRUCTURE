## C4-AI Analysis Round 2 (batch-49)

**Timestamp:** 2026-04-15T02:46:28.206Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 5× DNS resolution failed, 2× Request timeout, 1× URL path does not exist

---

### Source: lunds-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | URL path does not exist |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.65 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://lund.se/konserthus (404) |

**humanLikeDiscoveryReasoning:**
The URL /konserthus returned 404, indicating the venue page exists at lund.se but under a different path. Human-like reasoning suggests trying common Swedish municipal URL patterns like subdomain.kommun.se or konserthus.se variations.

**candidateRuleForC0C3:**
- pathPattern: `konserthus.*\.se|/konserthus|/evenemang`
- appliesTo: Swedish concert halls and music venues
- confidence: 0.45

**discoveredPaths:**
- konserthus.lund.se [derived] anchor="Lunds Konserthus subdomain" conf=0.45

**improvementSignals:**
- URL returned 404 — root domain lund.se likely exists but /konserthus path is invalid
- Concert hall may have moved to different subdomain or path structure

**suggestedRules:**
- Try subdomain: konserthus.lund.se or lundskonserthus.se
- Search for Lunds Konserthus official event page via known Swedish ticketing platforms

---

### Source: storsj-odjuret

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failed |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND means the domain storsjoodjuret.se does not exist. This is a terminal failure — cannot discover paths without DNS resolution. Human-like discovery would require manual domain verification.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND indicates domain does not exist in DNS
- Venue name 'Storsjöodjuret' is a well-known Östersund legend/festival

**suggestedRules:**
- Verify domain spelling — may be 'storsjoodjuret.se' vs 'storsjo-odjuret.se'
- Check if venue uses alternative domain or is hosted on platform like ticketmaster.se

---

### Source: stora-teatern-g-teborg

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failed |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND on stora-teatern.goteborg.se prevents any discovery. The domain was likely misconfigured or the venue moved to a different web presence.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND — domain not found in DNS
- Theater is real venue in Gothenburg, likely has working web presence elsewhere

**suggestedRules:**
- Try alternative domain: storateatern.se, stora-teatern-goteborg.se
- Check if venue uses goteborgsstadsteatern.se or cultural portal

---

### Source: umea-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | URL path returned 404 |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://umea.se/stadsteatern (404) |

**humanLikeDiscoveryReasoning:**
Root domain umea.se works but /stadsteatern path returns 404. Municipal theaters in Sweden commonly use subdomain.kommun.se structure. Umeå has a known Stadsteater with active programming.

**candidateRuleForC0C3:**
- pathPattern: `stadsteatern.*\.se|/teater|/scen`
- appliesTo: Swedish municipal theaters and stage venues
- confidence: 0.50

**discoveredPaths:**
- stadsteatern.umea.se [derived] anchor="Umeå Stadsteater" conf=0.50

**improvementSignals:**
- HTTP 404 on /stadsteatern path — root umea.se exists
- Umeå Stadsteater is a real municipal theater with active events

**suggestedRules:**
- Try /kultur eller /scen or /teater subpaths
- Check if theater moved to dedicated subdomain

---

### Source: jazz-i-lund

| Field | Value |
|-------|-------|
| likelyCategory | Request timeout |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.60 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://jazzilund.se/ (timeout) |

**humanLikeDiscoveryReasoning:**
Timeout occurred, meaning the domain resolves (DNS works) but server is unresponsive. This suggests jazzilund.se exists but may have performance issues. Retry during different time window may succeed.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/schema|/konserter`
- appliesTo: Jazz clubs and music venues in Sweden
- confidence: 0.55

**discoveredPaths:**
(none)

**improvementSignals:**
- Request timed out after 20 seconds — server may be slow or overloaded
- jazzilund.se is a known Lund jazz club with events

**suggestedRules:**
- Increase timeout threshold or retry during off-peak hours
- Check if site uses Cloudflare or similar protection causing delays

---

### Source: kalmar-museum

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failed |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND on kalmar-museum.se is terminal. Cannot discover event paths without domain resolution. Real museum exists but current domain is invalid.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND — domain does not exist
- Kalmar has a known museum (Kalmar museum / Kalmar läns museum)

**suggestedRules:**
- Try kalmarkonstmuseum.se or kalmar-lans-museum.se
- Check if museum website is hosted by municipality portal

---

### Source: historiska-museet-malmo

| Field | Value |
|-------|-------|
| likelyCategory | DNS punycode resolution failed |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Unicode domain malmöhistoriska.se converted to punycode but still failed DNS lookup. The domain does not exist. Malmö has known cultural institutions but this specific domain is invalid.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND for punycode xn--malmhistoriska-ypb.se
- Malmö's historical museum exists — domain may use ASCII format

**suggestedRules:**
- Try malmohistoriskamuseet.se or malmomuseet.se
- Check if museum uses malmo.se/kultur or similar municipal path

---

### Source: open-air

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failed |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND on openair.se prevents discovery. Generic name 'openair' suggests this may be a category rather than a specific venue. Domain likely invalid or never registered.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND — openair.se domain not registered or unavailable
- Open air theaters/festivals exist in Sweden but this domain is not valid

**suggestedRules:**
- Verify if this is the correct domain for Swedish open-air venue
- Search for known Swedish open-air venues by specific name

---

### Source: uppsala-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failed |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND for uppsalakonserthus.se. Uppsala Konserthus is a well-known concert hall with active programming, but the current domain is invalid. Likely needs hyphen variation or subdomain.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND — uppsalakonserthus.se not in DNS
- Uppsala Konserthus is a real venue with known events

**suggestedRules:**
- Try konserthuset-uppsala.se or uppsala-konserthus.se (hyphen variations)
- Check if venue uses konserthuset.se or municipal subdomain

---

### Source: paddan

| Field | Value |
|-------|-------|
| likelyCategory | Request timeout |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.58 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://paddan.se/ (timeout) |

**humanLikeDiscoveryReasoning:**
Timeout indicates domain resolves (DNS works) but server is unresponsive or overloaded. This is a transient failure — retry pool is appropriate. Low consecutive failure count (1) supports retry viability.

**candidateRuleForC0C3:**
- pathPattern: `/turer|/rundtur|/biljetter|/book`
- appliesTo: Tour operators and activity venues in Sweden
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- Timeout of 20000ms exceeded — server unresponsive
- Paddan is known boat tour operator in Gothenburg (or similar city)
- Only 1 consecutive failure — may recover with retry

**suggestedRules:**
- Retry with extended timeout or during different time window
- Check if site uses Cloudflare or anti-bot protection

---
