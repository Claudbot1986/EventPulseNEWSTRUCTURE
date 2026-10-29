# app-image-verification — feature #6 (live)

Speglar `scripts/verify_app_event_images.mjs` och appens bildväg
(`06-UI/hooks/useAiImageUrl.js` → `events.image_url` → Supabase Storage).

Detta är slutledet i kedjan: **bilderna genererade ≠ bilder i appen**.
Här bevisas att events faktiskt VISAR bilder i den riktiga appen.

## Sub-features

- **Kör den riktiga Expo-appen** i Chromium (`http://localhost:8081`).
- **Samlar laddade bilder** — React Native Web renderar `<Image>` som ett
  element med `background-image`, inte som `<img>`. Skriptet letar därför
  efter `background-image` inuti `[data-testid="event-card-image"]` och
  `[data-testid="event-card-image-latest"]`.
- **Räknar platshållare** — kort utan laddad bild visar `useBrokenImage`-
  platshållaren (en `<View>` med bakgrundsfärg, ingen URL).
- **Hämtar varje unik URL** och kontrollerar HTTP 200, `content-type:
  image/webp` och **faktiska pixeldimensioner** via `sharp` (aspect 1.5 = 3:2).
- **Scrollar vertikalt OCH horisontellt** — hem-sidan har karuseller.
- **onError-varningar** i konsolen räknas — en trasig URL ger en varning
  (`[EventPulseCard] image onError`), och det är det enda tecknet i konsolen
  på att något gick fel.

## How to get to it (user POV)

1. Öppna appen (Expo på 8081) — den laddar hem-feeden med eventkort.
2. Varje kort har en bildyta (150×100 px i karusellen, 96×64 px i "Senaste").
3. Bilden laddas från `events.image_url` → Supabase Storage
   (`<SUPABASE_STORAGE_URL>/event-posters/import-stamped/<kategori>/<fil>.webp`).
4. Kort utan fungerande bild visar i stället en platshållare.

## Driving it with curl

Appen är inte HTTP-API — men databasen är. Samma sak kan mätas på
DB-nivå (rekommenderat som komplement, inte ersättning):

```bash
node --env-file=.env --import tsx -e "
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { count } = await db.from('events')
  .select('id', { count: 'exact', head: true })
  .not('image_url', 'is', null);
console.log('events med image_url:', count);
"
```

**Appen (rekommenderat):**

```bash
cd /Users/claudgashi/EventPulse
node scripts/verify_app_event_images.mjs --sample=300 --min=50 --timeout=600
```

| flagga | default | betydelse |
|---|---|---|
| `--sample=N` | 300 | Målantal unika bilder att hitta |
| `--min=N` | 50 | Golv — under detta är verifieringen underkänd |
| `--timeout=S` | 600 | Sekunder att scrolla och samla |

Exitkod: 0 = alla assertions passerade, 1 = assertionfel, 2 = fatalt fel.

**Förväntat (efter publicering):**

| check | förväntat |
|---|---|
| unika bild-URL:er | ≥ `--min` (hem-sidan har ~143 kort → ~140 unika) |
| kort med platshållare | 0 |
| HTTP-status | `{ "200": N }` |
| giltiga 3:2-WebP | N av N |
| aspect-spridning | ≤ 0.02 (mätt på `width/height`) |
| onError-varningar | 0 |

## Gotchas

- **Appen renderar INTE `<img>`** — letar man efter `img` hittar man 0 st
  trots att bilderna laddas. Sök på `background-image` i stället.
- **Hem-sidan är taket (~143 kort).** Det finns ingen separat sökvy i
  webbbygget — `SearchScreen` finns kvar i git men monteras inte längre
  (`06-UI/App.js`, kommentar vid rad 2321). Flikar visas inte i webbbygget
  heller. Vill du fler än ~140 bilder måste du verifiera i API-läget.
- **`--sample` är ett mål, `--min` är ett golv.** Hem-sidan rymmer ~143 kort,
  så `--sample=300` uppnås aldrig — `--min=50` är det som avgör om
  verifieringen godkänns.
- **`background-image` kan vara `data:`-URL** — skriptet hoppar över sådana.
- **Platshållaren har ingen `background-image`** — därför räknas "kort utan
  URL" som platshållare.
- **onError-varningen kommer från `useBrokenImage`** och innehåller
  `[EventPulseCard] image onError`. Den är per kort — 118 kort = 118
  varningar, inte 118 olika fel.
- **Beviset ska sparas före nästa körning.** Skriptet skriver
  `.scratch/evidence/<datum>-app-images/report.json` — kopiera till
  `report-BEFORE-publish.json` innan publiceringen så före/efter kan jämföras.
