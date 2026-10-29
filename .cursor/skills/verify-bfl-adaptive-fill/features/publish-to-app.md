# publish-to-app — feature #5 (live)

Speglar `scripts/_upload_stamped_to_storage.ts`, `scripts/prune_dangling_library_rows.ts`,
`scripts/repair_broken_event_images.ts` och `08-Agent/utils/imageLibrary.ts`.

**Att generera bilder är inte samma sak som att visa bilder i appen.** Knappen
fyller diskbiblioteket. Bilderna syns i appen först efter fyra steg.

## Sub-features

1. **Kvalitetsgrind** — `.scratch/xmptest/quality-gate.mts`. Kontrollerar 3:2,
   XMP-paket, synlig stämpel och kompositionsmix mot målmixen. **Stäpper vid
   fel** — inget trasigt laddas upp.
2. **Uppladdning + registrering** — `scripts/_upload_stamped_to_storage.ts
   --src=local_image_library_stamped_v2 --register --apply`.
   Laddar upp till `event-posters/import-stamped/<kategori>/<fil>.webp` och
   registrerar rad i `image_library`.
   **`--register` är obligatoriskt** utan det finns ingen rad att matcha.
3. **Pruning** — `scripts/prune_dangling_library_rows.ts --apply`. Tar bort
   biblioteksrader som pekar på filer som inte finns.
4. **Reparering** — `scripts/repair_broken_event_images.ts --apply`. Pekar om
   events som pekar på döda bilder.
   **Kör två gånger**: `--scope=future` (default) och `--scope=past`.
   Appens "Beyond your bubble"-sektion läser `events_public` **utan**
   `start_time`-filter och tar de events med lägst `confidence_score` — vilket
   råkade vara förflutna events. Utan `--scope=past` stod 4 kort som
   platshållare (fix 2026-10-29).

## How to get to it (user POV)

1. Generera bilder via knappen (eller vänta på bakgrundskörningen).
2. Kör publiceringsstegen.
3. Öppna appen (Expo, port 8081) → eventens bild visas.

## Driving it with curl

Publiceringsstegen är CLI-skript, inte HTTP-endpoints. De kan också kedjas:

```bash
cd /Users/claudgashi/EventPulse

# 1. Grind
node --import tsx .scratch/xmptest/quality-gate.mts || exit 1

# 2. Uppladdning + registrering
node --env-file=.env --import tsx scripts/_upload_stamped_to_storage.ts \
  --src=local_image_library_stamped_v2 --register --apply | tail -25

# 3. Prune
node --env-file=.env --import tsx scripts/prune_dangling_library_rows.ts --apply | tail -8

# 4. Reparera events
node --env-file=.env --import tsx scripts/repair_broken_event_images.ts --apply | tail -20
```

Verifiera resultatet i databasen:

```bash
SOURCE=$(grep '^SUPABASE_URL=' .env | cut -d= -f2-)
KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2-)

# Antal biblioteksrader + hur många som har tomma cluster_tags.
# OBS: PostgREST har en max-rows-gräns — dela upp i flera anrop
# (Range-headern) om du vill räkna över fler tusen rader.
node --env-file=.env --import tsx -e "
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, count } = await db.from('image_library').select('*', { count: 'exact' });
const withTags = data.filter(r => (Array.isArray(r.cluster_tags) ? r.cluster_tags.length : 0) > 0).length;
console.log('rader:', count, '| med cluster_tags:', withTags);
const { data: objs } = await db.storage.from('event-posters').list('', { limit: 1000 });
console.log('objekt i event-posters:', objs.length);
"
```

**Förväntat:**

| check | förväntat |
|---|---|
| Grind passerar | exit 0 |
| Uppladdda filer = nya 3:2-filer | lika |
| `image_library`-rader efter registrering | ≥ antal uppladdade filer |
| Rader med tomma `cluster_tags` | 0 |
| Rader som pekar på raderade filer | 0 (efter prune) |
| Objekti i `event-posters` | = antal uppladdade filer |
| Events med `image_url` som svarar 200 | ökade (efter repair) |

## Skalldetaljer som påverkar resultatet

Verifierat mot den levande databasen 2026-10-29:

- **UNIQUE-indexen finns:** `image_library_storage_path_key` →
  `CREATE UNIQUE INDEX ... USING btree (storage_path)`. 422 rader / 422 unika
  storage-paths. En fil kan alltså bara registreras en gång — `--register`
  är ett upsert, inte en append.
- **Rangordningen i `pickLibraryFallback` är `rating DESC NULLS LAST`**
  (index `idx_image_library_category`: `(category_slug, rating DESC NULLS
  LAST, times_used DESC)`). De gamla raderna har `rating = 3`, de nya har
  `NULL` → **de gamla döda raderna rankas FÖRE de nya**. Därför måste prune
  köras före repair, annars väljer appen de döda raderna igen.
- **`cluster_tags`-filtret är ett partiellt index:**
  `idx_image_library_cluster_tags_gin ... WHERE (cardinality(cluster_tags) > 0)`.
  Rader utan taggar är alltså inte bara "svåra att matcha" — de är ute ur
  matchningen helt.
- **`public_url` på de gamla raderna är `https://placeholder.local/...`** —
  trasig URL. `storage_path` används först, så det fungerar, men datan är
  fel och bör rättas vid registrering.
- **Bucketen `event-posters` var tom (0 objekt)** efter storage-cleanup —
  det är därför 16 452 events hade döda bild-URL:er.

## Gotchas

- **`storage_path` innehåller BUCKETNAMNET** (`event-posters/import-stamped/
  <kat>/<fil>.webp`), medan en bucket-lista är bucket-RELATIV
  (`import-stamped/...`). Jämförelser måste skala av prefixet — annars matchar
  ingen rad. Detta buggade `repair_broken_event_images.ts` (fix 2026-10-29):
  skriptet avslutade med "INGA användbara biblioteksbilder" trots 865 rader
  och 865 objekt. `prune_dangling_library_rows.ts` har rätt logik — läs den
  där om du skriver liknande kod.
- **UNIQUE-indexen finns:** `image_library_storage_path_key` →
  `CREATE UNIQUE INDEX ... USING btree (storage_path)`. 422 rader / 422 unika
  storage-paths. En fil kan alltså bara registreras en gång — `--register`
  är ett upsert, inte en append.
- **Rangordningen i `pickLibraryFallback` är `rating DESC NULLS LAST`**
  (index `idx_image_library_category`: `(category_slug, rating DESC NULLS
  LAST, times_used DESC)`). De gamla raderna har `rating = 3`, de nya har
  `NULL` → **de gamla döda raderna rankas FÖRE de nya**. Därför måste prune
  köras före repair, annars väljer appen de döda raderna igen.
- **`cluster_tags`-filtret är ett partiellt index:**
  `idx_image_library_cluster_tags_gin ... WHERE (cardinality(cluster_tags) > 0)`.
  Rader utan taggar är alltså inte bara "svåra att matcha" — de är ute ur
  matchningen helt.
- **`public_url` på de gamla raderna är `https://placeholder.local/...`** —
  trasig URL. `storage_path` används först, så det fungerar, men datan är
  fel och bör rättas vid registrering.
- **Bucketen `event-posters` var tom (0 objekt)** efter storage-cleanup —
  det är därför 16 452 events hade döda bild-URL:er.
- **Bilderna syns i appen först efter att de är uppladdade.** Under
  genereringen ligger de bara på disk.
- **Kedjan är inte idempotent över tid:** varje körning av upload-skriptet
  läser bucketen, hoppar över redan uppladdade filer och registrerar det
  som är nytt. Kör den gärna flera gånger — den är byggd för det.
