## C4-AI Analysis Round 1 (batch-21)

**Timestamp:** 2026-04-13T04:18:56.414Z
**Sources analyzed:** 4

### Overall Pattern
Top failure categories: 1× redirect loop, 1× wrong subpage, 1× dead URL

---

### Source: cirkus

| Field | Value |
|-------|-------|
| likelyCategory | redirect loop |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.82 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- Redirect loop on https://cirkus.se/sv prevents any fetching — root URL is not stable
- c0LinksFound is empty, meaning no crawlable anchor links were found before redirect failure
- c1Verdict unfetchable confirms the site is completely unreachable via current approach
- No time tags or date signals seen — no fallback content available

**suggestedRules:**
- Manually verify the correct canonical entry URL for cirkus.se (likely https://cirkus.se/sv/ or a locale-specific path)
- Update stored URL to bypass redirect chain if a stable direct path exists (e.g. /sv/evenemang or /sv/program)
- Consider adding a locale-prefix stripping rule for .se sites that redirect root to /sv

---

### Source: friidrottsf-rbundet

| Field | Value |
|-------|-------|
| likelyCategory | wrong subpage |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.72 |
| nextQueue | retry-pool |

**discoveredPaths:**
- /events [url-pattern] anchor="derived-rule" conf=0.25

**improvementSignals:**
- /events path was derived via rule (not from actual nav anchor text), suggesting it may not exist or may not be the Swedish athletics events section
- c1Verdict is 'noise' and c2Score is 0 — the fetched page has no meaningful event signals
- c2Reason 'pg=time-tag' with score=0 implies the page structure has no date-bearing content
- No time tags or date counts in C1 — strong indicator this path is not an active event listing
- Swedish athletics likely uses Swedish-language paths such as /tavlingar, /kalender, or /resultat

**suggestedRules:**
- Try Swedish-language event paths for friidrott.se: /tavlingar, /kalender, /resultat, /evenemang
- Inspect friidrott.se navigation HTML manually to find real anchor links for competition/event listings
- If /events returns low-value content, deprioritize English-language derived paths for Swedish-language sports federations

---

### Source: h-gskolan-i-sk-vde

| Field | Value |
|-------|-------|
| likelyCategory | dead URL |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |

**discoveredPaths:**
(none)

**improvementSignals:**
- HTTP 404 on stored URL https://his.se/evenemang confirms the path no longer exists
- c0LinksFound is empty — no links were recoverable before the 404
- errors_16 in diversifiers indicates repeated fetch errors, likely consistent 404 over multiple attempts
- c1 unfetchable and c2 unclear with fetchHtml failure — entire discovery chain blocked by dead URL

**suggestedRules:**
- Manually locate the correct event/news path for his.se — try /aktuellt, /nyheter, /om-hogskolan/evenemang, or check the site's navigation
- Update stored entry URL from /evenemang to the verified active path
- Add a URL validity pre-check step for sources with errors_10+ to catch dead paths before running full pipeline

---

### Source: sundsvall

| Field | Value |
|-------|-------|
| likelyCategory | extraction mismatch |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |

**discoveredPaths:**
- /events [url-pattern] anchor="derived-rule" conf=0.55
- /program [url-pattern] anchor="derived-rule" conf=0.50
- /kalender [url-pattern] anchor="derived-rule" conf=0.48
- /evenemang [url-pattern] anchor="derived-rule" conf=0.45
- /kalendarium [url-pattern] anchor="derived-rule" conf=0.40
- /aktiviteter [url-pattern] anchor="derived-rule" conf=0.35
- /kultur [url-pattern] anchor="derived-rule" conf=0.30
- /schema [url-pattern] anchor="derived-rule" conf=0.20

**improvementSignals:**
- C2 scored 13 (promising) and classified page as 'event-list', yet C3 returned 0 events — strong mismatch between detection and extraction
- c0WinnerUrl resolved to /kultur which is a broad culture section, not a dedicated event listing — event items may use non-standard markup
- c1Verdict 'weak' with 0 time tags suggests dates are not inside <time> elements — extraction patterns may miss alternative date formats
- All c0LinksFound are derived-rule entries, not observed anchors — actual site nav structure is unknown and may differ significantly
- errors_18 in diversifiers suggests the site has significant HTTP error activity, possibly gating event subpages

**suggestedRules:**
- Inspect https://sundsvall.se/kultur HTML directly to understand the DOM structure used for event listings (e.g. custom card components, non-semantic date containers)
- Try higher-scoring derived paths first: /events, /program, /kalender before falling back to /kultur
- Extend extraction patterns to handle date formats outside <time> tags — look for aria-label, data-date, or text-pattern dates in div/span containers
- Check if sundsvall.se uses a specific CMS (e.g. Episerver/Optimizely) with known markup conventions and add a targeted extraction rule

---
