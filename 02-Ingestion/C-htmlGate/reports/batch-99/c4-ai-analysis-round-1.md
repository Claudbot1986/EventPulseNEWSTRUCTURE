## C4-AI Analysis Round 1 (batch-99)

**Timestamp:** 2026-04-17T05:07:48.757Z
**Sources analyzed:** 8

### Overall Pattern
Top failure categories: 3× DNS domain not found, 1× Connection timeout, 1× SSL certificate mismatch

---

### Source: vaxjo-teatern

| Field | Value |
|-------|-------|
| likelyCategory | DNS domain not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://vaexjoe-teatern.se/ |

**humanLikeDiscoveryReasoning:**
DNS lookup failed with ENOTFOUND - the domain vaexjoe-teatern.se does not exist. The sourceId 'vaxjo-teatern' suggests the intended target may be Växjö Teater, but the configured URL contains 'vaexjoe' instead of 'vaxjo'. No navigation paths exist because the server cannot be reached at all.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain vaexjoe-teatern.se does not exist in DNS
- SourceId says 'vaxjo' but URL has 'vaexjoe' - likely typo in configured URL

**suggestedRules:**
- Verify URL spelling matches intended target: should be 'vaxjo.se' or 'vaxjo-teatern.se'

---

### Source: kino

| Field | Value |
|-------|-------|
| likelyCategory | DNS domain not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://kinogoteborg.se/ |

**humanLikeDiscoveryReasoning:**
DNS lookup failed with ENOTFOUND for kinogoteborg.se. The domain does not exist. Kino is a known Gothenburg cinema venue - the correct domain may be different from what's configured.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain kinogoteborg.se does not exist in DNS
- Verify correct domain - may be kino.se or another subdomain

**suggestedRules:**
- Confirm correct domain for 'kino' cultural venue in Gothenburg

---

### Source: goteborgs-film-festival

| Field | Value |
|-------|-------|
| likelyCategory | DNS domain not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://gothenburgfilmfestival.com/ |

**humanLikeDiscoveryReasoning:**
DNS lookup failed with ENOTFOUND for gothenburgfilmfestival.com. Swedish festivals typically use .se domains. The correct domain is likely gothenburgfilmfestival.se or similar.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain gothenburgfilmfestival.com does not exist in DNS
- Verify correct domain - may be .se TLD or different name

**suggestedRules:**
- Confirm correct domain for Gothenburg Film Festival - likely uses .se TLD

---

### Source: kungstradgarden

| Field | Value |
|-------|-------|
| likelyCategory | Connection timeout |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://kungstradgarden.se/ |

**humanLikeDiscoveryReasoning:**
Connection timed out - server is reachable but not responding within timeout window. This is a transient infrastructure issue, not a content problem. Retry-pool is appropriate to attempt the request again.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang|/kalender|/program`
- appliesTo: Swedish cultural/municipal sites
- confidence: 0.60

**discoveredPaths:**
(none)

**improvementSignals:**
- Site timed out after 20 seconds - may be slow server or temporarily unavailable
- Could try with longer timeout or alternate approach

**suggestedRules:**
- Increase timeout threshold for municipal sites that may have slow response times

---

### Source: goteborgs-arkitekturgalleri

| Field | Value |
|-------|-------|
| likelyCategory | SSL certificate mismatch |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.65 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://arkitekturgalleriet.se/ |
| directRouting | D (conf=0.50) |

**humanLikeDiscoveryReasoning:**
Server is reachable but SSL certificate is misconfigured - it's issued for 'sajthotellet.com' not 'arkitekturgalleriet.se'. This shared hosting SSL issue can sometimes be bypassed with relaxed SSL verification. Retry-pool to test alternate connection methods.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang|/utstallningar|/program`
- appliesTo: Swedish museum/gallery sites
- confidence: 0.60

**discoveredPaths:**
(none)

**improvementSignals:**
- SSL certificate mismatch - hostname doesn't match cert (sajthotellet.com shared hosting)
- May need to accept insecure cert or try different SSL settings

**suggestedRules:**
- Add SSL verification bypass option for misconfigured Swedish hosting environments

---

### Source: vasamuseet

| Field | Value |
|-------|-------|
| likelyCategory | Extraction returned zero events |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.80 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | https://vasamuseet.se/aktiviteter |
| directRouting | D (conf=0.82) |

**humanLikeDiscoveryReasoning:**
Vasamuseet has multiple clear event-indicating paths discovered by C0 rules: /events, /program, /kalender, /schema, /evenemang, /kalendarium, /aktiviteter. C2 gave promising score of 9 indicating event-like content should exist. C3 failed to extract - likely needs D route with JS rendering support or different extraction patterns for this Swedish museum site structure.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/aktiviteter|/evenemang|/schema|/kalendarium`
- appliesTo: Swedish museum sites (vasamuseet, nordiska-museet, etc.)
- confidence: 0.85

**discoveredPaths:**
- /events [derived] anchor="derived-rule" conf=0.85
- /program [derived] anchor="derived-rule" conf=0.80
- /kalender [derived] anchor="derived-rule" conf=0.75
- /aktiviteter [derived] anchor="derived-rule" conf=0.70

**improvementSignals:**
- C2 gave promising score (9) but C3 extraction returned 0 events
- Multiple event-indicating paths found in C0 (/events, /program, /kalender, /evenemang)
- Low C1 timeTagCount and dateCount suggests HTML parsing issue

**suggestedRules:**
- Implement fallback extraction patterns for Swedish museum sites
- Try multiple event subpages since vasamuseet.se has clear event navigation paths

---

### Source: mosebacke

| Field | Value |
|-------|-------|
| likelyCategory | TLS protocol error |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://mosebacke.se/ |
| directRouting | D (conf=0.45) |

**humanLikeDiscoveryReasoning:**
TLS protocol error indicates server is reachable but SSL handshake is failing due to protocol mismatch. This is a connection configuration issue, not content unavailability. Retry-pool may work with adjusted TLS settings.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang|/program|/konserter|/biljetter`
- appliesTo: Swedish cultural venues (mosebacke, stadsteatern, etc.)
- confidence: 0.60

**discoveredPaths:**
(none)

**improvementSignals:**
- SSL/TLS protocol error (tlsv1 unrecognized name) - TLS configuration issue
- Server reachable but TLS handshake failing
- May work with different TLS settings or older protocol version

**suggestedRules:**
- Add TLS version fallback options for sites with legacy SSL configurations

---

### Source: vega

| Field | Value |
|-------|-------|
| likelyCategory | Unclear event content signals |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://vega.nu/events |

**humanLikeDiscoveryReasoning:**
Vega.nu has /events path discovered by C0 rules with highest possible score (10). While C2 score is low (2), this may be due to the homepage not containing events - the /events subpage is likely the actual event listing. Retry-pool to directly test /events page.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang|/konserter|/biljetter`
- appliesTo: Swedish music venue sites (vega, stora-teatern, etc.)
- confidence: 0.75

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.80

**improvementSignals:**
- /events path exists with high score but C1/C2 signals are weak
- C2 score of 2 is below threshold (6) for promising content
- May need to try the /events subpage directly to verify

**suggestedRules:**
- When C0 finds high-scoring event candidates but C1/C2 are weak, try direct navigation to candidate paths
- Vega.nu appears to be a Swedish music venue - /events should be primary event listing

---
