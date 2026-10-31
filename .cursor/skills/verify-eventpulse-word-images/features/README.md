# Features — verify-eventpulse-word-images

| Feature | Gate | Kommando | Fil |
|---|---|---|---|
| Ordet finns i titeln | word-in-title | `node --env-file=.env --import tsx scripts/verify-word-images.ts` | `features/word-in-title.md` |
| Bilden visar ordet | image-shows-word | `node --env-file=.env --import tsx scripts/verify-word-images.ts --recheck` | `features/image-shows-word.md` |
| Rätt titel ↔ rätt bild i UI | ui-pairing | `node scripts/check-word-image-pairing.mjs --word=bastu` | `features/ui-pairing.md` |

**Ordning:** word-in-title → image-shows-word → ui-pairing. Test 1 är deterministisk och kan köras utan LLM; test 2 kräver M3-vision; test 3 är den enkla kontrollen.

**Bevisfiler:** `runtime/verification-reports/word-images-<timestamp>.json`

## Historik — vad gaterna faktiskt har fångat

| Datum | Gate | Fynd | Åtgärd |
|---|---|---|---|
| 2026-10-31 | image-shows-word | MiniMax blockerade den *mildare* "bastu"-prompten men släppte igenom "mixbastu" med nakna bröst — innehållsfiltret är inkonsekvent | skärpt prompt med klädkrav + separat `appropriate`-granskning i verifieringen; bilden genererades om |
| 2026-10-31 | image-shows-word | första körningen av hela korpuset tystade i varje batch | MiniMax ignorerar `enable_thinking: false`; `thinking: { type: "disabled" }` fungerar (~2,3 s/batch) |
| 2026-10-31 | ui-pairing | alla public-URL:er gav HTTP 400 | Supabase-JS tar sökvägen inom bunken: upload `import-stamped/word/x.webp`, DB `event-posters/import-stamped/word/x.webp` |
| 2026-10-31 | ui-pairing | 0 av 7 bastu-event fick någon bild | PostgREST's standardgräns är 1 000 rader — `word_image_assign.ts` filtrerar i DB:t och använder `.range()` |
| 2026-10-31 | ui-pairing | `events.image_url` uppdaterades aldrig | `image_generation_status` har en check-constraint — `word-verified` är inte tillåtet, `completed` är det |
| 2026-10-31 | word-in-title | 4 ord i bastu-familjen men bara 3 bilder | "bastu" och "bastun" är samma ord i olika form — bildnyckeln normaliserar (`imageKey()`), matchningen sker på nyckel + ordform |
