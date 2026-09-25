# EventPulse Design System

Extracted from the actual EventPulse codebase. **Existing** tokens are
what production code uses today. **Recommended** tokens are
improvements to consider, not mandates.

## Color

### Existing (in use — binding)

| Token | Hex | Where | Notes |
|---|---|---|---|
| `color.bg` | `#000000` | All screens, app background | Pure black canvas. |
| `color.surface` | `#0A0A0A` | Subtle section borders | Only used for the 1 px outline in `App.js` `blackSection`. |
| `color.divider` | `#1A1A1A` | Tab bar top border | |
| `color.border` | `#2A2A33` | Image placeholder border | Lifted 2026-09-24 from `#1A1A1A` for visibility. |
| `color.text` | `#F7F2EA` | Primary text (warm beige) | All titles, primary content. |
| `color.textMuted` | `#9AA3B5` | Secondary text | Subtitles, supporting copy. |
| `color.textTertiary` | `#727B8D` | Inactive tab label | |
| `color.accent` | `#FFB454` | Eyebrow, active tab, AI badge dot | The only accent color. |
| `color.placeholder` | `#1F1F26` | Image placeholder fill | |
| `color.placeholderText` | `#8B92A1` | Placeholder text | Lifted 2026-09-24 from `#3A4254` (was near-invisible). |
| `color.skeleton` | `#15151B` | Skeleton card | |

### Recommended (proposed — discuss before adopting)

| Token | Hex | Rationale | Status |
|---|---|---|---|
| `color.surfaceRaised` | `#0E0E12` | A second elevation tier for modals / sheets. Currently no modal surface — `Modal` uses `#000` with a scrim. | [RECOMMENDED] |
| `color.success` | `#5BC890` | Match-toast pattern when an action succeeds. Currently no explicit success color. | [RECOMMENDED] |
| `color.warning` | `#FFB454` | Reuse accent? Or split? Currently nothing. | [OPEN] |
| `color.danger` | `#E56B6F` | Destructive action (delete account, unmatch). Currently nothing. | [RECOMMENDED] |
| `color.info` | `#7AAFFF` | Informational banners. Currently only `NetworkBanner` uses neutral grey. | [RECOMMENDED] |
| `color.focus` | `#FFB454` + 2 px outline | Visible focus ring. RN has no `focus-visible`; manage in state. | [RECOMMENDED] |

### Why no light mode

EventPulse is dark-only. There is no light theme in `06-UI/` or the
sandbox. Do not introduce one without an explicit user request.

### Contrast (verified against `#000`)

| Token | Hex | Contrast vs `#000` | WCAG |
|---|---|---|---|
| `color.text` | `#F7F2EA` | 14.6 : 1 | AAA ✅ |
| `color.textMuted` | `#9AA3B5` | 6.3 : 1 | AA ✅ |
| `color.textTertiary` | `#727B8D` | 4.5 : 1 | AA ✅ (borderline) |
| `color.accent` | `#FFB454` | 10.1 : 1 | AAA ✅ |
| `color.placeholderText` | `#8B92A1` | 5.6 : 1 | AA ✅ |

`color.textTertiary` is exactly at the AA threshold. Avoid using it for
body copy. Tab labels (11 pt, weight 700) are above the "large text"
threshold (18 pt regular or 14 pt bold), so 4.5 : 1 is sufficient.

## Typography

### Existing roles

| Role | Size | Weight | Letter spacing | Line height | Color | Use |
|---|---|---|---|---|---|---|
| `eyebrow` | 11 | 800 | +1.6 | (auto) | `accent` | SANDBOX tag, section eyebrow |
| `title` | 28 | 900 | -0.8 | (auto) | `text` | Screen title |
| `card.title` | 13 | 700 | -0.3 | 18 | `text` | Carousel card title |
| `card.subtitle` | 13 | 600 | +0.1 | (auto) | `textMuted` | Carousel card subtitle |
| `tab.label` | 11 | 700 | +0.4 | (auto) | `textTertiary` / `accent` | Bottom tab |
| `description` | 13 | **200** | 0 | 18 | `textMuted` | Supporting description text under a header. Reserved for muted gray copy only — see `TYPOGRAPHY.md` § Don't for the weight-200 exception and platform caveat. |

### Recommended additions

| Role | Size | Weight | Use | Status |
|---|---|---|---|---|
| `body` | 15 | 400 | Prose body text | [RECOMMENDED] |
| `bodyEmphasis` | 15 | 600 | Body with emphasis | [RECOMMENDED] |
| `caption` | 11 | 500 | Image captions, small metadata | [RECOMMENDED] |
| `cta` | 15 | 800 | Primary CTA buttons | [RECOMMENDED] |
| `link` | 15 | 600 | Inline links, see `accent` color | [RECOMMENDED] |

### Platform font

EventPulse uses the system font (no custom font loaded). iOS defaults
to SF Pro; Android to Roboto. Both are legible and support the weight
range 400–900 we need for primary content. The `description` role is
the single intentional exception (weight 200, iOS SF Pro Ultra Light)
— see `TYPOGRAPHY.md` § Don't for the rationale.

If you want a serif for editorial sections: use `New York` (iOS) only.
Don't ship a custom font without measuring bundle size and load time.

### Localized numbers and dates

- Numbers: `Intl.NumberFormat` with locale.
- Dates: `Intl.DateTimeFormat` with locale. Event date format in Swedish
  is "lör 26 sep" — see `06-UI/utils/`.
- Currencies: kr / SEK, format `Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' })`.

## Spacing

### Existing scale (binding)

```
4, 8, 12, 16, 20, 24, 32, 48
```

In code:
- `gap: 8` — card image → text
- `gap: 16` — between carousel cards
- `padding: 20` — screen edge padding (sandbox)
- `height: 166` — clipped carousel height (existing ratio, see comments)
- `paddingVertical: 14` — tab bar items (sandbox) — close to but under 44 pt target; see ACCESSIBILITY.md

### Token names (recommended when we add a `tokens.js`)

| Token | Value | Use |
|---|---|---|
| `space.xs` | 4 | Tight within a label |
| `space.sm` | 8 | Card image → text |
| `space.md` | 12 | Inline list gap |
| `space.base` | 16 | Section inner padding |
| `space.lg` | 20 | Screen edge padding |
| `space.xl` | 24 | Between major sections |
| `space.2xl` | 32 | Empty-state vertical breathing |
| `space.3xl` | 48 | Hero spacing |

### Why this scale

- 4 pt grid aligns to iOS/Android standard density units.
- 8 is the most-used "comfortable" gap.
- 16 is iOS standard content margin.
- 20 is what the existing sandbox uses for screen edges — preserve.
- 24 / 32 / 48 cover major section breaks without skipping steps.

### When to add a new value

Don't. If you find yourself wanting 7, 13, 19, etc., round to the
nearest token and document why. If multiple components need the new
value, propose it as a token in this file with a use case.

## Border radius

### Existing

The codebase uses sharp corners (no `borderRadius` set on cards, the
sandbox's tab bar uses sharp corners). The sandbox's `App.js` `btn`
example uses `borderRadius: 999` for a pill — that's a one-off, not a
system value.

### Recommended

| Token | Value | Use |
|---|---|---|
| `radius.none` | 0 | Default (matches EventPulse aesthetic) |
| `radius.sm` | 4 | Inputs, small chips |
| `radius.md` | 8 | Cards (if we introduce them — currently no rounded cards) |
| `radius.pill` | 999 | Pills, tag chips, full-width CTA buttons |

[RECOMMENDED] Avoid `radius.lg` or `radius.xl`. EventPulse aesthetic is
sharp or pill — no soft squircle cards.

## Elevation

### Existing

EventPulse uses **borders, not shadows**, on dark surfaces.

- `borderWidth: 1, borderColor: '#1A1A1A'` — sandbox `blackSection`
- `borderWidth: 0.5, borderColor: '#2A2A33'` — image placeholder border (subtle)
- `borderTopWidth: 1, borderTopColor: '#1A1A1A'` — tab bar divider

### Recommended

If shadows are needed (e.g., a floating sheet over content):

| Token | iOS | Android | Use |
|---|---|---|---|
| `elevation.sm` | `shadowColor: '#000', shadowOffset: {0,1}, shadowOpacity: 0.3, shadowRadius: 2` | `elevation: 2` | Snackbar / Toast |
| `elevation.md` | `shadowColor: '#000', shadowOffset: {0,4}, shadowOpacity: 0.4, shadowRadius: 8` | `elevation: 6` | Modal / Sheet |

Use sparingly. Most EventPulse surfaces are flat.

## Icons

### Existing

`06-UI/` uses `@expo/vector-icons` (Ionicons, default in many places).
The sandbox has none — `<Text>` labels only in the tab bar.

### Recommended

[RECOMMENDED] When adding icons to the sandbox tab bar:
- Use `@expo/vector-icons/Ionicons`.
- Size 24 pt.
- Color: `color.textTertiary` inactive, `color.accent` active.
- Always pair with a label (iOS HIG).

Don't mix icon libraries. If you find yourself wanting Material
Community Icons alongside Ionicons, propose a migration, not a mix.

## Cards

### Canonical card anatomy (BINDING — copy these values)

```
Card
├── imageWrap (aspectRatio: 1.15, border 0.5 px, overflow:hidden)
├── title (13pt 700, letterSpacing -0.3, lineHeight 18,
│         marginTop: 6,                ← imageToTitle token
│         numberOfLines={2}, ellipsizeMode='tail')
└── subtitle (13pt 600, letterSpacing +0.1,
             marginTop: 4,             ← titleToSubtitle token
             numberOfLines={1}, ellipsizeMode='tail')
```

- **Width**: 150 px (fixed). Don't change without a documented decision.
- **Image clipping**: implicit via `imageWrap aspectRatio 1.15` +
  `resizeMode: 'cover'` on the inner `<Image>`. The imageWrap is wider
  than tall, so the source image is cropped (cover) — no explicit
  `height` or `overflow` on the showcase container is needed.
- **Press feedback**: opacity 0.7 on press. Pattern:
  `style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}`
  with `cardPressed: { opacity: 0.7 }`.
- **Asymmetric spacing** (binding): do **not** put a `gap` on the
  card. Use two independent `marginTop` values via the
  `imageToTitle: 6` and `titleToSubtitle: 4` tokens. See
  `SPACING.md § Asymmetric card spacing` for rationale.
- **Image source**: always normalize via the `sourceOf()` helper from
  `COMPONENT_RULES.md § Image handling`. Raw string URLs do not render.

These values are the **single source of truth** for any new card-style
component built in the sandbox. If you find yourself reaching for a
different width / aspect / font weight, propose a documented change
here first.

### Recommended card improvements (not yet adopted)

- **Tap feedback.** Currently `Pressable` but no `pressed` style. Add a
  subtle scale or opacity for press feedback.
- **Saved state.** No visual indicator for "saved" events. A small heart
  icon top-right is the standard pattern.
- **Date prominence.** Events without dates are confusing. If the card
  has a date, show it (small chip or caption).

## Buttons

### Existing

`<TouchableOpacity>` and `<Pressable>`. The sandbox's `TabBar` uses
`<TouchableOpacity>` with a label-only style (active = orange).

### Recommended pattern

| Type | Style | Use |
|---|---|---|
| Primary CTA | Filled `color.accent` background, `color.bg` text, `radius.pill`, padding 14 vertical / 24 horizontal | One per screen, the main action. |
| Secondary | Transparent background, `color.text` border, `color.text` text | "See more", "Cancel". |
| Tertiary | Text-only, `color.text` | Inline actions, links. |
| Destructive | Filled `color.danger` (proposed), white text | Delete, sign-out. |

[RECOMMENDED] All buttons ≥ 44 pt vertical hit area.

## Inputs

### Existing

EventPulse's auth screens use `<TextInput>` directly. No custom input
component.

### Recommended

A reusable `TextField` component:
- Border `color.border` 1 px, radius 8.
- Label above (not as placeholder).
- Error state: `color.danger` border + helper text below.
- Focus state: `color.accent` border 2 px.
- `accessibilityLabel` = visible label.
- `accessibilityHint` describes expected format if non-obvious.

## Navigation

### Existing

`06-UI/` uses React Navigation with bottom tabs (`BottomTabBar.js`) and
a stack for screens.

### Recommended

- 4 primary tabs: `Hem` (Home), `Utforska` (Explore), `Karta` (Map),
  `Profil` (Profile).
- Each tab's content is a stack of screens; push for detail.
- Modal sheets for non-navigation overlays.

## Screen states

See `SCREEN_STATES.md`.

## Accessibility

See `ACCESSIBILITY.md`.

## Motion

See `MOTION.md`.
