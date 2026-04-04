# Source Testing Rules

## Purpose

Every new source must pass through a controlled testing approach before entering production.

This prevents:
- dead sources consuming resources
- weak HTML paths being mistaken for "empty sites"
- test data overwhelming the UI
- AI being used as a vague substitute for real verification

---

## Path Order Rule

Every source discovery must follow this path priority:

1. JSON-LD
2. Network Path
3. HTML Frontier Discovery + HTML Path
4. AI-Assisted Routing (only if HTML candidate choice is unclear)
5. Render Path
6. Manual review

Important:
AI routing is not above HTML discovery.
It is a support step inside difficult HTML candidate selection.

---

## Three-Phase Testing Approach

### Phase 1: Sanity Check

**Goal:** Verify the source can respond and that at least one plausible path exists.

Checks may include:
- source responds with real HTML or API data
- JSON-LD exists OR
- candidate internal pages can be found OR
- page shows any event-like signals

If sanity fails:
- check URL correctness
- check robots/policy
- check whether relevant content is hidden behind internal pages
- do not conclude "empty source" too early from root only

---

### Phase 2: Breadth Check

**Goal:** Verify the full source path works stably.

For HTML sources this means:
1. root-page inspection
2. internal link collection
3. candidate-page ranking
4. candidate-page testing
5. extraction
6. scoring
7. normalization
8. dedup

Success criteria:
- the system can identify a strong candidate page
- extraction from that page yields reasonable event candidates
- confidence scoring is sensible

If breadth fails:
- identify whether failure is:
  - page discovery
  - candidate ranking
  - extraction
  - scoring
  - normalization

Do not blame extraction if the wrong page was selected.

---

### Phase 3: Smoke Test

**Goal:** Import a small amount of real data for end-to-end verification.

Success criteria:
- real events appear in database and UI

This is the only phase that imports real data.

---

## HTML Testing Rule (CRITICAL)

For HTML sources, every test report must explicitly say:

- which page was the root page
- how many internal links were found
- which top candidates were selected
- why they were selected
- which page won
- how many events root page gave
- how many events winning candidate page gave
- whether AI routing was used
- whether render was needed

Without this, the HTML test is incomplete.

---

## AI Routing Testing Rule

If AI routing is used, the report must include:

- why rule-based discovery alone was insufficient
- how many candidates were sent to AI
- what structured inputs AI received
- which candidate AI preferred
- whether measured signals and extraction confirmed AI's choice

AI is valid only if its choice is later verified.

---

## Render Gate Testing Rule

Render may only be tested after the report shows:

- HTML candidate discovery was attempted seriously
- multiple candidate pages were tested where reasonable
- raw HTML was insufficient or misleading
- evidence suggests JS-hidden content matters

Do not use render as a shortcut around weak HTML discovery.

---

## Priority for Testing

When multiple new sources exist, test in order:

1. structured data sources
2. sources with clear HTML listing structure
3. sources with menus/submenus leading to likely event pages
4. only then JS-heavy sources needing render

---

## Traceability Requirement

Every source that enters testing must document:

- which path discovered it
- which candidate pages were considered
- what the page-selection logic concluded
- whether AI influenced the candidate choice
- why the final path was selected

This information must remain reviewable through all phases.

---

## Failure Handling

Never silently skip phases.

Every failure must be:
1. logged with source name and phase
2. explained clearly
3. actionable

Examples:
- "root page too weak; submenu candidate not tested"
- "candidate ranking chose press page over event page"
- "AI preferred candidate A, but extraction proved candidate B stronger"
- "render attempted too early without proper HTML discovery"

---

## Final Principle

A source is not "empty" just because the root page is weak.

For HTML sources, correct candidate-page discovery is part of testing truth.
