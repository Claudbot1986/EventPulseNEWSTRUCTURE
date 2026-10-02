# 2026-10-02 — MapScreen (Karta-sandbox)

## Vad

Lägg till en **karta-sandbox** i `06-UI-sandbox` som visar ALLA framtida
EventPulse-events i Stockholm-geografin. Börjar centrerad på Stockholm,
visar events som prickar. Filter-knappar under kartan byter vilka events
som visas: Idag / Helgen / Nästa helg / Alla.

**Fas 0 (denna plan):** sandbox-bygge. Rör inte `06-UI/`.
**Fas 1 (senare, separat godkännande):** integrera i `06-UI/` när sandbox
är klar.

## Varför

Användaren (2026-10-02) efterfrågade en kartfunktion som täcker ALLA
events, med filter (idag / helgen / nästa helg), och visionen att
sponsrade events kan tonas in vid hög zoom.

## Gap-analys utförd 2026-11-02 [VERIFIED via live REST]

Supabase `events_public` view:

| Mätning | Resultat |
|--------|---------|
| Totalt events_public | 3 672 |
| Future events (`start_time >= today`) | 3 611 |
| Future events med `lat` non-null | 3 611 (100%) |
| Future events med `lng` non-null | 3 611 (100%) |
| Future events med `venue_id` non-null | 3 214 (89%) |
| Future events med lat **≠ 59.3293** (riktig geo) | 1 030 (29%) |
| Future events med lat **= 59.3293** (Stockholm-fallback) | 2 581 (71%) |

Lat/lng-fallback (59.3293, 18.0686 = Stockholm Sergels torg) är satt i
venues-migrationen (`20261002-0001-venues-country.sql`, rad 20) när
inget riktigt venues skapas. Det är **avsiktligt** — inget datagap att
fixa. **Användaren uttryckligen sa: inget får tas bort från databasen
utan tillåtelse.**

**Konsekvens för kartan:** 71% av events klumpar sig på samma pixel
utan motåtgärd. Vi jitterar koordinaterna klient-side med ±0.005° (≈550m)
för fallback-events, deterministiskt via `venue_id`/`id`-hash, så
samma event alltid hamnar på samma jitter-position. Riktiga events
(lat ≠ 59.3293) lämnas orörda.

Lat/lng range för alla future events: lat 55.43–65.33, lng 11.98–21.48.
Kartan behöver alltså täcka hela Sverige för att inte klippa — men
centrerad viewport på lat 59.33 / lng 18.07 med zoom som visar
Stockholm-area fångar merparten.

## Research — hur gör branschen? [VERIFIED via web_search]

**Ticketmaster (Help Center + blogorama.com Ticketmaster API guide):**
- "Display active filters as removable chips so users always understand
  what's in effect"
- "Layer filters that reflect how people choose plans: date range,
  distance, price bands, genre/segment"
- "Date-first for locals, distance-first for travelers, genre-first
  for enthusiasts" → vi är locals, date-first
- "Show result counts early"
- "Active filters as removable chips"
- Map view = sekundär för Ticketmaster (de är främst köp-driven)

**Eventbrite / Bandsintown:**
- "Map view for local events" — Eventbrite har basic map
- Bandsintown: "local discovery map highlights what's happening this week
  without excessive scrolling"
- Filter UX: datum + kategori + distance är standard

**React Native kartbibliotek [VERIFIED]:**
- `react-native-maps` är battle-tested, funkar i Expo Go med
  config-plugin. PRO: störst ekosystem. CON: Apple Maps på iOS
  default (Stockholm ser bra ut) eller PROVIDER_GOOGLE (kräver API key)
- `expo-maps` är alpha, kräver dev build (INTE Expo Go) → **utesluten**
- `react-native-map-clustering` wrapper för supercluster → bra för
  framtida N i Sverige
- För **utanvikande sandbox utan API key** och för verifiering bygger
  vi en SVG-baserad projektion (Mercator lat/lng → x/y). Ingen
  extern tile-tjänst behövs. SVG-approach är verifierbar offline och
  fullt kompatibelt med react-native-svg (Expo Go).

**Apple HIG (developer.apple.com/design/human-interface-guidelines/maps):**
- "Cluster overlapping points of interest to improve map legibility"
- "Adjust map detail based on zoom level"
- "Make your map interactive"

**Booking.com / Airbnb (allmän branschpraxis):**
- Jittering av pins vid samma lat/lng för att förhindra visuell krock

## Beslut

1. **Sandbox-teknik:** SVG-baserad karta (inte react-native-maps).
   - Inget beroende av Google API key
   - Verifierbar offline (ingen tile-hämtning)
   - Snabb i Expo Go (små bundlar)
   - Klar att swappa till react-native-maps senare genom att ersätta
     endast `<MapCanvas>`-komponenten (single-responsibility)
2. **Projektion:** enkel Mercator-variant (ekvivalent vid liten
   Stockholm-area: `x = lng, y = -lat` räcker för visuellt syfte).
3. **Filter-knappar (4 st):** Idag / Helgen / Nästa helg / Alla.
   - Alltid synliga under kartan (inte reveal-on-focus)
   - Aktiv knapp markeras med orange accent (`#FFB454`)
   - 44pt minHeight (a11y)
5. **Klustring:** Aggregering per pixel-grid (~16px celler) för att
   förhindra krock. Visar antal events i klustret.
6. **Pins:** Cirkel med kategori-färgkodning (8 buckets) + en prick
   för klustrade events med count.
7. **Tooltip på press:** Mini-callout som visar första eventets titel
   + kategori + start_time. Max 3 events i callout-listan.
8. **Jitter för fallback-events:** ±0.005° (≈550m) deterministiskt via
   FNV-1a-hash på event-id.

## UX-specifikation

```
┌─────────────────────────────┐
│ < Komponenter             │
│                             │
│ KARTA                       │
│ ┌─────────────────────────┐ │
│ │  . .                    │ │
│ │   . . .                 │ │
│ │  ( Stockholm )          │ │
│ │   .  · · ·              │ │
│ │     · · ·               │ │
│ │   ·                     │ │
│ └─────────────────────────┘ │
│                             │
│ [Idag] [Helgen] [Nästa] [Alla] │
│  ↑ orange (aktiv)           │
│                             │
│ 2 361 eventtotal, 8 i viewport│
└─────────────────────────────────┘
```

## Komponenter

| Fila | Ansvar |
|------|--------|
| `components/MapScreen.js` | root-komponent (hooks + UI-state + MapCanvas) |
| `components/MapCanvas.js` | SVG-projektion + pin rendering + klustring |
| `components/MapFilterBar.js` | 4 filter-knappar |
| `components/MapTooltip.js` | mini-callout för marker-press |
| `components/mapProjection.js` | mercator helpers, bounds, jitter |
| `components/mapClustering.js` | grid-baserad klustring |
| `components/registry.js` | ny entry för MapScreen |
| `e2e/map-screen.test.mjs` | node-test som verifierar data + logik |

## Verifieringskrav

E2E-verifiering (live, inte påstådd):

1. **Live data-hämtning:** e2e-test kontaktar live Supabase REST med
   samma anon-nyckel som sandbox. Verifierar:
   - ≥3000 events returneras med lat/lng satta
   - ≥900 events har lat ≠ 59.3293 (riktig geo)
2. **Filter-logik:** test kör samma `computeTimeWindow('today'|
   'weekend'|'next_weekend'|'all')` som UI:t och verifierar att:
   - Idag ≤ Helgen ≤ Nästa helg ≤ Alla (range-monotonicitet)
   - Varje filter returnerar rimligt antal (>0, <total)
3. **Jitter-logik:** test verifierar att:
   - Samma id → samma jitterade position (deterministiskt)
   - Olika ids → olika positioner (inom ±0.005°)
4. **Projektion:** test verifierar att:
   - Stockholm centrum (59.33, 18.07) → mittpunkt av kartan
   - Inom bounds: bounds(1,1) → bounds(0,0)
5. **Klustring:** verifierar att grid-klustring på samma position
   resulterar i EN kluster med rätt count.
6. **TS-check:** `npx tsc --noEmit` exit 0.
7. **Data-ingenting-borttaget:** verifiera att vi INTE rör Supabase
   data. Bara SELECT-queries.

## Vad INTE byggs

- react-native-maps (Expo-komponent som kräver simulator)
- Sponsrade events (vision, inte nu)
- Clustering-animation
- Routing / directions
- Heatmap
- Sökfunktion (UI-only)
- Custom tile-server / OSM-tiles (för att inte kräva nätverk)

## Risk

- **API rate-limit:** vi kör live REST i test. Hanterar 429-graceful
  genom att bara läsa 1× per test-run och cache:a lokalt.
- **Klustring-precision:** vid tät data kan grid-klustring ge
  "0-bucketing" om pins är på olika pixlar. Acceptabelt för
  sandlåda-nivå.

## Öppet för framtida iterationer

- Sponsrade events vid zoom
- Distance-filter (slider)
- Sökfält
- react-native-maps-integration för produktion (när API key finns)
- Klustring-animationer