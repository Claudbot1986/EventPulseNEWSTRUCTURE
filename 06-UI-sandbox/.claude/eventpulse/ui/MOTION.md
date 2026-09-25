# Motion

EventPulse is intentionally low-motion. Animation is feedback, not
decoration.

## Existing motion budget

What already moves (or should move) in EventPulse:

| Surface | Motion | Duration | Use |
|---|---|---|---|
| Card press | Opacity 0.7 OR scale 0.98 | 100 ms | Press feedback |
| Tab switch | None currently | — | Consider adding a cross-fade |
| Modal open | Slide up + backdrop fade | 250 ms | `Modal` default animation |
| Toast | Slide in from bottom | 200 ms in, 200 ms out | |
| Skeleton | Shimmer (opacity 0.5 → 1 → 0.5) | 1500 ms loop | Loading placeholder |

Everything else is static. Resist the urge to animate.

## Rules

### 1. Press feedback is required

Every `<Pressable>` should have a visible pressed state:

```jsx
<Pressable
  style={({ pressed }) => [
    styles.card,
    pressed && { opacity: 0.7 },
  ]}
  ...
>
```

`EventPulseCarousel` already has `pressed && styles.cardPressed` — but
`cardPressed` is not defined in `styles` (gap to fix). Add it.

### 2. Transitions ≤ 300 ms

Cross-fades, slides, fades — all under 300 ms. Longer feels slow on
mobile.

### 3. Respect reduced motion

```jsx
import { AccessibilityInfo } from 'react-native';

const [reduceMotion, setReduceMotion] = useState(false);
useEffect(() => {
  const sub = AccessibilityInfo.addEventListener(
    'reduceMotionChanged',
    setReduceMotion,
  );
  AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  return () => sub.remove();
}, []);

const transition = reduceMotion ? 0 : 200;
```

If `reduceMotion` is true, skip animation entirely.

### 4. Use native driver when possible

For `Animated.timing` on `transform` and `opacity`:

```jsx
Animated.timing(opacity, {
  toValue: 1,
  duration: 200,
  useNativeDriver: true,
}).start();
```

Never animate `width`, `height`, `top`, `left` on the JS thread —
causes dropped frames.

### 5. Skeleton > spinner for content > 500 ms

`ActivityIndicator` is fine inside a button (action in progress). For
content loading, a stable-size skeleton block that matches the real
content shape is better — layout doesn't jump when data arrives.

`EventPulseCarousel` already uses skeleton cards (same width as real
cards) when `loading: true`. Extend this pattern.

### 6. Never block the JS thread with motion loops

If you find yourself wanting a `setInterval` or `Animated.loop` for a
visual effect, ask:

- Does this convey real-time state? (e.g., a spinner) — OK.
- Is this a decorative loop? — remove it.
- Is this a shimmer skeleton? — use `Animated.loop` with
  `useNativeDriver: true` and short duration.

### 7. No motion for the sake of motion

Refuse to add:

- Bouncing icons.
- Logo animations.
- Parallax effects.
- Skeleton shimmer that's longer than 2 s per cycle.
- Auto-playing carousels (those are UX anti-patterns).
- Animated page transitions that obscure content.

## Approved animations (the only ones allowed)

1. **Press feedback.** Opacity 0.7 OR scale 0.98, ≤ 100 ms.
2. **Modal/sheet transitions.** Slide up + backdrop fade, ~250 ms.
   Use `Modal` `animationType="slide"` — RN's built-in.
3. **Toast in/out.** Slide from bottom, 200 ms. Self-dismissing.
4. **Skeleton shimmer.** Opacity 0.5 ↔ 1, ~1500 ms loop, on stable
   shapes only.
5. **Tab indicator.** The orange underline / dot moves to the active
   tab. (When we add it.) ~200 ms ease-out.

That's the entire budget. If you want to add a 6th, justify it in the
PR with user need.

## Implementation reference

For new animation needs:

```jsx
import { Animated } from 'react-native';

function FadeInView({ children, duration = 200 }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, {
      toValue: 1,
      duration,
      useNativeDriver: true,
    }).start();
  }, [reduceMotion]);

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}
```

For press feedback, prefer `Pressable`'s built-in:

```jsx
<Pressable
  style={({ pressed }) => [
    styles.card,
    pressed && styles.cardPressed,
  ]}
>
```

No `Animated` needed for simple press feedback.

## When NOT to animate

- **Onboarding screens.** Static is fine.
- **Settings screens.** Static. Period.
- **Lists.** No item-entrance animations.
- **Empty states.** Static.
- **Error states.** Static.

If you want to animate one of these, you are over-designing.

## Reanimated 3 (future)

EventPulse does not currently use Reanimated. If we add it (for gesture-
driven bottom sheets, swipe-to-dismiss on toasts, etc.), keep the same
rules: short durations, native driver, reduced motion respect.

Don't add Reanimated just because. The core `Animated` API covers 95%
of what we need.

## Sources

- iOS Human Interface Guidelines — Motion:
  https://developer.apple.com/design/human-interface-guidelines/motion
- Material Design — Motion:
  https://m2.material.io/design/motion/overview.html
- WCAG 2.1 — Animation from Interactions:
  https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html
