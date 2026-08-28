# Image Flow — Current State

> Phase A audit deliverable T0020. Pure inventory — no decisions yet.
> Last verified: 2026-08-21.

## Where images come from

### 1. JSON-LD (schema.org Event)

**Path:** `schema.Event.image` or `schema.Event.image.url`

Parsed in `02-Ingestion/F-eventExtraction/schema.ts` via `JsonLdEventSchema.image`
(zod union of `JsonLdString | JsonLdUrl`).

Extracted by:
- `extractJsonLd()` in `universal-extractor.ts` — phase A1 method
- `makeEvent()` in `universal-extractor.ts` — all B-methods (B1–B5)

`imageUrl` field in `ParsedEventSchema` is set from `data.image`, `data.photo`, `data.poster`, `data.thumbnail`, `data.img`, or `data.imageUrl` (first non-empty wins).

Also resolves arrays:
- `data.images[0].url | .src`
- `data.photos[0].url | .src`

**Confidence signal:** `hasImage` not tracked separately; `confidence.score` is 0.95 for structured methods (A1/A2), 0.75 for B-methods.

### 2. Open Graph meta tags (page-level fallback)

**Path:** `<meta property="og:image">`, `<meta property="og:image:url">`, `<meta name="twitter:image">`

Two separate implementations:

**In universal-extractor.ts** (`extractPageOgImage`, lines 1128–1144):
- Runs as a post-processing step AFTER A1–C3 extraction
- Applies only to events that did NOT already get an image from structured data
- Enriches `imageUrl` in-place via `enrichedEvents` map
- No separate confidence signal; follows the event

**In event_image.ts** (`extractImageFromHtml`, lines 147–191):
- Pure parsing function, no I/O
- Priority: `og:image` → `og:image:url` → `twitter:image` → `twitter:image:src` → JSON-LD `Event.image`
- Resolves relative URLs against `pageUrl`
- Validates with `IMAGE_EXTS = /\.(jpe?g|png|webp|gif|avif|svg)(\?|#|$)/i`
- Used at **runtime** by the agent, not during ingestion

**In fetch_event_image.ts** (`fetchEventImage`):
- HTTP fetch wrapper around `extractImageFromHtml`
- In-process LRU cache (Map), 7-day TTL, max 1000 entries
- 5s hard timeout via AbortController
- UA: `EventPulse-Bot/1.0`
- Used by `08-Agent/server.ts` at chat time when `image_url` is NULL

### 3. HTML card heuristics

**Path:** `<img src>`, `<img data-src>`, `<picture source srcset>`

In `extractHtmlHeuristics()` — C1 extraction method:
- `<picture source[srcset]>` — first srcset entry wins
- `img[src]`, `img[data-src]`, `[class*="image"] img`, `[class*="poster"] img`
- Built into the per-card extraction loop (lines 804–819)

In `extractTimeAnchors()` — C2 extraction method:
- `$card.find('img[src]').first()` only

No validation against image extensions in these paths — any non-data: URL is accepted.

### 4. Ticketmaster / Eventbrite API

Source: `02-Ingestion/A-directAPI-networkGate/adapters/ticketmaster.ts`,
`02-Ingestion/A-directAPI-networkGate/adapters/eventbrite.ts`,
`06-UI/services/ingestion/src/sources/ticketmaster.ts`

API response fields mapped directly to `imageUrl` — no further transformation.

### 5. Supabase `events_public.image_url`

**Column:** `image_url` (nullable text)

Schema declaration in `05-Supabase/schema/schema.md` line 26:
```
- `image_url` — event image
```

Migration `20260818-0001-agent-event-graph.sql` (line 289) includes it in the view.

Confidence v1 scoring (`20260818-0002-confidence-v1.sql` line 44):
```sql
+ (CASE WHEN image_url IS NOT NULL THEN 10 ELSE 0 END)
```
+10 confidence when `image_url IS NOT NULL`.

**No rights/licensing fields exist** in `events_public` or any migration.

## Runtime image fallback flow (08-Agent)

```
/agent/chat response
  → search_events (DB query)
    → events_public.image_url IS NULL?
      → YES: fetch_event_image(sourceUrl)
        → HTTP GET (5s timeout)
        → extractImageFromHtml (og:image > twitter:image > JSON-LD)
        → cache[sourceUrl] = imageUrl (7d TTL)
        → return imageUrl | null
      → NO: return events_public.image_url
  → rank_events
  → composeReply (includes imageUrl in card)
```

Implemented in:
- `08-Agent/tools/fetch_event_image.ts` — the cache + fetch
- `08-Agent/tools/event_image.ts` — the parser
- `08-Agent/server.ts` — calls `fetchEventImage` when `imageUrl` is null

## Inventory summary

| Source | Location | Format | Storage | Rights fields |
|--------|----------|--------|---------|---------------|
| JSON-LD Event.image | universal-extractor.ts A1 | URL string or ImageObject | `events_public.image_url` | None |
| og:image / twitter:image | universal-extractor.ts C1/C2 post-process | meta content | `events_public.image_url` | None |
| og:image (runtime) | event_image.ts + fetch_event_image.ts | meta content | In-process cache only | None |
| HTML card img | universal-extractor.ts C1 | img src/data-src | `events_public.image_url` | None |
| Ticketmaster API | adapters/ticketmaster.ts | API field | `events_public.image_url` | None |
| Eventbrite API | adapters/eventbrite.ts | API field | `events_public.image_url` | None |

## No rights/licensing

Confirmed: **no `rights`, `license`, `attribution`, `copyright` or equivalent fields** exist in:
- `events_public` schema / migrations
- `ParsedEventSchema` in `schema.ts`
- `imageUrl` handling in any adapter or extractor

The system stores and serves whatever URL the organizer publishes, with no policy enforcement layer.
