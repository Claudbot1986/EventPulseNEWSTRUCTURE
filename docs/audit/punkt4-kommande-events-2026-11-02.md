# Punkt 4 för kommande events — verifieringsrapport 2026-11-02

**Beslut (användaren, 2026-11-02):** *"implementera det i kommande events enbart!"*
→ Ingen backfill av de 5 388 faktmallsraderna. Punkt 4 (prosa i stället för
faktmall) ska gälla events som kommer **in framöver**.

Övriga beslut samma dag: de 89 textlösa eventsen **lämnas tomma**,
gratisistockholm-adaptern **skjuts upp** ("vänta"), ingen ändring i C0/C1/C2.

Status: **genomfört och verifierat.** Commit `a6b02da3` (fixar), `512587ce` (mätverktyg).

---

## 1. Vad en backfill faktiskt hade gjort (frågan som ställdes)

Populationen är **5 388 LOW-rader** (faktmall) — inte ~6 400.

Live-mätning mot bas-tabellen `events` 2026-11-02:

| | antal |
|---|---|
| rader med `editorial_description` | 12 495 |
| `editorial_info_level = 'LOW'` (faktmall) | **5 388** |
| `VERY_LOW` (minimal) | 66 |
| övriga nivåer (riktig prosa) | 7 041 |
| LOW-rader **utan** `event_profile` | **0** |

Mätt på slumpmässigt urval (seed `punkt4a`, n = 50, **produktionsläget utan
NLI-judge**):

| | andel |
|---|---|
| blir prosa | **25/50 (50 %)** |
| texten ändras över huvud taget | **27/50 (54 %)** |
| förblir exakt samma faktmall | **23/50 (46 %)** |
| max / medel similarity | 0,385 / 0,094 |

Per kategori: **musik 16/25 (64 %) prosa**, **icke-musik 4/25 (16 %) prosa**.
Skillnaden är strukturell — underkännandena ligger i `community`, `theatre-drama`,
`exhibition`, `theatre-comedy`, `nightlife`.

Extrapolering till 5 388: ~2 150 rader blir prosa, ~2 500 ändras, ~2 900 förblir
faktmall (±~14 procentenheter på konverteringsgraden, n = 50).

**Beslutet blev: ingen backfill.** Men siffrorna ovan behövdes för att beslutet
skulle vara ett *medvetet* val — en backfill hade gett prosa på ungefär hälften
och lämnat den andra hälften som etiketttext.

### Metodkorrektion som gjordes under mätningen

Det första 20-radersurvalet var **ordningsberoende** (`preview-editorial-descriptions.ts`
hämtade de *första* N raderna i insertordning → kluster per källa). Skriptet fick
därför `--random=<seed>` med deterministisk mulberry32-shuffle, hämtar nu ALLA
matchande LOW-rader (PostgREST-taket 1 000 i åtta uppslag) och slumpar lokalt.

Fynd under mätningen: **140 av 5 388 LOW-rader har tom `title_sv` men har
`title_en`.** En backfill som bara läser `title_sv` förlorar deras titel-prefix.
Mätt på de 140 raderna: **0 exakta textkollisioner** med eller utan fix
(datum/tid skiljer dem åt) → formatregression, inte dedup-katastrof. Fixen
`title_sv → title_en → ''` är implementerad.

---

## 2. Levererar produktionsvägen prosa för nya events? — Ja

Diskriminatorn "editorial genererad inom 60 min efter att eventet skapades"
= normalizerns väg (`04-Normalizer/normalizer.ts:1083` → `maybeRunEditorial`).

Av 1 364 events skapade sedan 2026-10-28:

| | antal |
|---|---|
| på produktionsvägen | **192** |
| → `RICH` | 60 |
| → `MEDIUM` | 132 |
| → `LOW` (faktmall) | **0** |

**Punkt 4 är alltså redan effektiv för nya events** — de som når pipelinen får
prosa, aldrig faktmall.

**NLI-judgen behövs inte.** Med `useNliJudge: true` blev motsvarande mätning
20/50 (40 %) — inom LLM-variansen (n = 50). Produktionen kör `runEditorialPipeline`
utan `useNliJudge`, så ingen ändring där.

---

## 3. Luckan: 56 % av nya events fick ingen beskrivning alls

Av 497 events skapade sedan 2026-11-01 fick **276 (56 %)** ingen `editorial_description`.

Rotorsak mätt i nattloggarna
(`runtime/ingestion-cron/steps/worker-drain-2026-11-02T02-24-59-432Z*.log`):

| | antal |
|---|---|
| körningar som skrev beskrivning | 1 054 |
| körningar som föll på `rate limit exceeded(RPM) (1002)` | **271** |

`writeEditorialBack` skrev ingenting vid fel → eventet sparades utan
`editorial_description` **och** utan `event_profile` (276/276 saknar båda) och
syntes tomt i appen. Per källa: `vadkul-stockholm` 148 av 148 saknar,
`livespot-stockholm` 76 av 85 har, `lokalhelhet-calendar` 37 av 73,
`thatsupse` 51 av 67.

Nattens worker-drain körde 1 304 events på 18 minuter med upp till **3 MiniMax-anrop
per event** (skrivning + 2 regenereringar) ≈ **217 anrop/min** — över kontots tak.
Burstarna (worker-körningens concurrency 20) är det som spränger det.

### Tre fixar (commit `a6b02da3`)

1. **RPM-guard** — `RpmGuard` i `04-Normalizer/editorial/editorialWriter.ts`,
   **modul-level singleton** (`maybeRunEditorial` skapar en ny klient per event,
   så en per-instans guard skulle aldrig se taket). Tak `EDITORIAL_RPM`, default
   150, fönster 60 s.
2. **Deterministisk FACT-fallback vid fel** —
   `writeEditorialFallbackBack` i `normalizerIntegration.ts` skriver profilens
   egna faktatext (titel, typ, genre, lokal, datum, tid, pris) i stället för att
   lämna eventet tomt. Fallbacken innehåller **ingen källtext** — samma
   upphovsrättslogik som `fallbackHierarchy.ts` i övrigt.
3. **Omsök vid trunkering** — `finish_reason=length` med `max_tokens=150` gav
   2 av 60 fel i en live-probe (`content_len` 483 respektive 360 tecken).
   En trunkerad beskrivning kastades bort → eventet fick ingen beskrivning.
   Nu körs om med dubbelt budget.

---

## 4. Slutverifiering (riktiga DB-skrivningar)

Tre events från nattens extraction som saknade beskrivning (429-offer) kördes
genom den **ärkta** `maybeRunEditorial`:

```
✓ kungliga-musikhogskolan | Lunchkonsert på Stallbacken Kultur
  → skrev LLM-beskrivning (info_level=RICH, attempts=1)
✓ billetto-stockholm | GALLERY WEEKEND STOCKHOLM WALKS / Östermalm
  → skriv LLM-beskrivning (info_level=RICH, attempts=3)
✓ billetto-stockholm | TALKS 2026 GALLERY WEEKEND STOCKHOLM
  → skrev LLM-beskrivning (info_level=MEDIUM, attempts=3)
```

**3 av 3 har nu beskrivning + event_profile.** Ingen faktmall.

UI-resolvern verifierad med den **ärkta** `getDetailsDescription`
(`06-UI/utils/descriptionFallback.js`) och exakt den payload `HomeScreen.js`
bygger:

```
✓ TALKS 2026 GALLERY WEEKEND STOCKHOLM
  licens=unknown · summary=ja
  UI VISAR: TALKS 2026 GALLERY WEEKEND STOCKHOLM erbjuder ett lokalt och
  pedagogiskt program med samtal och kunskapsdelning på Galerie Nordenhake
  i Stockholm. Evenemanget är inriktat mot vuxna, studerande och lokalt
  intresserade, med möjlighet att ställa frågor och delta i diskussioner.
✓ Lunchkonsert på Stallbacken Kultur
  UI VISAR: Lunchkonsert på Stallbacken kultur Edsvik i Stockholm. Ett
  liveframträdande med musik, låtar och ett artistframträdande på scen.
✓ GALLERY WEEKEND STOCKHOLM WALKS / Östermalm
  UI VISAR: En stadsvandring i Östermalm inom programmet GALLERY WEEKEND
  STOCKHOLM WALKS. Den pedagogiska och öppna formen syftar till lokal
  gemenskap, samhällsengagemang och kunskapsdelning.

3 av 3 events får en riktig beskrivning i UI-resolvern.
```

`description_license = 'unknown'` (no-go för råtext) påverkar inte
`editorial_description` — licensgrinden gäller *råtexten*, inte AI-prosan.
Separationsregeln håller.

---

## 5. Vad som INTE är verifierat

- **[CLAIMED]** att RPM-grinden eliminerar 429 i drift. Enhetstestet bevisar att
  guarden pacar anrop och att den är delad mellan klienter. **A/B mot MiniMax
  kunde inte reproducera felet**: två armar (12, 60 och 150 events) gav
  **0 429 i båda** vid ≤134 anrop/min. Nattens 271 429-fel är dokumenterade i
  loggarna, men den exakta takgränsen är inte mätt. Grinden är en
  konservativ tolkning av hastighetsanalysen (217 anrop/min i drift → tak 150).
  Fallback-fixen täcker resten oavsett.
- **[UNVERIFIED]** att den deterministiska fallbacken är tillräcklig *kvalitativt*
  för de events som hamnar i den. Den är faktatext — samma typ som de 5 388
  raderna använder idag — och bättre än en tom rad, men inte prosa.
- **[UNVERIFIED]** den nya prosa-textens språkliga kvalitet i skarpa fall.
  Observerat i produktionstext: `...i Stockholm.evenemanget fokuserar...`
  (gemener efter punkt) och `...i lugn ochvisande atmosfär` (saknad mellanslag).
  Detta är M3-artefakter i utdata-texten, inte gate-fel — de passerar
  faktualitetsgrinden eftersom de inte är *påståenden* utan stavfel.

---

## 6. Teststatus

```
npx vitest run 04-Normalizer/editorial/ 06-UI/services/eventsCanonical.license.test.ts 06-UI/utils/
→ 36 sviter, 758 tester, 758 gröna, 0 nya fel
```

Nya tester: `04-Normalizer/editorial/normalizerIntegration.test.ts` (7) +
RpmGuard- och trunkerings-tester i `editorialWriter.retry.test.ts` och
`editorialWriter.test.ts` (8).
