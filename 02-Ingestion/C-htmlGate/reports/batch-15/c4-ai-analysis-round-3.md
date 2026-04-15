## C4-AI Analysis Round 3 (batch-15)

**Timestamp:** 2026-04-12T07:56:40.970Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 4× Subpage discovery needed, 2× Wrong entry page, 1× Municipality event path missing

---

### Source: bk-hacken

| Field | Value |
|-------|-------|
| likelyCategory | Subpage discovery needed |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.75 |
| nextQueue | manual-review |

**improvementSignals:**
- API-like structure found (18 errors) but no usable endpoints
- No 404s on entry page - events likely behind navigation
- Swedish sports club site - events should exist

**suggestedRules:**
- Sites with failed API discovery + no 404s likely have hidden event pages
- Swedish .se sites with sports/culture content should try /evenemang or /kalendarium subpage patterns
- Consecutive 2 failures on network path indicates structural mismatch

---

### Source: blekholmen

| Field | Value |
|-------|-------|
| likelyCategory | Wrong entry page |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.70 |
| nextQueue | manual-review |

**improvementSignals:**
- Root URL shows no event candidates
- API approach generated 18 errors with no usable output
- 0 likely candidates from network path

**suggestedRules:**
- Swedish venue/restaurant sites need /evenemang or /kalender entry points
- Sites with API errors but no 404s likely have events elsewhere on domain
- Root URL for venue sites frequently lacks event content

---

### Source: boplanet

| Field | Value |
|-------|-------|
| likelyCategory | Subpage discovery needed |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.72 |
| nextQueue | manual-review |

**improvementSignals:**
- API structure attempted (18 errors) but no usable data
- 0 likely candidates from breadth analysis
- No 404s - events may exist but undiscovered

**suggestedRules:**
- Swedish cultural/activity sites should try /evenemang or /aktiviteter subpages
- API-like structures failing to yield events suggests content on different paths
- Network path failure + no 404s = events likely on alternate URLs

---

### Source: borlange-kommun

| Field | Value |
|-------|-------|
| likelyCategory | Municipality event path missing |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.80 |
| nextQueue | manual-review |

**improvementSignals:**
- 19 404s indicates active path discovery was attempted
- Municipal government site - events should be present
- All 404s on tested paths - wrong entry page likely

**suggestedRules:**
- Swedish municipality sites use /kultur, /fritid, /evenemang, or /kalender for events
- Government sites with high 404 counts on network path need different entry URL
- Municipal sites frequently have events on dedicated subdomain or path

---

### Source: botaniska-tradgarden

| Field | Value |
|-------|-------|
| likelyCategory | JS rendering likely |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.68 |
| nextQueue | D |

**improvementSignals:**
- API structure found but no usable endpoints
- 18 404s and 18 errors on network path
- Botanical garden site likely uses modern web stack

**suggestedRules:**
- Botanical/garden/cultural venues frequently use JS-rendered event calendars
- Sites with detected API structure but no usable data may need D (render) path
- Swedish cultural venues increasingly use client-side rendering

---

### Source: brommapojkarna

| Field | Value |
|-------|-------|
| likelyCategory | Subpage discovery needed |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.73 |
| nextQueue | manual-review |

**improvementSignals:**
- API structure attempted (18 errors) with no usable output
- Sports club site should have events
- No 404s - events likely behind different paths

**suggestedRules:**
- Sports club sites need /matcher, /kalender, or /evenemang path patterns
- API errors with no 404s suggests wrong entry page, not missing content
- Swedish sports sites use /match, /evenemang, or /spelprogram for events

---

### Source: chalmers

| Field | Value |
|-------|-------|
| likelyCategory | Wrong entry page or JS render |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.70 |
| nextQueue | manual-review |

**improvementSignals:**
- University site - should have events (lectures, seminars, conferences)
- 19 404s indicates extensive but unsuccessful path testing
- API structure not yielding usable event data

**suggestedRules:**
- Swedish university sites use /kalender, /evenemang, or /aktuellt for campus events
- Large institutions with 404s need institutional-specific path patterns
- University sites often have separate event systems or subdomains

---

### Source: cirkus

| Field | Value |
|-------|-------|
| likelyCategory | Subpage discovery needed |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.74 |
| nextQueue | manual-review |

**improvementSignals:**
- Event venue site with 12 404s and 19 errors
- Cirkus is a venue - events should exist but root URL shows none
- Swedish venue sites hide event content behind /biljetter or /evenemang

**suggestedRules:**
- Swedish event venues use /biljetter, /evenemang, or /program for event listings
- Venue sites with API errors likely need ticket-system path patterns
- Event venues almost never have events on root URL

---

### Source: club-mecca

| Field | Value |
|-------|-------|
| likelyCategory | Wrong entry page |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.76 |
| nextQueue | manual-review |

**improvementSignals:**
- Nightclub/entertainment venue with API errors but no usable data
- 0 likely candidates from root URL
- Swedish nightlife venues use /evenemang or /klubb-kalender paths

**suggestedRules:**
- Nightclub/entertainment venues need /evenemang or /klubbar path patterns
- Entertainment venues frequently have separate event microsites or pages
- Root URL for clubs typically shows contact/info, not event listings

---

### Source: dalarna

| Field | Value |
|-------|-------|
| likelyCategory | Wrong entry page or path |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.72 |
| nextQueue | manual-review |

**improvementSignals:**
- Regional tourism/activity site with 18 API errors
- Dalarna region has significant event content
- No 404s - content exists but not on tested paths

**suggestedRules:**
- Swedish regional sites use /evenemang, /upplevelser, or /aktiviteter for events
- Tourism/region sites with API errors need regional-specific path patterns
- Region sites often have event sections under /kultur or /fritid

---
