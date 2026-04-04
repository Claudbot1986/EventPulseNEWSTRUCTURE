# AI Routing Rules

## Purpose

This file defines how AI may be used as a controlled decision-support layer during HTML candidate-page selection.

AI is support.
AI is not truth.
AI is not a free-form crawler.

---

## Core Principle

AI should help answer a small, structured question:

**Which of these already-discovered candidate pages is most likely to be the correct event/program page?**

AI must not be asked to solve the whole website on its own.

---

## Allowed AI Role

AI may:
- compare 3–10 candidate pages
- interpret unusual menu naming
- map semantically similar labels across languages or naming styles
- rank candidates when rule-based signals are close
- explain why a candidate seems promising

AI is best used when:
- naming is unusual
- several candidates look plausible
- rule-based ranking is uncertain
- cheap page summaries exist but are semantically ambiguous

---

## Forbidden AI Role

AI may NOT:
- act as a crawler
- browse the site freely without bounded candidates
- replace internal link collection
- replace measurable page scoring
- invent event counts
- claim a page is correct without later verification
- skip extraction and normalization

If AI is asked an unbounded question like:
"Find the events on this site"
that is the wrong use.

---

## Correct AI Question Shape

Good question:
- Here are 5 candidate pages
- Here is each candidate's anchor text
- Here is href
- Here is where the link appeared
- Here is a short page summary
- Here are cheap event-density signals

Choose which 1–3 pages are most likely the real event/program pages.

Bad question:
- Here is the full site HTML, figure everything out

---

## Required AI Inputs

When AI is called, the input should be structured and compact.

Suggested fields per candidate:
- candidate URL
- anchor text
- href/path tokens
- origin location (`nav`, `submenu`, etc.)
- short heading summary
- date/time count
- repeated block count
- event-link count
- CTA/ticket signal
- any negative signals

Important:
Do not send giant raw HTML unless absolutely necessary.

---

## Required AI Outputs

AI should return structured output such as:
- ranked candidates
- confidence/reasoning summary
- which candidates should be tested next
- what signals made the top candidate stronger

The output must be reviewable and comparable to measured results.

---

## Verification Rule

AI decisions are valid only if later verified by:
- real candidate-page fetch
- measurable event-density
- actual extraction results

If AI choice conflicts with measured extraction strength, measured evidence wins.

---

## Escalation Rule

Use AI only after rule-based discovery has already narrowed the space.

Suggested flow:
1. collect internal links
2. rank candidates with rules
3. fetch top candidates cheaply
4. if candidate choice still unclear:
   - call AI
5. verify AI choice with real extraction

Do not call AI before candidate narrowing.

---

## Cost Control Rule

AI should be used sparingly.

Prefer:
- one small routing call
- structured summaries
- bounded candidate sets

Avoid:
- repeated large prompts per page
- sending raw full-site HTML every time
- using expensive models for obvious cases

Use AI where it gives real leverage, not as default everywhere.

---

## Model-Agnostic Rule

The exact model is secondary.

Whether using MiniMax, Anthropic, or another model:
- keep the task bounded
- keep inputs structured
- keep output verifiable
- do not trust raw free-form confidence

Model choice matters less than prompt shape and system boundaries.

---

## Logging Rule

Every AI routing call must log:
- why AI was needed
- candidate count sent to AI
- structured summary of candidates
- AI's top choice
- AI's rationale summary
- whether extraction later confirmed the choice

Without this, AI routing is not traceable.

---

## Failure Rule

If AI routing fails, report clearly:
- candidate set was too weak
- summaries were too poor
- AI output was ambiguous
- extraction contradicted the AI preference
- render or source-specific handling may be needed

Do not silently let AI choose badly.

---

## Final Principle

AI should help solve ambiguity.

AI should not replace engineering discipline.

Rule-based discovery finds the space.
AI helps rank the space.
Verification decides truth.

---

## Site-Specific Restriction (MANDATORY)

AI may NOT propose global heuristic changes based on a single site.

If AI is asked to evaluate or recommend a change to:
- IGNORE_PATTERNS
- scoring weights
- candidate ranking
- URL token logic
- negative keyword lists

AI must first ask:
- Has this been verified across 2–3+ unrelated domains?
- Is this a canonicalization issue (often general) or a site-naming issue (usually specific)?

AI may only say:
- **"likely general"** — multi-site pattern confirmed
- **"likely site-specific"** — only one domain observed
- **"requires cross-site verification"** — insufficient evidence to classify

AI must NEVER recommend a global heuristic change for a single-site observation.

If a user asks AI to fix a problem seen only on one site:
- AI must refuse
- AI must suggest: source adapter, source-specific config, or manual review instead
