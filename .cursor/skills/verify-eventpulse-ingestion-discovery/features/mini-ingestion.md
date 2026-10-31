# Mini-ingestion — kör ingestion över discovery-källorna, bara N ändras

## Sub-features

- **preA-kön** (`runtime/preA-queue.jsonl`) — A-gatens högsta prioritet.
- **A-gatens urval** — preA → api-adapter → rss → never_run (alla klippta av
  `--limit N`).
- **`--limit N`** — gränsen som går vidare till A, B, C, D, pdf, etag och
  D-images (`effectiveLimit` i `scripts/ingestion-cron.ts:372`).
- **Resten av kedjan** — oförändrad: samma steg, samma ordning, samma filter.

## How to get to it (user POV)

Användaren (2026-10-31): *"Events från discovery ska ju överföras till
ingestion. Så jag vet inte om ingestion borde köras först, sen discovery och
sen en mini-ingestion på samtliga discovery-källor (endast ändring att antal
källor N ändras, inget annat tex hur ingestion sker, detta är absolut
kritiskt)."*

**Svaret är ja, och ordningen är 1) ingestion 2) discovery 3) mini-ingestion.**
Steg 3 är verifieringen av överföringen: de källorna discovery hittade ska
faktiskt ge events i appen.

## Driving it with <harness>

```bash
cd /Users/claudgashi/EventPulse
node scripts/verify-mini-ingestion.mjs            # N = de färskaste källorna (max 5)
node scripts/verify-mini-ingestion.mjs --limit 3
node scripts/verify-mini-ingestion.mjs --source id1,id2
node scripts/verify-mini-ingestion.mjs --recheck runtime/verification-reports/mini-ingestion-<TS>.json
```

| Gate | Krav | Negativ kontroll |
|---|---|---|
| M1 | Det finns discovery-källor **med verklig källfil** | ✅ post utan källfil kan inte köas (A raderar den tyst) |
| M2 | Alla ligger i preA-kön | — |
| M2b | De ligger inom de första N platserna i kön | ✅ gamla poster i kön kan skjuta dem bakom `--limit N` |
| M3 | Kedjan avslutades exit 0 | — |
| M4 | A-gaten körde **exakt N** källor — ur loggen från **denna** körning | ✅ föregående nattens logg får inte räknas |
| M5 | Varje källa gav events i `events_public` **eller** registrerade ett **friskt** routing-skäl (från denna körning) | ✅ varken/eller = rött; ✅ routing-skäl från en tidigare körning räknas inte |

**PASS** = exit 0 + `✓ alla gater passerade` + rapporten i
`runtime/verification-reports/mini-ingestion-<TS>.json` med `failed: []` och
`perSource[].ok=true`.

## Gotchas

- **A-gatens urval är ordnat preA → api-adapter → rss → never_run.** En ny
  discovery-källa är `never_run` och hamnar alltså sist — med `--limit N` ensam
  skulle den klippas bort. Därför kös källorna in i preA-kön först, via den
  befintliga CLI:n (`runA.ts --add <id> <reason>`).
- **UI-köns `sourceId` är inte alltid filnamnet i `sources/`.** Av 89 rader i
  `runtime/discovery-ui-queue.jsonl` resolve bara 36 direkt till en källfil; 47
  matchar samma värd under ett annat id (UI `wwwdramatense` ↔ fil
  `dramaten.jsonl`), och 52 har ingen träff alls. Gaten resolve:ar därför mot
  verkliga källfiler (först på id, sedan på värd) och hoppar över poster utan
  källfil — annars skulle A-gaten radera dem ur kön tyst.
- **preA-kön har varken kapacitet eller åldersfilter**, och nya poster
  appenderas sist. Gamla poster kan därför skjuba de nya källorna bakom
  `--limit N` — M2b fångar det.
- **Poster vars källfil saknas raderas tyst vid körning** (`runA.ts:293-298`) —
  de blockerar inte limiten, men de försvinner ur kön.
- **A-gatens city-filter gäller källfilens `city`** (måste vara `Stockholm`),
  inte UI-radens. 15 av 89 UI-rader har `city=NULL` trots att källfilen har
  `city=Stockholm` — det är alltså inte ett problem i sig.
- **Import-steget hoppar över oförändrade källor** (ingen `--force-import`),
  så `events_public` kan inte växa för en källa som redan importerats. M5
  vilar då på `lastRoutingReason` — en legitimt "inga framtida event"-utfall.
- **Ett routing-skäl i `runtime/sources_status.jsonl` är inte i sig bevis.**
  Filen innehåller även skäl från tidigare körningar, så en källa som hoppades
  över helt i kedjan kan ändå se ut att ha en anledning. M5 kräver därför att
  skälets `lastRun` ligger **efter** kedjans start (`updateSourceStatus` sätter
  `lastRun = now`, `sourceRegistry.ts:451`). Eventstillväxt är per definition
  färsk — den mäts före/efter körningen.
- **Kedjans stegloggar skrivs delvis EFTER att steget avslutats.** Kedjan
  skriver barnets stdout till stegloggen när data kommer, men "finished"-raden
  skrivs när barnet avslutar — en logg kan alltså se komplett ut innan den
  är det. Läs loggen efter att **hela kedjan** är klar, inte mitt i körningen.
- **Kedjan får inte köra parallellt** med en nattlig körning. Gaten vägrar
  starta om `liveChainPids()` hittar en levande kedja.
- **M5 mäter ANTAL, inte kvalitet.** Ett rött-grönt M5 betyder "källan
  levererade rader" — inte "raderna är evenemang". Mätt 2026-10-31:
  `kollaborationse` levererade 8 rader i `events_public` med titlar som
  *"Rätt säsong för din resa till Thailand"* och *"Så väljer du ekologisk
  gurkmeja"* — bloggposter, inte evenemang. Två andra rader fick titeln
  *"idag 31/10"* (ett datum som titel). Källpromoteringen (P3D) accepterade
  alltså en **blogg- och nyhetssida** som eventkälla, och C-gatens
  kandidatval landade på `kollaboration.se/category/blogg/` (en
  kategorilista, inte en evenemangssida).
  **Kvalitetsgranskning av promote:ade källor är en egen, ännu ogjord sak.**
- **Mini-ingestionen är inte en särskild extraction.** Samma
  `scripts/ingestion-cron.ts`, samma gates, samma filter. Enda skillnaden är
  `--limit N` och vad som står i preA-kön.
- **Kedjan kan avbrytas efter att den kört A/B/C.** Om drainen inte hinner
  persistera eventsen är "events efter" felaktigt noll. Då: kör kedjans
  återstående steg (`npx tsx scripts/ingestion-cron.ts --limit 3 --only
  worker-drain,dedup-audit,reconcile-source-status,P2C-active-learning`) och
  mät sedan om med `--recheck <rapport.json>`. Recheck kör **inte** kedjan.
- **`--only` är kedjans eget filter** (`scripts/ingestion-cron.ts:1228`). Ett
  okänt stegnamn är ett fel (exit 2), inte en tyst no-op — bra för att en
  typo inte ska få verifieringen att se grön ut.
- **Stegloggarnas filnamn bär stegets starttid** (`A-directAPI-<ISO>.log`),
  inte mtime. Kedjan skriver i loggen även efter att steget avslutats, så
  mtime pekar på ett senare läge än steget egentligen började.
- **Kedjan kan ta längre än en timme.** Mätt: 3 956 s med `--limit 3`
  (subpath-discovery ensamt tog 40 min). Ett verktyg som sätter en hård
  tak-tid på en halvtimme kan avbryta kedjan mitt i en drain — avbryt då
  **kedjans egna steg**, inte slumpmässiga jobb.
