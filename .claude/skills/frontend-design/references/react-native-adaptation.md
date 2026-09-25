# React Native Adaptation Notes

How `aladicf/better-web-ui` (web-first) maps to EventPulse's plain React
Native + `StyleSheet` stack.

## Stack detection (do this first)

Confirm before writing any RN UI:

```
- React Native version: 0.86.3 (sandbox & 06-UI)
- Expo: 57.0.24
- Hermes: enabled (RN 0.86+ default)
- Styling: plain StyleSheet.create — NOT NativeWind, NOT Uniwind, NOT Tailwind
- Icons: @expo/vector-icons (in 06-UI only — sandbox has none)
- Navigation: React Navigation + bottom tabs (in 06-UI only)
- State: useState + Zustand (06-UI) / useState only (sandbox)
- Animation: Animated API (no Reanimated in sandbox yet)
```

If you find NativeWind/Uniwind installed: STOP. That is a different
project. Report and ask before adding dependencies.

## What does NOT translate directly from web

| Web (better-web-ui) | React Native equivalent | Notes |
|---|---|---|
| `gap: 16px` | `gap: 16` (RN 0.71+) | Already supported. |
| `rem` units | Use pt/dp directly | RN is unitless pt on iOS, dp on Android. |
| `vw` / `vh` | `Dimensions.get('window')` or `useWindowDimensions()` | Hook is preferred — reactive to rotation. |
| `:hover` | `Pressable` with `({ pressed }) => …` | Visual pressed state only; no hover on touch. |
| CSS variables | Native: use a JS object exported as `tokens` | See `06-UI-sandbox/.claude/eventpulse/ui/DESIGN_SYSTEM.md`. |
| `box-shadow` | iOS: `shadow*` props; Android: `elevation` | Often need both. |
| `transition: 200ms` | `Animated.timing(value, { duration: 200, useNativeDriver: true })` | Use native driver for opacity/transform. |
| `@media (prefers-reduced-motion)` | `AccessibilityInfo.isReduceMotionEnabled()` then `addEventListener` | API exists in core RN. |
| `:focus-visible` | `Pressable` + `onFocus` / `onBlur` with state | RN does not have `focus-visible` natively; manage in state. |
| `<button>` | `<Pressable>` or `<TouchableOpacity>` | Prefer `Pressable` for new code. |
| `<a href>` | `<Link>` from React Navigation (06-UI) or `<Pressable onPress>` | External links use `Linking.openURL`. |
| `<input type="email">` | `<TextInput keyboardType="email-address">` | |
| CSS grid | Flexbox only in RN | Use `flexDirection`, `flexWrap`, `justifyContent`, `alignItems`. |
| `<fieldset>` / `<legend>` | Group via `View` + `accessibilityRole="summary"` | No native equivalent. |
| `aria-invalid="true"` | `accessibilityState={{ invalid: true }}` | |
| `aria-describedby` | `accessibilityHint` (single string) | Hint is announced after the label. |
| `<dialog>` | RN Modal with `accessibilityViewIsModal` | RN Modal handles focus trap-ish behavior. |
| `:lang(sv)` | No equivalent — use `I18nManager` for layout direction | |

## The thumb-zone rule (web → mobile priority)

Web has no thumb zone. Mobile does. The better-web-ui rule:
> Primary CTAs within bottom 60% of the screen.

Maps to EventPulse:
- Primary action (e.g., "See event") should sit in the lower half of
  the event detail screen, ideally above the bottom tab bar but not in
  the very top safe area.
- The bottom tab bar IS the primary navigation — do not stack FABs above
  it. The existing `BottomTabBar.js` is correct.

## Spacing scale translation

Better-web-ui recommends `4/8/12/16/24/32/48`. EventPulse's existing
code already uses these values. Do not introduce new arbitrary values.

| Token | Value | Use |
|---|---|---|
| `space.xs` | 4 | Tight within a label group |
| `space.sm` | 8 | Card image → text |
| `space.md` | 12 | Inline list gap |
| `space.base` | 16 | Section inner padding |
| `space.lg` | 20 | Screen edge padding (sandbox uses 20) |
| `space.xl` | 24 | Between major sections |
| `space.2xl` | 32 | Empty-state vertical breathing |
| `space.3xl` | 48 | Hero spacing |

## Typography translation

Better-web-ui recommends 4–6 named sizes. EventPulse already has the
five-role pattern (`eyebrow` / `title` / `card.title` / `card.subtitle` /
`tab.label`). Extend only by adding a named role with token + use case.

## Motion translation

| Web | RN |
|---|---|
| `transition: 150ms ease-out` | `Animated.timing(v, { duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true })` |
| `transform: scale(0.98)` on press | `Pressable` `style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}` |
| `prefers-reduced-motion` | `AccessibilityInfo.isReduceMotionEnabled()` |
| Spring for sheets | Reanimated `withSpring` or RN Animated `Animated.spring` |

If you find yourself needing `Animated.loop` or chained tweens for a UI
that does not strictly need it, **remove the animation**. EventPulse's
motion budget is small: press feedback + screen transitions + skeleton
shimmer. Nothing else.

## Images translation

| Web | RN |
|---|---|
| `<img src="…" alt="…">` | `<Image source={…} accessibilityLabel="…" />` |
| `loading="lazy"` | RN `<Image>` does not lazy-load automatically. Use `expo-image` for `contentFit`, progressive, and caching. |
| `srcset` | Not supported. Pre-resize on server or use multiple `<Image>` sources per breakpoint. |
| `object-fit: cover` | `resizeMode="cover"` |
| `width: 100%; height: auto` | RN requires explicit width AND height (or `aspectRatio`). |

**Critical RN gotcha (saw this in 06-UI/components/EventPulseCarousel.js:62):**
`<Image source={…}>` requires the value to be either:
- A `require()` result (asset registry number), or
- An object `{ uri: 'https://…' }`.

A **raw string URL** does NOT render — it silently falls through to
whatever is behind the `<Image>`. If you write `source={url}` with a
string, the user sees a black box. Always normalize.

## Touch targets

Web has hover and small click targets are forgivable. Mobile is strict:

- iOS HIG: 44×44 pt minimum.
- Android Material: 48×48 dp minimum.

`Pressable` does not enforce this — you do. Add hitSlop on small icons.

## Forms translation

Web `<input>` types map to RN `keyboardType`:
- `email` → `keyboardType="email-address"`
- `tel` → `keyboardType="phone-pad"`
- `number` → `keyboardType="numeric"`
- `url` → `keyboardType="url"`
- `password` → `secureTextEntry={true}` + optional show-password toggle

`onSubmitEditing` replaces `<form onsubmit>`. `returnKeyType="go"` /
`"send"` / `"done"` for visual cues.

## Accessibility translation

WCAG principles translate but the API differs:

- **Perceivable:** alt text → `accessibilityLabel`. Color contrast — same.
- **Operable:** keyboard → not applicable. Touch targets, gestures — set
  `accessibilityActions` for non-standard gestures.
- **Understandable:** labels — same. Language — `accessibilityLanguage="sv-SE"`.
- **Robust:** `accessibilityRole`, `accessibilityState` — RN-native.

Test with VoiceOver (iOS Simulator: Settings → Accessibility →
VoiceOver) and TalkBack (Android Studio Emulator).

## Offline & resilience

Web offline = Service Worker. RN offline = `NetInfo` + local persistence
(AsyncStorage / MMKV). EventPulse's existing services handle this in
`06-UI/services/`. The sandbox does not (intentional isolation).

## Performance traps (RN-specific)

- **Anonymous functions in render** create new functions each render —
  breaks memoization. Define handlers outside the component or wrap in
  `useCallback`.
- **Inline styles** create new style objects each render — keep
  `StyleSheet.create` at module scope.
- **Large lists without virtualization** — use `FlatList` not `.map()`.
- **Re-renders from context** — split contexts by update frequency.
- **JS-thread animations** — use `useNativeDriver: true` for transform /
  opacity, never for layout (`width`, `height`).
