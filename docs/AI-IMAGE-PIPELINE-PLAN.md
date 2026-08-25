# AI Image Pipeline — Permanent Integration Plan

**Status:** Implemented (Phase 1)  
**Author:** EventPulse AI workflow  
**Created:** 2026-08-25  
**Last updated:** 2026-08-25

---

## 1. Goal

**Målsättning:** Samtliga events i Supabase `events` ska ha EN AI-genererad bild.

**Varför:**
- **Copyright:** Source-sajter (venue-webbplatser, Ticketmaster) tillhandahåller ofta upphovsrättsskyddade bilder. Att reproducera dessa i en kommersiell app kräver licens eller tillstånd.
- **EU AI Act (Art. 50):** AI-genererat material måste kunna spåras till sin prompt + modell. Vi lagrar detta i Storage metadata och (från och med detta arbete) i `events.image_prompt`.
- **Visuell konsistens:** Alla eventkort i appen ska ha samma visuella språk — genererade, inte scrapade.

---

## 2. Arkitekturöversikt

```
┌─────────────────�
│ A:directAPI     │
│ B:JSON-feeds    ├──► 03-Queue/03-extractedevents/*.jsonl
│ C:htmlGate      │              │
│ D:renderGate    │              ▼
└─────────────────┘   03-Queue/importToEventPulse.ts (BullMQ enqueue)
                                    │
                                    ▼
                  BullMQ 'raw_events' worker (startWorker.ts)
                                    │
                                    ▼
                  04-Normalizer/normalizer.ts ─► Supabase events (id, ...)
                                    │
                                    ▼ (NY HOOK — Phase 2)
                  BullMQ 'image_generation' job → imageGen.generateForEvent()
                                    │
                                    ▼
                  08-Agent/services/imageGen.ts
                  ┌──────────────────────┐
                  │ buildAutoPrompt()    │ ← events.title, category_slug, venues.name
                  │ generateFluxImage()  │ ← BFL Flux-dev API (port 443)
                  │ uploadAndPersist()   │ ← Supabase Storage event-posters/
                  └──────────────────────┘
                                    │
                                    ▼
                  Supabase Storage event-posters/events/<slug>.png
                  + events.image_url UPDATE
                  + events.image_prompt INSERT (NEW column)
```

**Fas 1 (detta arbete):** Standalone batch-script + fungerande infrastruktur.
**Fas 2 (senare):** Auto-hook i normalizer → BullMQ-jobb vid varje upsert.

---

## 3. Befintlig kod att återanvända

| Komponent | Plats | Roll |
|---|---|---|
| `buildAutoPrompt(event)` | `06-UI/asterisk/autoGenServer.js:209-240` | Prompt-byggare (kategoridrivet, EU AI Act-negative-prompts) |
| `generateFluxSchnell(prompt)` | `06-UI/asterisk/autoGenServer.js:267-322` | BFL Flux-dev klient |
| `uploadAndPersistAll(ids, b64, mime, path)` | `06-UI/asterisk/autoGenServer.js:333-364` | Storage upload + DB UPDATE |
| `dedupKey(event)` / `dedupPath(key)` | `06-UI/asterisk/autoGenServer.js:250-263` | Idempotens per (titel+venue) |
| `VENUE_GENERICIZERS` / `CATEGORY_SCENES` | samma fil, rad 73-152 | Anonymisering + scener |

**Inga nya algoritmer.** Allt i autoGenServer.js flyttas till `08-Agent/services/imageGen.ts` och anropas därifrån.

---

## 4. Nya filer (detta arbete)

### 4.1 `08-Agent/services/imageGen.ts`

Extraherad Node-modul. Importerbar från både `autoGenServer.js` och `03-Queue/generateMissingImages.ts`.

```ts
export interface EventInput {
  id: string;
  title_sv?: string | null;
  title_en?: string | null;
  description_sv?: string | null;
  description_en?: string | null;
  category_slug?: string | null;
  venues?: { name: string } | null;
  venue_name?: string | null;
}

export interface ImageGenResult {
  eventId: string;
  imageUrl: string;
  storagePath: string;
  prompt: string;
  seed: number | null;
  costCents: number;
}

export async function generateForEvent(event: EventInput): Promise<ImageGenResult>;
export async function generateForFirst(n: number): Promise<BatchResult>;
export function buildAutoPrompt(event: EventInput): string;
export function dedupKey(event: EventInput): string;
```

### 4.2 `03-Queue/generateMissingImages.ts`

Standalone batch-script. Kör mot events utan `image_url`.

```bash
npx tsx 03-Queue/generateMissingImages.ts                  # alla events utan image_url
npx tsx 03-Queue/generateMissingImages.ts --limit 100       # cap
npx tsx 03-Queue/generateMissingImages.ts --source ticketmaster   # per source
npx tsx 03-Queue/generateMissingImages.ts --dry-run         # testa utan API-anrop
npx tsx 03-Queue/generateMissingImages.ts --force           # regenerera även events MED image_url
```

**Idempotens:** Använder `dedupKey` → samma (titel+venue)-grupp får samma bild. Upprepade körningar är billiga (Storage cache).

### 4.3 `05-Supabase/migrations/20260825-0001-event-image-tracking.sql`

```sql
-- Lägg till spårbarhet för AI-genererade bilder (EU AI Act Art. 50).
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image_prompt text,
  ADD COLUMN IF NOT EXISTS image_model text,
  ADD COLUMN IF NOT EXISTS image_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS image_generation_status text 
    CHECK (image_generation_status IN ('pending','done','failed')),
  ADD COLUMN IF NOT EXISTS image_ai_generated boolean NOT NULL DEFAULT false;

-- Index för backfill-jobb
CREATE INDEX IF NOT EXISTS idx_events_image_missing
  ON events (id) WHERE image_url IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_image_status_pending
  ON events (image_generation_status) WHERE image_generation_status = 'pending';
```

**Migrationen är SKRIVEN men INTE APPLIED i detta arbete.** Kräver DB-access via psql eller Supabase CLI.

---

## 5. Säkerhet & Compliance

### 5.1 Copyright-skydd (redan i prompt, rad 231-238)

- Inga riktiga venue-/artist-/varumärkesnamn (anonymiseras)
- Inga logotyper, varumärken, ordmärken
- Inga igenkännbara byggnader
- Ingen text/typografi (skyddar typsnitt/ordmärken)
- Aldrig "in the style of [artist]"

### 5.2 EU AI Act (Art. 50) — spårbarhet

- `events.image_prompt` (NY) — exakt prompt som genererade bilden
- `events.image_model` (NY) — t.ex. "flux-dev"
- `events.image_generated_at` (NY) — tidsstämpel
- `events.image_ai_generated = true` (NY) — flagga
- Storage metadata: `{ aiGenerated: true, model, prompt, generatedAt }`

### 5.3 Synlig märkning i UI

**Diskussionspunkt:** Ska "AI" eller liknande stå på bilden?

- **Alt A (valt i Fas 1):** Metadata + frivillig UI-overlay i Expo (badge i kortets hörn)
- **Alt B (framtida):** Post-processa med watermark i hörnet via Sharp

Nuvarande negativ prompt ("NO TEXT") gör Alt B omöjligt utan att kompromissa stil. Alt A kräver UI-arbete som ligger utanför detta scope.

### 5.4 API-nyckel

- `BFL_API_KEY` läses från `.env` server-side (INTE klient-side)
- Klient-side variant (`EXPO_PUBLIC_BFL_API_KEY`) finns för dev/test, men ska tas bort före App Store
- **Varning:** `BFL_API_KEY` exponerades i chatten 2026-08-25. ROTERA omedelbart hos Black Forest Labs.

---

## 6. Datamodell

### 6.1 Storage (`event-posters`-bucket)

```
event-posters/
  events/
    <dedup-key-slug>.png    ← 1024×1024, ~500KB
    metadata.json           ← bucket-level metadata (valfritt)
```

`dedup-key-slug` = `<title-slug>-<venue-slug>` (lowercase, alphanumeric + hyphen).

### 6.2 Database (`events`)

| Kolumn | Typ | Beskrivning |
|---|---|---|
| `image_url` | text | Public URL till Storage |
| `image_prompt` (NY) | text | Exakt prompt som genererade |
| `image_model` (NY) | text | Modellnamn ("flux-dev") |
| `image_generated_at` (NY) | timestamptz | När bilden genererades |
| `image_generation_status` (NY) | text | 'pending' / 'done' / 'failed' |
| `image_ai_generated` (NY) | boolean | true om AI-genererad |

---

## 7. Kostnad & prestanda

| Modell | Kostnad/bild | 1000 events | 10000 events |
|---|---|---|---|
| flux-schnell | ~$0.003 | $3 | $30 |
| flux-dev (används nu) | ~$0.025 | $25 | $250 |
| flux-pro | ~$0.05 | $50 | $500 |

**Val:** Flux-dev. Användaren klagade 2026-08-24 på att Flux-1-schnell ignorerar "no text"-instruktioner. Flux-dev följer negativa prompts bättre.

**Rate limits:** BFL paid tier ≈ 6 req/s. BullMQ concurrency=3 rekommenderas.

**Cache:** Storage cacheControl=31536000 (1 år). Upprepade anrop för samma `dedupKey` är idempotenta — inga extra kostnader.

---

## 8. Rollout-plan

### Fas 1 — Standalone (DETTA ARBETE) ✓

- [x] Extrahera `08-Agent/services/imageGen.ts`
- [x] Skapa `03-Queue/generateMissingImages.ts`
- [x] Skapa `05-Supabase/migrations/20260825-0001-event-image-tracking.sql`
- [x] Regenerera 10 första bilder för hem*-sektionen (Del A)

### Fas 2 — Hook i normalizer (NÄSTA)

- [ ] Modifiera `04-Normalizer/normalizer.ts`: efter `upsert`, enqueue BullMQ-jobb `image_generation`
- [ ] Ny `03-Queue/workers/imageGenerationWorker.ts`
- [ ] Konfigurera BullMQ concurrency=3
- [ ] Testa på 1 Stockholm-källa

### Fas 3 — Schema-applicering

- [ ] Kör migration `20260825-0001-event-image-tracking.sql` mot Supabase
- [ ] Verifiera RLS: anon-key ska INTE kunna läsa `image_prompt`/`image_model` (privacy: prompt kan avslöja scraping-logik)
- [ ] Backfill: kör `generateMissingImages.ts --limit 1000` på alla Stockholm-events utan `image_url`

### Fas 4 — Synlig märkning (UX)

- [ ] Expo: visa "AI"-badge på eventkort med `image_ai_generated = true`
- [ ] Event details screen: visa prompt + modell i "Om bilden"-sektion

### Fas 5 — Validering & generalisering

- [ ] Generalization Gate: verifiera att prompt-byggaren fungerar på 3+ unrelaterade Stockholm-domäner
- [ ] Mät: % events med `image_url` (target: 100% för Stockholm)
- [ ] Mät: hallucinerade detaljer (inga Moderna Museet-bilder som föreställer en fotbollsstadion etc.) — visuell QA-stickprov

---

## 9. Testning

### 9.1 Adapter-test (Phase 1)

```bash
npx vitest run 08-Agent/services/imageGen.test.ts
```

Tester:
- `buildAutoPrompt` returnerar NO TEXT-instruktion för varje CATEGORY_SCENES-nyckel
- `dedupKey` är stabilt för samma (titel, venue) — olika `id` men samma nyckel
- `anonymizeVenue` ersätter 12+ kända Stockholm-venues
- Mock BFL-anrop för kostnads-/latency-tester

### 9.2 Backfill smoke

```bash
python3 tests/test_real_pipeline.py --source ticketmaster --limit 5
```

Förväntat: alla 5 events får `image_url` efter att scriptet körts.

### 9.3 Visuell QA

Stickprov 10 events. Verifiera:
- Huvudämnet syns (teater → scen, fotboll → plan, konst → galleri)
- Ingen text på bilden
- Inga logotyper
- Inte identisk med känd svensk byggnad

---

## 10. Rollback

Om något går fel:

1. **Fel prompt (genererar fel sak):** Ändra i `CATEGORY_SCENES` eller `extractCategoryFallback`. Backfill-scriptet är idempotent — nästa körning skriver över.
2. **Fel modell:** Byt endpoint i `generateFluxImage` (`flux-dev` → `flux-pro` etc).
3. **Storage-bucket borttagen:** Bilderna är publika URLs — om bucket tas bort försvinner de. Backfill-scriptet regenererar vid behov.
4. **DB-kolumner behöver ångras:** Migration är ADD COLUMN — kan tas bort med ALTER TABLE DROP COLUMN (ingen dataförlust på `events`-rader).

---

## 11. Kostnad initial backfill

- 10 bilder ≈ $0.25 (redan kört)
- 100 events ≈ $2.50 (dedup kan halvera)
- 1000 events ≈ $25
- 10000 events ≈ $250

**Rekommendation:** Kör `--limit 100 --dry-run` först för att se hur många unika `dedupGroup`s som finns, innan full backfill.

---

## 12. Öppna frågor

1. **Synlig AI-märkning på bilden** — Alt A (metadata + UI-badge) eller Alt B (watermark via Sharp)? Rekommendation: Alt A för Fas 1, utvärdera Alt B i Fas 4.
2. **Source-bilder kontra AI-bilder** — Ska source-bilder raderas eller bara markeras som `image_ai_generated = false`? Rekommendation: låt source-bilder ligga kvar, men prioritera AI-bild i UI:t.
3. **Auto-regenerate vid uppdatering** — Om ett event uppdateras (titelbyte, venue-byte), ska bilden regenereras? Default: ja, eftersom `dedupKey` ändras.

---

## 13. Se även

- `docs/MASTERPLAN.md` §4 — Event Graph, image_url finns redan
- `docs/BACKLOG.md` — Phase 1 NEXT inkluderar "cheap og:image / JSON-LD image fallback" (detta arbete tar det längre)
- `06-UI/asterisk/README.md` — ursprunglig test-sida
- `06-UI/asterisk/autoGenServer.js` — källkod som extraheras
