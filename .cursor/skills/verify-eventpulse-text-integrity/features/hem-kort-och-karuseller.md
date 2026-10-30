# Hem — kort och karuseller

## Sub-features

- **Karusell-sektioner** — "Gratis", "Nytt på Eventpulse", "Upptäck",
  "Senaste", "Rekommenderat" m.fl. Varje sektion är en horisontell lista.
- **Eventkort** — bild, titel, meta-rad (kategori / datum / tid) och
  "N andra datum"-badge.
- **Filterchips** — tid, pris, kategori, humör.
- **Rubriker** — sektionsrubriker och "N event"-räknare.

## How to get to it (user POV)

Öppna appen. Hem är startsidan — ingen navigering behövs. Scrolla ned för att
se alla sektioner.

## Driving it with Playwright

```bash
node .cursor/skills/verify-eventpulse-text-integrity/scripts/text-integrity-scan.mjs \
  --language sv --screenshot
```

Drivaren scannar Hem efter att den scrollat igenom den scrollbara containern
och samlar alla synliga textnoder med sin position. Varje textnod mappas till
den sektionsrubrik den ligger under.

**Bevis att Hem laddades:** `surfaces[].text_nodes` för ytan `hem` ska vara
> 100. Ett värde runt 20 betyder att feeden inte kom (CORS).

## Gotchas

- **Hem läser `events_public` direkt från Supabase** — den går INTE via
  agentens `/agent/feed`. Översättningen hämtas därför klient-side av
  `06-UI/utils/displayTitles.js` (`attachDisplayTitles`) för de få titlar som
  har ett främmande skript. En audit som bara tittar på Hem missar därför
  den agentstyrda översättningen — och tvärtom.
- **Korttiteln visar inte lokalnamnet.** Kortet visar titel + datum/tid +
  kategori. Lokalnamnet dyker upp först i detaljvyn och i listorna — det är
  därför en audit som bara tittar på Hem kan se "ren" ut.
- Sektionrubriker och korttitlar är båda korta textnoder. Sektionsrubriken
  väljs som den översta rubriken ovanför textnoden — dina egna rubriker kan
  därför hamna i samma grupp.
- HTML-entiteter visas råa i titlar ("Stihm Food &amp; Wine"). Det är en
  separat renderingsbugg, inte en textintegritetsfråga.
- `aria-label` på kortet är `<underetikett> — <titel>` i de åtta
  `EventPulseCarousel`-sektionerna men **`<titel> — <underetikett>`** i
  "Senaste". En selektor som antar en ordning missar halva korten.
