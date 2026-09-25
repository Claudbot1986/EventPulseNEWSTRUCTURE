# Screen States

Every interactive surface in EventPulse must handle these states.
Forgetting one is a UX bug.

## The states

| State | When | Visual |
|---|---|---|
| Default | Normal use | Component as designed |
| Pressed | User touching | Opacity 0.7 or scale 0.98 |
| Focused | Keyboard / external focus (RN has limited support) | Border or ring in `color.accent` |
| Disabled | Action unavailable | 50% opacity, no interaction |
| Loading | Action in progress | Spinner inside, skeleton for content |
| Empty | No data to show | Icon + explanation + next action |
| Error | Something failed | Human message + retry button |
| Success | Action completed | Confirmation, auto-dismiss |

## Per-state patterns

### Default

The component as designed. Always rendered first.

### Pressed

```jsx
<Pressable
  style={({ pressed }) => [
    styles.card,
    pressed && { opacity: 0.7 },
  ]}
>
```

Don't animate pressed state longer than 100 ms. Don't scale below 0.95
— the press feedback becomes a layout shift rather than feedback.

### Focused

RN does not have CSS `:focus-visible`. Manage in state:

```jsx
const [focused, setFocused] = useState(false);

<Pressable
  onFocus={() => setFocused(true)}
  onBlur={() => setFocused(false)}
  style={[styles.card, focused && styles.cardFocused]}
>
```

`styles.cardFocused` adds a 2 px `color.accent` outline.

For `<TextInput>`, focus state is the platform default (cursor + keyboard).
Add a focus border to the wrapper:

```jsx
<TextInput
  style={[styles.input, focused && styles.inputFocused]}
  onFocus={() => setFocused(true)}
  onBlur={() => setFocused(false)}
/>
```

### Disabled

```jsx
<Pressable
  disabled={isDisabled}
  accessibilityState={{ disabled: isDisabled }}
  style={[styles.button, isDisabled && styles.buttonDisabled]}
>
  <Text style={[styles.buttonText, isDisabled && styles.buttonTextDisabled]}>
    Submit
  </Text>
</Pressable>
```

`buttonDisabled`: `opacity: 0.4`.
`buttonTextDisabled`: `color.textTertiary` (still readable, just muted).

A disabled-looking button that still receives taps is a bug. Always pair
the visual with `disabled={true}`.

### Loading

**For content (lists, cards):**

```jsx
{loading ? <Skeleton /> : <Content />}
```

Skeleton size = real content size. Same width, same height, same
spacing. Layout doesn't shift.

`EventPulseCarousel` does this with `skeletonCount` (default 4) cards.

**For action buttons:**

```jsx
<Pressable
  disabled={isLoading}
  accessibilityState={{ busy: isLoading, disabled: isLoading }}
>
  {isLoading ? (
    <ActivityIndicator size="small" color={color.text} />
  ) : (
    <Text>Submit</Text>
  )}
</Pressable>
```

**Never:**

- Block the entire UI with a full-screen spinner when content can be
  shown as skeleton.
- Show a spinner with no timeout. If something takes > 10 s, surface
  an error state with a retry.

### Empty

```jsx
<View style={styles.empty}>
  <Ionicons name="calendar-outline" size={48} color={color.textTertiary} />
  <Text style={styles.emptyTitle}>No events for tonight</Text>
  <Text style={styles.emptyBody}>
    Try a different day or category.
  </Text>
  <Pressable style={styles.emptyCta} onPress={openFilters}>
    <Text style={styles.emptyCtaText}>Browse filters</Text>
  </Pressable>
</View>
```

Empty states must:

1. Explain **what** is missing (no events for tonight).
2. Explain **why** (filter mismatch, no events in this category yet).
3. Suggest a **next action** (browse filters, change day).

Never just show a sad icon. Never say "Nothing here." That is not
helpful.

### Error

```jsx
<View style={styles.error}>
  <Ionicons name="alert-circle-outline" size={48} color={color.danger} />
  <Text style={styles.errorTitle}>Couldn't load events</Text>
  <Text style={styles.errorBody}>
    Check your connection and try again.
  </Text>
  <Pressable style={styles.errorRetry} onPress={retry}>
    <Text style={styles.errorRetryText}>Try again</Text>
  </Pressable>
</View>
```

Error states must:

1. Say **what failed** (couldn't load events).
2. Say **why** if known (no connection, server error).
3. Offer a **next action** (retry, contact support).
4. Never expose a stack trace or error code to the user.
5. Never auto-dismiss without the user seeing it.

### Success

Toasts and inline confirmations:

```jsx
<Toast visible={showSuccess} message="Event saved" />
```

Self-dismissing after 2–3 s. Don't block the user.

## Per-screen checklist

Before declaring a screen done, verify each state renders correctly:

- [ ] Default: real data shown.
- [ ] Loading: skeleton or spinner, layout stable.
- [ ] Empty: explanation + next action.
- [ ] Error: message + retry.
- [ ] Success: feedback on every action.
- [ ] Disabled: all disabled controls look disabled AND are disabled.
- [ ] Pressed: visible feedback on every tap target.

If a state is impossible to reach, document why ("Empty is impossible
because the API always returns at least the day's events").

## Real EventPulse screens

Map states to existing screens:

| Screen | Empty | Error | Loading |
|---|---|---|---|
| `HomeScreen` | "No events tonight — try a different day" | "Couldn't load — retry" | Skeleton carousels |
| `MapScreen` | "No events on the map" | "Couldn't load map" | Skeleton map |
| `ProfileScreen` | "Sign in to see your saved events" | N/A (auth screen handles) | Spinner during auth check |
| `UtforskaStarScreen` | "No saved events" | "Couldn't load — retry" | Skeleton cards |

These are the patterns to extend.

## Sources

- `06-UI/components/components.md` — empty state and error state
  requirements (existing).
- Nielsen Norman Group — Empty State UX:
  https://www.nngroup.com/articles/empty-state-design/
- React Native — ActivityIndicator:
  https://reactnative.dev/docs/activityindicator
