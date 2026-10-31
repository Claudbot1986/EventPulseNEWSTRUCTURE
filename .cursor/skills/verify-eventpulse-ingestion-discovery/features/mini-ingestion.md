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
```

| Gate | Krav | Negativ kontroll |
|---|---|---|
| M1 | Det finns discovery-källor **med verklig källfil** | ✅ post utan källfil kan inte köas (A raderar den tyst) |
| M2 | Alla ligger i preA-kön | — |
| M2b | De ligger inom de första N platserna i kön | ✅ gamla poster i kön kan skjuta dem bakom `--limit N` |
| M3 | Kedjan avslutades exit 0 | — |
| M4 | A-gaten körde **exakt N** källor — ur loggen från **denna** körning | ✅ föregående nattens logg får inte räknas |
| M5 | Varje källa gav events i `events_public` **eller** registrerade ett routing-skäl | ✅ varken/eller = rött |

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
- **Kedjan får inte köra parallellt** med en nattlig körning. Gaten vägrar
  starta om `liveChainPids()` hittar en levande kedja.
- **Mini-ingestionen är inte en särskild extraction.** Samma
  `scripts/ingestion-cron.ts`, samma gates, samma filter. Enda skillnaden är
  `--limit N` och vad som står i preA-kön.
