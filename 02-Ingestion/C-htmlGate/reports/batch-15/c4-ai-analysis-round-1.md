## C4-AI Analysis Round 1 (batch-15)

**Timestamp:** 2026-04-12T07:52:33.049Z
**Sources analyzed:** 7

### Overall Pattern
Top failure categories: 2× Wrong entry page, 1× JS-rendered event listings, 1× Site unavailable or misconfigured

---

### Source: kino

| Field | Value |
|-------|-------|
| likelyCategory | JS-rendered event listings |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.72 |
| nextQueue | manual-review |

**improvementSignals:**
- 18 API errors suggest dynamic content rendering
- Swedish cinema sites often use client-side frameworks
- Entry page may load events after initial HTML

**suggestedRules:**
- If site uses React/Vue/Next.js patterns → route to D (JS render)
- Cinema/theater sites in Sweden → probe /biljetter, /filmer, /visningar paths

---

### Source: open-art

| Field | Value |
|-------|-------|
| likelyCategory | Site unavailable or misconfigured |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.65 |
| nextQueue | manual-review |

**improvementSignals:**
- 18 404 errors out of 18 total errors is 100% failure rate
- openart.se may have migrated or be down
- No network signals at all detected

**suggestedRules:**
- 100% 404 rate across attempted paths → flag for manual URL verification
- Sites with no network signals → verify URL validity before retry

---

### Source: karlskrona-hf

| Field | Value |
|-------|-------|
| likelyCategory | Wrong entry page |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.68 |
| nextQueue | manual-review |

**improvementSignals:**
- 18 errors but 0 404s suggests page loads without event content
- HF (handelsförening) sites typically have event subpages
- Entry page likely loads but lacks event sections

**suggestedRules:**
- Association/club sites (HF, GF, IF) → probe /evenemang, /kalender, /events subpaths
- Pages loading with 0 404s but 0 events → verify entry page is event-containing section

---

### Source: norrkoping-art

| Field | Value |
|-------|-------|
| likelyCategory | JS-rendered or wrong entry |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.62 |
| nextQueue | manual-review |

**improvementSignals:**
- Art/gallery sites use modern CMS with JS rendering
- 18 errors with 0 404s indicates page accessibility
- Swedish art sites may load event images via JS

**suggestedRules:**
- Art galleries/museums → probe for /utstallningar, /event, /kalender endpoints
- Modern Swedish sites → consider JS render pipeline as primary approach

---

### Source: malmo-hogskola

| Field | Value |
|-------|-------|
| likelyCategory | Wrong entry or sparse content |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.70 |
| nextQueue | manual-review |

**improvementSignals:**
- mah.se is university homepage, not event page
- 18 errors with 0 404s indicates domain is valid
- Universities separate events into /kalendarium or /evenemang

**suggestedRules:**
- University sites → route to dedicated event calendars (/kalendarium, /evenemang)
- Homepage URLs for universities → automatically append known event paths

---

### Source: goteborgs-arkitekturgalleri

| Field | Value |
|-------|-------|
| likelyCategory | Extraction pattern mismatch |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.58 |
| nextQueue | retry-pool |

**improvementSignals:**
- C3 stage reached suggests HTML was retrieved
- 0 events despite 0 404s indicates content exists but not matched
- Architecture gallery likely has structured but non-standard HTML

**suggestedRules:**
- Non-standard event pages → attempt multiple extraction pattern families
- Galleries/museums → try both list-based and card-based extraction patterns

---

### Source: naturhistoriska-museet

| Field | Value |
|-------|-------|
| likelyCategory | Wrong entry page |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.75 |
| nextQueue | manual-review |

**improvementSignals:**
- naturhistoriska.se is museum homepage
- Museum homepages don't list current exhibitions
- 18 errors with valid HTML suggests no event section on entry page

**suggestedRules:**
- Museum sites → look for /utställningar, /event, /program pages
- Root URLs for museums → redirect to /kalender or /program if available

---
