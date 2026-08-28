# 08-Agent/scripts/

Operationella script för AI-bild-pipeline och EventPulse-bakgrundsarbete.

## `backfill_ai_images.ts`

Backfill-script som garantera att ALLA publicerade events har en
AI-genererad bild (`image_ai_generated = TRUE`).

**Default-beteende (2026-08-27+):** processar ENDAST events där
`start_time > now()` — samma strikta cutoff som dashboardens
`totalFutureEvents` och agent-feeden. Past events och events utan
`start_time` skippas och loggas till
`runtime/ingestion/ai-image-skip/backfill/YYYY-MM-DD.ndjson`.

### Flaggor

| Flagga | Default | Effekt | Exempel |
|---|---|---|---|
| `--dry-run` | `false` | Print plan, inga DB-writes, inga BFL-anrop. Använd ALLTID först. | `--dry-run` |
| `--limit N` | `none` (alla) | Processa max N dedup-grupper (inte events). | `--limit 50` |
| `--offset N` | `0` | Skippa första N rows vid SELECT. För icke-överlappande parallella workers. | `--offset 0 --limit 100` (worker 1), `--offset 100 --limit 100` (worker 2) |
| `--force` | `false` | Regenerera även redan-AI-events (ett BFL-anrop per dedup-grupp). | `--force` |
| `--failed-only` | `false` | Processa BARA events med `status='failed'` (efter transient error-fix). | `--failed-only` |
| `--no-credits-only` | `false` | Processa BARA events med `status='no_credits'` (efter manuell BFL-recharge). | `--no-credits-only` |
| `--autogen-url URL` | `http://localhost:7790` | Override autoGenServer-endpoint. | `--autogen-url http://autogen-prod:7790` |
| `--include-past` | `false` | Inkludera även past events (`start_time <= now()`). **Kräver `--confirm` vid skarp körning** (säkerhetsåtgärd mot oavsiktlig BFL-kredit-förbrukning). Past-skips loggas till `runtime/ingestion/ai-image-skip/backfill/YYYY-MM-DD.ndjson` med `skip_reason: 'included_past'`. | `--include-past --confirm --limit 50` |

### `--confirm`-gate

`--include-past` är den enda flagga som kan bränna BFL-kredit på events
som aldrig kommer visas i Utforska (past). Därför kräver skarp körning
även `--confirm`:

```bash
# Tillåtet: dry-run av past inklusion (inga BFL-anrop)
npx tsx 08-Agent/scripts/backfill_ai_images.ts --include-past --dry-run --limit 100

# TILLÅTET: skarp körning av past (men varnar om --confirm saknas)
npx tsx 08-Agent/scripts/backfill_ai_images.ts --include-past --limit 50

# BLOCKERAD: skarp körning utan --confirm
# → Error: --include-past requires --confirm to actually run BFL calls
npx tsx 08-Agent/scripts/backfill_ai_images.ts --include-past --limit 50
```

### Vanliga körningar

```bash
# 1. Verifiera scope först (ALLTID)
npx tsx 08-Agent/scripts/backfill_ai_images.ts --dry-run --limit 50

# 2. Kör på N events (staging-test)
npx tsx 08-Agent/scripts/backfill_ai_images.ts --limit 50

# 3. Parallella workers (partition SELECT via --offset)
npx tsx 08-Agent/scripts/backfill_ai_images.ts --limit 100 --offset 0 &
npx tsx 08-Agent/scripts/backfill_ai_images.ts --limit 100 --offset 100 &
wait

# 4. Efter BFL-recharge (processa bara no_credits-rader)
npx tsx 08-Agent/scripts/backfill_ai_images.ts --no-credits-only

# 5. Efter transient error-fix (processa bara failed-rader)
npx tsx 08-Agent/scripts/backfill_ai_images.ts --failed-only
```

### Kostnad

Per dedup-grupp: **~$0.025 USD** (BFL flux-dev).

Exempel:
- 100 dedup-grupper → ~$2.50
- 6 755 future-pending events (efter dedup) → ~$168.88 (max)

### Loggar

Skips och inklusioner skrivs till
`runtime/ingestion/ai-image-skip/backfill/YYYY-MM-DD.ndjson` (gitignored).

Aggregera med:
```bash
cat runtime/ingestion/ai-image-skip/backfill/*.ndjson | jq -s 'group_by(.skip_reason) | map({reason: .[0].skip_reason, count: length})'
```

---

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