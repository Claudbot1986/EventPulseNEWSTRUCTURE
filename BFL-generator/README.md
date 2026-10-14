# BFL-generator

Isolerat verktyg för att räkna, planera och generera BFL-bilder baserat på råa event-beskrivningar.

## Vad det gör

1. **Läser** alla `raw_description` (eller fallback till `description_sv` / `eventpulse_summary`) för events i en kategori.
2. **Klustrar** dem med MiniMax-M3 (modell `minimax/minimax-m3` via OpenRouter). Returnerar 1–3 taggar per event (t.ex. `["hårdrock","gitarr","mörk"]`).
3. **Räknar** hur många bilder som behövs enligt formeln `max(10, ceil(events/30))`.
4. **Genererar** bilder per kluster via befintlig round5-pipeline, med concurrency 7 (default) och 429-backoff.
5. **Stämplar** med legacy 240×64 SE-pill (samma som bfl2/3/4).
6. **Matchar** rätt bild till rätt event vid visning via `image_library.tags`.

## Användning (efter `npm install` i denna mapp)

Alla kommandon är **dry-run som default**. Man måste lägga till `--apply` för att BFL-kredit ska brännas.

```bash
# Ren räkning — hur många bilder behöver musik?
npx tsx bin/bfl-quota.ts --category=music

# Plan — hämta raw_descriptions, klustra, skriv plan.json
npx tsx bin/bfl-plan.ts --category=music

# Generera (default concurrency 7)
npx tsx bin/bfl-generate.mjs --apply --category=music --count=20

# Generera för specifikt event
npx tsx bin/bfl-generate.mjs --apply --event=<uuid>

# Generera för specifikt kluster
npx tsx bin/bfl-generate.mjs --apply --cluster=hårdrock --category=music

# Stämpla
npx tsx bin/bfl-stamp.ts --apply --category=music

# Matcha bild till event
npx tsx bin/bfl-match.ts --event=<uuid>
```

## Säkerhetsregler

- `--apply` krävs för att bränna BFL-kredit. `--dry-run` är default.
- Innan `--apply` skriver verktyget ut en plan i terminalen — vänta på Enter.
- **Aldrig** röra `local_image_library/` — stämplade kopior hamnar i `local_image_library_stamped/`.
- BFL-stämpeln är **alltid** legacy 240×64 SE-pill (`position: 'bottom-right'`), inte den nya 150×36 hörnpillen.
- MiniMax-API-nyckel exponeras **aldrig** i loggar/utdata.

## Status

- [x] Fas 1: mappskelett + quota.ts
- [ ] Fas 2: plan.ts (M3-klustring)
- [ ] Fas 3: generate.ts + 429-backoff + stämpel
- [ ] Fas 4: match.ts