## C4-AI Analysis Round 1 (batch-43)

**Timestamp:** 2026-04-15T02:05:45.849Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 3× DNS resolution failure, 2× Request timeout, 2× HTTP 404 on event path

---

### Source: karlskrona-hf

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /evenemang, /kalender, /program |

**humanLikeDiscoveryReasoning:**
c0LinksFound is empty array - no links discovered on entry page. Network fetch failed with ENOTFOUND. Cannot perform human-like navigation discovery without any page content to analyze. All standard Swedish event paths attempted but unreachable at DNS level.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang|/kalender|/program`
- appliesTo: Swedish cultural/sports sites
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution failure - domain may be defunct or misspelled
- No network path available to attempt discovery

**suggestedRules:**
- Verify domain spelling: karlskronahf.se appears correct but DNS fails
- Check if site migrated to new domain or subdomain

---

### Source: vega

| Field | Value |
|-------|-------|
| likelyCategory | Cross-domain redirect blocked |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /evenemang, /kalender, /program |

**humanLikeDiscoveryReasoning:**
c0LinksFound is empty - no links available for discovery. Cross-domain redirect detected: vega.nu → tobiasnygren.se. The original source domain redirects away, making event discovery on vega.nu impossible. Would need to analyze tobiasnygren.se for events.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang|/kalender`
- appliesTo: Swedish local news/cultural sites
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- Cross-domain redirect blocked: vega.nu redirects to tobiasnygren.se
- Domain may have been absorbed or redirected

**suggestedRules:**
- Investigate tobiasnygren.se as potential event source
- Verify if vega.nu domain ownership changed

---

### Source: vasteras-sk

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /evenemang, /kalender, /program |

**humanLikeDiscoveryReasoning:**
c0LinksFound is empty - no page content to analyze. Network failure at DNS level prevents any human-like discovery. Domain vastersask.se cannot be resolved.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang|/laget`
- appliesTo: Swedish sports club sites
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain vastersask.se unreachable
- Possible domain expiry or misspelling

**suggestedRules:**
- Verify domain: vastersask.se vs vastersask.se (check spelling)
- Search for Västerås SK official site via web search

---

### Source: goteborgs-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | Connection refused |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /evenemang, /kalender, /program |

**humanLikeDiscoveryReasoning:**
c0LinksFound is empty - no content available for link analysis. Connection refused at network level (ECONNREFUSED). Server is reachable but actively rejecting connections - likely firewall, IP blocking, or Cloudflare protection.

**candidateRuleForC0C3:**
- pathPattern: `/events|/scen`
- appliesTo: Swedish theater sites
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- Connection refused on port 443 - server up but blocking/scoped
- IP 139.162.135.242 actively rejecting connections

**suggestedRules:**
- Check if IP is geoblocked or requires specific headers
- Verify server firewall or Cloudflare protection

---

### Source: kalmar-teatern

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /evenemang, /kalender, /program |

**humanLikeDiscoveryReasoning:**
c0LinksFound is empty - no page content available. Network failure at DNS level (ENOTFOUND). Human-like discovery cannot proceed without any accessible page content.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang`
- appliesTo: Swedish theater venues
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - kalmarteatern.se domain not found
- Possible incorrect domain spelling

**suggestedRules:**
- Verify correct domain: kalmarteatern.se or kalmarkonstmuseum.se
- Search for Kalmar Teater official site

---

### Source: frolunda-hc

| Field | Value |
|-------|-------|
| likelyCategory | Request timeout |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.93 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /evenemang, /matcher, /program |
| directRouting | D (conf=0.65) |

**humanLikeDiscoveryReasoning:**
c0LinksFound is empty - page content not retrieved. Request timeout suggests server is slow to respond or overloaded. Without any c0LinksFound data, cannot perform human-like navigation discovery. Timeout may indicate JS-heavy site requiring D-stage rendering.

**candidateRuleForC0C3:**
- pathPattern: `/events|/matcher|/lag`
- appliesTo: Swedish hockey club sites
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- Request timeout after 20000ms - server slow or unresponsive
- Site may be behind heavy CDN/WAF protection

**suggestedRules:**
- Retry with increased timeout (30-60s)
- Check if frolundaindians.com requires JS rendering

---

### Source: spanggatan

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure (IDN) |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /evenemang, /kalender, /program |

**humanLikeDiscoveryReasoning:**
c0LinksFound is empty - no content available. DNS resolution failed on punycode domain. Human-like discovery impossible without accessible page content.

**candidateRuleForC0C3:**
- pathPattern: `/events`
- appliesTo: Swedish venue sites
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND on IDN domain xn--spnggatan-62a.se
- Punycode conversion may have failed

**suggestedRules:**
- Verify punycode encoding: spånggatan.se → xn--spnggatan-62a.se
- Try ASCII variant of domain

---

### Source: jazzfestivalen-goteborg

| Field | Value |
|-------|-------|
| likelyCategory | Request timeout |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.93 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /biljetter, /lineup |

**humanLikeDiscoveryReasoning:**
c0LinksFound is empty - no page content retrieved. Request timeout prevents any link analysis. Human-like discovery cannot proceed. Festival site may be seasonal (Gothenburg Jazz Festival typically runs in summer).

**candidateRuleForC0C3:**
- pathPattern: `/program|/lineup|/biljetter`
- appliesTo: Swedish music festival sites
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- Request timeout after 20000ms - possible high traffic or DDoS protection
- Festival site may be seasonal/inactive

**suggestedRules:**
- Retry with extended timeout
- Check if festival has annual schedule with archive

---

### Source: umea-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | HTTP 404 on event path |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /konserthus, /evenemang, /kalender, /konserter |

**humanLikeDiscoveryReasoning:**
Source URL https://umea.se/konserthus returned 404. The /konserthus path does not exist. However, the root umea.se domain is likely valid. Human-like discovery should attempt to find konserthus events via root domain navigation or alternative path patterns.

**candidateRuleForC0C3:**
- pathPattern: `/konserthus|/evenemang|/kalender|/konserter`
- appliesTo: Swedish concert hall/music venues
- confidence: 0.70

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on /konserthus path - URL structure may have changed
- Root umea.se might still be accessible

**suggestedRules:**
- Try root domain umea.se for event navigation
- Check if konserthus moved to different URL structure

---

### Source: karolinska-institutet

| Field | Value |
|-------|-------|
| likelyCategory | HTTP 404 on event path |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /om/arrangement, /events, /kalender, /english |

**humanLikeDiscoveryReasoning:**
Source URL https://ki.se/om/arrangement returned 404. The event listing path has changed or been removed. Karolinska Institutet likely still hosts events but at a different URL. Human-like discovery should try root domain and alternative event paths.

**candidateRuleForC0C3:**
- pathPattern: `/om/arrangement|/kalender|/events|/aktuellt|/english/events`
- appliesTo: Swedish university/research institution sites
- confidence: 0.70

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on /om/arrangement - KI event path may have changed
- Root ki.se might have updated event structure

**suggestedRules:**
- Try ki.se root or /en for English event listing
- Check KI's current event/calendar URL structure

---
