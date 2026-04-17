## C4-AI Analysis Round 2 (batch-93)

**Timestamp:** 2026-04-16T18:45:30.470Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 5× DNS domain not found, 1× SSL cert domain mismatch, 1× JS-rendered events page

---

### Source: goteborgs-stadsbibliotek

| Field | Value |
|-------|-------|
| likelyCategory | SSL cert domain mismatch |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.70 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://goteborgsstad.se/bibliotek |

**humanLikeDiscoveryReasoning:**
SSL certificate error prevents access. Domain appears incorrect - 'goteborgsstad.se' not covered by certificate which is for 'goteborg.se'. Manual domain verification needed.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain 'goteborgsstad.se' has SSL cert mismatch - cert issued for 'goteborg.se' domain
- Verify correct domain for Gothenburg City Library events

**suggestedRules:**
- Consider alternate domain pattern: 'goteborg.se/bibliotek/evenemang' or 'goteborg.se/kalender'

---

### Source: malmo-icc

| Field | Value |
|-------|-------|
| likelyCategory | DNS domain not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://malmöicc.se/ |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND indicates domain is non-existent or recently expired. No alternate paths can be discovered without correct domain.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain 'malmöicc.se' (punycode: xn--malmicc-d1a.se) does not resolve via DNS
- Source may be defunct or domain expired

**suggestedRules:**
- Verify if Malmö ICC events exist at alternate domain (e.g., malmo.se, malmotown.com)

---

### Source: lulea-hf

| Field | Value |
|-------|-------|
| likelyCategory | DNS domain not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://luleahf.se/ |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND indicates domain is non-existent. Swedish hockey teams often use simplified domain patterns - alternative search recommended.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain 'luleahf.se' does not resolve via DNS
- Luleå HF hockey team may have moved to new domain

**suggestedRules:**
- Try common Swedish sports domain patterns: 'luleahockey.se', 'lulea-hockey.se', or 'if-lulea.se'

---

### Source: vega

| Field | Value |
|-------|-------|
| likelyCategory | JS-rendered events page |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.78 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | /events |
| directRouting | D (conf=0.78) |

**humanLikeDiscoveryReasoning:**
C0 found /events path via derived rules with strong confidence. C1/C2 scoring low despite valid event path suggests JS-rendering. Recommend D-route for JavaScript rendering fallback.

**discoveredPaths:**
- /events [derived] anchor="derived-rule" conf=0.85

**improvementSignals:**
- C0 correctly identified /events path with high confidence (score 10)
- C1 found no time tags or dates despite /events being event page
- Score of 2 suggests possible JS-rendered content blocking detection

**suggestedRules:**
- When C0 finds strong event path but C1/C2 score is low, suspect JS rendering
- Consider direct D route for pages where derived-rule link score >= 8 but content score < 5

---

### Source: hv71

| Field | Value |
|-------|-------|
| likelyCategory | Network timeout |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.60 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://hv71.se/ |

**humanLikeDiscoveryReasoning:**
Network timeout suggests temporary connectivity issue or slow server. Retry may succeed. If it fails consistently, manual domain verification recommended.

**discoveredPaths:**
(none)

**improvementSignals:**
- Site timed out after 20000ms - server may be slow or temporarily unavailable
- No C0 links found but this could be due to fetch failure

**suggestedRules:**
- Increase timeout for Swedish .se domains known to have slower servers
- HV71 is a hockey team - try common paths: /events, /matcher, /biljetter

---

### Source: storsj-odjuret

| Field | Value |
|-------|-------|
| likelyCategory | DNS domain not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://storsjoodjuret.se/ |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND indicates domain is non-existent. This appears to be a defunct venue site. Manual verification of alternate domain needed.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain 'storsjoodjuret.se' does not resolve via DNS
- Source may be inactive or using alternate domain

**suggestedRules:**
- Verify if Storsjöodjuret (Gothenburg music venue) has moved to new domain

---

### Source: spanggatan

| Field | Value |
|-------|-------|
| likelyCategory | DNS domain not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://spånggatan.se/ |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND indicates domain is non-existent. Spångatan venue may have moved to new domain or social media presence only.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain 'spånggatan.se' (punycode: xn--spnggatan-62a.se) does not resolve
- Source may be inactive

**suggestedRules:**
- Spångatan is a music venue in Gothenburg - verify correct domain

---

### Source: gavle-if

| Field | Value |
|-------|-------|
| likelyCategory | DNS domain not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://gavleif.se/ |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND indicates domain is non-existent. Swedish sports clubs often use simplified domains - manual verification recommended.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain 'gavleif.se' does not resolve via DNS
- Gävle IF sports club may use different domain

**suggestedRules:**
- Try alternate domain patterns: 'gavleifotboll.se', 'gavle-idrott.se', or verify correct domain

---

### Source: globen

| Field | Value |
|-------|-------|
| likelyCategory | SSL protocol error |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://globen.se/ |

**humanLikeDiscoveryReasoning:**
TLS protocol error indicates SSL misconfiguration. The famous Globen venue (now Avicii Arena) likely uses different domain. Retry with http:// or alternate domain recommended.

**discoveredPaths:**
(none)

**improvementSignals:**
- SSL error: 'tlsv1 unrecognized name' suggests certificate mismatch or TLS configuration issue
- Domain may redirect to Globen/Avicii Arena events at different URL

**suggestedRules:**
- Try http:// instead of https:// for legacy Swedish venues
- Verify if 'globen.se' redirects to 'globenarena.se' or 'aviciiarena.se'

---

### Source: goteborgs-arkitekturgalleri

| Field | Value |
|-------|-------|
| likelyCategory | SSL cert hosted domain |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.75 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://arkitekturgalleriet.se/ |

**humanLikeDiscoveryReasoning:**
SSL certificate mismatch indicates site may be hosted under different primary domain or the configured URL is incorrect. Manual domain verification needed.

**discoveredPaths:**
(none)

**improvementSignals:**
- Hostname 'arkitekturgalleriet.se' not in cert altnames (cert is for 'da201.sajthotellet.com')
- Site likely hosted on Sajthotellet platform with different actual domain

**suggestedRules:**
- Verify correct domain for Gothenburg Architecture Gallery
- May use subdomain on sajthotellet.com or different domain entirely

---
