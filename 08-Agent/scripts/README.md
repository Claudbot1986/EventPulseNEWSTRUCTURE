# 08-Agent/scripts/

Operationella script för AI-bild-pipeline och EventPulse-bakgrundsarbete.

## Status 2026-09-03 — biblioteks-lösningen är TEMPORÄR

`library_fallback` är ett medvetet kostnadsbeslut (2026-08-30): framtida
events matchas mot redan genererade biblioteksbilder istället för att
bränna BFL-krediter. **Detta är en temporär lösning, inte permanent.**
Framtida plan (först när projektet är MVP): generera fler bilder med
BFL och utöka biblioteket. Nuvarande state: alla framtida events har
bild (`completed` 2257 + `library_fallback` 6755); 2299 past-pending är
out of scope enligt future-only-beslutet (`9c9b583`, 2026-08-27).

Borttaget i två-roll-omläggningen (`9101d70`): `backfill_ai_images.ts`,
`restamp_*`/`seed_*`/`scan_legacy_*`-familjen och 7790-autoGenServern.
Ersättare för stamp-flödet: `stamp_all_originals.ts` (`npm run stamp:all`).
Notera: `08-Agent/workers/aiImageWorker.ts` har fortfarande ett dangling
`localhost:7790`-beroende för worker-pathen vid nya events — dokumenterad
som öppen queue-task i vault.

## `backfill_library_to_future.ts`

Tilldela biblioteks-bilder till framtida events som saknar AI-bild.
Biblioteket byggs automatiskt upp från past-AI-bilder (steg 1, alltid
idempotent). Steg 2 markerar framtida events med biblioteks-bild som
fallback istället för BFL-generering.

**När ska man köra:** en gång direkt efter migrering för att omedelbart
fylla Utforska-feed med bilder utan att bränna BFL-kredit. Därefter
behövs ingen manuell körning — workern och normalizern hanterar nya
events automatiskt via `pickLibraryFallback()`.

### Flaggor

| Flagga | Default | Effekt |
|---|---|---|
| `--apply` | `false` | Faktiskt skriva `image_url` + `status='library_fallback'` på events. Default = steg 2 dry-run. |
| `--limit N` | `none` (alla) | Processa max N events. |
| `--skip-past-ai-backfill` | `false` | Skippa steg 1. Använd när biblioteket redan är populerat. |

### Steg

1. **backfillFromPastAi()** — extraherar unika past-AI-URL:er från
   `events` och registrerar dem i `image_library` med kategori-metadata.
   **Alltid idempotent** — `storage_path` är UNIQUE.
2. **För varje future event utan AI-bild** → `pickLibraryFallback()` →
   om match → `markEventWithLibraryFallback()`.

### Vanliga körningar

```bash
# 1. Verifiera scope (rekommenderas ALLTID först)
npx tsx 08-Agent/scripts/backfill_library_to_future.ts --limit 50

# 2. Kör skarpt på alla future events utan AI-bild
npx tsx 08-Agent/scripts/backfill_library_to_future.ts --apply

# 3. Starta om bibliotek-populering (idempotent — körs om är OK)
npx tsx 08-Agent/scripts/backfill_library_to_future.ts --apply --skip-past-ai-backfill
```

### Match rate

Dry-run på 20 framtida events → **95% match rate** (19/20). Den enda
"no match" var `category='art'` — biblioteket hade inga art-tagged
bilder vid tillfället. Library växer över tid med fler BFL-success och
fler past-AI-events.

### Notering

`image_generation_status='library_fallback'` är en ny status (migration
20260827-0002). UI:ts `useAiImageUrl()`-hook har en motsvarande
`'library'`-källtyp utan AI-stämpel.