# React Native Component System — Decision

**Decision: SKIP react-native-reusables AND nativeui-org.**
Document why, what we did instead, and under what conditions we'd revisit.

## TL;DR

EventPulse uses **plain React Native `StyleSheet`**. Neither
candidate component system supports this without adding NativeWind or
Uniwind as a hard dependency. Adding either would force a major
refactor of the existing 06-UI component layer. The sandbox's purpose
is fast iteration without that surface area. We do not install either.

## What we considered

### react-native-reusables (founded-labs/react-native-reusables)

- **Stars:** 8.7k.
- **License:** MIT.
- **Stack requirement:** NativeWind **or** Uniwind (Tailwind
  implementations for React Native).
- **Install:** package install + setup script + babel config +
  global.css.
- **Docs:** https://reactnativereusables.com/docs

### nativeui-org/ui (nativeui-org/ui)

- **Stars:** significant, exact number not fetched.
- **License:** MIT.
- **Stack requirement:** NativeWind + Tailwind CSS.
- **Distribution model:** "No package to install. Copy and paste the
  code." (https://nativeui.io/docs)
- **Docs:** https://nativeui.io/docs

## Why both are incompatible with EventPulse

### 1. NativeWind / Uniwind / Tailwind is not in the stack

EventPulse uses plain `StyleSheet.create` across all of `06-UI/` and
`06-UI-sandbox/`. There is no Tailwind config, no `tailwind.config.js`,
no `global.css`, no babel transform for class-name-based styling.

Adding NativeWind would require:

- A new dependency (`nativewind`, `tailwindcss`).
- A new `tailwind.config.js` at the repo root.
- A babel transform (`nativewind/babel`) replacing the current Metro
  config.
- A `global.css` (or equivalent).
- Migrating every existing component's `StyleSheet.create` to class
  names — OR running two styling systems side by side, which doubles
  the design system surface and creates drift.

The second option (side-by-side) is what most projects end up doing
during migration, and it always produces visual drift, larger bundles,
and confused contributors.

### 2. `06-UI/` is off-limits from the sandbox

The sandbox exists specifically because `06-UI/App.js` is ~2500 lines
and pulls in everything. The sandbox's `package.json` says:

> MINIMAL deps (ingen Supabase/maps/auth/notifications)

Adding a styling transform to the sandbox would also affect `06-UI/`
(both share `node_modules` via symlink). This is an architectural
change that should not happen during a UI tooling upgrade task.

### 3. The sandbox's purpose is fast iteration, not a design system

The sandbox README says:

> Hela Expo Go-bundeln laddar på flera sekunder. Sandboxen är en tom,
> snabb testmiljö där du bygger UI i isolering och kopierar in färdiga
> komponenter i 06-UI/ för hand.

A full component library would slow down the bundle and add complexity
to a space that is intentionally minimal.

### 4. The sandbox already has the reference patterns it needs

The two production reference components (`EventPulseCarousel`,
`BottomTabBar`) plus the sandbox's own `HorizontalCardCarousel` and
`TabBar` cover the patterns needed for iteration. Adding a third-party
library on top of these creates three ways to do the same thing.

### 5. Copy-paste model of nativeui-org requires per-component audit

nativeui-org's "copy and paste the code" model is honest about the
maintenance cost — you own the code. But the components are written
in Tailwind class names. Copying them into EventPulse would require
rewriting every component in `StyleSheet.create` anyway.

## What we did instead

1. **Documented the existing patterns.** See
   `06-UI-sandbox/.claude/eventpulse/ui/COMPONENT_RULES.md` and
   `DESIGN_SYSTEM.md`. The two reference components are now the
   canonical examples.
2. **Created reusable building blocks in this directory.** Not
   component files — knowledge files. A new agent reads these and
   builds consistent UI without copy-pasting a third-party library.
3. **Left `06-UI-sandbox/components/` for actual prototype code.**
   When a real component is built, it lives there, then is hand-copied
   to `06-UI/components/` (the existing sandbox convention).

## When to revisit this decision

We would revisit if **all** of the following became true:

1. EventPulse switches from `StyleSheet` to NativeWind or Uniwind as a
   **deliberate architectural decision** (not because a third-party
   library forced it).
2. The team has migrated `06-UI/components/` to the new styling system.
3. The bundle size cost is measured and acceptable.
4. The decision is documented in
   `01-Projects/EventPulse/02-Operations/` as a strategic direction
   change (it would touch the North Star, since it's a stack choice
   with long-term consequences).

If any of those conditions is false, do not install either library.

## Alternative: a tiny in-house foundation (considered, deferred)

A future option is to build a small in-house component library in
`06-UI/components/` using `StyleSheet`. This would be:

- `EventPulseCarousel` — already exists.
- `EventPulseCard` — variant prop pattern, 3 sizes.
- `EventPulseButton` — primary / secondary / tertiary.
- `EventPulseTextField` — input with label + helper + error.
- `EventPulseBanner` — info / success / warning / error.
- `EventPulseSkeleton` — loading placeholder.

Each would be ~50–100 lines, native `StyleSheet`, EventPulse tokens.
Built when the duplication cost is real (3+ identical implementations
of the same pattern), not now.

Status: deferred. The current duplication is low.

## Sources

- https://github.com/founded-labs/react-native-reusables (MIT)
- https://github.com/nativeui-org/ui (MIT)
- https://github.com/nativewind/nativewind (MIT) — the underlying
  library both depend on.
- 06-UI/components/EventPulseCarousel.js — existing reference
  component, plain StyleSheet.
- 06-UI-sandbox/README.md — sandbox conventions.
