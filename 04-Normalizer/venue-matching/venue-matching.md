# 04-Normalizer/venue-matching

## Purpose

Documents the venue resolution logic that matches incoming events to existing venue records or creates new ones in the Supabase `venues` table.

## Resolution Flow

```
RawEventInput.venue_name (or fallback from raw_payload._embedded.venues[0])
    │
    ├──► isValidVenueName? ──► NO ──► skip venue resolution, return null
    │
    ├──► YES ──► normalize name (trim, collapse spaces)
    │
    ├──► Try exact name match (case-insensitive):
    │        SELECT id FROM venues WHERE name ILIKE :normalizedName
    │
    ├──► If looksLikeAddress(name):
    │        try address-based matching:
    │            SELECT id FROM venues WHERE address ILIKE :address
    │        try partial address match:
    │            SELECT id FROM venues WHERE address ILIKE '%:address%'
    │
    └──► If no match found:
            INSERT new venue:
                name: normalizedName
                address: raw.venue_address ?? ''
                lat: raw.lat ?? 59.3293 (Stockholm center)
                lng: raw.lng ?? 18.0686
                location: POINT(lng lat) or POINT(18.0686 59.3293)
            ON CONFLICT (unique_violation, code 23505):
                re-fetch existing venue by name
```

## Valid Venue Name Rules

**Reject:**
- `null`, `undefined`, empty string, whitespace-only
- Literal `"undefined"`, `"null"`, `"None"`

**Accept:**
- Any string that passes the above check

## Venue Quality Heuristics

### Promoter/Company Rejection

Names matching these patterns are **NOT venues**:
- Company suffixes: `inc, ab, ltd, llc, bv, gmbh, oy`
- Major platforms: `live nation, lnc, ticketmaster, axs, eventim, ticketek`
- Business types: `promoter, booking, management, agency, productions, entertainment, holdings`
- Generic: `stockholm live, wine vision, wine tasting, taste of, concerts, events, festival, tour`

These are checked by `isLikelyPromoterOrCompany()` but currently do NOT block venue creation — they are logged as suspicious.

### Venue Indicator Words

Words that indicate a REAL venue:
`arena, stadium, theater, theatre, hall, center, centre, club, bar, lounge, pub, restaurant, museum, galler, konsthall, arenan, teatern, scenen, krog, scen, hus, garden, plaza, square`

Used by `hasVenueIndicators()` to assess venue likelihood, but currently does NOT block creation.

### Attraction-as-Venue Fallback

For venue names that look like attractions (artists/performers), `isLikelyAttractionAsVenue()` applies stricter criteria:
- Must have STRONG venue indicators (arena, theater, hall, centre, museum, opera, concert, house, palace)
- Must NOT look like a company
- Must be at least 8 characters long

## Address-Based Matching

When `looksLikeAddress()` detects a street-pattern name (Swedish gatan/vägen/stranden pattern, or ends with number), it:
1. Extracts address from `raw_payload._embedded.venues[0].address.line1`
2. Tries exact address match against existing venues
3. Tries partial address match

This helps when venue name is corrupted but address is valid.

## Race Condition Handling

When two workers try to create the same venue simultaneously, PostgreSQL raises `unique_violation` (code 23505). The normalizer catches this and re-fetches the existing venue by name.

## What belongs here

- Venue resolution flow
- Promoter/company rejection logic
- Address-based matching
- Race condition handling

## What does NOT belong here

- Queue infrastructure (belongs to `03-Queue`)
- Supabase schema (belongs to `05-Supabase/schema/`)

## Status

**Status: Active**

Venue resolution is implemented in `normalizer.ts` via `resolveVenue()`. Race conditions are handled. Address-based matching is in place. However, promoter/company detection is logging-only — it does not currently block venue creation.
