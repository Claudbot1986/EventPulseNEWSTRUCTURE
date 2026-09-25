# Component Rules

How components are built in EventPulse. Read this before adding a new
component.

## File layout

- **One component per file.** Default export.
- **File name = component name.** `EventPulseCarousel.js` exports
  `EventPulseCarousel`.
- **Header comment.** JSDoc-style, explains:
  - Purpose (one sentence).
  - Props (concise).
  - Non-obvious choices (why a width is 187, why a height is 166).
  - Sandbox reference if it has one.
- **Constants at top.** `CARDS`, `CARD_WIDTH`, `TOKENS`.
- **Helpers above the main export.** `Card`, `sourceOf`, etc.
- **`styles` at the bottom** via `StyleSheet.create`.

## Sandbox-only vs shared

- **`06-UI-sandbox/components/`** — isolated iteration. Constant data,
  no services, no providers. Components built here copy to `06-UI/`
  by hand when ready.
- **`06-UI/components/`** — production. May use Zustand, services,
  navigation.

Do not import across these directories. The sandbox shares `node_modules`
via symlink with `06-UI/` but should not import its components.

**Sandbox UI must never expose file paths.** The registry entries are
`{id, name, description, Component, sampleProps}` only. No `file`,
`path`, `importPath`, or similar fields. The user is reviewing
components, not file structure. Path leaks have caused visible gray
text under cards (registry leak) and tend to drift between sandbox
and `06-UI/` on copy.

## Component anatomy

A component file should answer:

1. **What does this render?** (header comment)
2. **What does it take?** (props)
3. **How does it look?** (styles + tokens)
4. **What states?** (default, loading, empty, error, success, disabled,
   pressed, focused)
5. **How does it respond?** (accessibility role, label, hint)
6. **What does it own?** (local state via `useState`)
7. **What does it defer?** (data, callbacks — caller controls)

The reference anatomy is `EventPulseCarousel.js`:

```jsx
// Header comment
import { ... } from 'react-native';

const TOKENS = { ... };
const CARD_WIDTH = 150;

function Card({ ... }) { ... }
function sourceOf(imageUrl) { ... } // helper

export default function EventPulseCarousel({ ... }) { ... }

const styles = StyleSheet.create({ ... });
```

## Props

- Define props as a `type` or `interface` in `.tsx`, or as a JSDoc
  typedef in `.js`.
- Required props first; optional props with defaults.
- Use destructuring in the function signature.
- Avoid `React.FC` (per `.claude/rules/typescript/coding-style.md`).

## State

- Local UI state via `useState`.
- Loading data: lift to the caller (the screen). The component is
  presentational; the caller owns the fetch.
- Cross-screen state: Zustand store (in `06-UI/`).
- The sandbox does not have Zustand. Use `useState`. If state grows
  complex, propose adding Zustand.

## i18n

- Strings are translated by the caller. Components never import
  `useI18n`.
- This is the existing pattern (see `EventPulseCarousel.js:26`:
  "i18n: titel + subtitle förväntas redan vara översatta av anroparen").

## Styling

- `StyleSheet.create` at the bottom of the file.
- Tokens at the top as a const object.
- No inline `style={{ ... }}` for things that repeat — move to `styles`.
- One-off styles OK inline.
- Colors and sizes must reference tokens, not raw values.

## Accessibility

- Every `<Pressable>` / `<TouchableOpacity>` needs:
  - `accessibilityRole="button"` (or `"link"` for navigation)
  - `accessibilityLabel="<what it does, out of context>"`
  - `accessibilityState={{ selected, disabled, busy }}` where relevant
- Every `<TextInput>` needs:
  - `accessibilityLabel`
  - `accessibilityHint` for non-obvious formats
- Every `<Image>` (non-decorative) needs `accessibilityLabel`.
- Decorative `<Image>` uses `accessible={false}` or empty
  `accessibilityLabel`.

## Image handling

The `source` prop on `<Image>` MUST be:

- A `require()` result (asset registry number), or
- An object `{ uri: 'https://…' }`.

A raw string URL does not render. See `06-UI/components/EventPulseCarousel.js:62`
for the bug history. Always normalize via a helper:

```js
function sourceOf(imageUrl) {
  if (!imageUrl) return null;
  if (typeof imageUrl === 'number') return imageUrl;
  if (typeof imageUrl === 'string' && imageUrl.length > 0) return { uri: imageUrl };
  if (typeof imageUrl === 'object' && imageUrl.uri) return imageUrl;
  return null;
}
```

Then:
```jsx
<Image source={sourceOf(url)} style={...} resizeMode="cover" />
```

## Truncation

- Card title: `numberOfLines={2}`, `ellipsizeMode="tail"`.
- Card subtitle: `numberOfLines={1}`.
- Tab label: no truncation expected (labels are short).
- Long body text: prefer `Text` with `numberOfLines={N}` to control
  layout, but never `1` for body content — readability matters.

## Press feedback

- `<Pressable>` with `style={({ pressed }) => [styles.x, pressed && styles.xPressed]}`.
- Pressed state: opacity 0.7 or scale 0.98. Pick one and stick to it.
- The current `EventPulseCarousel` has no pressed style — recommend
  adding it (see DESIGN_SYSTEM.md § Recommended card improvements).

## Edge-bleed (carousel / section headers)

When a component contains both a header (e.g. "Tid", "Smak") and a
horizontally-scrolling row that bleeds to the screen edge, the header
**must** apply the same edge-bleed pattern as the row, or the header
text will sit 20 px to the right of the first card.

The pattern is a `-20 / +20` swap on the header element:

```js
header: {
  marginHorizontal: -SCREEN_PADDING,  // undo parent's edge padding
  paddingHorizontal: SCREEN_PADDING,  // preserve inner text spacing
  // ... rest of header styles
},
```

This mirrors the `clipWrapper` pattern already used on the row. Both
elements end up with content starting at `x = 0` of the screen.

See `SPACING.md § Header edge-bleed` for the full rationale and a note
on prod drift (`06-UI/components/EventPulseCarousel.js` does not
currently apply this — fix when sandbox component is copied to prod).

## Asymmetric card spacing

Cards do **not** use a single `gap` between image / title / subtitle.
Use two independent `marginTop` values via tokens:

```js
TOKENS.space = {
  imageToTitle: 6,
  titleToSubtitle: 4,
};

// card style has NO `gap` property
card:    { width: CARD_WIDTH },
title:    { ..., marginTop: TOKENS.space.imageToTitle },
subtitle: { ..., marginTop: TOKENS.space.titleToSubtitle },
```

Rationale and rationale-for-not-collapsing are in
`SPACING.md § Asymmetric card spacing`.

## Loading

- Use a skeleton block, not a spinner, for content areas.
- Skeleton size = real content size. Layout doesn't shift.
- For action buttons (e.g., submit), a spinner inside the button is OK.

## Empty / Error / Disabled

- Empty: explanation + next action button.
- Error: human-readable message + retry button.
- Disabled: visually distinct (50% opacity, `color.textTertiary` text),
  `disabled` prop on `Pressable`, `accessibilityState={{ disabled: true }}`.

See `SCREEN_STATES.md` for full patterns.

## When to ask vs proceed

Proceed without asking when:

- Following an existing pattern (e.g., new card follows `EventPulseCarousel`).
- Using an existing token (color, spacing).
- A reasonable default exists and the user task is clear.

Ask before:

- Introducing a new color, font size, spacing value, or radius.
- Adding a new dependency.
- Refactoring an existing component to use a new pattern.
- Touching `06-UI/` from the sandbox.
- Removing any existing accessibility hook.

## Sandbox → production handoff

When a sandbox component is ready:

1. Review against `UI_REVIEW.md`.
2. Run TypeScript (`npx tsc --noEmit` in sandbox).
3. Manually copy to `06-UI/components/`.
4. Update the call site in `06-UI/app/` or `06-UI/screens/`.
5. Document the handoff in the commit message.

There is no automated sync. Drift between sandbox and `06-UI/` is
intentional and visible.

## Sources

- `06-UI/components/components.md` — existing component conventions.
- `06-UI/components/EventPulseCarousel.js` — reference anatomy.
- `.claude/rules/common/coding-style.md` — immutability, error handling,
  file size.
