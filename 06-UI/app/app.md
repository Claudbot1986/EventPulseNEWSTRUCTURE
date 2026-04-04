# 06-UI/app

## Purpose

Contains the main application screens and navigation structure of the EventPulse UI.

## What belongs here

- Page components (event list page, event detail page)
- Navigation/routing logic
- URL structure
- Page-level state management

## Screens

### Event List Page

Main entry point. Shows all published events.

Key requirements:
- Fetch from `/supabase-events`
- Show loading/error/empty states
- Display: title, date, venue for each event
- Scrollable and responsive
- Filter controls

### Event Detail Page

Shows full event information.

Key requirements:
- Fetch single event by ID
- Show: title, date, time, venue, description, CTA
- CTA must open `ticket_url` in browser
- Back navigation must work

## What does NOT belong here

- Reusable components (belongs to `../components/`)
- API client (belongs to `../services/`)

## Status

**Status: Active**

Screens exist and are connected to the backend API.
