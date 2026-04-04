# 06-UI/components

## Purpose

Contains reusable UI components used across screens in EventPulse.

## Component Categories

### Event Cards

Display a single event in a list. Must show:
- title
- date
- venue
- image (if available)
- category indicator

States: default, loading skeleton, error placeholder.

### Filters

Allow filtering event list by:
- source
- category
- date range
- price (free/paid)

Filter state should be reflected in API query params.

### Buttons / CTAs

Primary CTA: "See event" → opens `ticket_url`
States: default, pressed, disabled, loading.

### Loading States

- Skeleton screens for event cards
- Full-page spinner for initial load

### Empty States

Shown when no events match filters or API returns empty:
- Clear message: "No events found"
- Suggestion to adjust filters

### Error States

Shown when API call fails:
- Clear error message: "Failed to load events"
- Retry button

## Design Principles

From `AI/rules/ui.md`:
- fast, clear, minimal, predictable
- no over-design
- no complexity
- avoid decorative changes without UX value

## What belongs here

- Component documentation
- Props/state definitions
- Usage guidelines

## What does NOT belong here

- Screen-level state (belongs to `../app/`)
- API client (belongs to `../services/`)

## Status

**Status: Active**

Components exist and follow the design principles in `AI/rules/ui.md`.
