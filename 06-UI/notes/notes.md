# 06-UI/notes

## Purpose

Contains design notes, UX decisions, and documentation about the EventPulse UI layer.

## Design Principles

From `AI/rules/ui.md`:
- UI must be fast, clear, minimal, predictable
- Avoid over-design and complexity
- Every screen needs loading, error, and empty states
- Never show fake or placeholder data as real

From `AI/workflows/ui-loop.md`:
- Work in strict loops: analyze, select ONE problem, fix, verify, evaluate, repeat
- Never fix multiple UI issues at once
- If improvement is unclear after fix → treat as failure
- UI must reflect what the user actually experiences

## UX Decisions

### State Coverage
Every important UI surface must handle:
- loading
- success
- empty
- error

Blank or silent states are failures.

### Interaction Testing
Every user action must be testable:
- tap/click
- navigation
- back behavior
- CTA behavior
- opening event links

Dead interactions are critical failures.

### Navigation Rules
- Always reversible (back button works)
- Never trap the user
- Predictable and simple
- For webviews: either open inside app OR open external browser cleanly

## What belongs here

- UX design decisions
- UI rules reference
- Design system notes

## What does NOT belong here

- Component code (belongs to `../components/`)
- API client (belongs to `../services/`)

## Status

**Status: Active**

Design principles from `AI/rules/ui.md` and `AI/workflows/ui-loop.md` apply to this layer.
