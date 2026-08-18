# EventPulse getdesign.md

## Purpose

This file is the practical design brief for EventPulse UI work.

Use it before changing screens, components, styling, motion, spacing, or empty/loading/error states. It translates external design systems into EventPulse-specific rules so UI iterations stay coherent.

## Source Systems

- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines) for clarity, deference to content, native app feel, depth, and motion.
- [Material Design 3](https://m3.material.io/) for component structure, adaptive layout, surfaces, color roles, and purposeful motion.
- [Shopify Polaris](https://polaris.shopify.com/design) for polished but not ornamental interfaces, strong interaction states, and action-driven product UI.
- [Mobbin](https://mobbin.com/) for real-world reference patterns from discovery, city guide, ticketing, music, events, and media apps.

## Product Feeling

EventPulse should feel like a modern city discovery app:

- curated, not dumped
- local, not generic
- lively, not chaotic
- premium, not flashy
- trustworthy, not speculative
- fast enough to browse casually

The UI should make real events feel discoverable and alive while preserving the system rule that fake or placeholder data must never look real.

## Core Principles

### 1. Content Leads

Event content is the product. Interface chrome should support browsing, not compete with events.

- Event title, date, venue, image, category, and CTA must be visually prioritized.
- Cards should feel editorial and scannable, not like database rows.
- Pipeline or ingestion status must not leak into the consumer app as user-facing truth unless explicitly designed as an operator view.

### 2. Clear In Two Seconds

A user should understand what an event is, when it happens, and why it might matter within two seconds.

- Use strong date and venue hierarchy.
- Keep labels short and concrete.
- Prefer direct copy: "See event", "Today", "This weekend", "Free", "Nearby".
- Avoid unexplained internal terms like provider, queue, source status, normalized, persisted, or derived rule in consumer UI.

### 3. Browse First, Filter Second

The default experience should invite exploration. Filters should refine momentum, not block entry.

- Start with event discovery, not an empty control panel.
- Make filters lightweight, reversible, and visible.
- Filter state should be obvious and easy to clear.
- Search and category controls should not dominate the first screen unless the user has already expressed intent.

### 4. Polished But Not Ornamental

The UI should feel carefully made without adding decoration for its own sake.

- Motion must explain navigation, state change, or hierarchy.
- Gradients, blur, glass, and shadows need a job.
- Avoid generic AI-looking purple-blue gradients unless they are part of a deliberate brand palette.
- Do not add visual effects that make event content harder to scan.

### 5. Honest States

Every important surface must handle loading, empty, error, and partial-data states.

- Loading should use skeletons or meaningful progressive loading, not blank screens.
- Empty states should explain what happened and offer the next useful action.
- Error states should be calm, readable, and retryable.
- Missing event fields should degrade visibly but honestly; never fabricate title, date, venue, image, price, or ticket data.

### 6. Native App Rhythm

EventPulse should behave like a high-quality app even when built on web technology.

- Navigation must be reversible.
- Touch targets must be comfortable.
- Interactions need immediate feedback.
- Sheets, detail views, and transitions should preserve spatial context.
- Mobile layouts are first-class, not compressed desktop layouts.

### 7. Accessibility Is Baseline Quality

Accessibility is not a post-polish pass.

- Maintain readable contrast in light and dark contexts.
- Do not rely on color alone for category, price, or status.
- Focus states must be visible.
- Text should scale without breaking the primary event browsing flow.
- Tap targets should be large enough for real mobile use.

## Visual Direction

### Layout

- Use generous spacing around hero/event content.
- Use tighter density only for repeatable lists and filter rows.
- Prefer stacked mobile cards and structured desktop grids.
- Keep alignment consistent across card title, date, venue, image, and CTA.

### Typography

- Use a clear hierarchy: screen title, section title, event title, metadata, caption.
- Event titles should carry personality but remain readable.
- Metadata should be compact, not tiny.
- Avoid overusing all caps; reserve it for small labels or date chips.

### Color

- Color should communicate meaning and atmosphere.
- Use accent color for primary actions and selected filter/category states.
- Category colors must be consistent across the app.
- Avoid random one-off colors in components.
- Dark mode, if used, should feel intentional and not like inverted light mode.

### Depth

- Use depth to separate surfaces: event cards, filter sheets, detail overlays, sticky controls.
- Shadows and borders should be subtle and consistent.
- Do not stack too many elevated surfaces in one view.

### Motion

- Motion should be quick, directional, and tied to user action.
- Good uses: opening event detail, applying filters, refreshing results, loading cards.
- Bad uses: decorative loops, slow hover theatrics, scroll animations that delay content.

## Component Rules

### Event Card

Must show:

- title
- date or date range
- venue or location label
- category or event type when known
- image only when real image data exists
- primary action or clear tap affordance

Should support:

- compact list version
- larger editorial version
- loading skeleton
- partial-data variant
- unavailable image variant

Must not:

- invent event imagery
- hide date uncertainty behind confident UI
- over-emphasize source/provider over user-facing event value

### Event Detail

Must answer:

- What is it?
- When is it?
- Where is it?
- How do I go or learn more?
- What source does this come from, if transparency is needed?

Should preserve browsing context when closed.

### Filters

Must be:

- reversible
- easy to clear
- reflected in visible UI state
- backed by real API/query behavior

Do not create visual-only filters that do not affect results.

### Empty State

Must include:

- clear reason when known
- suggested next action
- no fake events

Examples:

- "No events this weekend. Try clearing filters."
- "No free events found. Show all prices?"

### Error State

Must include:

- plain-language message
- retry path
- no blame on the user

### Loading State

Must avoid blank screens. Prefer skeleton cards that match the eventual layout.

## Reference Collection Workflow

When a visual reference is added from Instagram, Mobbin, screenshots, or recordings:

1. Save the source URL or local asset path.
2. Write what is actually useful, not just "looks nice".
3. Extract patterns into EventPulse language:
   - layout rhythm
   - card hierarchy
   - motion behavior
   - typography
   - filter behavior
   - detail transition
4. Decide whether the pattern belongs in:
   - consumer app
   - operator dashboard
   - future experiment
   - reject list

## AI Agent Instructions

Before UI implementation:

1. Read this file.
2. Read `06-UI/notes/notes.md`.
3. Read `06-UI/components/components.md`.
4. Identify one UI problem only.
5. Make the smallest coherent change.
6. Verify with real UI behavior, screenshot, browser run, test, or visible output.

After UI implementation:

- Check loading, empty, error, and success states.
- Check mobile and desktop if the surface is responsive.
- Confirm no fake event data was introduced.
- Report what changed, why, how it was verified, and what remains unclear.

## Do Not

- Do not turn the consumer app into an operator dashboard.
- Do not show fake or placeholder events as real.
- Do not use decorative gradients, glass, blur, or motion without a clear product purpose.
- Do not create one-off component styles without a reason.
- Do not bury date, venue, or CTA behind visual noise.
- Do not claim a design is better without visual or behavioral verification.

## Current Design North Star

EventPulse should feel like the fastest way to understand what is happening around you:

real events, strong visual hierarchy, calm controls, honest states, and just enough motion to make discovery feel alive.
