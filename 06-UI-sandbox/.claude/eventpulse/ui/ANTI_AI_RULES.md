# Anti-AI-UI Rules

Explicit, non-negotiable rules that prevent common low-quality AI
UI patterns. Refuse to ship these. Read this before generating UI.

## The list

### 1. Arbitrary gradients

**Don't use purple-blue gradients on white surfaces.**
**Don't use orange-pink gradients on dark surfaces.**

EventPulse has a single accent color (`#FFB454`). Gradients dilute it.
If you want depth, use a 1 px border or a slightly lighter surface.

### 2. Excessive border-radius everywhere

**Don't make every label a pill.**
**Don't stack rounded cards on rounded cards.**

EventPulse uses sharp corners (no `borderRadius` set on the standard
card). Reserve rounding for:
- Pill chips (full `borderRadius: 999`).
- Primary CTA buttons (pill).
- Input fields (subtle 4–8 px radius).

### 3. Everything inside a card

**Don't put every list item in its own card.**

Cards group related content. A bare single line item does not need a
card. The standard EventPulse carousel card has image + title +
subtitle because those three things belong together.

If your "card" has only one piece of information, it's a row, not a
card. Use a `<View style={styles.row}>` with appropriate spacing
instead.

### 4. Excessive drop shadows

**Don't pile shadows on a dark surface.**

Drop shadows are barely visible on `#000`. If you need elevation:
- Use a 1 px border (`#2A2A33` or `#1A1A1A`).
- Or use `elevation: N` (Android) + iOS shadow props on the same
  surface.

Define the shadow token once. Don't write ad-hoc shadow props.

### 5. Giant headings without hierarchy

**Don't make every heading 32+ pt.**

The existing pattern is: 28 pt screen title, 13 pt card title, 13 pt
card subtitle (titled by weight and letter-spacing, not size). That's
three levels of hierarchy. Don't add a fourth "hero" size unless you
have a real hero.

If a heading is large enough to dominate the screen on its own, ask:
what is it a heading **of**? If the answer is "the whole screen",
you're using a hero font. Use `28 pt 900` instead.

### 6. Random spacing values

**Don't use 7, 13, 19, 22 px.**

The scale is 4/8/12/16/20/24/32/48. Round to the nearest token. If you
genuinely need a new value, propose a token in `DESIGN_SYSTEM.md`.

### 7. Inconsistent padding between similar surfaces

**Don't have one card with 16 px padding and another with 18 px.**

Pick a value from the scale and use it everywhere. The existing pattern
is 16 for inner card padding, 20 for screen edge, 24 between major
sections.

### 8. Unnecessary badges and pills

**Don't add "NEW", "BETA", "PREMIUM", "TRENDING" badges unless they
carry real meaning.**

A badge is a visual tax. If every card has a badge, the badges become
noise. Use a badge only when:
- It conveys real status (verified, saved, new since last visit).
- It is rare on screen (≤ 1 per row).

### 9. Decorative UI without function

**Don't add animated blobs, gradient overlays, or "premium" textures.**

If a visual element does not improve hierarchy, comprehension, or
brand, it does not belong. The "premium gradient" trend of 2024–2025
is not EventPulse's aesthetic.

### 10. Too many competing accent colors

**Don't introduce a second accent color.**

EventPulse has one accent: `#FFB454`. No blue, no purple, no green
accents. The whole UI is built on warm beige + cool grey + the single
orange. Don't disturb that.

If you need to indicate status:
- Use the existing accent in a different role (e.g., filled vs.
  outlined).
- Or add a semantic color to `DESIGN_SYSTEM.md` (success, warning,
  danger) — but only one new color at a time, with a use case.

### 11. Generic dashboard aesthetics

**Don't add KPI tiles, "AI insights" cards, or metric grids.**

EventPulse is a personal event agent. Its home screen shows category
carousels, not dashboard metrics. If you find yourself reaching for a
KPI tile, you are off-product.

### 12. Unnecessary animations

**Don't animate what doesn't need to move.**

Approved animations (see `MOTION.md`):
- Press feedback.
- Modal/sheet transitions.
- Toasts.
- Skeleton shimmer.

Everything else is decoration. Resist.

### 13. Duplicated components

**Don't create a `BigCard`, `MediumCard`, `SmallCard` when one
`Card` with size variants would do.**

Variant props, not new components. A `<Card size="lg" />` is better
than three near-identical components.

### 14. Inaccessible contrast

**Don't put text under 4.5:1 against its actual background.**

`color.textTertiary` (`#727B8D`) is exactly at 4.5:1 — borderline AA.
Use only for inactive tab labels (where the 700 weight puts it above
the "large text" threshold). Never for body copy.

For darker or lighter backgrounds, recompute contrast.

### 15. Tiny touch targets

**Don't ship buttons smaller than 44×44 pt.**

The sandbox's tab bar uses `paddingVertical: 14` with 11 pt text —
that's ≈ 38 pt hit area. Below the iOS floor. Bump to 16 or add
`hitSlop={{ top: 8, bottom: 8 }}`.

### 16. Desktop patterns copied to mobile

**Don't use hover-only affordances on mobile.**

Mobile does not have hover. If you need to surface an action:
- Add a long-press with `accessibilityActions`.
- Add a visible "more" button.
- Add a context menu (rare; bottom sheet is more native).

**Don't use multi-column dashboards on 375 pt width.**
**Don't use right-click menus.**
**Don't assume keyboard navigation.**

### 17. Excessive explanatory text

**Don't write "Tap here to submit your preferences and continue to the
next step" for a button that says "Continue".**

Button labels are 1–3 words. Body copy is short. Error messages are
short. The user is busy and the screen is small.

If you find yourself writing paragraphs of helper text, the UI is
probably wrong, not the copy.

### 18. Visual clutter

**Don't show everything on one screen.**

Progressive disclosure. The home screen shows category carousels; the
detail screen shows event details. Don't dump every metadata field
into the home cards. Don't put the action buttons on the same row as
the title.

## How to refuse these patterns

When generating UI, ask:

1. **Does this improve hierarchy or comprehension?** If not, remove.
2. **Is this on the design system scale?** If not, propose a token.
3. **Does this fit the existing aesthetic?** If not, redesign or
   remove.
4. **Is this needed on mobile?** If not, remove for mobile.
5. **Is this accessible?** If not, fix.

When critiquing existing UI:

- Name the pattern (e.g., "decorative gradient", "pill on every
  label").
- Explain why it's wrong for EventPulse.
- Propose the specific fix.
- Cite the relevant rule from this list.

## Why this list exists

The "AI UI" problem is real: language models default to a specific
aesthetic — purple gradients, soft squircle cards, drop shadows,
multi-color accent systems — because that's what training data
over-represents.

EventPulse is the opposite: dark, warm, minimal, single accent,
sharp corners. Following AI defaults here would actively make the
product worse.

These rules protect the existing aesthetic. They are non-negotiable
unless the user explicitly overrides them with a documented decision.

## What "deliberate, restrained, native-feeling" looks like

Concrete examples:

- A primary CTA: solid `#FFB454` background, `#000` text, pill
  radius, 14 pt vertical / 24 pt horizontal padding, no shadow, no
  gradient.
- A card: sharp corners, 1 px `#2A2A33` border, no shadow, image
  with `aspectRatio: 1.15`, title 13 pt 700.
- A section header: 11 pt 800 uppercase `#FFB454` eyebrow, then
  13 pt 700 `#F7F2EA` title.
- A list item: 16 px vertical padding, sharp corners, no card
  wrapper, subtle divider below.
- A modal: `Modal animationType="slide"`, `#000` background with
  scrim, sharp corners on the sheet.
- A toast: `#0E0E12` surface (when added), 1 px `#2A2A33` border,
  pill radius, slides from bottom, auto-dismisses 3 s.

That's the aesthetic. Stay in it.

## Sources

- `06-UI-sandbox/.claude/eventpulse/ui/UI_RULES.md` — core rules.
- `06-UI-sandbox/.claude/eventpulse/ui/DESIGN_SYSTEM.md` — tokens.
- `aladicf/better-web-ui` (MIT) — adapted anti-pattern list.
- `hueyexe/frontend-agent-skills` (MIT) — adapted principles.
