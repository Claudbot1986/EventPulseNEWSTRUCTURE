# pattern-promoter (DORMANT, 2026-10-21)

`02-Ingestion/C-htmlGate/runC-pattern-promoter.ts` — kvar på disk, **inte längre i cron-kedjan**.

## Status

**Borttagen ur cron 2026-10-21.** Steget och dess syskon `manual-review-triage` (som körde samma script i dry-run-läge) togs bort från `scripts/ingestion-cron.ts` eftersom hela kedjan var bruten:

1. `runC-pattern-promoter.ts` läser `02-Ingestion/C-htmlGate/reports/pattern-validation/validation-*.json` (rad 28).
2. Mappen produceras av `runC-pattern-validator.ts`, som aldrig skrivits — varken på disk eller i git-historik.
3. Utan input är promotorn en no-op: avslutar direkt (rad 182) på `<1000ms`.

Att köra steget i produktion var alltså *inte ofarligt* — det var aktivt skadligt (se Gotchas nedan). Aktivering kräver ett separat validator-bygge, **inte** en cron-flagga.

## Sub-features (om någon i framtiden återaktiverar)

- Läser `reports/pattern-validation/validation-*.json` (output från en framtida `runC-pattern-validator.ts`)
- För varje `status: 'confirmed'` pattern:
  - Append till `C0-htmlFrontierDiscovery.ts` → `SWEDISH_EVENT_PATTERNS`
  - Append till `C2-htmlGate.ts` → `eventUrlSegments`
  - Append till `reports/pattern-promotions.jsonl`
- `--dry-run` rapporterar utan att skriva
- Respekterar Generalization Protection Rule: bara `confirmed` (verifierat på ≥2 unrelated domains)

## How to get to it (user POV)

I dagsläget: användaren ser inte steget alls — det syns inte i dashboard, inte i status.json. Tidigare syntes det som "två korta steg utan effekt".

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. Bekräfta att steget INTE ligger i cron längre
grep -n "manual-review-triage\|pattern-promoter" scripts/ingestion-cron.ts | grep -v "^[[:space:]]*//"
# → förväntat: ingen träff

# 2. Finns scriptet kvar på disk?
ls -l 02-Ingestion/C-htmlGate/runC-pattern-promoter.ts
# → ja, användbart först om validator byggs

# 3. Finns validation-input?
ls 02-Ingestion/C-htmlGate/reports/pattern-validation/ 2>/dev/null
# → tomt (eller "No such file") förväntat

# 4. Har någon pattern någonsin promotats?
test -f 02-Ingestion/C-htmlGate/reports/pattern-promotions.jsonl \
  && wc -l 02-Ingestion/C-htmlGate/reports/pattern-promotions.jsonl \
  || echo "(filen finns inte — inga patterns har någonsin promotats)"
```

Bevis: `grep`-träff (förväntat 0) + mappstatus.

## Gotchas

**Varför "bara ta bort ur cron" och inte "skriv validator"?** Aktivt skadligt utan validator. `runC-pattern-promoter.ts:promoteToC0/C2` (rad 84/120) skriver URL-mönster in i C-lagret. CLAUDE.md:s Generalization Protection Rule kräver bevis på 2–3 orelaterade domäner innan ett mönster får generaliseras. Utan validator har promotorn inget sätt att veta vilka mönster som faktiskt är bevisade, och kan bara arbeta med skenbart bevisade sådana. Att tyst tolerera det (genom att låta steget köra som no-op) ger en falsk bild av att validering pågår.

**Append-only till C0/C2** — körs validator + promoter i framtiden kan flera körningar skapa dubbletter om pattern redan finns. Manuell städning krävs.

**Saknas `VALIDATION_DIR` (första körning)** → scriptet returnerar `null` istället för att krascha (rad 53-60). Både smoke + skarpt kan köra även utan valideringsrapporter.

**Generalization Protection Rule:** pattern måste vara verifierat på ≥2 unrelated domains. `insufficient-data` och `rejected` skip:as automatiskt.
