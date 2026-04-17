## C4-AI Analysis Round 1 (batch-79)

**Timestamp:** 2026-04-16T21:38:41.052Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 2× DNS resolution failed, 1× 404 on entry page, 1× SSL certificate verification failed

---

### Source: halmstad-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | 404 on entry page |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://halmstad.se/stadsteatern |

**humanLikeDiscoveryReasoning:**
Page returned 404. Halmstad municipality (halmstad.se) typically organizes cultural venues under /kultur or similar subsections. The /stadsteatern path appears to have changed or requires different URL structure.

**candidateRuleForC0C3:**
- pathPattern: `/kultur/stadsteatern|/scenkonst|/teater`
- appliesTo: Swedish municipal theater pages that return 404
- confidence: 0.60

**discoveredPaths:**
(none)

**improvementSignals:**
- URL returned HTTP 404 - subpage may have moved or renamed
- Halmstad municipality site structure suggests /kultur or /evenemang paths

**suggestedRules:**
- Try /kultur/stadsteatern as alternate path for Halmstad theater events
- Check if halmstad.se uses /kulturutbud or /scenkonst for theater listings

---

### Source: ruddalen

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failed |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS resolution failed with ENOTFOUND - the domain ruddalen.se cannot be resolved to an IP address. This is a terminal failure requiring manual verification of the correct domain.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND indicates domain does not exist or is unreachable
- Cannot attempt any discovery without successful DNS resolution

**suggestedRules:**
- Verify domain spelling - ruddalen.se may not be registered
- Could be regional facility with events hosted on parent municipality domain

---

### Source: falun-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | SSL certificate verification failed |
| failCategory | robots_or_policy_blocked |
| failCategoryConfidence | 0.85 |
| nextQueue | manual-review |
| discoveryAttempted | false |
| discoveryPathsTried | https://falu.se/stadsteatern |

**humanLikeDiscoveryReasoning:**
SSL certificate verification failed due to root CA not installed locally. This blocks all network access to the domain. Node.js may need --use-system-ca flag or manual SSL configuration.

**discoveredPaths:**
(none)

**improvementSignals:**
- Certificate verification error suggests SSL misconfiguration
- Unable to verify root CA - could be Node.js SSL configuration issue

**suggestedRules:**
- Try with NODE_TLS_REJECT_UNAUTHORIZED=0 or system CA installation
- Could indicate site uses non-standard certificate chain

---

### Source: goteborgs-stadsbibliotek

| Field | Value |
|-------|-------|
| likelyCategory | Wrong domain in URL |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.90 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://goteborgsstad.se/bibliotek |

**humanLikeDiscoveryReasoning:**
Certificate mismatch reveals correct domain is goteborg.se. The old domain goteborgsstad.se has been deprecated. Need to retry with correct domain.

**candidateRuleForC0C3:**
- pathPattern: `https://goteborg.se/*替换旧域名模式`
- appliesTo: Gothenburg municipal sites that migrated from goteborgsstad.se
- confidence: 0.85

**discoveredPaths:**
(none)

**improvementSignals:**
- Certificate altnames show correct domain is goteborg.se not goteborgsstad.se
- URL pattern suggests migration from subdomain to main domain

**suggestedRules:**
- Correct URL should be https://goteborg.se/bibliotek
- Gothenburg municipal sites consolidated to goteborg.se domain

---

### Source: neon

| Field | Value |
|-------|-------|
| likelyCategory | Strong event links found but JS rendering suspected |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.80 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | https://neon.se/ |
| directRouting | D (conf=0.82) |

**humanLikeDiscoveryReasoning:**
C0 discovered 29 event-indicating links with strong scores. High link density suggests proper site structure but c1 shows no-main content. This indicates SPA where content loads after initial HTML. Direct routing to D for JS rendering.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender`
- appliesTo: Swedish cultural/entertainment sites with SPA architecture
- confidence: 0.80

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.90
- /program [nav-link] anchor="derived-rule" conf=0.85
- /kalender [nav-link] anchor="derived-rule" conf=0.80

**improvementSignals:**
- c0LinksFound contains 29 event-indicating paths with high scores
- Top candidates: /events (10), /program (9), /kalender (8) all scored high
- c1 shows no-main despite strong link signals - suggests SPA architecture

**suggestedRules:**
- Direct routing to D (JS render) recommended due to SPA behavior
- c0 derived rules show this site has proper event navigation structure

---

### Source: studio-acusticum

| Field | Value |
|-------|-------|
| likelyCategory | Redirect loop on event page |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://studioacusticum.se/evenemang |
| directRouting | D (conf=0.75) |

**humanLikeDiscoveryReasoning:**
c0Candidates=6 shows this site has event structure but /evenemang causes redirect loop. Need to try alternate Swedish event paths that don't trigger the loop. /schema and /program are common alternatives for concert venues.

**candidateRuleForC0C3:**
- pathPattern: `/schema|/program|/konserter|/biljetter`
- appliesTo: Concert venues that may have redirect loops on /evenemang
- confidence: 0.70

**discoveredPaths:**
- /schema [url-pattern] anchor="derived-rule" conf=0.70
- /program [url-pattern] anchor="derived-rule" conf=0.65

**improvementSignals:**
- c0Candidates=6 found but c0WinnerUrl redirects to /evenemang causing loop
- Try alternate event paths: /schema, /program, /konserter
- Redirect loop may indicate dynamic content requiring JS

**suggestedRules:**
- Try /schema as alternate for academic/conference event listings
- Try /program for concert/cultural venue programming
- Check if site uses query parameters for event filtering

---

### Source: goteborgs-kulturfestival

| Field | Value |
|-------|-------|
| likelyCategory | SSL certificate mismatch |
| failCategory | robots_or_policy_blocked |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | false |
| discoveryPathsTried | https://kulturfestivalen.se/ |

**humanLikeDiscoveryReasoning:**
SSL certificate mismatch prevents network access. Certificate is valid for *.one.com but not for kulturfestivalen.se. This is a terminal SSL configuration issue requiring manual intervention.

**discoveredPaths:**
(none)

**improvementSignals:**
- Certificate shows *.one.com - site hosted on One.com
- Hostname mismatch indicates possible phishing protection or misconfiguration
- Cannot verify certificate validity for kulturfestivalen.se

**suggestedRules:**
- Verify domain ownership and correct SSL configuration
- May need to use HTTP instead of HTTPS if certificate is misconfigured

---

### Source: stockholm-jazz-festival

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failed |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS resolution failed with ENOTFOUND for stojazz.se. Domain is unreachable. Festival may have moved to different domain or be hosted on event platform.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND indicates domain does not exist or is misspelled
- Possible alternative: stockholmjazz.se or stockholm-jazz.se

**suggestedRules:**
- Verify correct domain - may be stockholmjazz.se or similar variation
- Festival may be hosted on event platform like ticketmaster.se
- Could be subdomain of larger jazz festival organization

---

### Source: unt-uppsala

| Field | Value |
|-------|-------|
| likelyCategory | 404 on event subpage |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.80 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://unt.se/evenemang |

**humanLikeDiscoveryReasoning:**
Event-specific URL /evenemang returned 404. Need to discover event content from homepage instead. News sites often reorganize event sections or use different URL patterns.

**candidateRuleForC0C3:**
- pathPattern: `/kultur|/nolat|/traffik|/lokalt`
- appliesTo: Swedish regional news sites where /evenemang returns 404
- confidence: 0.65

**discoveredPaths:**
(none)

**improvementSignals:**
- URL /evenemang returned 404 - event section may have moved
- Try homepage unt.se for event navigation
- Swedish news sites often have event sections at /kultur or /nolat

**suggestedRules:**
- Try unt.se homepage for event section discovery
- Try /kultur or /nolat as alternate event paths
- News site events may be under /traffik or /lokalt

---

### Source: lulea-tekniska-universitet

| Field | Value |
|-------|-------|
| likelyCategory | C2 promising but extraction failed |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://ltu.se/aktuellt/kalender |
| directRouting | D (conf=0.78) |

**humanLikeDiscoveryReasoning:**
C2 promising (score 14) but C3 extraction failed. High score indicates event content exists but HTML structure doesn't match extraction patterns. Calendar may use JS rendering or non-standard HTML structure. Retry with different extraction approach or D route.

**candidateRuleForC0C3:**
- pathPattern: `/aktuellt/kalender|/kalender|/schema`
- appliesTo: Swedish university and academic institution calendars
- confidence: 0.80

**discoveredPaths:**
- /aktuellt/kalender [url-pattern] anchor="derived-rule" conf=0.90

**improvementSignals:**
- c2Score=14 indicates high event likelihood at /aktuellt/kalender
- C3 extraction returned 0 events despite strong C2 signals
- Pattern mismatch likely due to calendar page structure

**suggestedRules:**
- LTU calendar may use JavaScript-rendered calendar widget
- Try date-specific URL parameters or pagination
- Check if events are in JSON/embedded data rather than HTML
- Luleå university calendar may use separate event system

---
