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
