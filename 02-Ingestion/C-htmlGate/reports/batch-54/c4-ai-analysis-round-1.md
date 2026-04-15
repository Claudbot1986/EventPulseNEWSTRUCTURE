## C4-AI Analysis Round 1 (batch-54)

**Timestamp:** 2026-04-15T02:45:13.143Z
**Sources analyzed:** 5

### Overall Pattern
Top failure categories: 2× IDN domain DNS resolution failure, 1× Municipal event page moved, 1× Sports league events need JS render

---

### Source: malmo-redhawks

| Field | Value |
|-------|-------|
| likelyCategory | IDN domain DNS resolution failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.65 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | malmoredhawks.se (ASCII form), /evenemang |
| directRouting | D (conf=0.68) |

**humanLikeDiscoveryReasoning:**
DNS failure on IDN-encoded domain (xn--malmredhawks-7ib.se) suggests the actual site may use ASCII form 'malmoredhawks.se'. Swedish hockey teams typically have event pages under /evenemang or /biljetter. C1 found 0 signals but this is likely due to connection failure rather than missing content.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/biljetter|/matcher`
- appliesTo: Swedish hockey/sports team sites with IDN domains
- confidence: 0.70

**discoveredPaths:**
- https://malmoredhawks.se [derived] anchor="ASCII variant of IDN domain" conf=0.55
- https://malmoredhawks.se/evenemang [derived] anchor="Standard Swedish event path" conf=0.60

**improvementSignals:**
- IDN encoding xn--malmredhawks-7ib.se failed DNS resolution
- Swedish umlaut domains may need alternative URL forms
- Try http://www.malmoredhawks.se or https://malmoredhawks.se

**suggestedRules:**
- For Swedish IDN domains with DNS failures, attempt ASCII-encoded versions (malmoredhawks.se vs xn-- encoding)
- Add retry with www-prefix for sports club venues

---

### Source: linkoping-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | Municipal event page moved |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /kultur, /evenemang, /scenkonst, /teater |

**humanLikeDiscoveryReasoning:**
The URL /stadsteatern returned 404, indicating the page was moved or restructured. Municipal sites (linkoping.se) typically host theater under culture sections. Swedish cities organize cultural venues under /kultur or /scenkonst, with specific venues having sub-pages. The correct path likely is linkoping.se/kultur or linkoping.se/evenemang/stadsteatern.

**candidateRuleForC0C3:**
- pathPattern: `/kultur|/evenemang|/scenkonst`
- appliesTo: Swedish municipal theater and performing arts venues
- confidence: 0.80

**discoveredPaths:**
- /kultur [derived] anchor="Culture section on municipal site" conf=0.72
- /evenemang [derived] anchor="Standard municipal event path" conf=0.75
- /scenkonst [derived] anchor="Performing arts/ theater section" conf=0.68

**improvementSignals:**
- HTTP 404 on /stadsteatern suggests path restructuring
- Municipal site likely hosts events under different section
- Linköping city events are likely in /kultur or /evenemang

**suggestedRules:**
- For municipal URLs returning 404, try /kultur, /scen, /evenemang, /foreningar paths
- City theater venues often have dedicated event calendars under culture sections

---

### Source: svenska-hockeyligan-shl

| Field | Value |
|-------|-------|
| likelyCategory | Sports league events need JS render |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.82 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | /biljetter, /matcher, /spelschema |
| directRouting | D (conf=0.92) |

**humanLikeDiscoveryReasoning:**
SHL has 5 event candidates in C0 but C1 found 0 timeTags and C2 score is only 1. This classic pattern indicates client-side rendering where HTML is empty of event data. Sports league sites (SHL, NHL, etc.) use React/Vue frameworks that inject content after page load. The /biljetter winner URL confirms events exist but require JS render to extract.

**candidateRuleForC0C3:**
- pathPattern: `/biljetter|/matcher|/spelschema`
- appliesTo: Swedish sports league and team sites with ticket/schedule pages
- confidence: 0.85

**discoveredPaths:**
- /biljetter [derived] anchor="Biljetter (Tickets)" conf=0.85
- /matcher [derived] anchor="Matches/Schedule" conf=0.78
- /spelschema [derived] anchor="Game schedule" conf=0.75

**improvementSignals:**
- C0 found 5 event candidates but C1 found 0 timeTags - strong JS render indicator
- Sports league sites often use client-side frameworks for schedules
- C2 score 1 (very low) suggests HTML lacks event structure, not absence of events

**suggestedRules:**
- Sports league/ticket pages with 0 timeTags and low C2 scores should route to D immediately
- SHL and similar sports sites use React/Vue frameworks - D queue handles this

---

### Source: malmo-ff

| Field | Value |
|-------|-------|
| likelyCategory | IDN domain DNS resolution failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.65 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | malmoff.se (ASCII form), /matcher, /evenemang |
| directRouting | D (conf=0.68) |

**humanLikeDiscoveryReasoning:**
Same DNS failure pattern as malmo-redhawks. IDN-encoded xn--malf-d1a.se failed resolution. Malmö FF is a major Swedish football club with substantial event content. The actual site likely uses ASCII domain. Football clubs typically structure events under /matcher or /evenemang for fixtures.

**candidateRuleForC0C3:**
- pathPattern: `/matcher|/evenemang|/biljetter`
- appliesTo: Swedish football club sites with IDN domains
- confidence: 0.72

**discoveredPaths:**
- https://malmoff.se [derived] anchor="ASCII variant of IDN domain" conf=0.58
- https://malmoff.se/matcher [derived] anchor="Matches/Fixtures" conf=0.72

**improvementSignals:**
- Identical DNS pattern to malmo-redhawks - Swedish umlaut domain encoding issue
- xn--malf-d1a.se failed getaddrinfo
- Similar Malmö sports team with IDN domain

**suggestedRules:**
- For Swedish IDN domains with DNS failures, attempt ASCII-encoded versions
- Malmö FF is a major football club - try malmoff.se or malmoff.se/fotboll

---

### Source: partille-arena

| Field | Value |
|-------|-------|
| likelyCategory | Arena events need JS render |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.75 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | /kalender, /kommande-evenemang, /program |
| directRouting | D (conf=0.88) |

**humanLikeDiscoveryReasoning:**
Partille Arena has 8 C0 candidates and a winner URL pointing to an event page, confirming events exist. However, C1 found only 1 date with 0 timeTags, and C2 score is 6 (half the threshold). This indicates the HTML structure lacks event data but events are definitely present - classic JS render scenario. Arena venues use calendar widgets and client-side frameworks for event listings.

**candidateRuleForC0C3:**
- pathPattern: `/kalender|/kommande-evenemang|/program`
- appliesTo: Swedish arena and venue sites with multi-event calendars
- confidence: 0.78

**discoveredPaths:**
- /event/23-maj-asme/ [derived] anchor="Individual event page" conf=0.82
- /kalender [derived] anchor="Calendar" conf=0.70
- /kommande-evenemang [derived] anchor="Upcoming events" conf=0.75

**improvementSignals:**
- C0 found 8 candidates - substantial event presence
- C1 found 1 dateCount but 0 timeTags - indicates JS render
- C2 score 6 (threshold 12) suggests HTML lacks structured event data
- Winner URL is an individual event page /event/23-maj-asme/

**suggestedRules:**
- Venue pages with multiple C0 candidates but low C1/C2 scores need JS rendering
- Arena/multi-event venues often use calendar widgets with client-side rendering

---
