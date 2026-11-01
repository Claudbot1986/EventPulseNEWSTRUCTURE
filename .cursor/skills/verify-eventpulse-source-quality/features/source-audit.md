# Källkvalitet och audit — vilka källor i grafen är bra?

## Sub-features

- **Översikt per källa** — antal rader, andel med plats, andel med beskrivning.
- **Klassning** — `event` / `artikel` / `okänt` per källa, med rubrikmönster
  och (med `--deep`) sidornas egna deklarationer.
- **Urvälj** — `--source <id,id>` för att titta på enskilda källor.
- **Säkerhet** — auditen **raderar aldrig** något, i något läge.

## How to get to it (user POV)

Användaren vill veta vad som faktiskt ligger i appens grafen. Auditen ger
svaret per källa: hur många rader, har de plats, har de beskrivning, och
ser de ut som evenemang eller som artiklar?

Det är underlaget för beslutet "vilka källor ska vi rensa bort?" — ett beslut
som ska fattas av människan, inte av skriptet.

## Driving it with <harness>

```bash
cd /Users/claudgashi/EventPulse

# Översikt (snabb, bara rubriker + DB-statistik)
npx tsx scripts/audit-source-quality.mjs

# Med sidhämtning (långsammare, ger sidbeviset)
npx tsx scripts/audit-source-quality.mjs --deep

# Bara vissa källor
npx tsx scripts/audit-source-quality.mjs --source kollaborationse,thatsupse

# Som JSON, för vidare analys
npx tsx scripts/audit-source-quality.mjs --json > /tmp/audit.json
```

Utskrift (2026-11-01, urklipp):

```
  ✓ event   thatsupse                  rader   65 · plats    0 · beskrivning    0 · sidor 0
  ✓ event   nupagangse                 rader   57 · plats    0 · beskrivning    0 · sidor 0
  ? okänt   wwwmynewsdeskcom           rader    1 · plats    0 · beskrivning    0 · sidor 0
  ...
  Ingen data raderad. Radering är ett eget beslut.
```

Verifiera en enskild källa mot databasen:

```bash
npx tsx -e "
(async () => {
  const dotenv = (await import('dotenv')).default;
  dotenv.config({path:'.env'});
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await sb.from('events_public')
    .select('title_sv,venue_full_name,description_sv,start_time')
    .eq('source','kollaborationse');
  for (const r of data) console.log(r.title_sv, '|', r.venue_full_name, '|', r.start_time);
})();
"
```

## Gotchas

- **Auditen raderar aldrig.** Ingen flagga i skriptet raderar. Om du vill
  rensa, är det ett eget beslut med eget underlag.
- **"okänt" är inte "bra".** `okänt` betyder att varken rubriken eller sidan
  gav ett entydigt svar. Många av de 45 källorna ligger där — de är inte
  bedömda, inte godkända.
- **Rubrikbedömningen ensam är svag.** Mätning: titelmönstren fångar 4 av 8
  artikelrubriker i kollaborationse, medan sidans `Article`-deklaration fångar
  alla. Använd `--deep` när frågan är "vilken källa är skräp?".
- **Siffrorna i kolumnerna "plats" och "beskrivning"** gäller
  `events_public` (`venue_full_name`, `description_sv`/`description_en`).
- **`source` är källans id** (`kollaborationse`), inte en url. Kolumnen heter
  `source` — det finns ingen `source_id` och ingen `url` i `events_public`.
- **Rate-limiterade sajter (t.ex. www.famgo.se, HTTP 429)** ser tomma ut i
  mätningen. Det är ett mätfel, inte ett innehållsfel.
