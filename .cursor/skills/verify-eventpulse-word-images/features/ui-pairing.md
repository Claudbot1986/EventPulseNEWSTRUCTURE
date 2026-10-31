# Gate: rätt titel ↔ rätt bild i UI

**Kommando:** `node scripts/check-word-image-pairing.mjs --word=bastu`

## Vad gaten bevisar

Den **enkla** kontrollen (per användarens önskemål — test 1 och 2 har en egen
gaten, den här behöver bara bevisa parningen).

1. Hämta event via **`events_public`** — det är vyn appen läser, inte
   `events`. Skillnaden är viktig: `events_public` filtrerar bort sammanslagna
   rader.
2. För varje event: räkna ut vilket ord som matchar titeln (längsta ordet
   vinner).
3. Kontrollera att `image_url` pekar på just den bilden.
4. Hämta bilden och kontrollera att den svarar HTTP 200 med `image/webp`.

## Varför det räcker

Om appen läser `events_public.image_url` och den pekar på rätt bild, så visas
rätt bild på rätt kort. Ingen ytterligare UI-kontroll behövs för den här
frågan.

## Vad som INTE kontrolleras här

- Om bilden *visar* rätt sak → `image-shows-word.md`
- Om appens rendering fungerar → `verify-eventpulse-ui/`

## Exit

0 = alla event har rätt bild och bilden är nåbar. 1 = någon avvikelse.

## Historik

| Datum | Fynd | Åtgärd |
|---|---|---|
| 2026-10-31 | 0 av 7 bastu-event matchade | `word_image_assign.ts` hämtade bara de första 1 000 raderna (PostgREST-standard) |
| 2026-10-31 | `events.image_url` uppdaterades aldrig | `image_generation_status = 'word-verified'` violates check-constraint → bytt till `'completed'` |
| 2026-10-31 | rätt bild men HTTP 400 | uppladdningen skickades till `event-posters/event-posters/...`; Supabase-JS vill ha `import-stamped/word/...` |
