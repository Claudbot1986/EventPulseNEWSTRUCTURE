# P7 Editorial Engine — metrics methodology

> Skapad 2026-10-08 efter LLM-byte OpenAI→MiniMax-M3 (`4ffb06f`).
> Ägs av Editorial Description Engine (P7-milstolpe i MASTERPLAN).
> Confidence: methodology = [VERIFIED]; actual metrics = [UNVERIFIED] (körs ej ännu).

## Insamling

`04-Normalizer/editorial/metrics.ts` skriver **en JSONL-rad per pipeline-körning** till `runtime/editorial-metrics.jsonl`. Append-only, non-critical (skrivfel kraschar aldrig normalizern).

Fält:

| Fält | Typ | Källa |
|---|---|---|
| `ts` | ISO timestamp | `new Date().toISOString()` |
| `event_id` | UUID \| null | från events-tabellen |
| `status` | `'passed' \| 'failed' \| 'regenerating'` | pipeline-result |
| `info_level` | `RICH \| MEDIUM \| LOW \| VERY_LOW \| null` | från Profile |
| `attempts` | number (0 för PASS på första försök) | pipeline-result |
| `word_count` | number | LLM-output |
| `model` | string (t.ex. `MiniMax-M3`) | från LLM-klient |
| `factuality_pass` | boolean \| null | factuality check |
| `independence_pass` | boolean \| null | independence check |
| `unsupported_claims_count` | number | factuality check |
| `matched_phrases_count` | number | independence check |
| `source` | string \| null | normalizer source-id |
| `category_slug` | string \| null | normalizer category |

## Baseline kräver

1. `EDITORIAL_ENABLED=1` i miljövariabler (root `.env` eller cron).
2. Normalizer kör mot prod-events i minst 24h (eller mot ett batch-replay på `runtime/` fixtures).
3. `runtime/editorial-metrics.jsonl` har då >100 rader att aggregera.

## Förväntade buckets (MiniMax-M3)

| Metric | Förväntad intervall | Åtgärd vid |
|---|---|---|
| PASS rate (första försök) | ≥ 70 % | < 50 % → granska prompts |
| Snitt attempts | ≤ 1.3 | > 1.5 → factuality-tröskel för hård |
| Factuality-fail rate | ≤ 15 % | > 25 % → utöka STYLISTIC_ADJECTIVES eller GENERIC_NOUNS |
| Independence-fail rate | ≤ 10 % | > 20 % → höj tröskeln eller stärk prompts |
| Median word_count | 25–45 ord | < 15 → profil för tunn för att skriva |
| Median latency | okänt (MiniMax ej benchmarkad lokalt) | > 5s → överväg cache |

## Vad kan INTE jämföras modell-mot-modell

- **OpenAI baseline**: OpenAI-nyckeln är fortfarande aktiv (Flux image gen använder den) men EDITORIAL_ENABLED var aldrig påslagen med OpenAI-backenden. Noll prod-rader från OpenAI = ingen modell-mot-modell-jämförelse möjlig.
- **MiniMax-M3 i prod**: Första kalkylen blir absoluta tröskelvärden, inte relativ jämförelse.
- **MiniMax-M3 kontra MiniMax-M2.7** (den modell som `.scratch/minimax-sample-community.mjs` använde): endast observations-skattning möjlig via kategoriserings-körningarna från 2026-09-23. Förväntan är att M3 har bättre resonemang men högre latens.

## Aggregeringsskript (att skriva vid behov)

```bash
# Total pass rate
jq -s 'map(select(.status=="passed")) | length' runtime/editorial-metrics.jsonl
# Avg attempts
jq -s 'map(.attempts) | add/length' runtime/editorial-metrics.jsonl
# Factuality fail rate
jq -s 'map(select(.factuality_pass==false)) | length' runtime/editorial-metrics.jsonl
```

## När baseline finns

1. Kör aggregat på `runtime/editorial-metrics.jsonl` (eller en exporterad CSV).
2. Skriv sammanfattning till `docs/operations/p7-editorial-baseline-<datum>.md`.
3. Länka in i `01-Current-State.proposed.md` som [VERIFIED] data point.
4. Återstående P7-arbete: inget — DoD 15/15 klar.

## Confidence markers

- **[VERIFIED]** — detta dokument och dess fält-definitioner är på plats.
- **[CLAIMED]** — MiniMax-M3-förväntningarna bygger på kategori-classifier-observationer (andra task), inte description-generation.
- **[UNVERIFIED]** — alla faktiska mätvärden tills `EDITORIAL_ENABLED=1` körts mot prod.
