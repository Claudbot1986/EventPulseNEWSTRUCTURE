# Plan: Source URL Recovery Tool

## Problem

248 sources har misslyckats via `scb-diagnostic`. Fördelning:
- `postTestC-serverdown`: 156 sources (servern nere)
- `postTestC-404`: 35 sources (URL finns inte)
- `postTestC-error500`: 52 sources (okänt fel)
- `postTestC-timeout`: 4 sources
- `postTestC-blocked`: 1 source

Många är "server down" eller "404" — men det betyder inte att evenemangssidan är borta. Den kan ha flyttat till ny URL.

## Mål

För sources i `postTestC-serverdown` och `postTestC-404`:
1. Googla på domännamnet
2. Hitta rätt event-sida (om den finns)
3. Verifiera att nya URL:en är alive (200 OK)
4. Uppdatera källan i canonical source registry
5. Skriv korigerade sources till `postTestC-out`

## Verktyg: `scB-404-recovery.ts`

### Steg 1: Läs från rätt köer

Läser från:
- `runtime/postTestC-serverdown.jsonl`
- `runtime/postTestC-404.jsonl`

### Steg 2: Fråga MiniMax efter nya event-URL:er

Använd Ollama direkt med minimax-m2.7:cloud:

```bash
ollama launch claude --model minimax-m2.7:cloud -- --dangerously-skip-permissions
```

Prompt till modellen:
```
Given the domain "{domain}" which previously hosted events at {oldUrl}.
The page is now returning 404 or the server is down.

What is the most likely current URL for their events/calendar page?
Answer with only the URL, nothing else. If you don't know, say "UNKNOWN".
```

### Steg 3: Verifiera URL är alive

```typescript
const result = await fetch(newUrl, { method: 'HEAD', timeout: 10000 });
if (result.status === 200) → proceed
```

### Steg 4: Uppdatera sourceRegistry

Skriv till en `CORRECTIONS_FILE`:

```
source_id,old_url,new_url,verified,date
abb-arena,https://abb-arena.se/,https://abb-arena.se/evenemang,yes,2026-04-19
```

### Steg 5: Skriv till output-kö

Lägg korigerade sources till `runtime/postB-preC-queue.jsonl` (klar för ny ScB-körning).

## CLI

```bash
npx tsx 02-Ingestion/C-htmlGate/tools/scB-404-recovery.ts --batch
npx tsx 02-Ingestion/C-htmlGate/tools/scB-404-recovery.ts <sourceId>
```

## Output

- `runtime/logs/scB-404-recovery.log` — körningslogg
- `runtime/corrections.csv` — alla URL-korrigeringar
- `runtime/postB-preC-queue.jsonl` — korigerade sources (klar för ny ScB-körning)

## Verktyg i UI

| ID | Namn | Drain-fil |
|----|------|-----------|
| `scb-diag` | ScB diagnostic | — |
| `scb-404` | ScB 404-recovery | `postB-preC-queue.jsonl` |

## Queue-översikt

```
postTestC-man           → scb-diagnostic
  ├─ postTestC-serverdown (156) → scB-404-recovery
  ├─ postTestC-404 (35)         → scB-404-recovery
  ├─ postTestC-error500 (52)     → (annan åtgärd?)
  ├─ postTestC-timeout (4)       → (timeout = kanske borde köras igen?)
  └─ postTestC-blocked (1)      → (källa adapter?)

postB-preC-queue        ← scB-404-recovery (klar för omkörning med ScB)
```

## Todo

- [ ] Skriv verktyget `scB-404-recovery.ts`
- [ ] Testa på 3-5 sources först
- [ ] Verifiera att det inte skriver över fungerande URLs
- [ ] Rulla ut batch
