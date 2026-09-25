# UI Workflow — EventPulse

Persistent instructions for AI coding agents (MiniMax M3, Claude, Codex)
working on EventPulse UI.

**Read this before starting any UI task.**

## The 18-step process

When you are asked to build, modify, or critique UI in EventPulse, work
through these steps in order. Skip none.

### 1. Understand the user's goal

What task is the user trying to complete? What is the success criterion?
What device, screen size, theme, language? If the goal is unclear, ask
**one** focused question. Do not ask 4.

### 2. Inspect the existing surface

- Read the screen file completely. Not just the changed region.
- Read related components in `06-UI/components/` and
  `06-UI-sandbox/components/`.
- Check `DESIGN_SYSTEM.md` for tokens in use.
- Check the call sites — how does the component get used?

### 3. Read relevant UI skills

- `.claude/skills/frontend-design/SKILL.md` — repo-level entry point.
- `.claude/skills/frontend-design/references/principles.md` — curated
  principles.
- Match the reference to the task:
  - Visual hierarchy → `principles.md` § 1
  - Tokens → `eventpulse-conventions.md`
  - RN-specific → `react-native-adaptation.md`
  - Quality gates → `checklist.md`

### 4. Read EventPulse UI rules

- `06-UI-sandbox/.claude/eventpulse/ui/README.md` — index.
- `UI_RULES.md` — core rules.
- `COMPONENT_RULES.md` — how components are built.
- `SCREEN_STATES.md` — if introducing a new state.

### 5. Search for existing reusable components

- `06-UI/components/` — production components.
- `06-UI-sandbox/components/` — sandbox components.
- `06-UI/screens/` and `06-UI/app/` — full screen patterns.

**Reuse before creating.** If a similar component exists, extend it.

### 6. Establish visual hierarchy (before implementation)

Rank content/actions by importance. Decide primary, secondary, tertiary
on paper (or in a comment) before any code. Test in grayscale.

### 7. Implement using design tokens

Use the spacing scale, type scale, color tokens, radius tokens,
elevation tokens. If a value isn't in the system:

- Round to the nearest existing token, OR
- Propose a new token in `DESIGN_SYSTEM.md` and use it.

Never inline arbitrary values.

### 8. Handle every state

Default, pressed, focused, disabled, loading, empty, error, success.
See `SCREEN_STATES.md`. Skeleton > spinner for content.

### 9. Check accessibility

Every interactive element with `accessibilityLabel` and `accessibilityRole`.
Touch targets ≥ 44×44 pt. Color contrast ≥ 4.5:1 body. Reduced-motion
respect. See `ACCESSIBILITY.md`.

### 10. Check small-screen behavior

- Long Swedish titles (52+ chars).
- `ar` / `fa` RTL.
- iOS Dynamic Type / Android font scaling.
- SafeAreaView for notch / Dynamic Island / cutouts.

### 11. Run TypeScript and lint

```bash
cd 06-UI-sandbox && npx tsc --noEmit
# or for production
cd 06-UI && npx tsc --noEmit
```

Fix all type errors before claiming done.

### 12. Run tests

If the project has tests, run them. EventPulse has Playwright tests in
`06-UI/e2e/` and unit tests in `06-UI/utils/*.test.ts`. If your change
affects tested code, update the tests.

### 13. Render or run the UI

In the sandbox: `cd 06-UI-sandbox && npx expo start`. In `06-UI/`:
same. If you can't render, say so in the report.

### 14. Capture or inspect screenshots

Save the screenshot. Reference the path in the report.

### 15. Critique the result visually

Run through `UI_REVIEW.md` self-critique. Look for problems first.

### 16. Compare against supplied visual references

If the user provided screenshots, Figma, or a description of the
desired look, compare side-by-side. Note any divergence.

### 17. Fix hierarchy, spacing, typography, consistency problems

Small tokens, large leverage. One change at a time. Re-render after
each fix.

### 18. Repeat 13–17 until the UI passes the review checklist

Iterate until no improvements remain. Then commit.

## Critical rules

### UI work is not done when the code compiles

UI work is done when:

- Rendered.
- Reviewed against `UI_REVIEW.md`.
- Either cleared every item or produced concrete fixes that were
  applied.

If you cannot render the UI in the environment, say so. Do not claim
done.

### Reuse before creating

If a similar component exists, extend it. New components are a tax
on the design system.

### Don't redesign during a task

If a component has problems unrelated to your task, note them in the
report — do not silently fix them. Scope drift creates bugs.

### Existing rules are binding; recommended rules are suggestions

`[EXISTING]` rules in `DESIGN_SYSTEM.md` reflect the shipped code.
`[RECOMMENDED]` rules are proposed. Don't silently turn recommended
into mandatory.

### Stack lock

- Plain `StyleSheet`, no NativeWind / Uniwind / Tailwind.
- Sandbox uses `useState` only — no Zustand / Redux / React Query.
- Sandbox does not import from `06-UI/` (intentional isolation).
- Production (`06-UI/`) is off-limits from the sandbox iteration loop.

## Workflow by task type

### "Add a new card"

1. Read `EventPulseCarousel.js` for the reference pattern.
2. Confirm the new card matches the same anatomy (image, title,
   subtitle).
3. Use the same width (187 px) and the same clip height (166 px)
   unless there is a documented reason to differ.
4. Add the new card to the carousel data + a screenshot.
5. Run the review checklist.

### "Build a new screen"

1. Read 1–2 existing screens for structure (`HomeScreen.js`,
   `ProfileScreen.js`).
2. Decide: tabs / stack / modal. Default to React Navigation patterns.
3. Set up the screen with `SafeAreaView`, status bar, edge padding.
4. Lay out content in sections (gap 24).
5. Add loading skeleton + empty state + error state.
6. Test long-content and RTL.

### "Fix a layout bug"

1. Capture the bug as a screenshot.
2. Identify the cause: spacing token, hierarchy, overflow, alignment?
3. Apply the smallest fix that resolves the bug.
4. Re-render and verify.
5. If the fix requires a new token, propose it; do not silently add it.

### "Polish / improve visual quality"

1. Read `UI_REVIEW.md`.
2. Pick the highest-impact issue.
3. Fix.
4. Re-render.
5. Repeat.

## Common traps

- **Wrong image source.** `<Image source={url}>` with a raw string
  silently fails. Always normalize.
- **Off-scale spacing.** 7, 13, 19 — round to the scale.
- **Touch targets under 44 pt.** Bump paddingVertical or add hitSlop.
- **Missing accessibility label.** Every interactive element.
- **Press feedback missing.** Add `({ pressed })` styling.
- **Loading without skeleton.** Use skeleton, not spinner.
- **Single-string error.** "Couldn't load" + retry. Always.
- **Color-only state.** Pair color with text/icon/shape.
- **Decorative motion.** Resist. Animation is feedback.

## Sources

- `.claude/skills/frontend-design/` — repo-level skill.
- `06-UI-sandbox/.claude/eventpulse/ui/` — EventPulse UI Brain.
- `06-UI/components/components.md` — existing design principles.
- `06-UI/components/EventPulseCarousel.js` — reference anatomy.
