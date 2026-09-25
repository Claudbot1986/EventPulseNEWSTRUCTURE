# UI Self-Review

Run this on every UI task before declaring done. It is a critique
pass, not a celebration pass. Look for problems first.

## Pre-review: render and capture

Before you can review, you must see the result.

1. **Render the UI.** Run `npx expo start` in `06-UI-sandbox/` or
   `06-UI/`. Or build for a simulator.
2. **Capture it.** Screenshot or simulator session log. Save to
   `/tmp/eventpulse-ui-review-<timestamp>.png` or include in the commit.
3. **If rendering is impossible** (headless CI), state this in the
   report. Do not pretend review happened.

## The review (in this order)

### 1. Hierarchy (most important)

- [ ] The primary content or action is obvious without reading text.
- [ ] I can identify the primary, secondary, and tertiary elements at
      a glance.
- [ ] One element dominates each screen region.

**Fix priority:** if hierarchy fails, fix that first. Adding color or
decoration on a hierarchy-broken screen makes it worse.

### 2. Spacing

- [ ] All gaps and paddings are on the scale (4/8/12/16/20/24/32/48).
- [ ] Related items are closer than unrelated ones.
- [ ] No visual "noise" — empty regions don't compete with content.
- [ ] The screen has a clear margin from the device edge.

### 3. Typography

- [ ] Every text element uses a named role from `TYPOGRAPHY.md`.
- [ ] Titles are the largest. Subtitles are clearly secondary. Body
      text is comfortable.
- [ ] No two text styles are visually indistinguishable.
- [ ] Long titles truncate gracefully (`numberOfLines={2}`).

### 4. Color

- [ ] No raw hex outside of `DESIGN_SYSTEM.md`.
- [ ] The single accent (`#FFB454`) appears in 1–2 places per screen
      max.
- [ ] Muted text is still readable (≥ 4.5:1).
- [ ] No color-only signals.

### 5. Imagery

- [ ] All images render (no silent black boxes).
- [ ] Image aspect ratios are consistent within a row.
- [ ] Placeholders are intentional, not fallback holes.
- [ ] AI-generated images carry the "● AI-genererad" stamp.

### 6. States

- [ ] Loading state exists and doesn't shift layout.
- [ ] Empty state explains and offers a next action.
- [ ] Error state is human-readable with a retry path.
- [ ] Disabled controls look disabled.
- [ ] Press feedback is visible.

### 7. Accessibility

- [ ] Every interactive element has a label that makes sense out of
      context.
- [ ] Touch targets ≥ 44×44 pt.
- [ ] Color contrast verified.
- [ ] Screen reader walkthrough completed (if VoiceOver/TalkBack is
      available).
- [ ] Reduced-motion preference respected.

### 8. Long content

- [ ] Tested with the longest realistic EventPulse title.
- [ ] Tested with empty strings.
- [ ] Tested with one card, three cards, ten cards.
- [ ] RTL (`ar` / `fa`) layout verified.

### 9. Consistency

- [ ] Same component pattern as the rest of the app.
- [ ] No new color, type, or spacing value introduced ad hoc.
- [ ] Component names match file names.

### 10. Performance

- [ ] No anonymous functions in render.
- [ ] Lists use `FlatList` (or `FlashList` for long lists).
- [ ] Animations use `useNativeDriver: true`.

## What to fix

Prioritize:

1. **Hierarchy breaks.** These break the entire screen.
2. **Accessibility failures.** Keyboard / screen reader users are blocked.
3. **Off-scale spacing.** Looks unprofessional and creates rhythm breaks.
4. **Touch targets under 44 pt.** Motor-impaired users blocked.
5. **Color-only signals.** Color-blind users blocked.
6. **Missing states.** Loading / empty / error.
7. **Performance.** Dropped frames, slow interactions.
8. **Polish.** Letter-spacing, line-height, alignment.

Don't fix polish if hierarchy is broken. Don't add features if
accessibility is broken.

## The "could a stranger understand it" test

Show the screenshot to someone who has never seen EventPulse. Ask:

- "What's the main action?"
- "What do you tap first?"
- "What does this button do?"

If they can't answer in 5 seconds, hierarchy is broken.

## The grayscale test

Desaturate the screenshot (any image editor). If you can still identify
the primary action, hierarchy is color-independent. If everything
collapses into same-grey mush, you were relying on color.

## After review

If the review produced concrete improvements:

1. Apply them.
2. Re-render.
3. Re-review.
4. Repeat until no improvements remain.

If the review cleared every item:

1. Commit.
2. Include the screenshot in the commit message or PR description.
3. Update `DESIGN_SYSTEM.md` if you added a new token.
4. Update `06-UI/components/components.md` if you introduced a new
   pattern.

## What "done" means

A UI task is done when:

- Code compiles (TypeScript clean).
- Rendered without warnings.
- Reviewed against this checklist.
- Rendered output is captured.
- Compared against the existing EventPulse aesthetic.
- Self-critique either cleared every item or produced concrete fixes
  that were applied.

A UI task is NOT done when:

- It compiles but you haven't seen it rendered.
- It looks right to you without comparing to the system.
- You claimed "minor polish" without doing the polish.
- You assumed the user would test it.

## Reporting

End every UI task report with:

1. **What changed** (files, line numbers).
2. **Why** (user goal).
3. **How verified** (screenshot path, simulator, `expo start` log).
4. **What remains unclear** (open questions).
5. **Recommended next step** (one concrete action).

If the environment prevented visual review, say so. Honesty over
optimism.
