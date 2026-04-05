# HTML Discovery Rules

## Purpose

This file defines how EventPulse should discover the correct internal HTML pages before attempting deeper extraction.

This is not a full crawler.
This is a controlled candidate-page discovery layer.

---

## Core Principle

For many HTML sources, the main problem is not field extraction.
The main problem is choosing the right internal page.

Therefore:

**Correct page discovery comes before extraction tuning.**

---

## Discovery Goal

Given a root URL, the system should identify the internal page or pages most likely to contain:
- event listings
- program listings
- show listings
- category-specific event listings
- repertoire/performance listings

The output is:
- ranked candidate pages
- rationale for ranking
- selected best candidate page
- optional fallback candidates

---

## Discovery Scope

Allowed:
- collect internal links
- classify link source location
- rank candidates
- fetch a bounded number of candidate pages
- compare candidate-page event signals
- choose best candidate page

Forbidden:
- full uncontrolled crawl
- deep recursive exploration
- acting like a search engine
- opening unrelated content pages endlessly

---

## Candidate Link Collection

Collect internal links from:
- nav
- header
- submenu / mega menu
- visible category sections
- content sections
- hero CTA areas

Footer links may be collected but should usually have lower priority.

Ignore:
- social links
- mailto/tel
- login/account
- legal/policy
- privacy/cookies
- press/news/blog unless evidence says otherwise
- contact/about
- sponsor/partner pages

---

## Link Classification

Each collected link should be tagged by origin:

- `nav`
- `header`
- `submenu`
- `hero`
- `content`
- `footer`
- `unknown`

These tags are ranking signals.

---

## Token and Semantic Rule

Do not rely on exact words only.

Use:
- tokenization
- separators like `/`, `-`, `_`
- case normalization
- fuzzy matching
- concept families

Examples of concept families:

### Event / program family
- event
- events
- evenemang
- program
- what's on
- whats-on
- calendar
- agenda

### Stage / performance family
- scen
- på scen
- pa-scen
- show
- shows
- performance
- performances
- repertoire
- repertoar
- production
- productions
- föreställning
- föreställningar

### Category family
- musik
- music
- sport
- sports
- humor
- talk
- live
- tickets
- biljetter

Important:
Exact terms are weak hints.
They are never sufficient alone.

---

## Candidate Ranking

Ranking should combine multiple signal groups:

### Group A — Link-level signals
- internal URL
- source location in nav/header/submenu
- anchor text relevance
- href token relevance
- repeated appearance in menus
- clean category-like URL shape

### Group B — Quick page signals
After cheap fetch of top candidates:
- repeated DOM blocks
- multiple date/time patterns
- many likely detail links
- ticket CTA presence
- list-like structure
- headings that look like programs/shows/events

### Group C — Negative signals
- blog/news/press patterns
- static info page patterns
- no list-like structure
- no dates
- mostly prose
- footer-only low-value page
- account/legal/contact patterns

---

## Event-Density Rule

The winning page should usually be the one with the strongest event-density, not the one with the "best-looking" URL.

Event-density can include:
- date count
- time count
- repeated candidate blocks
- event-like links
- CTA/ticket signals
- consistency of layout

If root page yields 1 event but a candidate page yields 5+ strong candidates, the candidate page should win.

---

## Bounded Search Rule

Candidate exploration must remain controlled.

Suggested limits:
- max depth: 2
- max tested candidate pages: 10–20
- dedupe normalized URLs
- stop early if a clearly dominant candidate appears

This is discovery, not crawling the whole site.

---

## Sitemap Rule

If `sitemap.xml` exists, it may be used as a discovery aid.

Use it to:
- find likely category/listing pages
- enrich the candidate pool
- compare against links found in menus

Do not blindly trust sitemap URLs.
They must still be ranked.

---

## AI Usage Rule

AI may help only after rule-based discovery has produced a bounded candidate set.

AI may:
- compare candidate summaries
- interpret unusual naming
- rank semantically ambiguous candidates

AI may NOT:
- skip candidate discovery
- replace scoring
- override measured event-density without evidence

See `ai-routing.md` for strict AI rules.

---

## Logging Rule

Every discovery run must log:
- root URL
- number of internal links found
- link origin counts (nav/header/submenu/content/footer)
- top candidates
- why they ranked highly
- which candidate page won
- why root page did not win
- whether AI was used

Without this, discovery is not explainable.

---

## Failure Rule

If discovery fails, report why:

- no meaningful internal links found
- candidate fetches too weak
- candidates all looked static
- probable JS-hidden navigation
- likely need for render fallback
- likely need for source-specific adapter

Do not say "site has no events" unless the evidence truly supports that.

---

## Cross-Site Verification Rule (MANDATORY)

A discovery heuristic is only considered stable if tested against multiple unrelated domains.

**Single-site success is NOT enough.**

**Rules:**
1. Heuristics affecting candidate selection require at least 2–3 independent confirmations
2. Changes to ignore patterns require cross-site verification
3. Changes to token families require cross-site verification
4. Changes to negative signals require cross-site verification

**If only one domain exhibits an issue:**
- Do NOT implement in C-layer
- Report the issue as "Site-Specific"
- Suggest: source adapter, source-specific config, or manual review

**Allowed without full cross-site verification:**
- Canonicalization fixes (www/www-less, trailing slashes) — these are infrastructure-level, not content-level
- These are general by nature, not site-specific workarounds

**Forbidden without multi-site verification:**
- Removing a term from IGNORE_PATTERNS because one site uses it for events
- Adding a term to scoring because one site has it in nav
- Changing ranking because one site ranks poorly
- Any "negative keyword list" change for a single domain

---

## Final Principle

For HTML sources:
Wrong page selection destroys extraction quality.

Choose the right page first.
Only then optimize extraction.

---

## Cross-Site Verification in Batch Context

HTML Discovery heuristics in batch loops must follow the same cross-site rule as the rest of C-htmlGate:

1. A pattern observed on 1 site → document as "site-specific observation"
2. A pattern confirmed on 2-3 sites → document as "provisionally general, needs verification"
3. A pattern confirmed on 3+ unrelated sites → may be added to heuristics

**Batch analysis is the verification mechanism.** Each batch of 10 C-candidates tests whether existing heuristics hold across domains. Patterns that fail repeatedly across batches signal a need for model review.

**Allowed to change based on batch evidence:**
- Adding to concept families (after 3+ site confirmation)
- Canonicalization fixes (www/www-less)
- Bounded search limits adjustment

**Forbidden to change based on single batch:**
- Removing terms from IGNORE_PATTERNS
- Changing scoring weights
- Changing URL token logic
- Editing negative keyword lists
