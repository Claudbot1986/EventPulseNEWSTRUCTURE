---
name: verify-eventpulse-descriptions
description: |
  Verify EventPulse's EVENT DESCRIPTIONS and the copyright separation around
  them (T0201). Use for /verify-eventpulse-descriptions, when an event card
  shows "No description available from <source>", when a description is a
  robotic fact-list instead of readable prose, when you suspect a source's
  raw text leaked into the app, before changing the editorial pipeline
  (04-Normalizer/editorial/), before changing the license gate or the
  description fallback chain, or after touching 06-UI/utils/descriptionFallback.js,
  06-UI/screens/HomeScreen.js select lists, or 04-Normalizer/textualFirewall.ts.
  Covers five independent gates: license gate (raw source text never reaches
  the UI), firewall (raw source text never reaches the writer model),
  non-copy (generated text does not resemble the source), time-box (raw text
  is deleted after 30 days), and parity (Hem, Utforska and Sök show the same
  description). Also covers prose quality (fact-list vs readable prose).
disable-model-invocation: false
---

# verify-eventpulse-descriptions

Beskrivningarna i EventPulse är byggd som en **separation**:

| Lager | Vad | Var |
|---|---|---|
| Källtext | rå text från källsajten | `events.raw_description`, `events.description_sv/en` |
| Grind | licens → vyn nollställer ut | `events_public`-vyn + `descriptionLicense.ts` |
| Brandvägg | källtext får aldrig nå writer-modellen | `textualFirewall.ts` |
| Utdata | AI-prosa ur profil + fakta | `editorial_description` (P7) |
| Utdata | deterministisk faktmall | `eventpulse_summary` |
| UI | resolution i 5 steg | `06-UI/utils/descriptionFallback.js` |

**Beslutet (T0201, 2026-10-05):** rå källtext får ALDRIG synas i UI:t utan
tillåtande licens. Fakta (datum, tid, plats, artist) + öppen data (Wikidata,
MusicBrainz) + AI-genererad text är det som ska synas.

## De fem grindarna

| # | Grind | Frågan | Mäts av |
|---|---|---|---|
| A | **Licensgrind** | Syns rå källtext i appen? | `events_public` + `descriptionLicense.ts` |
| B | **Brandvägg** | Når källtext writer-modellen? | `textualFirewall.ts` |
| C | **Icke-kopia** | Likhnar utdata källtexten? | `checkIndependence` (samma mått som pipelinen) |
| D | **Time-box** | Raderas råtext efter 30 dagar? | `rawDescriptionRetentionWorker.ts` |
| E | **Paritet** | Visar Hem/Utforska/Sök samma sak? | `descriptionFallback.js` + select-listor |

## Launch

Det finns ingen server att starta för grindarna A–E. "Launch" = köra gaten
mot live-Supabase.

```bash
# Huvudgaten: alla fem grindarna + bevisfil
node --env-file=.env --import tsx scripts/verify-description-rights.ts
node --env-file=.env --import tsx scripts/verify-description-rights.ts --sample=300
```

**För UI-flödet (kräver att Expo-webb kör på :8081):**

```bash
cd 06-UI && npx expo start --web --port 8081
```

Redan igång? `curl -s -o /dev/null -w "%{http_code}" http://localhost:8081` → `200`.

## Doctor

```bash
curl -s -o /dev/null -w "expo:%{http_code}\n" --max-time 5 http://localhost:8081
node --env-file=.env --import tsx scripts/verify-description-rights.ts --sample=20 | tail -3
```

`expo:200` + gaten `RESULTAT: PASS` = instansen är värd att köra.
En röd grind i gaten är **inte** en trasig app — den är ett verkligt fynd.

## Drive

### Grind A–E (headless, utan app)

`scripts/verify-description-rights.ts` gör allt. Exit 0 = grönt, exit 1 = rött
med detaljer i `runtime/verification-reports/description-rights-<ts>.json`.

### Paritet i den riktiga appen

```bash
# Mät vilka beskrivningar Hem/Utforska/Sök faktiskt visar
node --env-file=.env scripts/_audit_description_coverage.mjs
```

Skriptet importerar den **ärkta** `getDetailsDescription` ur
`06-UI/utils/descriptionFallback.js` och läser Hem:s select-listor ur
`HomeScreen.js` **vid körning** — siffrorna kan inte glida ifrån appens
beteende. Skriver `docs/audit/description-coverage-<datum>.md` + CSV.

**Invarianten:** de tre flödena ska visa **samma antal** events utan
beskrivning. (2026-11-02: 89 / 89 / 89 efter fixen. Före: 11 932 / 95 / 218.)

### Vad appen visar (Playwright)

```bash
node scripts/_verify_description_rendering.mjs
```

Öppnar Hem i Expo-webb, trycker på första eventkortet och läser av
DetailsScreen-texten. Bevis: `.scratch/evidence/<datum>-description-rendering/`.

Fallet att fånga: texten **"No description available from <källa>"**. Det
betyder att resolutionen inte nådde något av sina fem steg — nästan alltid
ett saknat fält i select-listan.

## Evidence

| Fil | Vad |
|---|---|
| `runtime/verification-reports/description-rights-<ts>.json` | alla fem grindarna + similarity-statistik + matchade fraser |
| `docs/audit/description-coverage-<datum>.md` | täckning per flöde + rotorsak + per källa |
| `docs/audit/data/events-without-description-<datum>.csv` | komplett lista över events utan beskrivning |
| `.scratch/evidence/<datum>-description-rendering/` | skärmdump av DetailsScreen |

## Stoppregler

- **Skriv aldrig `editorial_description` utan att ha kört gaten C först.**
  En genererad beskrivning som ligger nära källtexten är ett rättsligt
  problem, inte ett kosmetiskt.
- **Ändra aldrig `textualFirewall.ts` så att källtext kan passera.** Den är
  rättslig brandvägg — grind B i gaten ska vara grön.
- **Lägg inte ord i `NON_FACTUAL_VOCABULARY` som påstår något.** Ordet
  "scen", "lokal", "kväll", "gemensam", "community", "format", "genre" är
  fakta. Listan får bara innehålla glödord. (FARVEBLIND-fallet i
  `factualityCheck.test.ts` skyddar detta.)
- **Kör inte backfill-pipelinen utan `--dry-run` först** — den skriver till
  `events.editorial_description`.
- **Rör inte `events_public`-vyns licensfilter.** Logiken ska ligga på ett
  ställe (`descriptionLicense.ts`).
- **Publicera inte rå källtext för att "testa"** — sätt aldrig
  `description_license` på en riktig rad för att se effekten i appen.

## Korsreferens

- Rättighetsbeslutet → `00-Vault/.../02-Operations/19-Decision-Log.md` (2026-10-05)
- Implementationsrapport → `00-Vault/.../2026-10-05-Description-Rights-Summary-Implementation.md`
- Orsaksutredning beskrivningsluckor → `docs/audit/description-gap-root-cause-2026-11-01.md`
- Bildpipelinen → `verify-eventpulse-word-images/`
- UI-nivå → `verify-eventpulse-ui/`
