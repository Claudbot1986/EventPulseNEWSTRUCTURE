## C4-AI Analysis Round 1 (batch-14)

**Timestamp:** 2026-04-11T20:12:11.711Z
**Sources analyzed:** 9

### Overall Pattern
Top failure categories: 1× No HTML extraction attempted, 1× University events page not crawled, 1× Low event volume site

---

### Source: naturhistoriska-riksmuseet

| Field | Value |
|-------|-------|
| likelyCategory | No HTML extraction attempted |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.70 |
| nextQueue | B |

**improvementSignals:**
- C3 routed to HTML but no subsequent extraction evidence
- Heavy 404 responses (17) blocking discovery
- No c0Candidates found suggests page structure issues

**suggestedRules:**
- When C3 routes to HTML, ensure extraction phase executes before marking unresolved
- Reduce 404 threshold impact on discovery crawl budget allocation

---

### Source: mittuniversitetet

| Field | Value |
|-------|-------|
| likelyCategory | University events page not crawled |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.65 |
| nextQueue | B |

**improvementSignals:**
- 18 404s suggests crawling hit institutional barriers
- URL /evenemang exists but no extraction occurred
- University sites typically have event calendars 2-3 levels deep

**suggestedRules:**
- For educational institution domains, expand subpage discovery depth to 4+ levels
- Implement 404 backoff strategy instead of abandoning crawl on threshold

---

### Source: ois

| Field | Value |
|-------|-------|
| likelyCategory | Low event volume site |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.55 |
| nextQueue | B |

**improvementSignals:**
- Only 2 404s and 16 errors vs 17-18 errors on other sites
- Small organizational site (ois.se)
- C3 routed to HTML but found nothing

**suggestedRules:**
- Differentiate between 404-heavy institutional sites and genuinely small sites
- Lower crawl budget allocation for small organizational domains

---

### Source: kungsbacka

| Field | Value |
|-------|-------|
| likelyCategory | Municipality site crawling blocked |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.70 |
| nextQueue | B |

**improvementSignals:**
- 18 404s, 18 errors - identical to other Swedish municipality
- kungsbacka.se has events but not discovered
- Swedish municipal sites use complex navigation structures

**suggestedRules:**
- For Swedish municipal domains, target /kalender and /evenemang endpoints directly
- Municipal sites often have separate event microsites or subsites

---

### Source: h-gskolan-i-sk-vde

| Field | Value |
|-------|-------|
| likelyCategory | University crawl depth insufficient |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.65 |
| nextQueue | B |

**improvementSignals:**
- 16 404s on his.se/evenemang
- Swedish university event pages often behind faculty portals
- High error count suggests structure not mapped

**suggestedRules:**
- University event extraction should try /events, /kalendarium, /evenemang variants
- Implement pathway discovery specifically for .se educational domains

---

### Source: svenska-innebandyf-rbundet

| Field | Value |
|-------|-------|
| likelyCategory | Federation site JS-heavy |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.60 |
| nextQueue | D |

**improvementSignals:**
- 0 404s but 18 errors - content exists but not captured
- Sports federation sites commonly use client-side event rendering
- API structure attempted but no usable data

**suggestedRules:**
- Sites with 0 404s but persistent errors likely have JS-rendered content
- Sports and federation sites are high-probability JS-render candidates

---

### Source: malmo-hogskola

| Field | Value |
|-------|-------|
| likelyCategory | University site with JS rendering |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.55 |
| nextQueue | D |

**improvementSignals:**
- 0 404s but 18 errors like other university pattern
- mah.se likely uses modern JS framework for event calendar
- Network approach failed completely

**suggestedRules:**
- Higher education institutions increasingly use SPA frameworks
- 0 404s with high errors should trigger automatic JS-render routing

---

### Source: ralambshovsparken

| Field | Value |
|-------|-------|
| likelyCategory | Small venue site rendering issue |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.60 |
| nextQueue | D |

**improvementSignals:**
- 0 404s, 18 errors - page loads but content not captured
- ralambshov.se is a specific venue/park site
- Small venue sites often use booking platforms with JS rendering

**suggestedRules:**
- Venue and location-specific sites frequently use third-party JS widgets
- 0-404 with consistent error count should route directly to D phase

---

### Source: malm-opera

| Field | Value |
|-------|-------|
| likelyCategory | Cultural institution site blocked |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.60 |
| nextQueue | B |

**improvementSignals:**
- 18 404s blocking event page discovery
- Cultural venue sites often have calendar subsites
- malmoopera.se has structured event content but not captured

**suggestedRules:**
- Cultural institutions (.se) often use /kalender or /program endpoints
- Heavy 404 sites should try alternative URL patterns before failing

---
