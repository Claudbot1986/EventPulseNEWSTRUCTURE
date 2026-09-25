# Spacing

## Existing scale

```
4, 8, 12, 16, 20, 24, 32, 48
```

This is the only spacing scale EventPulse uses. Every gap, padding, and
margin should be one of these values.

## Token names (recommended)

When we add a real `tokens.js` (currently inline in components), the
naming convention is:

| Token | Value | Use |
|---|---|---|
| `space.xs` | 4 | Tight within a label group |
| `space.sm` | 8 | Card image → text |
| `space.md` | 12 | Inline list gap |
| `space.base` | 16 | Section inner padding |
| `space.lg` | 20 | Screen edge padding |
| `space.xl` | 24 | Between major sections |
| `space.2xl` | 32 | Empty-state vertical breathing |
| `space.3xl` | 48 | Hero spacing |

## Why these values

- **4 pt** is the iOS/Android standard density unit. Aligns to the
  pixel grid on most devices.
- **8 pt** is the most-used "comfortable" gap. Two 4-pt units.
- **12 pt** is for tighter inline spacing (icons next to labels).
- **16 pt** is the iOS standard content margin.
- **20 pt** is the existing sandbox screen padding. Preserve.
- **24 pt** separates major sections without feeling empty.
- **32 pt** and **48 pt** create vertical breathing room for empty
  states and hero content.

## When to use what

| Situation | Value | Example |
|---|---|---|
| Tight between icon and label | 8 | Tab item icon + text |
| Card image → text | 8 | `EventPulseCarousel` |
| Between carousel cards | 16 | `EventPulseCarousel` row gap |
| Screen edge padding (horizontal) | 20 | Sandbox `App.js` `screen` padding |
| Between cards in a vertical list | 16 | (When we add vertical lists) |
| Between sections | 24 | Carousel → next section |
| Inside a card | 12–16 | Padding around card content |
| Empty state vertical | 32 | Icon → text in empty state |
| Hero spacing | 48 | Onboarding hero |
| **Page / section top padding (binding)** | **48** | **All new pages and sections — see rule below** |

## Page / section top padding — BINDING RULE (2026-09-25)

Every new page or section in EventPulse must use `paddingTop: 48` at the
top of its root scrollable. This is not a recommendation — it is the
binding default.

**Why 48.** On iPhone with the dynamic island, anything below 48 pt gets
visually crowded by the status bar / clock. We tried 20 (standard
content margin) and the eyebrow "KOMPONENTER" / back button "‹ Komponenter"
overlapped the iPhone clock. 40 was close but still tight. 48 gives
breathing room on every device without making the content feel pushed
down on Android / older iPhones.

**Where it applies:**
- New screens (root `ScrollView` or section component) → `paddingTop: 48`.
- New sections inside a screen (e.g. a new `EventPulseSection` block)
  → `paddingTop: 48` on the section root.
- Inside an existing component (e.g. between header and row in
  `EventPulseCarousel`) → use the existing token system, **not** this
  rule. This rule is for the **top** of a page/section only.

**Token name (when we move to `tokens.js`):**
`space.screenTop` = 48. Or, if you prefer descriptive: `space.pageTop`.

**How to apply:**
```js
// CORRECT — new page root
<ScrollView contentContainerStyle={{ paddingTop: 48, paddingBottom: 48 }}>
  ...
</ScrollView>

// CORRECT — new section root inside a screen
<View style={{ paddingTop: 48 }}>...</View>

// WRONG — 20 (overlaps clock on iPhone)
<ScrollView contentContainerStyle={{ paddingTop: 20 }}>...</ScrollView>
```

**Sandbox binding in code:** `06-UI-sandbox/App.js` `screen` style uses
`paddingTop: 48`. Any new component added to `components/` should mirror
this in its root container when it's a full screen, or in its top-level
section when it's a partial.

**Don't use 48 for:**
- Gap between sibling sections (use 24).
- Padding inside a card (use 6/8 per card rules).
- Vertical padding between content and screen bottom (use 48 only if
  content is short; otherwise let the content breathe naturally).

## Forbidden values

These values should never appear in EventPulse code:

- 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19 — all off-scale.
- 22, 26, 28, 36 — close but not on the scale. Round.
- 50, 64, 100 — too large for mobile without a hero context.

If you find yourself wanting one of these, document why in
`DESIGN_SYSTEM.md` and propose a new token. Do not silently use an
off-scale value.

### Approved off-scale exceptions

| Value | Token | Where | Rationale |
|---|---|---|---|
| `6` | `imageToTitle` | `EventPulseCard` marginTop on title | Tight editorial rhythm — image sits a hair closer to the title than the standard 8, but the title-to-subtitle pair stays at 4. Decided 2026-09-25 after sandbox iteration on Hem-sektionen. If reused elsewhere, copy the token name and rationale. |

## Asymmetric card spacing (binding)

Cards use **two** independent margins instead of a single `gap`:

```js
TOKENS.space = {
  imageToTitle: 6,      // bild → rubrik (lite mer andrum)
  titleToSubtitle: 4,   // rubrik → grå text (mer kompakt)
};

card: { /* no `gap` — explicit per-child margins below */ },
title:    { marginTop: TOKENS.space.imageToTitle },
subtitle: { marginTop: TOKENS.space.titleToSubtitle },
```

**Why asymmetric.** Image → title carries the heavier visual load (the
title is the primary content), so it deserves slightly more breathing
room than the title → subtitle pair, which are semantically closer (the
gray subtitle is a clarification of the title, not a separate beat).
Spotify-style card layouts use the same rhythm.

**Do not collapse back to a single `gap`.** The single-gap pattern
forces both gaps to the same value, which is the wrong editorial
rhythm for cards.

## Negative spacing

The sandbox uses `marginHorizontal: -20` on the carousel wrapper to
bleed the carousel to the screen edge while keeping inner padding at
20. This is the **only** correct negative-spacing pattern. Don't use
negative margins to "fix" overflow bugs — fix the overflow.

### Header edge-bleed (carousel/section headers)

When a section header sits above a horizontally-bleeding row of cards
or tiles, the header must apply the **same** `marginHorizontal: -20`
+ `paddingHorizontal: 20` pattern as the cards themselves. Without this,
the header text starts 20 px to the right of the first card's image —
visible misalignment.

```js
// CORRECT — header aligned with first card's left edge
header: {
  marginHorizontal: -SCREEN_PADDING,  // undo parent's 20 px padding
  paddingHorizontal: SCREEN_PADDING,  // preserve inner text spacing
  ...
},
```

This pattern is used in `EventPulseCarousel.js` (`header` style). The
prod `06-UI/components/EventPulseCarousel.js` does **not** apply it —
a documented drift to fix when we copy the sandbox component to prod.

## Padding vs margin vs gap

In React Native 0.71+, `gap` is supported on flex containers. Prefer
`gap` over per-child margins:

```jsx
// GOOD
<View style={{ gap: 16 }}>
  <Text>One</Text>
  <Text>Two</Text>
</View>

// AVOID
<View>
  <Text style={{ marginBottom: 16 }}>One</Text>
  <Text>Two</Text>
</View>
```

`padding` for inside-of-a-container. `margin` for positioning
relationships to siblings/parents. `gap` for flex children.

## Touch spacing

Adjacent interactive controls must have ≥ 8 pt between hit areas. If
two `<TouchableOpacity>` are stacked, they cannot have `gap: 0` —
that's a finger-tap ambiguity. Bump to 8.

## Examples in current code

| File | Value | Context |
|---|---|---|
| `06-UI-sandbox/components/EventPulseCard.js` | `marginTop: 6` (title), `marginTop: 4` (subtitle) | Asymmetric card spacing — no `gap` on the card |
| `06-UI-sandbox/components/EventPulseCarousel.js` | `marginHorizontal: -20` on header | Header edge-bleed (aligned with cards) |
| `06-UI-sandbox/components/EventPulseCarousel.js` | `marginHorizontal: -20` on `clipWrapper` | Card row edge-bleed |
| `06-UI-sandbox/components/EventPulseCarousel.js` | `gap: 16` on ScrollView `contentContainerStyle` | Space between cards |
| `06-UI-sandbox/components/EventPulseCarousel.js` | `paddingHorizontal: 20` on ScrollView | Inner card spacing |
| `06-UI-sandbox/App.js` | `paddingHorizontal: 20` | Screen edge |
| `06-UI-sandbox/App.js` | `marginTop: 6` on `itemDescription` | Description → header spacing (tight editorial) |
| `06-UI-sandbox/App.js` | `paddingTop: 20, paddingBottom: 48` | Screen vertical padding |
| `06-UI/components/EventPulseCarousel.js` | `marginHorizontal: -20` on clipWrapper | Bleed to edge (header is **not** aligned — see "Header edge-bleed" above) |

## Migrating to `tokens.js` (future, [RECOMMENDED])

When the codebase grows, extract:

```js
// 06-UI/theme/spacing.js (proposed)
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
};
```

Then components import `SPACE` instead of inlining numbers. This is
not done today; inline numbers are acceptable for now. Don't migrate
for the sake of migrating.

## Sources

- Apple Human Interface Guidelines — Layout:
  https://developer.apple.com/design/human-interface-guidelines/layout
- Material Design — Spacing:
  https://m2.material.io/design/layout/spacing-methods.html
- 4 pt grid: industry standard, see iOS design resources.
