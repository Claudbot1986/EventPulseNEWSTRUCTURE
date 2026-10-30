# Utforska — lista, kategorier och sök

## Sub-features

- **Kategorirutor** — 18 kategorier som leder till en kategorilista.
- **Eventlista** — rader med `<kategori> — <titel>` som a11y-label och
  lokalnamn + ort som meta ("왕의 정원 · Stockholm" var det faktiska fyndet).
- **Sökfält** — `[data-testid="explore-search-input"]`. Server-side sök via
  `/agent/feed?q=`.
- **Sökresultat** — träfflistan som öppnas av sökningen.
- **Karta** — egen flik, samma eventmängd i kartform.

## How to get to it (user POV)

1. Tryck fliken **Utforska** i botten.
2. Tryck en kategoriruta för att se listan, eller skriv i sökfältet.
3. Öppna en träff för att komma till detaljvyn.

## Driving it with Playwright

```bash
# Kategorilistan (fliken)
node .cursor/skills/verify-eventpulse-text-integrity/scripts/text-integrity-scan.mjs \
  --language sv --screenshot

# Söklistan + öppnad träff
node .cursor/skills/verify-eventpulse-text-integrity/scripts/text-integrity-scan.mjs \
  --language sv --search "VIKING" --screenshot
```

`--search` skriver i sökfältet, väntar, scannar listan (`sok`) och öppnar
första träffen (`sok-detalj`).

**Bevis att listan laddades:** `surfaces` ska innehålla `utforska` och `sok`
med `text_nodes` > 20.

## Gotchas

- **Söklistan är den yta som hittade problemet.** Hem-korten visar inte
  lokalnamnet — listan gör det. En audit som bara kör Hem missar 1 000+
  events.
- **Raderna är `div[role="button"]`, inte `<button>`.** Samma för
  evenemangskortens tryckyta i övriga sektioner.
- **Det första kortet på Hem är ofta "TEST EVENT"** (ett fixture-event).
  Använd `--event-title` för att rikta drivaren mot ett riktigt event.
- Sökfältet renderas först när Utforska är öppet. Hittar drivaren ingen
  `input` är det för att detaljvyn låg kvar — tryck "Tillbaka" och vänta.
- `SearchScreen.js` är död kod; sökningen sker i Utforska-inline.
- **Karta läser `events_public` direkt** (inte `/agent/feed`) och har därför
  ingen `venue_name` i sitt payload — kortet visar bara titel, metarad och
  pillor. Ett främmande lokalnamn kan alltså inte synas på kartan.
