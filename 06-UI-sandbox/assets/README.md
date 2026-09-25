# 5 bild-platser

App.js renderar 5 `ImageSlot`s som letar efter:

- `tile-1.png` — Helg
- `tile-2.png` — Ikväll
- `tile-3.png` — Gratis
- `tile-4.png` — Stämningsfullt
- `tile-5.png` — Skratt

Alla är **BFL/FLUX-genererade originals** (1024×1024) från
`tmp/explore-tiles/`, **stämplade** med samma "● AI-genererad"-SVG som
prod-pipelinen (`08-Agent/tools/ai_compliance.ts`) — orange prick +
text-pill i nedre-vänstra hörnet, halvtransparent.

## Regenerera stämplade bilder

```bash
cd 06-UI-sandbox
node scripts/stamp-tiles.mjs
```

Skriptet läser 5 originals från `tmp/explore-tiles/` och skriver stämplade
PNGs hit. Kräver `sharp` (finns i projekt-rootens `node_modules`).

## Byta ut en bild

Lägg en ny 1024×1024 JPG/PNG med samma filnamn i denna mapp (eller
uppdatera `TILE_SOURCES`-nyckeln i App.js + källfilens namn i
`scripts/stamp-tiles.mjs`). Sandboxen läser om direkt i Expo Go.