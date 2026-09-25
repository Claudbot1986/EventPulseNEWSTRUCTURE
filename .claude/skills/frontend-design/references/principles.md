# Principles — UI/UX for EventPulse

Curated and adapted from `hueyexe/frontend-agent-skills` (MIT) and
`aladicf/better-web-ui` (MIT). EventPulse is a dark-themed iOS-first
mobile event-discovery app — these principles are filtered for that
context.

## 1. Hierarchy is the backbone

Make the most important content and actions easiest to notice. Use size,
weight, contrast, spacing, placement, and order before relying on color
or ornament.

**In EventPulse:** The home screen's primary content is "what's happening
tonight/this weekend". A carousel of category cards sets the rhythm. The
"see more" action must be visually subordinate to the carousel itself —
not the same weight.

**Default levers (in order of cost):**
1. Placement (top of screen, first card in a row)
2. Size (larger for primary content, smaller for support)
3. Weight (`'900'` for titles, `'700'` for cards, `'600'` for subtitles,
   `'400'` for body)
4. Contrast (full text on `#000000`, muted text on `#9AA3B5`)
5. Color (orange accent `#FFB454` is reserved — see DESIGN_SYSTEM.md)

## 2. Use familiar patterns unless novelty has a purpose

Users bring mental models from other apps. Spotify, Audible, and Apple
Music all use horizontal card carousels for category browsing — that is
why `EventPulseCarousel.js` uses that pattern. Do not invent a new layout
for the same job.

**In EventPulse:** Horizontal carousels for category browse, vertical
lists for event detail feeds, bottom tabs for primary navigation. These
are not negotiable without user research.

## 3. Group by meaning

Related elements closer together than unrelated ones. Ambiguous spacing
creates ambiguous meaning.

**In EventPulse:** The carousel card image and title are tightly grouped
(gap 8); the carousel and the next section have a larger gap (24+). This
reads as "card group" then "next section".

## 4. Constrain choices with systems

Use the token scales (spacing, type, color, radius, elevation). If a value
isn't in the system, propose adding it to the system — do not inline an
arbitrary pixel value.

**Existing EventPulse spacing scale:** `4, 8, 12, 16, 20, 24, 32, 48`. See
`06-UI-sandbox/.claude/eventpulse/ui/SPACING.md`.

## 5. Typography is interface structure

Choose type that fits the content, set readable line length, line height,
alignment, emphasis, and hierarchy.

**Existing EventPulse type roles:**
- `eyebrow` — 11 pt, `'800'`, letter-spacing 1.6, uppercase, accent orange
- `title` — 28 pt, `'900'`, letter-spacing -0.8, beige `#F7F2EA`
- `card.title` — 13 pt, `'700'`, letter-spacing -0.3, line-height 18
- `card.subtitle` — 13 pt, `'600'`, letter-spacing 0.1, muted `#9AA3B5`
- `tab.label` — 11 pt, `'700'`, letter-spacing 0.4

Do not invent new sizes — propose them as a new token first.

## 6. Color must carry meaning safely

Use color to reinforce hierarchy, state, and brand, but never as the
only signal. Maintain contrast.

**Existing EventPulse palette:**
- `#000000` — canvas background (always)
- `#F7F2EA` — primary text (warm beige)
- `#9AA3B5` — secondary/muted text
- `#727B8D` — tertiary/tab inactive
- `#FFB454` — single accent (eyebrow, active tab, AI badge dot)
- `#1A1A1A` — subtle dividers
- `#2A2A33` — image placeholder border (lifted 2026-09-24)
- `#1F1F26` — image placeholder fill
- `#8B92A1` — placeholder text (lifted 2026-09-24)
- `#15151B` — skeleton

WCAG AA contrast targets:
- Primary text on `#000`: `#F7F2EA` ≈ 14.6:1 ✅
- Muted text on `#000`: `#9AA3B5` ≈ 6.3:1 ✅
- Tab inactive on `#000`: `#727B8D` ≈ 4.5:1 ✅ (borderline)
- Accent orange on `#000`: `#FFB454` ≈ 10.1:1 ✅

## 7. Depth should explain layers

Shadows, borders, and surface shifts clarify elevation, grouping, focus
— never decoration.

**In EventPulse:** Use borders (`#1A1A1A` / `#2A2A33`) rather than
shadows on dark surfaces. Drop shadows are barely visible on `#000`. If a
shadow is needed, use `elevation` (Android) + a 1-px border for iOS.

## 8. Resilient real content

User-uploaded images, long Swedish event titles, empty states, errors,
localization — the composition must not break.

**In EventPulse:** Card titles use `numberOfLines={2}` + `ellipsizeMode="tail"`.
Subtitles use `numberOfLines={1}`. Test with the longest real title —
"Helgen i Stockholm — allt som händer lördag och söndag" (52 chars).

## 9. Match the pattern to the data and task

- **Cards** for visually recognizable items users browse.
- **Lists** for text-heavy, comparable, sortable items.
- **Carousels** for small, optional, visually rich sets — never hide
  essential choices in a carousel.
- **Tables** for structured, comparable data (rare on mobile).
- **Tabs** for primary navigation between 3–5 destinations.

## 10. Make actions safe

Prefer undo over confirmation. Confirmation only for destructive or
irreversible actions. EventPulse's primary actions ("See event" → opens
`ticket_url`) are external — handle the link opener carefully on iOS
(Safari View Controller) and Android (`chromeCustomTabs`).

## 11. Touch and tap targets

iOS: ≥ 44×44 pt. Android: ≥ 48×48 dp. The sandbox's tab bar uses
`paddingVertical: 14` with text-only labels — that gives ≈ 40 pt hit
area; bump to `paddingVertical: 16` to clear the floor.

## 12. Motion: optional, purposeful, controllable

All transitions ≤ 300 ms. Spring for sheets/tabs. Respect
`AccessibilityInfo.isReduceMotionEnabled`. Skeletons > spinners for content
> 500 ms. Never block the JS thread with setState loops for animation —
use `Animated` or Reanimated if needed.

## 13. Forms are high-stakes

Persistent labels, grouped fields, inline validation, keyboard-type
per field, password reveal (never duplicate password fields), proper
`onSubmitEditing`, autofill support.

## 14. Empty / error / onboarding

- **Empty:** explain why empty + teach the next action.
- **Error:** human-readable, offer retry or contact path, never log raw
  stack to the user.
- **Onboarding:** defer account creation until value is visible.

EventPulse's onboarding screen (`06-UI/screens/OnboardingScreen.js`) uses
this pattern — value first, sign-up deferred.

## 15. Accessibility baseline

- Every interactive node with `accessible` + `accessibilityLabel` or
  `accessibilityRole`.
- Tap targets ≥ 44×44 pt.
- Contrast ≥ 4.5:1 body, ≥ 3:1 large text.
- Focus order = visual order.
- Test with VoiceOver / TalkBack, not just labels.
- Respect `prefers-reduced-motion` and `AccessibilityInfo.isReduceMotionEnabled`.

## 16. Performance

- Hermes (default in RN 0.86+).
- `FlatList` is fine for small lists; consider `FlashList` for > 20 items
  with images.
- Images: explicit dimensions, never `resizeMode: "stretch"`. Use
  `contentFit: "cover"` if you switch to `expo-image`.
- Reanimated 3 worklets for gesture/animation; never animate via
  `setState` on the JS thread.

## 17. Localization

EventPulse ships 5 languages (Swedish, English, Arabic, Farsi, Somali,
Polish, Turkish — Arabic committed 2026-09-21). Strings flow through
`06-UI/i18n/`. RTL handling is required for `ar` / `fa`.

- Test with 2× the Swedish text length.
- Use `I18nManager.allowRTL(true)` + `I18nManager.forceRTL(language)` for
  RTL layout.
- Numbers, dates: `Intl.DateTimeFormat`. Never hardcode units.

## 18. Resilience

- `SafeAreaView` everywhere — notch / Dynamic Island / cutout aware.
- Offline-first where possible: queue mutations, reconcile on reconnect.
- Don't hard-fail on missing data — show a useful empty state.

## 19. Anti-AI patterns (refuse)

- Purple-gradient-on-white "AI card" aesthetic.
- Three floating action buttons.
- Modal-stack-on-modal.
- Loading spinner with no timeout.
- Bottom sheet with no drag handle.
- Icons without labels in tab bars (iOS) or without badge slots (Android).
- Disabled-looking buttons that still receive taps.
- Decorative gradients, blobs, animated shine.
- Generic "AI insights" cards with no actual insight.

## 20. Explain recommendations in user-centered terms

When proposing a UI change, name:
1. The user task it serves.
2. The cognitive load it removes.
3. The context it preserves.
4. The accessibility it enables.
5. The implementation simplicity.

Avoid "it looks better" without naming what specifically improves
hierarchy, readability, affordance, or accessibility.
