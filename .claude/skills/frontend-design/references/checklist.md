# Pre-commit UI Quality Checklist

A UI task is not complete until every item below is verified. Adapted
from `hueyexe/frontend-agent-skills` and the EventPulse codebase.

## Hierarchy

- [ ] The primary content or action is obvious without reading any text.
- [ ] The interface works in grayscale (test by desaturating).
- [ ] No two elements compete for "primary" status on the same screen.
- [ ] Labels are not needed where the value carries the meaning
      (e.g., "12 events" — the number alone is enough).

## Spacing

- [ ] All spacing values are on the 4/8/12/16/20/24/32/48 scale.
- [ ] Related items are closer than unrelated items (proximity).
- [ ] No "magic 7" or "magic 13" px values.
- [ ] Screen edge padding ≥ 16 pt.
- [ ] Section gap ≥ 24 pt.
- [ ] Touch spacing between adjacent controls ≥ 8 pt.

## Typography

- [ ] Every text style matches a named role (eyebrow / title /
      card.title / card.subtitle / tab.label / body).
- [ ] Long titles truncate with `numberOfLines={2}` and
      `ellipsizeMode="tail"`.
- [ ] Subtitles truncate with `numberOfLines={1}`.
- [ ] Line height for body text is ≥ 1.4× the font size.
- [ ] Letter-spacing is intentional (negative for titles, positive for
      eyebrow / uppercase).
- [ ] Tabular numerals for any data display (`fontVariant: 'tabular-nums'`).

## Color

- [ ] No raw hex in components — use tokens.
- [ ] Text contrast ≥ 4.5:1 against its actual background (verify the
      background, not just `#000`).
- [ ] Accent color (`#FFB454`) is reserved for one role per screen.
- [ ] Status colors are not the only signal — pair with text/icon/shape.
- [ ] Dark mode is the only mode (EventPulse does not currently support
      light mode).

## Depth

- [ ] Use borders on dark surfaces, not shadows.
- [ ] If shadows are needed, define them once as a token.
- [ ] No overlapping interactive elements.

## Imagery

- [ ] All `<Image>` `source` values are normalized — `require()` or
      `{ uri }`, never raw string URLs.
- [ ] All images have explicit dimensions or `aspectRatio`.
- [ ] `resizeMode="cover"` for fills, `contain` for icons.
- [ ] AI-generated images carry the "● AI-genererad" stamp.
- [ ] Missing images render a placeholder, not a silent gap.

## States

- [ ] **Default** — visible.
- [ ] **Pressed** — visible feedback (`Pressable` `({ pressed })`).
- [ ] **Focused** — visible focus indicator (managed in state for RN).
- [ ] **Disabled** — visibly different + non-interactive.
- [ ] **Loading** — skeleton for content, spinner for actions.
- [ ] **Empty** — explanation + next action.
- [ ] **Error** — human-readable message + retry/contact path.
- [ ] **Success** — feedback on completion.

## Accessibility

- [ ] Every interactive element has `accessibilityLabel`.
- [ ] `accessibilityRole` is set when it differs from default.
- [ ] `accessibilityState={{ selected, disabled, busy }}` for tabs and
      buttons.
- [ ] Touch targets ≥ 44×44 pt (use `hitSlop` for icon-only buttons).
- [ ] Color is not the only signal.
- [ ] `accessibilityHint` describes non-obvious outcomes.
- [ ] Reduced-motion preference is respected.
- [ ] Screen reader labels make sense out of context
      (`"Helg — Helgens alla händelser"`, not just "button").
- [ ] Heading order matches visual order.

## Small-screen behavior

- [ ] Tested with long Swedish titles (52+ chars).
- [ ] Tested with `ar` / `fa` (RTL) — `06-UI-sandbox/.claude/eventpulse/i18n/`.
- [ ] Tested with `font-size: largest` in iOS Settings.
- [ ] SafeAreaView applied where needed (notch / Dynamic Island).

## Performance

- [ ] No anonymous functions in render for memoized children.
- [ ] Styles defined via `StyleSheet.create` at module scope.
- [ ] Lists use `FlatList` (or `FlashList` if > 20 items).
- [ ] Animations use `useNativeDriver: true` for transform/opacity.
- [ ] No console.log in production code.

## Verification

- [ ] TypeScript: `npx tsc --noEmit` passes.
- [ ] Lint: `npm run lint` passes (or `expo lint`).
- [ ] Visual review: screenshot or simulator run captured.
- [ ] Compared against any supplied visual reference.
- [ ] Compared against existing EventPulse aesthetic (dark, beige text,
      orange accent).
- [ ] Reviewed by `06-UI-sandbox/.claude/eventpulse/ui/UI_REVIEW.md`
      self-critique.

## Documentation

- [ ] Component file has a JSDoc-style header explaining purpose.
- [ ] New tokens are added to `06-UI-sandbox/.claude/eventpulse/ui/DESIGN_SYSTEM.md`.
- [ ] If a new pattern is introduced, document why.

## Reporting

When reporting UI work, include:
1. What changed.
2. Why it changed.
3. How it was verified (screenshot, file path, line numbers).
4. What remains unclear.
5. Recommended next step.

If any item on this checklist fails, the work is not done. Fix it.
