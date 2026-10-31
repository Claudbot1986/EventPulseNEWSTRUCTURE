# Mini-ingestion — kör ingestion över discovery-källorna, bara N ändras

## Sub-features

- **preA-kön** (`runtime/preA-queue.jsonl`) — A-gatens högsta prioritet.
- **A-gatens urval** — preA → api-adapter → rss → never_run.
- **`--limit N`** — antalet källor A-gaten får ta.
- **Resten av kedjan** — oförändrad: B, C, D, import, drain, dedup, reconcile.

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
node scripts/verify-mini-ingestion.mjs            # N = antalet discovery-källor
node scripts/verify-mini-ingestion.mjs --limit 3
node scripts/verify-mini-ingestion.mjs --source id1,id2
```

Gaten:

1. Hittar discovery-källorna (`runtime/discovery-ui-queue.jsonl`), föredrar de
   som ännu inte gett events.
2. Köar dem in i preA-kön via den befintliga CLI:n
   (`runA.ts --add <id> <reason>`).
3. Kör **hela kedjan** med `--limit N` — inga hoppade steg.
4. Läser ur A-stegloggen hur många källor som faktiskt kördes.
5. Mäter `events_public` före/efter per källa och kontrollerar routing-skäl.

## Gotchas

- **A-gatens urval är ordnat preA → api-adapter → rss → never_run.** En ny
  discovery-källa är `never_run` och hamnar alltså sist — med `--limit N` ensam
  skulle den klippas bort. Därför kös källorna in i preA-kön först.
- **preA-kön har prioritet per position** (först i kön = högst prioritet).
  Lämna den inte full med gamla poster — `runA.ts --status` visar vad som
  står där.
- **Kedjan får inte köra parallellt** med en nattlig körning. Gaten vägrar
  starta om `liveChainPids()` hittar en levande kedja.
- **"Inga events" är ett legitimt utfall** för en källa utan framtida event —
  så länge A-gaten registrerat ett routing-skäl. M5 skiljer på det och på
  "inget resultat alls" (rött).
- **Mini-ingestionen är inte en särskild extraction.** Samma
  `scripts/ingestion-cron.ts`, samma gates, samma filter. Enda skillnaden är
  `--limit N` och vad som står i preA-kön.
- **Promote:ade källor har ofta `city=NULL`** i UI-kön (det gäller kandidaten,
  inte källfilen). A-gatens filter gäller *källfilens* city — kontrollera den
  i `sources/<slug>.jsonl`.
