## C4-AI Analysis Round 2 (batch-15)

**Timestamp:** 2026-04-12T07:54:40.078Z
**Sources analyzed:** 9

### Overall Pattern
Top failure categories: 1× Sparse niche events, 1× Sports club events, 1× Venue with events on subpages

---

### Source: goteborgs-arkitekturgalleri

| Field | Value |
|-------|-------|
| likelyCategory | Sparse niche events |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.65 |
| nextQueue | manual-review |

**improvementSignals:**
- Architecture gallery with infrequent events
- Entry page shows no event-prominent structure
- 2 consecutive failures with zero candidates

**suggestedRules:**
- If domain contains 'galleri' or 'museum' and c0Candidates=0 across attempts, flag as low-value
- Set lower priority for cultural venues with infrequent scheduling

---

### Source: bk-hacken

| Field | Value |
|-------|-------|
| likelyCategory | Sports club events |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |

**improvementSignals:**
- Sports club likely has events in /kalender or /evenemang subsection
- Root URL shows generic site structure, not events page
- 18 API errors indicate wrong endpoint probing

**suggestedRules:**
- For sports club domains, first discover /kalender, /evenemang, /matches, /events subpages
- If root yields 404s and no c0Candidates, do subpage crawl before giving up

---

### Source: blekholmen

| Field | Value |
|-------|-------|
| likelyCategory | Venue with events on subpages |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |

**improvementSignals:**
- Venue/restaurant site with events likely in separate section
- Root page not event-centric based on evidence
- 1 failure only, not exhausted

**suggestedRules:**
- For venue/restaurant domains, look for /evenemang, /kalender, /event subpaths
- HTML extraction should target event list containers on subpages

---

### Source: boplanet

| Field | Value |
|-------|-------|
| likelyCategory | Event listings on subpage |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.68 |
| nextQueue | retry-pool |

**improvementSignals:**
- Domain name suggests event-related content
- Root URL did not yield event data despite 18 errors
- Events likely exist but on discovered subpage

**suggestedRules:**
- When domain hints at events but root fails, crawl for /kalender, /events, /evenemang links
- Set broader subpage discovery threshold for event-indicating domains

---

### Source: borlange-kommun

| Field | Value |
|-------|-------|
| likelyCategory | Large municipal site, events buried |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |

**improvementSignals:**
- Municipal site with 18 404s indicates wrong section
- Events for municipalities typically in /bo-och-leva/kalender or similar
- High 404 count but only 1 failure

**suggestedRules:**
- For kommun/kommune domains, use known municipal event URL patterns
- Municipal sites often use same CMS patterns: /kalender, /nyheter-och-kalender, /evenemang

---

### Source: botaniska-tradgarden

| Field | Value |
|-------|-------|
| likelyCategory | Visitor attraction with events |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.72 |
| nextQueue | retry-pool |

**improvementSignals:**
- Botanical garden likely has seasonal events on dedicated page
- 18 404s from root suggests events not on homepage
- Visitor attractions typically have /evenemang or /kalender

**suggestedRules:**
- For visitor attractions (trädgård, museum, zoo), look for /kalender, /program, /evenemang subpages
- These sites often use same event CMS as tourism boards

---

### Source: brommapojkarna

| Field | Value |
|-------|-------|
| likelyCategory | Sports club events page |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.72 |
| nextQueue | retry-pool |

**improvementSignals:**
- Brommapojkarna is a football club with regular matches/events
- Root shows no event data, events likely in /matcher or /kalender
- Only 1 failure, worth another attempt

**suggestedRules:**
- Sports clubs commonly use /matcher, /kalender, /program, /evenemang for event listings
- For sports domains, check for football-specific URL patterns before concluding failure

---

### Source: centuri

| Field | Value |
|-------|-------|
| likelyCategory | Corporate site with no events |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.60 |
| nextQueue | manual-review |

**improvementSignals:**
- 18 404s indicates site structure issues or wrong entry
- Domain centuri.se suggests corporate/business rather than events
- Low likelihood of public event listings

**suggestedRules:**
- If domain is company/corporate name and shows 404-heavy pattern, check if events section exists
- Corporate sites with no /kalender or /events links are likely low-value for events

---

### Source: chalmers

| Field | Value |
|-------|-------|
| likelyCategory | Large institution, events not on root |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |

**improvementSignals:**
- Chalmers is a large university with many events
- 19 404s from root indicates events are in specific subsections
- University events typically at /kalender, /event, /nyheter or student portals

**suggestedRules:**
- For university domains (.edu, chalmers.se), use known event URL patterns like /kalender, /events, /aktuellt
- Universities often have separate student event portals with different structures

---
