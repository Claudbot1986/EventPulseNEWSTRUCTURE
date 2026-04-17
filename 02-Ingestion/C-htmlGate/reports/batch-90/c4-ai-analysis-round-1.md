## C4-AI Analysis Round 1 (batch-90)

**Timestamp:** 2026-04-16T16:53:53.563Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 4× DNS resolution failure, 1× Redirect loop blocking access, 1× 404 on current URL path

---

### Source: sturecompagniet

| Field | Value |
|-------|-------|
| likelyCategory | Redirect loop blocking access |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
No paths could be discovered due to c0LinksFound being empty. The site blocks access via redirect loop at C1 stage.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- c1 shows redirect loop exceeding 3 redirects - site may have changed domains
- c0LinksFound empty - no navigation data available to work with

**suggestedRules:**
- Investigate if site moved to different domain or has redirect rules that need handling
- Add redirect-following logic to handle multi-step redirects

---

### Source: karlstad-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | 404 on current URL path |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /program, /kalender, /evenemang |

**humanLikeDiscoveryReasoning:**
Current URL /stadsteatern returns 404. Human-like reasoning: municipal Swedish sites typically organize theater events under /program or /kalender. The path structure suggests events should be accessible via these standard Swedish event paths.

**candidateRuleForC0C3:**
- pathPattern: `/program|/kalender|/schema`
- appliesTo: Swedish municipal theater and cultural sites
- confidence: 0.70

**discoveredPaths:**
- /program [url-pattern] anchor="program" conf=0.60

**improvementSignals:**
- Page returns HTTP 404 - URL structure may have changed
- Swedish municipal theaters often use /program or /kalender paths

**suggestedRules:**
- Try /program path for municipal theater event listings
- Try root domain for theater subsite navigation

---

### Source: liseberg

| Field | Value |
|-------|-------|
| likelyCategory | Wrong subpage selected for events |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.80 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /händelser, /event, /nyheter |

**humanLikeDiscoveryReasoning:**
C2 found promising content on biljetter-priser page but this is a pricing page. Major attractions like Liseberg typically have dedicated event/activity pages separate from ticket purchasing. C0Candidates=10 indicates navigation exists that could lead to event listings.

**candidateRuleForC0C3:**
- pathPattern: `/event|/händelser|/nyheter|/program`
- appliesTo: Swedish amusement parks and major attractions
- confidence: 0.75

**discoveredPaths:**
(none)

**improvementSignals:**
- C2 promising (score=64) was on price page - not event listing
- C0 candidates=10 suggests navigation links exist
- Liseberg is major theme park - should have dedicated events page

**suggestedRules:**
- Liseberg likely has /händelser or /nyheter or /event pages separate from tickets
- Price pages often link to event listings - extract nav links from price-marker pages

---

### Source: gamla-uppsala

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS resolution failure prevents any network access. Domain may be inactive, misspelled, or blocked. No discovered paths available due to complete connectivity failure.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND indicates domain is unreachable or typo

**suggestedRules:**
- Verify domain spelling: gamlauppsala.se vs gamla-uppsala.se vs uppsala.se/gamla

---

### Source: varbergs-if

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS resolution failure. Domain varbergsif.se cannot be resolved. Sports club sites may have migrated or use alternative domains.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND indicates domain is unreachable
- Verify if club uses different domain structure

**suggestedRules:**
- Check if domain should be varbergsif.se or similar variation
- Sports clubs sometimes use .com or organizational domains

---

### Source: rockfest-vasteras

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS failure. Rock festival sites frequently go dormant after events end. Domain may need verification or alternative sources should be checked.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND indicates domain is unreachable
- Festival may have ended or moved to different domain

**suggestedRules:**
- Check if festival still exists and uses alternate domain
- Festival sites often go offline after event ends

---

### Source: sydsvenskan

| Field | Value |
|-------|-------|
| likelyCategory | Events path returned 404 |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.80 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /, /kultur, /nöje |

**humanLikeDiscoveryReasoning:**
Sydsvenskan's /evenemang path returns 404. Newspapers frequently restructure their event content. Starting from root domain and looking for Kultur or Nöje sections might reveal event listings.

**candidateRuleForC0C3:**
- pathPattern: `/|/kultur|/nöje|/tipset`
- appliesTo: Swedish newspaper and media sites
- confidence: 0.60

**discoveredPaths:**
- / [url-pattern] anchor="root" conf=0.50

**improvementSignals:**
- /evenemang returns 404 - newspaper events section moved
- News sites restructure content frequently
- Try root domain for current events landing

**suggestedRules:**
- Try root domain instead of /evenemang for newspaper event listings
- Swedish newspapers often embed events in section pages rather than dedicated paths

---

### Source: vasamuseet

| Field | Value |
|-------|-------|
| likelyCategory | Promising subpage not extracting events |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /program, /kalendarium, /evenemang, /aktiviteter |

**humanLikeDiscoveryReasoning:**
vasamuseet.se has 7 derived rule paths suggesting event content exists. The /aktiviteter page was selected but extraction failed. Human-like analysis: museum programs are typically under /program (schedule) or /kalendarium (calendar). These are standard museum event structures in Swedish. Should try these paths explicitly.

**candidateRuleForC0C3:**
- pathPattern: `/program|/kalendarium|/evenemang`
- appliesTo: Swedish museum and cultural institution sites
- confidence: 0.88

**discoveredPaths:**
- /program [derived] anchor="derived-rule" conf=0.90
- /kalendarium [derived] anchor="derived-rule" conf=0.85
- /evenemang [derived] anchor="derived-rule" conf=0.80

**improvementSignals:**
- c0LinksFound has 7 derived rule paths suggesting event content exists
- /aktiviteter was selected as winner but extraction failed
- /program and /kalendarium are strong candidates

**suggestedRules:**
- Try /program path - museum calendar pages often use this structure
- /kalendarium is direct Swedish calendar term with high event likelihood
- Museum extraction may need specific schema.org handling

---

### Source: ralambshovsparken

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS failure. Swedish park events are often managed through municipal websites rather than dedicated park domains. The park may be on stockholm.se or similar.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND indicates domain is unreachable
- Park may be managed by Stockholm city under different domain

**suggestedRules:**
- Check if park events are on Stockholm city site instead
- Parks often integrate with municipal event systems

---

### Source: nationalmuseum

| Field | Value |
|-------|-------|
| likelyCategory | Low signal from event page |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.70 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Nationalmuseum's /kalendarium scored only 4 (below threshold of 6) and was flagged as noise. This suggests either the page lacks event HTML signals or events are rendered differently. Low HTML signal could indicate JS-rendering or external calendar integration. Human-like: museums often use complex calendar widgets. Should send to manual-review for visual verification.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- C2 score=4 below threshold of 6
- kalendarium page flagged as noise rather than events
- Museum may use JS-rendered calendar or external ticketing

**suggestedRules:**
- Verify if kalendarium page has actual event content
- Museum calendars often load via JS - consider D route
- May need schema.org extraction with broader selectors

---
