# 06-UI/services

## Purpose

Contains the API client code for the UI layer: functions that fetch event data from the backend (`api-server.cjs` /Supabase).

## What belongs here

- API client functions (fetch wrappers)
- Query parameter builders
- Response transformation
- Error handling for API calls

## Primary API Endpoint

**`GET /supabase-events`**

Query parameters:
- `city` (default: 'Stockholm')
- `days` (default: 365)
- `limit` (default: 100)
- `source` (optional, filter by source)

Response shape:
```typescript
{
  data_source: 'supabase';
  fallback_used: false;
  timestamp: string;
  ingestion_stats: {
    events_last_24h: number;
    by_source: Record<string, { inserted: number; updated: number }>;
    last_run: string;
  } | null;
  total_published_events: number;
  source_counts: Record<string, number>;
  sources: string[];
  events: UnifiedEvent[];
  count: number;
  query_params: { city, days, limit, source };
}
```

## UnifiedEvent Shape

```typescript
{
  id: string;
  title: string;           // title_en || title_sv || 'Untitled'
  date: string;            // YYYY-MM-DD
  time: string;            // HH:MM
  venue_name: string;
  venue_address: string;
  city: string;
  description: string;     // description_en || description_sv
  source: string;
  category_slug: string;   // denormalized
  is_free: boolean;
  price_min: number | null;
  price_max: number | null;
  ticket_url: string;
  image_url: string | null;
  // Legacy aliases
  venue: string;
  area: string;
  url: string;
  category: string;
  isFree: boolean;
  priceMin: number | null;
  priceMax: number | null;
  imageUrl: string | null;
}
```

## API Server Location

The backend API server is at `services/api-server.cjs` and runs on port 8080.
It connects to Supabase directly and serves the unified event shape.

## What does NOT belong here

- Components (belongs to `../components/`)
- Screens (belongs to `../app/`)

## Status

**Status: Active**

API client is in use. `/supabase-events` is the primary data source for the UI.
