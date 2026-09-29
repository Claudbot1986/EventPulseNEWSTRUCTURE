# 04-Normalizer/category-mapping

## Purpose

Documents the category resolution logic that converts category slugs from RawEventInput into category UUIDs for the Supabase `event_categories` join table.

## How it works

```
RawEventInput.categories (string[]) or RawEventInput.category (string)
    │
    ▼
resolveCategoryIds(slugs: string[] | undefined)
    │
    ├── Lookup each slug in Supabase categories table
    │        SELECT id FROM categories WHERE slug IN (slugs)
    │
    └── Returns: string[] of UUIDs

For each normalized event:
    if (category_ids.length > 0):
        INSERT INTO event_categories (event_id, category_id) ...
```

## Category Slug Convention

The normalizer denormalizes the **first** category slug onto the event record as `category_slug`.
This allows UI to filter directly without a join:
```sql
SELECT * FROM events WHERE category_slug = 'music'
```

## Source Differences

- **Kulturhuset:** uses `category` (singular)
- **Others:** use `categories` (plural array)

The normalizer handles both:
```typescript
const categories = raw.categories ?? (raw.category ? [raw.category] : undefined);
const category_slug = categories?.[0] ?? 'community';
```

## Default Category

If no category is present, defaults to `'community'`.

## Source-level defaults (2026-09-29)

Verifierade enkel-syfte-källor får en hårdkodad kategori innan
'community'-fallbacken. Implementation i
`04-Normalizer/sourceCategoryDefaults.ts`. Wikas via
`getDefaultCategorySlugForSource(raw.source)` i `normalizer.ts`.

Lägg till nya entries **bara** när:
1. ≥ 50 % av källans events har samma kategori, ELLER
2. Källans identitet ÄR kategorin (t.ex. Berwaldhallen som konserthall).

Exempel (verifierade 2026-09-29 mot riktig DB-data):
- `berwaldhallen` → `classical` (125 events, alla klassiskt)
- `lulea-hf-2` / `downtown-2` / `globen-3` / `halmstad-konserthus-2` → `musical` (samma biljettshop.se Chicago-musikal — kors-source dedup konsoliderar 228 → 57)
- `sthlmlist` → `music` (Stockholm music listings)
- `debaser` → `music` (Debaser musikscen)

Om källan redan satt en adapter-level category (raw.categories eller
raw.category), tar det **företräde** — source-default är sista-chans-lookup.

## What belongs here

- Category resolution logic documentation
- Slug → UUID lookup examples
- Category slug conventions

## What does NOT belong here

- Supabase schema definitions (belongs to `05-Supabase/schema/`)
- UI filter logic (belongs to `06-UI/`)

## Status

**Status: Active**

Category resolution is implemented in `normalizer.ts` via `resolveCategoryIds()`. Slugs are denormalized onto events for fast filtering.
