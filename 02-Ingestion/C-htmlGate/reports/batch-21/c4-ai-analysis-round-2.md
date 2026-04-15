## C4-AI Analysis Round 2 (batch-21)

**Timestamp:** 2026-04-13T04:19:53.754Z
**Sources analyzed:** 4

### Overall Pattern
Top failure categories: 1× redirect loop on entry, 1× events page lacks structure, 1× evenemang page returns 404

---

### Source: cirkus

| Field | Value |
|-------|-------|
| likelyCategory | redirect loop on entry |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- redirect_loop_detected_in_c2
- root_fallback_disabled
- c0_candidates_zero

**suggestedRules:**
- If redirect loop detected, try appending language suffix (/sv, /en) as entry point before attempting other paths
- Add cirkus.se domain to redirect-aware entry page list with known working path https://cirkus.se/sv

---

### Source: friidrottsf-rbundet

| Field | Value |
|-------|-------|
| likelyCategory | events page lacks structure |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.72 |
| nextQueue | D |
| directRouting | D (conf=0.74) |

**discoveredPaths:**
- /events [url-pattern] anchor="derived-rule" conf=0.85

**improvementSignals:**
- c1_noise_verdict_with_zero_time_tags
- c2_low_value_despite_promising_c0
- events_candidate_url_exists_but_unstructured

**suggestedRules:**
- Verify /events page is not JS-rendered before marking LOW_VALUE; route to D when c1LikelyJsRendered uncertain but c0 has valid event candidate
- Add validation: if /events URL derived with high score but C1 shows noise, automatically escalate to D for render fallback

---

### Source: h-gskolan-i-sk-vde

| Field | Value |
|-------|-------|
| likelyCategory | evenemang page returns 404 |
| failCategory | WRONG_ENTRY_PAGE |
| failCategoryConfidence | 0.95 |
| nextQueue | retry-pool |

**discoveredPaths:**
(none)

**improvementSignals:**
- c2_fetch_html_failed_404
- c0_candidates_zero
- errors_16_in_diversifiers

**suggestedRules:**
- When entry page path /evenemang returns 404, probe common Swedish event paths: /kalender, /arrangemang, /aktiviteter
- Error count 16 with 404 suggests server-side issue or URL structure change; mark for manual verification

---

### Source: sundsvall

| Field | Value |
|-------|-------|
| likelyCategory | JS-rendered event content |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.81 |
| nextQueue | D |
| directRouting | D (conf=0.81) |

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.92
- /program [nav-link] anchor="derived-rule" conf=0.88
- /kalender [nav-link] anchor="derived-rule" conf=0.85
- /schema [nav-link] anchor="derived-rule" conf=0.78
- /evenemang [nav-link] anchor="derived-rule" conf=0.75
- /kalendarium [nav-link] anchor="derived-rule" conf=0.70
- /aktiviteter [nav-link] anchor="derived-rule" conf=0.65
- /kultur [nav-link] anchor="derived-rule" conf=0.60

**improvementSignals:**
- c2_promising_score_13_but_zero_events
- c1_weak_verdict_zero_time_tags
- multiple_event_paths_found_c0
- no_jsonld_breadth_nojsonld_pattern

**suggestedRules:**
- When C2 shows promising (score >= 12) but C1 has 0 timeTags and extraction returns 0 events, automatically route to D for JS render fallback
- Add sundsvall.se to JS-render suspect list given 8 event-related paths found but no extraction success across network path

---
