# C-htmlGate Batchmaker

## Syfte

Batchmaker väljer 10 diversifierade källor från `postB-preC` för manuell batchkörning i C-testriggen.

## Användning

```bash
npx tsx make-batch.ts
```

## Output

- `current-batch.jsonl` — de 10 valda källorna med diversifieringsdata och canonical URLs

## Diversifieringslogik

Batchmaker försöker skapa en **avsiktligt blandad batch** genom att diversifiera på:

| Dimension | Värden | Prioritet |
|-----------|--------|-----------|
| `errorBucket` | 0 (ingen), 1 (<10), 2 (<18), 3 (18+) | Högst |
| `has404s` | true / false | Medel |
| `consecutiveFailures` | 0, 1, 2 | Medel |
| `lastEventsFound` | 0 vs >0 | Medel |
| `lastPathUsed` | network / jsonld | Låg |
| `triageResult` | html_candidate / still_unknown | Låg |

## Inputs

| Fil | Beskrivning |
|-----|-------------|
| `runtime/postB-preC-queue.jsonl` | Poolen — 342 HTML-kandidater |
| `runtime/sources_status.jsonl` | Statusposter för enrichment |
| `sources/{sourceId}.jsonl` | Canonical URL per source |

## URL-hantering

URL hämtas direkt från `sources/{sourceId}.jsonl` (`url`-fältet). Batchmakern gör **inte** uppslag i råa källor.

## Batchens sammansättning

- **10 källor** väljs med diversifieringsalgoritm
- Ingen hänsyn till domäntyp, storlek eller tidigare framgång
- Poolen i `postB-preC` är homogen på vissa dimensioner (alla har `failures=2`, `events=0`) — detta återspeglar verkligheten

## Nästa steg enligt C-rebuild-plan

Den nya canonical runnern `run-dynamic-pool.ts` hanterar nu hela loopen:

1. Köra vald batch genom `C1 → C2 → C3`
2. Samla resultat i `reports/batch-N/`
3. Analysera fail-fall med C4-AI
4. Applicera generella förbättringar
5. Köra fail-mängden igen (round 2)

Batchmaker (make-batch.ts) används inte längre direkt — dess diversifieringslogik är inbäddad i `run-dynamic-pool.ts`.
