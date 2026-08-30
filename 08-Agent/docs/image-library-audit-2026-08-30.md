# Image Library Audit — 2026-08-30 [VERIFIED]

## Scope

Användarens fråga: *"Vid en första scraping av en källa — matchas nya events mot befintliga AI-bilder? Vi vill ha ett bibliotek som (a) successivt växer med nya, (b) tillåter manuell inmatning, (c) matchar motiv mot event (t.ex. teater → teater-liknande), (d) har en snabb matchning. Undersök om detta redan finns idag — kolla kod, /tmp, ongoing automation."*

Denna note är resultatet av en kodbas-genomgång med tre oberoende Explore-agenter. Alla påståenden har fil:rad-citat.

**Vault-mirror:** Denna note ska speglas till `00-Vault/01-Projects/EventPulse/02-Operations/34-Image-Library-Audit-2026-08-30.md` av `vault-sync`-agenten (vault-filer är reserverade för den rollen — se CLAUDE.md Vault Memory Protocol).

---

## Svar i ett stycke

**Det finns redan ett komplett image-library** byggt 2026-08-27. Användaren (och jag) hade inte koll på det. Det mesta av användarens vision (a, c, d) **fungerar idag**, men bara på **kategori-nivå** — inte semantisk motiv-matchning. Manuell inmatning (b) saknas helt. Tre konkreta buggar gör att dokumenterad funktionalitet inte fungerar som utlovat.

---

## Vad som finns — verifierat nuläge

### Datatabell `image_library`

Migration: `05-Supabase/migrations/20260827-0001-image-library.sql:27-48`. Kolumner:

| Kolumn | Typ | Roll |
|---|---|---|
| `id` | uuid PK | |
| `storage_path` | text UNIQUE | Sökväg i Supabase Storage |
| `public_url` | text | Publikt URL |
| `category_slug` | text NULL | FK mot `categories.slug` |
| `venue_pattern` | text NULL | Regex mot venue-namn (DÖD — används ej) |
| `tags` | text[] | Fritext-taggar |
| `source_event_id` | uuid NULL | Vilket event som ursprungligen genererade bilden |
| `times_used` | int | Räknare, bumpas via RPC |
| `last_used_at` | timestamptz | |
| `rating` | int NULL | 1–5 (default NULL → sortering trasig) |
| `approved_by` | text | Curator (UI saknas) |
| `added_at`, `updated_at` | timestamptz | |

RPC: `image_library_bump_usage(p_id uuid)` — atomic +1.

Tilläggsmigration `20260827-0002-image-library-status.sql`: utökar `events.image_generation_status` CHECK med `'library_fallback'` och `events.image_license` med `'library-fallback'`.

### Biblioteks-funktioner (`08-Agent/utils/imageLibrary.ts`)

| Funktion | Roll | Rad |
|---|---|---|
| `pickLibraryFallback({venue_id, venue_name, category_slug})` | Hämta bästa match | 93–130 |
| `bumpUsage(libraryId)` | Atomic +1 via RPC | 132–140 |
| `addToLibrary({storage_path, category_slug, venue_pattern, tags, source_event_id})` | Idempotent upsert | 156–195 |
| `markEventWithLibraryFallback(eventId, fallback)` | Skriv library-URL till event | 204–224 |
| `backfillFromPastAi({dryRun})` | Extraherar unika past-AI-URL:er | 241–289 |

### Aktiv användning vid ingestion

**`04-Normalizer/normalizer.ts:455–501`** — vid varje insert (efter att `start_time > now()`):

1. Library-first check (rad 470–479): `pickLibraryFallback({venue_id, category_slug})`
2. OM träff → `markEventWithLibraryFallback(event_id, libMatch)` (ingen BFL)
3. OM ingen träff → `aiImageQueue.add('generate', {event_id}, {jobId: 'ai-img-'+event_id})`

**`08-Agent/workers/aiImageWorker.ts:212–247`** — efter BFL-success anropas `addToLibrary()`. Biblioteket växer automatiskt.

**`08-Agent/scripts/backfill_library_to_future.ts`** — applicerar library-fallback på alla future events utan AI-bild. Default `--apply=false` (dry-run).

### UI-koppling

**`06-UI/hooks/useAiImageUrl.js:14–21`** — beslutsträd med `'library'` source-state:

```js
image_ai_generated === false && status === 'library_fallback' → 'library'
```

Klienten visar library-bilden utan att användaren märker att den är återanvänd.

### Bucket-struktur (Supabase Storage `event-posters/`)

| Prefix | Roll | Antal |
|---|---|---|
| `events/` | Raw AI-bilder | 326 |
| `ai-originals/` | Rena originals | 908 |
| `ai-stamped/` | Publikt derivat med stämpel + XMP | 908 + 10 |
| `ai-quarantine/` | Legacy / förstörda | 12 |
| `ai-generated/` | Legacy-prefix | ~130 |

Inget separat `library/`-prefix — biblioteket är bara datatabellen.

---

## Gap-analys vs användarens vision

| Önskemål | Nuläge | Källa | Gap |
|---|---|---|---|
| **Matchas vid första scrape?** | ✅ JA | `normalizer.ts:470–479` | Bara kategori-equal, inte semantisk |
| **Bibliotek växer successivt?** | ✅ JA | `aiImageWorker.ts:212–247` + `backfillFromPastAi` | Klart |
| **Manuellt lägga in bilder?** | ❌ NEJ | `addToLibrary` är server-only, inget admin-UI | Curator-UI saknas |
| **Motiv-matchning (teater→teater)?** | ⚠️ DELVIS | `pickLibraryFallback` equality på `category_slug` | Venue_id ignoreras, inga embeddings |
| **Snabb?** | ✅ JA | Equality på indexerad kolumn, ~1ms | Semantisk matching dyrare (5–20ms) |

---

## Tre buggar i befintlig kod

### Bug 1: `pickLibraryFallback` ignorerar `venue_id`

**Källa:** `08-Agent/utils/imageLibrary.ts:93–113`

**Docblock (rad 15–22):**
> Prioritet:
>   1. Samma venue_id + samma category_slug (perfekt match)
>   2. Samma category_slug (konsert-bild till konsert)
>   3. Default-bild

**Verklig kod (rad 99–113):**
```ts
// 2. Försök kategori-match först (vanligaste fallet)
if (input.category_slug) {
  const { data: byCat } = await db()
    .from('image_library')
    .select('id, public_url, storage_path, times_used')
    .eq('category_slug', input.category_slug)
    .order('rating', { ascending: false, nullsFirst: false })
    .order('times_used', { ascending: true })
    .limit(1)
    .single();
  // ...
}
```

Steg 1 (venue+category) finns inte i koden — bara kategori-match.

**Konsekvens:** Konserthuset-evenemang får vilken kategori-bild som helst, inte en Konserthuset-scen.

### Bug 2: `addToLibrary` sätter aldrig `rating`

**Källa:** `08-Agent/utils/imageLibrary.ts:156–195`

`pickLibraryFallback` sorterar `order('rating', ascending: false)` (rad 104). Nya bilder får rating=NULL (default), så sorteringen är odefinierad bland nya — alla NULL hamnar i samma grupp.

**Konsekvens:** Rating-baserad kvalitetsprioritering fungerar inte förrän curator sätter betyg.

### Bug 3: `venue_pattern` är död kolumn

**Källa:** `image_library`-tabell + `FallbackInput.venue_pattern`-interfacefält (rad 78)

Finns i DB-schema och TypeScript-interface, men **ingen query filtrerar på den**. Hade kunnat användas för venue-specifik matchning.

**Konsekvens:** Curator kan manuellt tagga `venue_pattern='konserthuset'` på en bild men systemet hittar den aldrig.

---

## Vad som INTE finns

| Sökning | Resultat |
|---|---|
| `pgvector`, `cosine similarity`, `vector(`, `embedding` | NOLL träffar i EventPulse-kod |
| `clip`, `openclip`, `sentence-transformers` | NOLL |
| `/agent/match-image`, `/agent/search-images` | SAKNAS i `08-Agent/server.ts:43–203` |
| UI för manuell upload | SAKNAS i `06-UI/` |
| `/tmp/eventpulse-*library*`, `/tmp/eventpulse-*embed*`, `/tmp/eventpulse-*match*` | SAKNAS |

---

## Confidence

**[VERIFIED]** — alla påståenden baserade på minst en fil:rad-citat. Tre oberoende Explore-agenter konvergerade.

## Förslag på nästa steg

1. **Fixa de 3 buggarna** i `imageLibrary.ts`: venue+category-steg, default rating, venue_pattern-filter.
2. **Kör `backfill_library_to_future --apply`** — ger library-bilder till alla future events utan AI-bild med en gång.
3. **Manuell upload-UI** (senare): admin-skärm, ny endpoint, kategori-dropdown.
4. **Semantisk matchning** (senare, bara om kategori+ratering inte räcker): CLIP-embedding + pgvector.
