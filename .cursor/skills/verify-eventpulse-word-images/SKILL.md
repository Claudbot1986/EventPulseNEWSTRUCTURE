---
name: verify-eventpulse-word-images
description: |
  Verify EventPulse's TITLE-ADAPTED image generation (titalanpassad bildgen) —
  the pipeline where the unit is ONE UNIQUE WORD from an event title
  ("dambastu", "tipspromenad", "julmässa"), not a category × cluster like the
  orange MiniMax button. Use for /verify-eventpulse-word-images, when an event
  card shows the wrong picture, when a generated image does not show what its
  title promises, when an event title contains a content word but the picture
  shows something else entirely, before trusting a word-image batch, or after
  changing scripts/word_image_gen.ts, the word inventory, or the prompt
  rules. Covers: word-in-title (deterministic, no LLM), image-shows-the-word
  (M3 vision reads the actual picture), and the simpler UI-pairing check
  (is the right title paired with the right picture?). Only CONTENT WORDS get
  images — artist names, show titles, venue names and place names never do.
disable-model-invocation: false
---

# verify-eventpulse-word-images

Titalanpassad bildgen har en annan enhet än resten av bildpipelinen:

| | Orange knappen (`scripts/adaptive_image_gen.ts`) | Titalanpassad (`scripts/word_image_gen.ts`) |
|---|---|---|
| Enhet | kategori × kluster × zoomnivå × pose × ljus | **ett unikt ord** från eventtiteln |
| Vad som styr prompten | kategori + cluster-tag | ordet + dess innebörd + riktiga titlar |
| Vad som är en bild | "en konsert i community" | "en bastu", "en dam-bastu", "en tipspromenad" |

Det som skiljer är **hur mycket ett ord betyder**. "bastu" och "dambastu" ger
två olika bilder — kvinnor i bastu respektive en allmän bastu — och det är bara
ordet i titeln som avgör.

Ord med ordets betydelse genereras **inte**. Ord-inventeringen är delad i två:

- `docs/audit/data/huvudattraktioner-2026-10-31-ord-inventering.csv` — **innehållsord**, 2 014 st. Dessa får bilder.
- `docs/audit/data/huvudattraktioner-2026-10-31-namn.csv` — **namn** (artist, pjäs, lokal, plats, varumärke, serie), 3 331 st. Dessa får **aldrig** bilder.

## De tre testerna

1. **Finns ordet i titeln?** Deterministisk. Ordet förekommer som helt ord eller som del av ett sammansatt ord ("bastu" i "Dambastu"). Ingen LLM.
2. **Visar bilden ordet?** M3 vision läser av den faktiska PNG-filen och svarar `match` + `confidence`. Dessutom `appropriate` — en bild med nakna bröst är fel även om den "visar en bastu".
3. **Är rätt titel matchad med rätt bild i UI?** Enklare kontroll: `events_public` (det appen läser) → `image_url` → pekar den på just den bild som genererats för titelns ord? Är bilden nåbar (HTTP 200)?

## Launch

Det finns ingen server att starta. "Launch" = köra gaten mot de riktiga bilderna.

```bash
# Gaten: test 1 + 2 mot alla genererade ordbilder
node --env-file=.env --import tsx scripts/verify-word-images.ts

# Granska om från början (även om sidecaren har ett resultat)
node --env-file=.env --import tsx scripts/verify-word-images.ts --recheck

# Test 3: UI-parning
node scripts/check-word-image-pairing.mjs --word=bastu
```

**Generera bilder (om inga finns):**

```bash
# Från dashboarden: knappen "Titalanpassad bildgen" (port 7777)
# Från CLI:
node --env-file=.env --import tsx scripts/word_image_gen.ts --word=bastu --limit=5
node --env-file=.env --import tsx scripts/word_image_gen.ts --limit=20          # 20 första orden
node --env-file=.env --import tsx scripts/word_image_gen.ts --dry-run          # bara visa plan
node --env-file=.env --import tsx scripts/word_image_gen.ts --word=bastu --verify-only   # granska utan att generera
```

**Tilldela bilder till events** (detta skriver `events.image_url` — `--apply` krävs):

```bash
node --env-file=.env --import tsx scripts/word_image_assign.ts --dry-run
node --env-file=.env --import tsx scripts/word_image_assign.ts --apply
node --env-file=.env --import tsx scripts/word_image_assign.ts --word=bastu --apply
```

## Hjälpare

| Skript | Gör | Exit |
|---|---|---|
| `scripts/verify-word-images.ts` | test 1 + 2 mot riktiga bilder | 0/1 |
| `scripts/check-word-image-pairing.mjs` | test 3: titel ↔ bild via `events_public` | 0/1 |
| `scripts/word_image_gen.ts` | generera ordbilder + M3-granskning | 0/1 |
| `scripts/word_image_assign.ts` | ladda upp + registrera + tilldela till events | 0/1 |

## Viktiga fällor (upptäckta 2026-10-31)

- **MiniMax ignorerar `enable_thinking: false`.** Modellen bränner `max_tokens` på resonemang och svarar **aldrig** ut JSON. Rätt sätt är `thinking: { type: "disabled" }`. Utan det tystar varje batch.
- **MiniMax innehållsfilter är inkonsekvent.** Det blockerade den *mildare* "bastu"-prompten men släppte igenom en "mixbastu"-bild med nakna bröst. Scriptet skriver därför om prompten med ett klädkrav och försöker igen vid "content safety" — men det räcker inte ensamt, det finns en separat `appropriate`-granskning.
- **Supabase-JS tar sökvägen INOM bunken.** Upload ska vara `import-stamped/word/x.webp`, medan `image_library.storage_path` ska vara `event-posters/import-stamped/word/x.webp`. Blandar man ihop blir public-URL:en HTTP 400 på alla bilder.
- **PostgREST's standardgräns är 1 000 rader.** `word_image_assign.ts` filtrerar i DB:t på ord och använder `.range()` — annars syns bara de första 1 000 eventsen.
- **`events.image_generation_status` har en check-constraint:** `pending|completed|failed|no_credits|library_fallback`. Okänt värde → hela uppdateringen faller.
- **Ord-bilder tilldelas via `events.image_url`, inte via biblioteksfallback.** `image_library.category_slug` sätts till den reserverade pseudo-kategorin `'word'`, som ingen riktig event har — annars hamnar ordbilderna i den generiska fallback-poolen och en bastubild kan visas på ett orelaterat event.

## Stoppregler

- **Generera inte bilder för ord som är klassade som namn.** Gaten returnerar röd om ett ord i `namn`-listan har en bild.
- **Lämna inte en bild kvar som inte klarar `appropriate`**, även om `match` är sant. En offentlig app kan inte visa nakna bröst på ett evenemangskort.
- **Skriv inte `events.image_url` utan `--apply`-flaggan på `word_image_assign.ts`.** Utan den är det en förhandsvisning.
- **Rör inte `scripts/adaptive_image_gen.ts`** (den orange knappen). Den här gaten gäller bara ordpipelinen.

## Bevis

`runtime/verification-reports/word-images-<timestamp>.json` — varje ord med test 1, test 2, konfidens och vad bilden faktiskt visar.

## Korsreferens

- Ord-inventeringen och ordklassningen → `docs/audit/unika-ord-2026-10-31.md`
- Orange knappen och biblioteksfyllning → `verify-bfl-adaptive-fill/`
- Bildkvalitet och kvot → `verify-bfl-zoom-pipeline/`
- UI-nivå → `verify-eventpulse-ui/`
