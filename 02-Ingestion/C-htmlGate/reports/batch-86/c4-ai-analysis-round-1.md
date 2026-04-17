## C4-AI Analysis Round 1 (batch-86)

**Timestamp:** 2026-04-17T04:55:57.758Z
**Sources analyzed:** 7

### Overall Pattern
Top failure categories: 3× DNS resolution failure, 3× HTTP 404 page not found, 1× SSL/TLS handshake failure

---

### Source: kalmar-museum

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot perform discovery - entry page unreachable due to DNS resolution failure. c0LinksFound is empty. No HTML content available to analyze.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/kalender`
- appliesTo: Swedish museum and cultural sites
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND suggests domain may have changed or be incorrect
- Verify correct domain format (kalmar-museum.se vs kalmar-museum.se)

**suggestedRules:**
- For DNS ENOTFOUND errors, flag for manual domain verification
- Source may have moved to kalmarbefattning.se or similar municipal domain

---

### Source: h-gskolan-i-sk-vde

| Field | Value |
|-------|-------|
| likelyCategory | HTTP 404 page not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot perform discovery - entry page (his.se/evenemang) returns HTTP 404. No HTML content available to analyze. Root URL his.se would need separate fetch attempt.

**candidateRuleForC0C3:**
- pathPattern: `/kalendarium|/schema`
- appliesTo: Swedish university and educational institution sites
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- URL his.se/evenemang returns 404 - path may have moved
- Root URL his.se may need path discovery from scratch
- Swedish university event pages typically at /kalendarium or /evenemang

**suggestedRules:**
- For 404 on specific path, try root domain for nav-based event discovery
- University of Skövde events may be at his.se/kalendarium or similar

---

### Source: karlstad-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | HTTP 404 page not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot perform discovery - entry page returns HTTP 404. No HTML content to analyze. Would need to start from karlstad.se root.

**candidateRuleForC0C3:**
- pathPattern: `/kultur|/evenemang`
- appliesTo: Swedish municipal event pages
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- URL karlstad.se/stadsteatern returns 404 - section may have moved or been renamed
- Karlstad municipality may use different URL structure
- Stadsteatern may be under different section (kultur/kommunal-kultur)

**suggestedRules:**
- For 404 on known subpage, try root domain and traverse from there
- Swedish municipal theaters often under kultur or evenemang sections

---

### Source: melodifestivalen-svt

| Field | Value |
|-------|-------|
| likelyCategory | HTTP 404 page not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot perform discovery - entry page returns HTTP 404. SVT likely restructured content. Human review needed to determine current Melodifestivalen URL or confirm it's archived.

**candidateRuleForC0C3:**
- pathPattern: `/melodifestivalen/2024|/2025`
- appliesTo: Swedish seasonal TV event pages on SVT
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- SVT Melodifestivalen is a seasonal TV event, page may be archived or moved
- 404 could indicate page removed after contest ended
- SVT may have restructured their event pages

**suggestedRules:**
- For seasonal TV events, verify if current season active before adding
- Past Melodifestivalen pages likely archived at svt.se/melodifestivalen/202X

---

### Source: sticky-fingers

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot perform discovery - DNS resolution failed for stickyfingers.se. No HTML content available. Human needs to verify correct domain.

**candidateRuleForC0C3:**
- pathPattern: `/konserter|/biljetter|/spelningar`
- appliesTo: Swedish music venue and band websites
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain stickyfingers.se does not exist
- Correct domain may be stickyfingers.nu or stickyfingers.se (different TLD)
- Swedish band website may have moved to new domain

**suggestedRules:**
- For DNS failures on .se domains, check alternative TLDs (.nu, .com)
- Verify band name spelling - Sticky Fingers vs Stickyfingers

---

### Source: uppsala-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot perform discovery - DNS resolution failed. No HTML content available. Human review needed to find correct Uppsala Stadsteatern URL.

**candidateRuleForC0C3:**
- pathPattern: `/kultur|/teater|/evenemang`
- appliesTo: Swedish municipal theater and culture pages
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain uppsala-stadsteatern.se does not exist
- Uppsala theater may be part of uppsala.se municipality site
- Actual venue may be called 'Uppsala Stadsteater' or similar

**suggestedRules:**
- For Swedish theaters, check if they are subsections of municipal sites
- Uppsala theater likely at uppsala.se/kultur or uppsala.se/stadsteatern

---

### Source: globen

| Field | Value |
|-------|-------|
| likelyCategory | SSL/TLS handshake failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot perform discovery - SSL/TLS handshake failed. No HTTP content available. Human review needed to determine correct domain or verify SSL configuration.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/konserter|/biljetter`
- appliesTo: Swedish arena and concert venue websites
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- SSL error suggests TLS configuration issue on server
- globen.se may have moved to globen.com or be redirects to modern site
- Avicii Arena / Globe Arena branding may have changed domain

**suggestedRules:**
- For SSL errors, verify if site has moved to different domain
- Major venues often rebrand - check for globen.com or aviciiarena.se

---
