# E-detailProbe

Detail page enrichment step. Follows event detail page URLs to extract fuller data than is available on list pages.

## What It Enriches

From `goals-detailed.md`: listsidan data rarely enough — follow detail page to get:
- Exact start/end times
- Full venue address
- Organizer name and contact
- Price information
- Event image
- Full description
- Direct ticket URL

## When to Use

Not every event needs a detail probe. Use it when:
- The list page has incomplete time/venue data
- Rich event records are required for the target use case
- The detail page URL is reliably available from the list page

## Current Status

**Not separately implemented as a standalone step.** The need is documented in goals-detailed.md and the concept is understood, but there is no `E-detailProbe.ts` or equivalent. Events from detail pages are currently extracted as part of the main extraction flow when list pages link to detail pages directly.
