# EventPulse UI Conventions

What I found by reading the actual EventPulse code. This is the source of
truth — the existing tokens, patterns, and component anatomy. New UI
should match these unless there is a documented reason to deviate.

## Where the patterns live

| Code area | What it contains | Read this when |
|---|---|---|
| `06-UI/components/EventPulseCarousel.js` | The reference card carousel. Tokens, sizes, spacing, typography. | Building any horizontal card. |
| `06-UI/components/BottomTabBar.js` | Tab bar pattern with active/inactive states. | Building or modifying navigation. |
| `06-UI/components/TabBar.js` | Older tab bar — older design. | Comparing v1 vs current tab pattern. |
| `06-UI/components/NetworkBanner.js` | Inline banner pattern. | Building any banner/toast. |
| `06-UI/components/Toast.js` | Toast pattern. | Building feedback messages. |
| `06-UI/components/PushPromptModal.js` | Modal pattern. | Building any modal sheet. |
| `06-UI/components/AuthReminderModal.js` | Modal with copy + dual CTA. | Building auth-related prompts. |
| `06-UI-sandbox/components/HorizontalCardCarousel.js` | Sandbox version of the carousel — stripped-down reference. | Prototyping a card layout. |
| `06-UI-sandbox/App.js` | Sandbox tab bar + screen layout. | Prototyping screen-level layout. |
| `06-UI/screens/HomeScreen.js` | Production home screen with multiple carousels. | Studying screen composition. |

## Tokens (extracted — see DESIGN_SYSTEM.md for the canonical list)

Colors from `EventPulseCarousel.js` and `HomeScreen.js`:

```js
const TOKENS = {
  color: {
    bg: '#000000',         // canvas
    surface: '#0A0A0A',    // very subtle elevation (1-px borders)
    border: '#2A2A33',     // image placeholder border
    divider: '#1A1A1A',    // tab bar divider
    text: '#F7F2EA',       // primary (warm beige)
    textMuted: '#9AA3B5',  // secondary
    textTertiary: '#727B8D', // tab inactive
    accent: '#FFB454',     // orange — eyebrow, active tab, AI badge dot
    placeholder: '#1F1F26',
    placeholderText: '#8B92A1',
    skeleton: '#15151B',
  },
};
```

## Component anatomy (EventPulseCarousel)

```
Carousel
├── clipWrapper        — overflow:'hidden', height:166, marginHorizontal:-20
└── ScrollView (horizontal)
    └── contentContainerStyle (paddingHorizontal:20, gap:16)
        └── Card
            ├── imageWrap — aspectRatio:1, border 1px, overflow hidden
            │   ├── Image  — fill, resizeMode cover
            │   └── placeholder View (when no image)
            │       └── Text — subtitle as placeholder text
            ├── title   — numberOfLines:2, ellipsizeMode:'tail', 15pt 800
            └── subtitle — numberOfLines:1, 13pt 600
```

## Component conventions

1. **Stateless controlled components.** `EventPulseCarousel` takes
   `cards`, `headerText`, `loading`, `skeletonCount`. The caller owns
   the data. The component renders.
2. **i18n upstream.** Strings are translated by the caller. Components
   never import `useI18n`.
3. **Loading via skeleton, not spinner.** `loading: true` renders
   `skeletonCount` (default 4) skeleton cards in the same size. Layout
   stays stable.
4. **Image fallback is explicit.** No image → `<View placeholder>` with
   the subtitle text. Avoid silent gaps.
5. **`<Pressable>` for interactive cards.** Not `TouchableOpacity`. Use
   `accessibilityRole="button"` + `accessibilityLabel="<subtitle> — <title>"`.
6. **Width fixed at 187 px** for the standard card. Why: the home screen
   shows two carousels; the card width was chosen to fit two-up on a
   375 pt iPhone with the 16 pt gap.
7. **`marginHorizontal: -20` + `paddingHorizontal: 20`** on the
   ScrollView to bleed to the screen edge while keeping inner padding.
   Don't reach for a third approach — match this pattern.

## File conventions

- Components live in `06-UI/components/` (production) or
  `06-UI-sandbox/components/` (iteration).
- One component per file. Default export.
- JSDoc-style header comment explaining the component's purpose,
  contract, and any non-obvious choices.
- Constants at top of file (CARDS, CARD_WIDTH, TOKENS).
- Local `styles` at bottom via `StyleSheet.create`.

## What does NOT belong

- API clients / fetch logic — those go in `06-UI/services/`.
- Screen-level state — that goes in the screen (`06-UI/screens/` or
  `06-UI/app/`).
- Auth, providers — `06-UI/App.js`.
- Server-side anything — outside the UI layer.

## State patterns

EventPulse uses (in production):
- `useState` for local UI state.
- Zustand for cross-screen state (auth, current event context).
- React Query for server state (none currently — fetching is direct).

Sandbox uses only `useState` by design (see sandbox `App.js` header).

## Image rules

- 1:1 (square) for carousel tiles.
- AI-generated images carry the "● AI-genererad" stamp (orange dot +
  pill, semi-transparent, bottom-left). The stamp is added in
  `08-Agent/tools/ai_compliance.ts` for production and
  `06-UI-sandbox/scripts/stamp-tiles.mjs` for the sandbox.
- `<Image source={…}>` accepts `require()` numbers or `{ uri }`
  objects. **Never** a raw string. Always normalize.

## Naming

- Components: PascalCase (`EventPulseCarousel`).
- Files: match component name (`EventPulseCarousel.js`).
- Styles: `styles.card`, `styles.title`, `styles.titleMuted` — flat, not
  nested.
- Tokens: `TOKENS.color.bg`, `TOKENS.space.base` (when we add a real
  tokens module).
- Test files: `Component.test.js` next to source, or `__tests__/`.

## Don'ts (from existing code comments)

- "Sektioner är helt svarta — så layout-buggar syns mot bakgrunden."
  Sandbox convention. Keep sections dark for visual debugging.
- "Ingen Zustand/Redux/React Query. Använd useState." Sandbox
  convention. The sandbox is intentionally minimal.
- "När komponenten är klar: kopiera in den i 06-UI/components/ för hand."
  Sandbox → 06-UI is a **manual** process. Drift is intentional.
