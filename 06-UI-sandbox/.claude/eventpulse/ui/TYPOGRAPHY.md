# Typography

EventPulse uses the system font (SF Pro on iOS, Roboto on Android). No
custom font is loaded. Weight range 400–900 is supported on both.

## Existing type roles

These are the roles already in use across `06-UI/` and the sandbox.

| Role | Size | Weight | Letter-spacing | Line-height | Color | Use |
|---|---|---|---|---|---|---|
| `eyebrow` | 11 | 800 | +1.6 | auto | `color.accent` `#FFB454` | Section labels (e.g., "SANDBOX"), uppercase |
| `title` | 28 | 900 | -0.8 | auto | `color.text` `#F7F2EA` | Screen titles |
| `card.title` | 13 | 700 | -0.3 | 18 | `color.text` | Carousel card titles |
| `card.subtitle` | 13 | 600 | +0.1 | auto | `color.textMuted` `#9AA3B5` | Carousel card subtitles |
| `tab.label` | 11 | 700 | +0.4 | auto | `color.textTertiary` `#727B8D` / `color.accent` | Bottom tab labels |
| `description` | 13 | **200** | 0 | 18 | `color.textMuted` `#9AA3B5` | Supporting description text under a header (sandbox `App.js` `itemDescription`). See "Don't" section for the weight-200 exception. |

## Why these roles

- **eyebrow**: 11 pt is small enough to feel like metadata. 800 weight
  + uppercase + 1.6 letter-spacing gives editorial authority. Reserved
  for `color.accent` — only one accent color, so eyebrows stand out.
- **title**: 28 pt with -0.8 letter-spacing is large enough to anchor a
  screen but tight enough to feel native (not "hero text").
- **card.title**: 13 pt / 700 / -0.3 letter-spacing — denser than body
  but lighter than screen titles. Tight letter-spacing is the
  load-bearing choice for fitting longer Swedish titles into a 150 px
  card without truncating mid-word on the second line. Use this for
  any new card or thumbnail-style caption.
- **card.subtitle**: 13 pt / 600 / muted is the secondary supporting
  copy. One line, never truncates ugly.
- **tab.label**: 11 pt / 700 / +0.4 letter-spacing — the iOS standard.
- **description**: 13 pt / **200** / `textMuted` — ultralight weight on iOS SF Pro
  gives an editorial, newspaper-supporting-copy feel. Reserved
  **exclusively** for muted gray text that lives directly under a
  header (component descriptions, helper copy, captions). Never use
  for titles, primary content, or anything a user must scan to make a
  decision. Weight 200 is the **only** allowed weight below 400 (see
  the "Don't" rule below for the rationale and the platform caveat).

## Adding a new role

Before adding a new role:

1. **Search the codebase.** Is there already a style that does this?
2. **Check the use case.** A new role is justified if:
   - It's used in 3+ places (one-off = inline style).
   - It serves a semantic purpose not covered by existing roles.
   - It has consistent weight/size/color across all uses.
3. **Propose the token.** Add it to `DESIGN_SYSTEM.md` as `[RECOMMENDED]`.
4. **Apply consistently.** Once added, use the role everywhere it fits —
   don't drift.

Roles to consider adding:

| Role | Size | Weight | Use | Status |
|---|---|---|---|---|
| `body` | 15 | 400 | Prose body text | [RECOMMENDED] |
| `bodyEmphasis` | 15 | 600 | Body with emphasis | [RECOMMENDED] |
| `caption` | 11 | 500 | Image captions, metadata | [RECOMMENDED] |
| `cta` | 15 | 800 | Primary CTA button text | [RECOMMENDED] |
| `link` | 15 | 600 | Inline links, see `color.accent` | [RECOMMENDED] |
| `error` | 13 | 600 | Error messages, `color.danger` | [RECOMMENDED] |

## Don't

- **Don't inline `fontSize: 13`** for a one-off label. Either reuse an
  existing role or add a new token.
- **Don't use weight 100–300 for primary content, body, titles, or
  anything load-bearing.** System fonts fall back unpredictably across
  platforms; lighter weights are harder to scan and fail WCAG in dense
  lists. The **only** allowed exception is the `description` role
  above (weight 200 on iOS SF Pro Ultra Light). On Android (Roboto)
  this may render as a heavier fallback — acceptable because the role
  is supporting copy, not a content anchor. Do not introduce weight
  100–300 for any other role without a documented decision in
  `Decisions/`.
- **Don't use `fontFamily: 'System-Bold'`.** Use `fontWeight: '700'` or
  `'800'`. Platform-correct.
- **Don't use `textTransform: 'uppercase'`** on long titles — only on
  eyebrows and small labels.
- **Don't apply fake italic.** RN does not synthesize italics. Use a
  separate italicized text element if needed.

## Truncation

- Card title: `numberOfLines={2}`, `ellipsizeMode="tail"`.
- Card subtitle: `numberOfLines={1}`.
- Tab label: short labels, no truncation needed.
- Body text: never `numberOfLines={1}` for readable content. Use
  scrolling containers.

## Long-content behavior

Test with the longest real EventPulse content:

- Swedish event title: "Helgen i Stockholm — allt som händer lördag
  och söndag" (52 chars) — wraps to 2 lines, ellipsizes cleanly.
- English: "Indie rock showcase with three local bands and a special
  guest DJ set" — wraps to 2 lines.
- Arabic / Farsi: RTL — verify layout. `I18nManager.allowRTL(true)`.

If your component does not handle a 52-char title gracefully, fix it
before shipping.

## Letter-spacing rules of thumb

- **Negative** (-0.2 to -1.0): titles, large text. Tightens for
  density.
- **Zero**: body text. Default.
- **Positive** (+0.1 to +0.4): small labels, captions.
- **Strong positive** (+1.0 to +2.0): uppercase eyebrows only.

## Numerals

For any numeric display (event date, time, count), consider
`fontVariant: ['tabular-nums']`. Prevents width jitter when numbers
change.

## Localization

- Translations live in `06-UI/i18n/`.
- Strings flow through `useTranslation()` (or equivalent) at the screen
  level, never inside components.
- For RTL (Arabic, Farsi), use `I18nManager.allowRTL(true)` and verify
  layout mirrors correctly.

## Resources

- Apple Human Interface Guidelines — Typography:
  https://developer.apple.com/design/human-interface-guidelines/typography
- Material Design — Type:
  https://m2.material.io/design/communication/typography.html
- WCAG — Text Spacing:
  https://www.w3.org/WAI/WCAG21/Understanding/text-spacing.html
