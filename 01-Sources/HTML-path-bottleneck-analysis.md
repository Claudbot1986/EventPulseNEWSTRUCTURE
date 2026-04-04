# HTML-Path Bottleneck Analysis

**Generated:** 2026-04-02
**Test:** 100 sources through C1-preHtmlGate and C2-htmlGate
**Source:** c1-c2-results.json

---

## Executive Summary

| Category | Count | % | Primary Action |
|----------|-------|---|---------------|
| **unfetchable** | 39 | 39% | URL verification / site investigation |
| **weak** | 45 | 45% | Improve C2 scoring selectors |
| **no-main** | 6 | 6% | 5 of 6 are JS-rendered → render-path needed |
| **medium** | 4 | 4% | Subpath testing |
| **strong** | 3 | 3% | Ready for extraction |
| **noise** | 3 | 3% | Non-event pages |

**Key Finding:** 84 of 100 sources have addressable issues. Only 3 are "strong" candidates ready for extraction.

---

## C1-PreHtmlGate Results

### Category Breakdown

| C1 Category | Count | Description |
|-------------|-------|-------------|
| weak | 45 | Has `<main>` but weak event signals |
| no-main | 6 | No main/article - 5 are likely JS-rendered |
| unfetchable | 39 | DNS fail, timeout, 403, 404 |
| medium | 4 | Medium quality signals |
| strong | 3 | Strong event signals |
| noise | 3 | No event content detected |

### Likely JS-Rendered Sources (no-main + likelyJs=true)

1. Debaser (debaser.se)
2. FC Rosengård (fcc.se)
3. Way Out West (wayoutwest.se)
4. Borås Zoo / Animagic (animagic.se)
5. Millesgården (millesgarden.se)

### Sources Marked as Noise (non-event pages)

1. Fotografiska (fotografiska.com)
2. Stockholms Universitet (su.se/evenemang)
3. Göteborgs Universitet (gu.se/evenemang)

---

## C2-htmlGate Results

### Verdict Breakdown

| C2 Verdict | Count | Description |
|------------|-------|-------------|
| promising | 34 | Passed C2, ready for extraction |
| unclear | 22 | Low signals, needs investigation |
| skipped | 39 | C1 failed, skipped |
| low_value | 5 | Rejected by C2 |

### Interesting Finding: "promising" but 0 events

34 sources got "promising" verdict but C2.eventsFound=0. This is because C2 is a **gate/quality scorer**, NOT an extractor. Events are extracted by `extractFromHtml()` separately.

**The "promising" verdict means the page structure looks like it COULD contain events, not that events were actually found.**

Sources that got "promising" but need `extractFromHtml()`:
- Konserthuset Stockholm (score=15)
- Berwaldhallen (score=27)
- Malmö Live (score=22)
- Avicii Arena (score=28)
- Malmö Opera (score=49)
- ...and 29 more

---

## Bottleneck Analysis

### 1. UNFETCHABLE (39 sources) — Highest Priority Fix

**Problem:** Site unreachable (DNS, timeout, 403, 404)

**Action:** URL verification and site investigation

| URL | Likely Issue |
|-----|-------------|
| goteborgsoperan.se | DNS/Server issue |
| uppsalakonserthus.se | DNS/Server issue |
| malmo-konserthus.se | DNS/Server issue |
| stora-teatern.goteborg.se | DNS/Server issue |
| slakthuset.se | 404 - URL changed |
| malmoarena.se | Working but low signals |
| (34 more) | Various |

**Estimated Fix Rate:** ~20% (some sites are truly down)

### 2. JS-RENDERED (5 sources) — Requires Render Path

**Problem:** Content loaded via JavaScript, not in static HTML

**Action:** Requires headless browser rendering (D-renderGate)

| Source | URL |
|--------|-----|
| Debaser | debaser.se |
| FC Rosengård | fcc.se |
| Way Out West | wayoutwest.se |
| Borås Zoo | animagic.se |
| Millesgården | millesgarden.se |

**Feature Needed:** render-path (headless Chrome/Playwright)

### 3. WEAK Signals (45 sources) — Improve Selectors

**Problem:** Page has `<main>` but C2 found weak event signals

**Action:** Test with `extractFromHtml()` to see if events actually exist

Example weak-but-may-work:
- Konserthuset Stockholm (was strong in our earlier extraction test!)
- Berwaldhallen
- Malmö Live
- Avicii Arena
- Moderna Museet

**C2 verdict "promising" ≠ events found. Must run `extractFromHtml()` to verify.**

### 4. NO-MAIN (6 sources) — Investigate

**Problem:** No `<main>` or `<article>` found

**Action:** Check if site uses different structure, or is JS-rendered

| Source | Likely Issue |
|--------|-------------|
| Göteborgs Symfoniker | Site structure issue |
| Debaser | JS-rendered |
| FC Rosengård | JS-rendered |
| Way Out West | JS-rendered |
| Borås Zoo | JS-rendered |
| Millesgården | JS-rendered |

### 5. MEDIUM (4 sources) — Test Subpaths

**Problem:** Medium signals, may need calendar/program subpath

| Source | Action |
|--------|--------|
| Cirkus | Test /kalender/ subpath |
| Moderna Museet | Already works with HTML extraction |
| ArkDes | Test subpath |
| Svenska Fotbollförbundet | May need API |

### 6. STRONG (3 sources) — Ready for Extraction

**Problem:** None - these are ready

| Source | Notes |
|--------|-------|
| Naturhistoriska Riksmuseet | Ready |
| Svenska Schackförbundet | Ready |
| Textilmuséet | Ready |

### 7. NOISE (3 sources) — Non-Event Pages

**Problem:** Pages without event content

| Source | Issue |
|--------|-------|
| Fotografiska | Museum, events on separate site |
| Stockholms Universitet | Academic events, different structure |
| Göteborgs Universitet | Academic events, different structure |

---

## Recommended Priority Order

### Priority 1: Fix unfetchable URLs (39 sources)
- **Effort:** Low (just investigation)
- **Impact:** Could recover 10-15 sources
- **Action:** Curl each, find correct URLs

### Priority 2: Verify "promising" sources with extractFromHtml() (34 sources)
- **Effort:** Low (just run the extraction)
- **Impact:** We know 14+ already work, likely more
- **Action:** Run phase1ToQueue on promising sources

### Priority 3: Implement render-path for JS sources (5 sources)
- **Effort:** High (requires Playwright/headless Chrome)
- **Impact:** 5 additional sources
- **Action:** Enable D-renderGate

### Priority 4: Test medium sources with subpaths (4 sources)
- **Effort:** Low
- **Impact:** 2-3 additional sources
- **Action:** Try /kalender/, /program/, /events/ subpaths

### Priority 5: Investigate no-main sources (6 sources)
- **Effort:** Medium
- **Impact:** 1-2 might work
- **Action:** Manual inspection

---

## Sources Needing Render-Path (JS)

These sources have content loaded via JavaScript and require headless browser rendering:

1. debaser.se
2. fcc.se
3. wayoutwest.se
4. animagic.se
5. millesgarden.se

---

## Sources with Wrong URLs (unfetchable)

These need URL verification:

1. goteborgsoperan.se (DNS issue - site exists at different URL?)
2. uppsalakonserthus.se (DNS issue)
3. malmo-konserthus.se (DNS issue)
4. stora-teatern.goteborg.se (DNS issue)
5. slakthuset.se (404)
6. [34 more need investigation]

---

## Next Steps

1. **Verify 34 "promising" sources** with `phase1ToQueue` to see actual event counts
2. **Investigate unfetchable URLs** - some may have moved or have typos
3. **Enable render-path** for JS-rendered sources
4. **Test subpaths** for medium-quality sources

---

## Appendix: Full C1/C2 Results

See `c1-c2-results.json` for complete data.

---

## UPDATE: Promising Sources Verified with extractFromHtml()

**Date:** 2026-04-02
**Test:** 34 "promising" sources from C2-htmlGate tested with `extractFromHtml()`

### Key Finding
**C2 "promising" verdict does NOT reliably predict extractFromHtml() success.**

Of 34 "promising" sources:
- **13 sources (38%)** yielded events via HTML extraction
- **21 sources (62%)** yielded 0 events despite "promising" verdict

### Sources with Events (13)

| Source | C2 Score | HTML Events |
|--------|----------|-------------|
| Konserthuset Stockholm | 15 | 11 |
| Malmö Opera | 49 | 7 |
| Avicii Arena | 28 | 6 |
| Avicii Arena (sport) | 28 | 6 |
| Lunds Universitet | 24 | 5 |
| Moderna Museet | 60 | 4 |
| Friidrottsförbundet | 36 | 4 |
| Friends Arena | 30 | 3 |
| Textilmuséet | 51 | 3 |
| Tele2 Arena | 23 | 2 |
| Folkoperan | 10 | 1 |
| Dramaten | 10 | 1 |
| Nationalmuseum | 25 | 1 |

### Sources with NO Events (21) - Despite "promising" verdict

These sources need selector/heuristic improvements:
- Berwaldhallen (C2: 27)
- Malmö Live (C2: 22)
- Debaser (C2: 67) - JS-rendered
- Stora Teatern Uppsala (C2: 51)
- Cirkus (C2: 31)
- Naturhistoriska Riksmuseet (C2: 60)
- Nordiska Museet (C2: 26)
- ArkDes (C2: 20)
- Waldemarsudde (C2: 18)
- Skansen (C2: 12)
- Junibacken (C2: 48)
- Liseberg (C2: 45) - JS-rendered
- Vasamuseet (C2: 13)
- Scandinavium (C2: 38)
- Svenska Fotbollförbundet (C2: 193)
- Svenska Baskethallsförbundet (C2: 41)
- Ridsportförbundet (C2: 25)
- Svenska Schackförbundet (C2: 798)
- Svenska Tennisförbundet (C2: 11)
- Helsingborgs Konserthus (C2: 325)

### New Bottleneck Categories

Based on combined C1/C2 + extractFromHtml results:

| Category | Count | Description |
|----------|-------|-------------|
| works-with-html-extraction | 13 | Already working |
| promising-but-no-events | 21 | C2 says promising, but extract() finds nothing |
| unfetchable | 39 | Site unreachable |
| js-rendered | 5 | Requires headless browser |
| noise | 3 | Non-event pages |

### Conclusion

**C2 is too permissive.** 21/34 "promising" sources don't actually yield events. The C2 scoring system needs calibration, OR these sites have event listings that use selectors/patterns not yet supported by extractFromHtml().

### Next Steps

1. **Investigate "promising-but-no-events" sources** - why does C2 think they're promising?
2. **Fix Berwaldhallen** - it was verified working earlier, should be in the "works" list
3. **Test subpaths** for promising-but-no-events sources