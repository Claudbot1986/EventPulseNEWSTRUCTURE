# Accessibility

EventPulse must be usable by everyone, including VoiceOver / TalkBack
users, switch-control users, low-vision users, motor-impaired users,
and users with reduced motion preferences.

## Baseline (every component)

- **Every interactive element** has `accessibilityLabel` and
  `accessibilityRole`.
- **Touch targets** are ≥ 44×44 pt (iOS) / ≥ 48×48 dp (Android).
- **Color contrast** ≥ 4.5:1 for body, ≥ 3:1 for large text (≥ 18 pt
  regular or ≥ 14 pt bold).
- **Color is not the only signal.** Pair color with text, icon, shape,
  or position.
- **Focus order** matches visual order.
- **Reduced motion** is respected via
  `AccessibilityInfo.isReduceMotionEnabled()`.

## Roles in use

| Element | Role | Notes |
|---|---|---|
| `<Pressable>` (action) | `button` | Default for most. |
| `<Pressable>` (navigation) | `link` | When the action navigates. |
| `<TouchableOpacity>` | `button` | Legacy — prefer `Pressable` for new code. |
| Tab item | `tab` | Plus `accessibilityState={{ selected: isActive }}`. |
| Card | `button` | The whole card is interactive. |
| `<TextInput>` | `none` (default) | `accessibilityLabel` describes the field. |
| `<Image>` (informative) | `image` | `accessibilityLabel` describes content. |
| `<Image>` (decorative) | `none` | `accessible={false}` or empty label. |

## Labels

The label is what VoiceOver reads. Make it make sense out of context:

```jsx
// GOOD: descriptive, includes context
<Pressable
  accessibilityRole="button"
  accessibilityLabel="Helg — Helgens alla händelser"
  onPress={...}
>

// BAD: vague
<Pressable accessibilityLabel="card">
```

Pattern for card:

```jsx
accessibilityLabel={`${subtitle} — ${title}`}
```

This reads as "Helg — Helgens alla händelser" instead of "card".

## States

```jsx
<Pressable
  accessibilityRole="button"
  accessibilityLabel="See event"
  accessibilityState={{ disabled: isLoading, busy: isLoading }}
  accessibilityHint="Opens the event ticket page in your browser"
>
```

For tabs:

```jsx
<Pressable
  accessibilityRole="tab"
  accessibilityLabel="Hem"
  accessibilityState={{ selected: isActive }}
>
```

## Touch targets

iOS Human Interface Guidelines: ≥ 44×44 pt.
Android Material: ≥ 48×48 dp.

`EventPulseCarousel` cards are 187 pt wide and ~166 pt tall — well
above the floor. The sandbox tab bar uses `paddingVertical: 14` with
text-only labels — that gives ≈ 38 pt hit area when you include font
height. **That's below 44 pt. Bump to `paddingVertical: 16` or add
`hitSlop`.**

For icon-only buttons, use `hitSlop`:

```jsx
<Pressable
  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
  ...
>
```

## Contrast (verified)

See `DESIGN_SYSTEM.md` § Contrast for the table.

Body text on `#000`:
- `color.text` `#F7F2EA` → 14.6:1 (AAA)
- `color.textMuted` `#9AA3B5` → 6.3:1 (AA)
- `color.textTertiary` `#727B8D` → 4.5:1 (AA, borderline)

Avoid `color.textTertiary` for body text. Use it only for inactive tab
labels where the 700 weight puts it above the "large text" threshold.

## Color independence

Color-only signals fail for color-blind users. Required pairings:

- **Selected tab** — color + bolder weight + (optional) underline.
- **Error state** — `color.danger` (when added) + error icon + helper
  text below.
- **Disabled** — reduced opacity + `accessibilityState={{ disabled }}`.
- **Loading** — spinner + `accessibilityState={{ busy: true }}`.

## Reduced motion

Always respect. See `MOTION.md` § 3 for the hook.

## Screen reader testing

Test with VoiceOver on iOS Simulator:

1. Settings → Accessibility → VoiceOver → On.
2. Navigate the screen with swipe gestures.
3. Verify: every element announces, focus order is logical, no "button"
   or "image" labels without context.

Test with TalkBack on Android Emulator similarly.

## Don't

- **Don't remove focus rings** to "clean up" the design. RN doesn't
  have `outline: none` issues, but state-managed focus indicators are
  still required.
- **Don't rely on icon-only buttons** without labels. iOS HIG requires
  labels on tab bars; same for primary actions.
- **Don't disable zoom.** `maxFontSizeMultiplier` is a per-text setting,
  not a global disable.
- **Don't use placeholder as the only label.** Placeholder disappears
  when the user types.
- **Don't trap focus** outside modals unnecessarily. Modals can use
  `accessibilityViewIsModal`.

## Common patterns

### Form input

```jsx
<TextInput
  accessibilityLabel="Email address"
  accessibilityHint="We'll send a 6-digit code to this address"
  keyboardType="email-address"
  autoComplete="email"
  textContentType="emailAddress"
  ...
/>
```

### Toggle / switch

```jsx
<Switch
  accessibilityLabel="Enable notifications"
  accessibilityState={{ checked: value }}
  onValueChange={setValue}
/>
```

### Loading button

```jsx
<Pressable
  accessibilityRole="button"
  accessibilityLabel="Sign in"
  accessibilityState={{ disabled: isLoading, busy: isLoading }}
  disabled={isLoading}
>
  {isLoading ? <ActivityIndicator /> : <Text>Sign in</Text>}
</Pressable>
```

## Open a11y work

[RECOMMENDED] items not yet shipped:

- Explicit success/warning/danger colors with non-color pairings.
- `accessibilityLanguage="sv-SE"` on the root `<View>` so screen readers
  announce in the user's language.
- A11y audit script that scans the codebase for missing labels.
- `accessible={false}` review for purely decorative icons.

## Sources

- Apple Accessibility — Human Interface Guidelines:
  https://developer.apple.com/design/human-interface-guidelines/accessibility
- Material Design — Accessibility:
  https://m2.material.io/design/communication/accessibility.html
- React Native Accessibility API:
  https://reactnative.dev/docs/accessibility
- WCAG 2.1 AA: https://www.w3.org/WAI/WCAG21/quickref/
