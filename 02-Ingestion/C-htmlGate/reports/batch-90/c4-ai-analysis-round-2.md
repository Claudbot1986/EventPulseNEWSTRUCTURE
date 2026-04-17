## C4-AI Analysis Round 2 (batch-90)

**Timestamp:** 2026-04-16T16:55:39.760Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 4× DNS resolution failure, 1× Site unreachable due to redirect loops, 1× URL path returns 404

---

### Source: sturecompagniet

| Field | Value |
|-------|-------|
| likelyCategory | Site unreachable due to redirect loops |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://sturecompagniet.se/ |

**humanLikeDiscoveryReasoning:**
Site failed to load due to excessive redirects. No event links could be discovered from entry page. Sture Compag is a well-known Swedish restaurant/theater venue. Redirect loops typically indicate misconfigured server settings or temporary infrastructure issues. Retry-pool allows for natural resolution.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/schema|/konserter`
- appliesTo: Swedish theater/restaurant venues
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- Site returns redirect loops (3+ redirects)
- May need HTTPS enforcement or www handling
- DNS resolution may be inconsistent

**suggestedRules:**
- Check robots.txt for any blocking directives
- Test alternative URL patterns (with/without www, with/without trailing slash)
- Monitor for permanent redirect configuration issues

---

### Source: karlstad-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | URL path returns 404 |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.80 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://karlstad.se/stadsteatern |

**humanLikeDiscoveryReasoning:**
The URL https://karlstad.se/stadsteatern returns 404. This is a well-established municipal theater. Swedish municipal sites often restructure their navigation. Common Karlstad paths might be /kultur/konserthus or similar. The retry-pool allows for URL pattern discovery.

**candidateRuleForC0C3:**
- pathPattern: `/stadsteatern|/kulturhus|/scen`
- appliesTo: Swedish municipal theater venues
- confidence: 0.55

**discoveredPaths:**
(none)

**improvementSignals:**
- Specific URL path returns HTTP 404
- Karlstad Stadsteater is a known municipal venue that should exist
- Site structure may have changed

**suggestedRules:**
- Try root domain karlstad.se//upplev/stadsteatern or similar municipal paths
- Try archive.org for historical correct path
- Check if subdomain consolidation occurred

---

### Source: liseberg

| Field | Value |
|-------|-------|
| likelyCategory | Wrong candidate selected - ticket page not event page |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://liseberg.se/, https://liseberg.se/parken/biljetter-priser/ |

**humanLikeDiscoveryReasoning:**
C0 found 10 candidates but selected the ticket pricing page as winner. The page has price markers (score 64) but no event structure. Liseberg events are seasonal attractions. The extraction returned 0 events because the wrong candidate was selected. Need to refine candidate selection to prefer event-indicating URLs over price pages.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/konsertseries|/sasongen|/nyheter`
- appliesTo: Swedish amusement parks and large venues with seasonal events
- confidence: 0.70

**discoveredPaths:**
(none)

**improvementSignals:**
- C0 selected /parken/biljetter-priser/ as winner (ticket prices)
- C2 gave promising score due to price markers (not event markers)
- Liseberg is an amusement park with seasonal events, not traditional event listings

**suggestedRules:**
- Add priority for event-indicating keywords: evenemang, konsert, show, event, program over biljett, pris, köp
- Identify amusement park event structure: /sasongen, /hemsida, /nyheter, /kommande
- Weight anchor text context over page score for candidate selection

---

### Source: gamla-uppsala

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://gamlauppsala.se/ |

**humanLikeDiscoveryReasoning:**
Site returned ENOTFOUND DNS error. This typically indicates domain expiration, DNS misconfiguration, or temporary propagation issues. No event content could be analyzed. Retry-pool is appropriate for DNS-based failures that may self-resolve.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/kalendarium|/program`
- appliesTo: Swedish historical society and local cultural sites
- confidence: 0.40

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND suggests domain may have expired or misconfigured
- gamlauppsala.se is a known historical site association
- May need alternate domain or typo correction

**suggestedRules:**
- Check for domain expiration or DNS propagation issues
- Try www subdomain: www.gamlauppsala.se
- Consider gamla-uppsala.se (hyphen) as alternative
- Monitor for domain renewal

---

### Source: varbergs-if

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://varbergsif.se/ |

**humanLikeDiscoveryReasoning:**
DNS resolution failed for varbergsif.se. Sports clubs often maintain minimal web presence or rely on social media. No event links could be discovered. Retry-pool for DNS resolution, but likely low-value source.

**candidateRuleForC0C3:**
- pathPattern: `/matcher|/evenemang|/kalender|/schema`
- appliesTo: Swedish sports clubs and athletics associations
- confidence: 0.45

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain unreachable
- varbergsif.se is a sports club domain
- May have moved to another domain or social media

**suggestedRules:**
- Check for domain typos: varbergs-if.se, varbergsifotboll.se
- Try facebook.com/varbergsif as alternate source
- Consider that smaller sports clubs may not maintain websites

---

### Source: rockfest-vasteras

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://rockfestvasteras.se/ |

**humanLikeDiscoveryReasoning:**
DNS failed for rockfestvasteras.se. Music festivals often have short-lived web presence or consolidate with ticketing platforms. No event discovery possible due to DNS failure.

**candidateRuleForC0C3:**
- pathPattern: `/program|/lineup|/biljetter|/tickets`
- appliesTo: Swedish music festivals and concert venues
- confidence: 0.40

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain may have expired
- Rockfest Vasteras is a music festival
- Festival may have ended, moved, or rebranded

**suggestedRules:**
- Search for Vasteras Rock Festival via web search
- Check if event moved to vasteras.se or major ticketing platforms
- Verify if festival is seasonal (summer only) and site is down off-season

---

### Source: sydsvenskan

| Field | Value |
|-------|-------|
| likelyCategory | Events section URL returns 404 |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://sydsvenskan.se/evenemang |

**humanLikeDiscoveryReasoning:**
Sydsvenskan /evenemang returns 404. The newspaper may have restructured their site, removed event listings, or integrated them into other sections. Need to probe main domain for current event paths.

**candidateRuleForC0C3:**
- pathPattern: `/kultur|/noje|/event|/aktuellt`
- appliesTo: Swedish newspapers and media sites
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- /evenemang path returns HTTP 404
- Sydsvenskan is a major Swedish newspaper
- Events section may have been moved or removed

**suggestedRules:**
- Try main sydsvenskan.se domain for navigation links
- Check if events moved to subsections like /kultur/evenemang
- Major newspapers often integrate events into article feeds

---

### Source: vasamuseet

| Field | Value |
|-------|-------|
| likelyCategory | JS-rendered event listing not extracted |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.72 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /kalender, /schema, /evenemang, /kalendarium, /aktiviteter |
| directRouting | D (conf=0.78) |

**humanLikeDiscoveryReasoning:**
vasamuseet.se has strong event-indicating links discovered by derived rules. The C0 found 7 candidate paths including /events, /program, /kalender. Despite promising C2 score, extraction returned 0 events. Zero timeTags and zero dateCount in c1 despite visible event links strongly suggests JS-rendered content. The /aktiviteter path (highest-scoring derived rule) should be routed to D for render fallback.

**candidateRuleForC0C3:**
- pathPattern: `/aktiviteter|/events|/program|/kalendarium`
- appliesTo: Swedish museum and cultural institution websites
- confidence: 0.80

**discoveredPaths:**
- /aktiviteter [derived] anchor="derived-rule" conf=0.75

**improvementSignals:**
- C2 promising score (9) but extraction returned 0
- c1LikelyJsRendered=false but 0 timeTags and 0 dateCount
- Strong derived rule links found: /events, /program, /kalender, /evenemang
- Page likely renders content client-side after initial HTML load

**suggestedRules:**
- Enable JS rendering fallback (D route) for vasamuseet.se
- /aktiviteter and /evenemang paths should be fetched with render enabled
- Museum sites frequently use React/Vue frameworks for dynamic content

---

### Source: ralambshovsparken

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://ralambshov.se/ |

**humanLikeDiscoveryReasoning:**
DNS failed for ralambshov.se. The correct domain may be ralambshovsparken.se (with proper spelling). Stockholm municipal parks often list events on stockholm.se. Retry-pool allows for domain correction discovery.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/aktiviteter|/kalender`
- appliesTo: Swedish city parks and recreational venues
- confidence: 0.45

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - site unreachable
- ralambshovparken.se may be the correct domain (with 'parken')
- Stockholm park events may be managed by municipal sites

**suggestedRules:**
- Try ralambshovsparken.se (proper spelling with 'sparken')
- Check stockholm.se for park event listings
- Small venues often use facebook events instead of websites

---

### Source: nationalmuseum

| Field | Value |
|-------|-------|
| likelyCategory | Low signal extraction from calendar page |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.80 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /kalendarium |

**humanLikeDiscoveryReasoning:**
Nationalmuseum's /kalendarium scored 4 in C2 (unclear) just below threshold. The museum should have substantial events. Zero timeTags despite promising page structure suggests extraction pattern mismatch or deep content requiring pagination. Retry-pool allows for alternative path testing (/utstallningar, /evenemang) or pattern refinement.

**candidateRuleForC0C3:**
- pathPattern: `/kalendarium|/utstallningar|/visningar|/evenemang`
- appliesTo: Swedish national and regional museums
- confidence: 0.70

**discoveredPaths:**
- /kalendarium [derived] anchor="derived-rule" conf=0.60

**improvementSignals:**
- C2 score 4 (unclear) - barely below threshold of 6
- C0 found /kalendarium as candidate (lowest viable path)
- c1Verdict noise with 0 timeTags suggests page needs deeper extraction
- Nationalmuseum.se should have substantial event program

**suggestedRules:**
- Try alternative museum paths: /utstallningar, /visningar, /evenemang
- National museum sites often have dedicated exhibition pages separate from calendar
- Consider fetching multiple subpages and aggregating events
- Lower C2 threshold for known institutional sources

---
