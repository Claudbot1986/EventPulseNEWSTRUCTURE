# EventPulse UI Rules

Core rules for UI work in EventPulse. Read this before writing any UI.

## Mandatory first reads

1. `README.md` (this directory) — index.
2. `DESIGN_SYSTEM.md` — tokens in use.
3. `COMPONENT_RULES.md` — how components are built.
4. `UI_REVIEW.md` — the self-critique checklist.

## Stack lock (do not change without user approval)

[EXISTING] **React Native 0.86.3 + Expo 57 + plain `StyleSheet`.**
- Do NOT introduce NativeWind, Uniwind, or Tailwind.
- Do NOT introduce a new icon library unless `@expo/vector-icons` is
  missing an icon you actually need.
- Do NOT replace `StyleSheet.create` with a CSS-in-JS library.

Why: The existing codebase (06-UI + sandbox) is plain `StyleSheet`.
Mixing two styling systems creates drift and doubles the design system
surface area. The cost is not worth it for an app this size.

[EXISTING] **Sandbox is isolated from 06-UI.** The sandbox exists for
fast UI iteration without the ~2500-line `06-UI/App.js`. Never reach
into `06-UI/` from sandbox code.

[EXISTING] **Sandbox uses only `useState`.** No Zustand, Redux, React
Query, or AsyncStorage in the sandbox. If you need state, use `useState`.

## Existing aesthetic

[EXISTING] **Dark, warm, minimal.** The aesthetic is the one already
shipped in `06-UI/`:

- Background `#000000`
- Primary text `#F7F2EA` (warm beige)
- Secondary text `#9AA3B5` (cool muted grey)
- Accent `#FFB454` (single warm orange)

If you find yourself reaching for purple, blue, or multi-color gradients,
you are off-aesthetic. Stop and reconsider.

## Anti-AI-UI rules (refuse these patterns)

The following are common AI-default UI moves that do not fit EventPulse.
Refuse to ship them:

- **Purple-blue gradients on white.** EventPulse is dark. Decorative
  gradients have no place here.
- **Everything in a card.** Cards group related content; bare single
  items do not need a card.
- **All-caps labels everywhere.** Eyebrows yes; titles no.
- **Massive drop shadows on dark surfaces.** Drop shadows barely show on
  `#000`; use 1 px borders instead.
- **Floating action buttons.** Three FABs is an anti-pattern. Use a
  primary action in the layout.
- **Modal-on-modal.** Avoid nested modals. If you need a confirmation
  on top of a sheet, fold the confirmation into the sheet.
- **Loading spinner with no timeout.** Skeletons are better than spinners.
- **Tab bar icons without labels.** iOS requires labels per HIG.
- **Disabled-looking buttons that still receive taps.** If a button
  looks disabled, it must be disabled.
- **Generic "AI insights" cards.** If you cannot name the insight, do
  not show the card.
- **Decorative animation.** Skeleton shimmer, press feedback, screen
  transitions — that's the budget. No bouncing logos.
- **Color-only status.** Pair color with text, icon, or shape.
- **Hover-only affordances.** Touch devices do not have hover. If you
  need to hide an action, surface it on long-press with
  `accessibilityActions`.

## When it is OK to break a rule

Rules exist to serve the user's goal. Break a rule when:

1. **The user explicitly asks.** Document the request in the PR.
2. **The existing pattern fails the goal.** For example: the existing
   card uses fixed 150 px width; if a new use case needs fluid width,
   propose the change with evidence (screenshots, user research).
3. **A new platform constraint forces it.** E.g., Android Material
   requires different tap targets than iOS. Document why.
4. **A documented decision exists in the vault.** Decisions recorded
   under `01-Projects/EventPulse/02-Operations/` supersede these rules.

Do not break a rule because it is "easier" or because you prefer it.

## Visual review is mandatory

UI work is not complete when:

- The code compiles (minimum bar, not done).
- The tests pass (necessary but not sufficient).
- You wrote the component file (you wrote code, not UI).

UI work is complete when:

- The component is rendered.
- The rendered output is captured (screenshot or simulator session).
- The output is critiqued against `UI_REVIEW.md`.
- The critique produced concrete improvements OR the critique cleared
  every item.

If the environment does not allow rendering (e.g., headless CI), say so
explicitly in the report. Do not claim UI work is done without
rendering.

## Reporting

Every UI task report must include:

1. **What changed.** Files + line numbers.
2. **Why.** What user goal this serves.
3. **How it was verified.** Screenshot path, simulator session, or
   `expo start` log.
4. **What remains unclear.** Open questions.
5. **Recommended next step.** Concrete, one action.

Be honest about uncertainty. UI quality comes from honest iteration, not
from confident claims.

## Sources

This file adapts content from `hueyexe/frontend-agent-skills` (MIT)
and `aladicf/better-web-ui` (MIT), filtered through EventPulse's
existing patterns. See `06-UI/components/components.md` for the
existing design principles (line 56: "fast, clear, minimal,
predictable, no over-design, no complexity").
