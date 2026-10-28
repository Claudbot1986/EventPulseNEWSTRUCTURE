# Import-backlog — kön töms, och importen körs en gång

## Sub-features

- **`03-Queue/importLedger.mjs`** — fillivrig idempotens. Ledger
  `runtime/import-ledger.jsonl` med `{sourceId, fileMtime, fileHash, enqueued,
  at}`. En källa hoppas över om dess **innehållshash** är oförändrad sedan
  sist.
- **`03-Queue/importToEventPulse.ts`** — läser ledgern, hoppar över
  oförändrade källor, registrerar nya efter en lyckad import.
- **En importägare** — `scripts/ingestion-cron.ts` kl 02:00 importerar och
  dränerar i samma körning. Kl 04:00-vägen
  (`com.eventpulse.post-ingest` → `runPostIngest.sh` → `runDaily.ts` →
  `ingestionPipeline.ts`) körs med `EVENTPULSE_IMPORT_MODE=never`, som ger
  `--import=never`.
- **`03-Queue/drainQueue.ts`** — dränerar `bull:raw_events:wait` till
  Supabase. `--max-ms` är en hård gräns.

### Varför (2026-10-28)

Två fel, båda upptäckta i samma granskning:

1. **Importen hade två ägare.** Kl 02:00 (cron) och kl 04:00 (post-ingest)
   importerade båda. Samma events köades upp två gånger per natt, och det
   gick att se "grönt" i två loggar samtidigt.
2. **5436 jobb låg fast i kön** sedan 25 okt 03:00Z. Senaste skrivning till
   `events` var 2026-10-25T03:11Z — tre dygn utan nytt.

### Varför innehållshash och inte mtime

Planen sa "`fileMtime`". Det räckte inte: `runA` och `runA-extract` skriver
sina filer med `writeFileSync` varje natt, **oavsett om innehållet ändrats**.
En mtime-baserad ledger skulle aldrig hoppa över något — varken mellan de två
cron-vägarna eller mellan körningar. Hashen på innehållet är det som
faktiskt betyder "oförändrad".

### Två faser, och vad som är ett bevis (2026-10-28, femte rundan)

En rad i ledgern är `queued` när importören köat jobben (de ligger bara i
Redis) och blir `persisted` först när **dräneringen** skrivit dem till
databasen. Bara `persisted` och `empty` hoppas över.

Beviset räknas **per FIL**, inte per kanonisk källa:

| Fält | Betydelse |
|---|---|
| `jobs` | Antal DISTINKTA jobb just den här filen lade in. Det är radens **krav**. |
| `state` | `queued` → jobben ligger i Redis. `persisted` → bevis finns. `empty` → filen lade in 0 jobb. `failed` → importen var inte komplett. |
| `import_file` | Jobbets payload bär vilken fil den kom från. Den är nyckeln i dräneringens räknare. |

Reglerna:

| Regel | Varför |
|---|---|
| Varje rad jämförs mot **sin egen** räknare | Aldrig mot en summa, aldrig mot en annan rad. Två filer kan ge samma kanoniska källa (`berwaldhallen` + `berwaldhallen-tixly`); med en gemensam summa kunde fil A:s bevis täcka fil B:s krav → B hoppades över nästa natt → B:s events försvann |
| En gammal `queued`-rad får **inte** låsa en annan källa | Med summa-regeln höjde den kravsumman för evigt, så källan kunde aldrig flippa igen |
| En rad **utan** `jobs` flippar aldrig | Äldre ledger har inget krav → inget bevis → den importeras om en gång |
| En `failed`-rad flippar aldrig | Importen var inte komplett — ett event kanske aldrig sparades |
| `empty` = filen lade in **0** jobb | Inget att bevisa och inget att importera om. (Ändras filens innehåll ändras hashen, och då importeras den igen.) |

Följden av reglerna är att beviset är **konservativt**: hellre att importera
om en källa (dyrt, men inget förloras) än att hoppa över en som inte kom in.

**Lita inte på att "kön var tom" betyder "jobbena finns i databasen"** — kontrollera
`state` i ledgerfilen:

```bash
jq -r '.state' runtime/import-ledger.jsonl | sort | uniq -c
# → 184 "persisted"  = allt hanterat
# → N "queued"       = de källorna importeras om nästa natt (och det ska de)
# → N "empty"        = filen lade inte in något jobb (inget att importera om)
# → N "failed"       = importen misslyckades, importeras om
```

### Mätbart resultat (2026-10-28)

| Mätning | Före | Efter |
|---|---|---|
| `bull:raw_events:wait` | 5 446 | 0 (dränerad) |
| Import körning 1 | — | "KLAR │ 9 events till bullmq │ 0 errors", 3 källor i ledgern |
| Import körning 2 (samma data) | — | "KLAR │ 0 events till bullmq", alla 3 "redan importerad (oförändrad)" |

## How to get to it (user POV)

"Det finns 5000 evenemang i systemet som aldrig kom fram till appen."

Nu dräneras kön med den riktiga vägen — ingenting kastas bort — och samma
körning två gånger i rad importerar inte samma sak igen.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. Hur stor är kön?
redis-cli LLEN bull:raw_events:wait

# 2. Dränera med den riktiga vägen (bild-pipeline avstängd — den startar
#    annars en image-worker med känd hängning)
AI_IMAGE_PIPELINE_ENABLED=0 npx tsx 03-Queue/drainQueue.ts --max-ms 3600000 --concurrency 20

# 3. Import + dränering via kedjans egna steg
npx tsx scripts/ingestion-cron.ts --only import-to-eventpulse,worker-drain --limit 50

# 4. Idempotens: kör importen igen med samma data
npx tsx scripts/ingestion-cron.ts --only import-to-eventpulse --limit 5
# → "redan importerad (oförändrad) — hoppar över"

# 5. Vad står i ledgern?
cat runtime/import-ledger.jsonl | tail -3
# → {"sourceId":"3arena","fileMtime":...,"fileHash":"f7d3b934…","enqueued":8,"at":"..."}
```

**Ledger-radens `fileHash` är en sha256 över filnamn + innehåll** för alla
extraherade filer för en källa, sorterade på filnamn. Två körningar med
samma innehåll ger samma hash → hoppas över.

## Gotchas

**`AI_IMAGE_PIPELINE_ENABLED=0` under normaliseringen.** Annars startar
image-workern, som har en känd hängning. Det är den enda inställningen som
gör drainen säker.

**Kön växer under importen.** `import-to-eventpulse` köar jobb; workern
dränerar dem. Mät ködjupet EFTER att båda stegen är klara — annars mäter
du en halvfärdig import.

**`--limit` gäller per steg.** `--only import-to-eventpulse,worker-drain
--limit 50` importerar 50 källor och dränerar i 90 min.

**Ledger-filen växer för evigt.** Varje importerad källa + hash läggs in.
Den är append-only och liten (några rader per natt). Rör den inte manuellt —
en felaktig hash i filen gör att källan hoppas över nästa natt.

**Två importägare är ett tecken på att något går fel.** Om både kl 02:00
och kl 04:00 importerar, är `EVENTPULSE_IMPORT_MODE=never` inte satt i
`scripts/cron/runPostIngest.sh`.

**A/B körs FORTFARande i 04:00-vägen.** Det är medvetet: `runA.ts` fyller
`preUI-queue.jsonl` som `runA-extract.ts` dränerar. Hoppa över A/B skulle
svälta den flödet. Bara importen har en ägare.
