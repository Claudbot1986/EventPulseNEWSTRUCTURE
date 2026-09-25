---
name: frontend-design
description: Use when creating, critiquing, or refining UI in EventPulse — Expo/React Native (06-UI, 06-UI-sandbox) and any Next.js/web surface. Covers visual hierarchy, design tokens, accessibility, interaction patterns, screen states, motion, anti-AI patterns, and visual review. ALWAYS read .claude/eventpulse/ui/README.md and UI_RULES.md before writing UI in this repo.
type: skill
license: MIT (skill scaffold) + portions adapted from hueyexe/frontend-agent-skills (MIT) and aladicf/better-web-ui (MIT)
metadata:
  author: EventPulse AI tooling (2026-09-24)
  sources:
    - hueyexe/frontend-agent-skills (MIT)
    - aladicf/better-web-ui (MIT)
---

# Frontend Design — EventPulse

This skill gives AI coding agents (Claude, Codex, MiniMax M3) a durable UI/UX
quality standard for EventPulse. It combines:

- Curated principles from `hueyexe/frontend-agent-skills` (MIT) — UI visual
  composition, design systems, interaction patterns, accessibility.
- Mobile-adapted guidance from `aladicf/better-web-ui` (MIT) — hierarchy,
  spacing, typography, motion, anti-AI patterns, mobile review.
- EventPulse-specific conventions extracted from the actual codebase
  (`06-UI/components/`, `06-UI-sandbox/components/`, `06-UI/app/`).

## When to use this skill

Load this skill whenever the user asks for any UI/UX work in EventPulse:
building a screen, fixing a layout bug, polishing a card, choosing between
patterns, reviewing a screenshot, refactoring a component, or onboarding a
new agent to the EventPulse design language.

Also load when writing any front-end code that will be rendered — RN
components, web pages, design tokens, navigation structure.

## When NOT to use this skill

- Backend, ingestion, agent runtime, database — out of scope.
- Pure content/copy without visual presentation.
- Strategic product decisions (North Star, target customer) — those go via
  Jev advisor and human review, never via this skill.

## Files in this skill

| File | Purpose |
|---|---|
| `SKILL.md` | This entry point — workflow, anti-AI rules, review gates. |
| `references/principles.md` | Curated principles (hierarchy, spacing, typography, color, depth, motion, accessibility). |
| `references/react-native-adaptation.md` | Plain RN `StyleSheet` adaptation — no NativeWind/Uniwind. |
| `references/eventpulse-conventions.md` | Extracted EventPulse design tokens, component patterns, state vocabulary. |
| `references/checklist.md` | Pre-commit UI quality gates. |

The EventPulse-specific **UI Brain** lives at
`06-UI-sandbox/.claude/eventpulse/ui/` and is the canonical place for
existing-vs-recommended rules before writing new components.

## Workflow (full UI task)

1. **Understand the user's goal.** What task are they trying to complete? What
   is the success criterion? What device, screen size, theme?
2. **Inspect the existing surface.** Read the screen file. Read related
   components. Check the design tokens in `06-UI-sandbox/.claude/eventpulse/ui/DESIGN_SYSTEM.md`.
3. **Read relevant skills.** This file (frontend-design) first. Then
   `references/principles.md`. Then the specific reference matching your
   problem (a11y, motion, RN adaptation, conventions).
4. **Read EventPulse UI rules.** `.claude/eventpulse/ui/UI_RULES.md`,
   `COMPONENT_RULES.md`, `SCREEN_STATES.md`. **Existing** rules are binding.
   **Recommended** rules are suggestions — flag them, do not silently
   enforce them.
5. **Search for existing reusable components.** Check
   `06-UI/components/`, `06-UI-sandbox/components/`, and the screens in
   `06-UI/app/` and `06-UI/screens/`. Reuse before creating.
6. **Plan visual hierarchy first.** Rank content/actions by importance.
   Decide primary, secondary, tertiary before any styling. Lay out in
   grayscale.
7. **Pick tokens, not arbitrary values.** Use the spacing scale, type
   scale, color tokens, radius, and elevation tokens. If a value isn't in
   the system, propose adding it to the system (not the component).
8. **Handle every state.** Default, pressed, focused, disabled, loading,
   empty, error, success. See `SCREEN_STATES.md`.
9. **Check accessibility.** See `references/checklist.md` § Accessibility.
   Labels, roles, contrast, target size, focus order, reduced motion.
10. **Check small-screen behavior.** Test with long Swedish titles, RTL
    languages (`ar` shipped 2026-09-21), dynamic type, narrow phones.
11. **Run TypeScript + lint.** `npx tsc --noEmit` in the project root or
    sandbox. Fix type errors before claiming done.
12. **Render or run the UI.** In the sandbox: `npx expo start`. In
    `06-UI/`: same. If you cannot run, hand back the smallest verifiable
    path (file path, screenshot prompt).
13. **Critique the result visually.** Compare against:
    - the supplied visual reference, if any
    - the existing EventPulse aesthetic (dark, warm beige text `#F7F2EA`,
      orange accent `#FFB454`)
    - the principles in `references/principles.md`
14. **Fix hierarchy, spacing, typography, consistency problems.** Small
    tokens, large leverage. One change at a time.
15. **Repeat 13–14** until the UI passes the review checklist.
16. **Commit only when complete.** Include before/after if visual.

## Hard rules (NEVER break)

1. **Never ship code that compiles but has no visual review.** UI work
   without screenshots is unfinished.
2. **Never use NativeWind/Uniwind** in EventPulse. The stack uses plain
   RN `StyleSheet`. Adding Tailwind would break the architecture.
3. **Never edit `06-UI/` from the sandbox iteration loop.** Sandbox → copy
   finished components to `06-UI/` by hand. Drift is by design.
4. **Never introduce a new color, font size, or spacing value ad hoc.** Add
   a token, then use the token.
5. **Never trust AI-generated decorative UI.** If a gradient, badge, or
   icon does not improve hierarchy or comprehension, delete it. See the
   anti-AI rules below.
6. **Never disable zoom, focus rings, or system font scaling.**
7. **Never use placeholder text as the only label.**

## Anti-AI-UI rules (refuse these patterns)

When generating or critiquing UI, refuse to ship any of these:

- Arbitrary gradients (especially purple → blue) on top of an interface
  whose accent is already `#FFB454`.
- Excessive border-radius everywhere (pills on every label, fully-rounded
  cards stacked on rounded cards).
- Everything inside a card. Cards should group related content; bare
  one-line items do not need a card.
- Excessive drop shadows. Use elevation tokens, not ad-hoc `shadowOffset`.
- Giant headings without a smaller supporting line. Hierarchy > size.
- Random spacing values (7, 13, 19 px). Use the 4/8/12/16/24/32/48 scale.
- Inconsistent padding between similar surfaces (16 here, 18 there).
- Unnecessary badges and pills — every chip is visual noise.
- Decorative UI without function (animated blobs, gradient blobs,
  "premium" badges that carry no meaning).
- More than 2 accent colors competing in one screen. EventPulse has
  `#FFB454` (orange) + the warm beige text. That's the whole accent set.
- Generic dashboard aesthetics (KPI tiles everywhere, "AI insights"
  cards).
- Unnecessary animations — every transition must justify its existence.
- Duplicate components when a reusable one would do.
- Inaccessible contrast (text under 4.5:1 against its background).
- Tiny touch targets (under 44×44 pt iOS / 48×48 pt Android).
- Desktop patterns blindly copied to mobile (hover-only, right-click,
  multi-column dashboards on 375 pt width).
- Excessive explanatory text (a button that says "Tap here to submit your
  preferences and continue" instead of "Continue").

Prefer deliberate, restrained, native-feeling mobile UI. EventPulse's
existing aesthetic is: dark surface (`#000000`), warm beige text
(`#F7F2EA`), muted grey secondary (`#9AA3B5`), single orange accent
(`#FFB454`). Stay in that lane.

## Visual review gates (mandatory before "done")

A UI task is **not complete** until:

1. **It runs.** No TypeScript errors, no React warnings.
2. **It is reviewed.** At minimum, the agent has visually inspected the
   rendered output (screenshot, simulator, or Expo Go).
3. **The hierarchy is obvious** without color (test by desaturating).
4. **Spacing is on the scale** (4/8/12/16/24/32/48).
5. **Text is readable.** Contrast ≥ 4.5:1 for body, ≥ 3:1 for large text.
6. **Touch targets are ≥ 44×44 pt.** Tested at runtime, not in theory.
7. **States are present.** Loading skeleton, empty, error, success,
   disabled — at least default state is rendered.
8. **Accessibility hooks are present.** `accessibilityLabel` on every
   non-text control; `accessibilityRole` where it differs from default.
9. **Long content is handled.** Titles truncate with `numberOfLines={2}`,
   `ellipsizeMode="tail"`. Test with the longest real EventPulse title.
10. **RTL languages still work.** `ar` shipped 2026-09-21 — verify layout
    does not break.

If any of these fails, the work is not done. Fix it.

## Reference shortcuts

- Visual composition rules → `references/principles.md` § Visual
- Token vocabulary → `references/eventpulse-conventions.md` § Tokens
- RN-specific gotchas → `references/react-native-adaptation.md`
- State patterns → `06-UI-sandbox/.claude/eventpulse/ui/SCREEN_STATES.md`
- Component anatomy → `06-UI-sandbox/.claude/eventpulse/ui/COMPONENT_RULES.md`
- Typography rules → `06-UI-sandbox/.claude/eventpulse/ui/TYPOGRAPHY.md`
- Spacing scale → `06-UI-sandbox/.claude/eventpulse/ui/SPACING.md`
- Motion rules → `06-UI-sandbox/.claude/eventpulse/ui/MOTION.md`
- Accessibility rules → `06-UI-sandbox/.claude/eventpulse/ui/ACCESSIBILITY.md`
- UI self-review → `06-UI-sandbox/.claude/eventpulse/ui/UI_REVIEW.md`

## Attribution

This skill is original EventPulse work that adapts and curates content
from:

- `hueyexe/frontend-agent-skills` (MIT) — the 9-skill structure, the
  core principles, the workflow phases.
- `aladicf/better-web-ui` (MIT) — the React Native adaptation rules,
  the anti-pattern list, the picker logic.

Both sources are MIT-licensed and free to adapt with attribution. Original
sources retained for reference:

- https://github.com/hueyexe/frontend-agent-skills
- https://github.com/aladicf/better-web-ui

We did **not** dump the entire repos. We extracted the actionable rules,
adapted them to plain React Native + EventPulse's actual stack, and
documented the existing tokens we found in the codebase.
