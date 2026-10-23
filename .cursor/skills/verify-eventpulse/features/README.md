# verify-eventpulse/features — index

Feature-map för EventPulse-ingestion: de fem gaten (A/B/C/D/I), kökedjan
som binder ihop dem, workern som dränerar bullmq-kön, och
källstatusfilen som avgör vad som körs.

Skillen **kör** gaten (i `EVENTPULSE_SANDBOX_ROOT`) — till skillar
`verify-eventpulse-discovery` som bara läser launchd-artefakter.

| Feature | Fil | Entrypoint | Sandbox? |
|---|---|---|---|
| Gate A — direct API/JSON-LD | `gate-a-directapi.md` | `02-Ingestion/A-directAPI-networkGate/runA.ts` | ja |
| Gate B — JSON/network-feed | `gate-b-json-feed.md` | `02-Ingestion/B-JSON-feedGate/runB-parallel.ts` | ja (`runB.ts`: **nej**) |
| Gate C — htmlGate | `gate-c-html.md` | `02-Ingestion/C-htmlGate/run-dynamic-pool.ts` | ja |
| Gate D — renderGate (Scrapingbee) | `gate-d-render.md` | `02-Ingestion/D-renderGate/runD-scrapingbee.ts` | ja |
| Gate I — pdf-extrahering | `gate-i-pdf.md` | `02-Ingestion/I-pdfExtraction/pdfExtractor.ts` | **nej** |
| Kökedjan A→B→C→D→I | `queue-chain.md` | — | via respektive gate |
| Ködränering + workern | `worker-drain.md` | `03-Queue/startWorker.ts` | nej (Redis) |
| Källstatus + scope | `source-status.md` | `02-Ingestion/tools/sourceRegistry.ts` | ja |
| Orchestrator | `orchestrator.md` | `scripts/ingestion-cron.ts` | **nej** |

Varje feature-fil har fyra H2:er: `Sub-features`, `How to get to it (user POV)`,
`Driving it`, `Gotchas`.

## Kedjan i en rad

```
sources/*.jsonl ──A──▶ 03-Queue/03-extractedevents/*.jsonl  + postA-queue.jsonl
                   └──▶ preB-queue.jsonl          (fail / no-jsonld)
preB-queue ──B──▶ postB-queue.jsonl
                └──▶ postB-preC-queue.jsonl + preUI-queue.jsonl
postB-preC ──C──▶ postTestC-{UI,A,B,D,manual-review}.jsonl
postTestC-D ──D──▶ postD-UI.jsonl / postD-man*.jsonl
sources/*.jsonl ──I──▶ append till postTestC-UI.jsonl
bullmq raw_events ──workern──▶ 04-Normalizer
```

## Vad beviset är

Tre saker tillsammans: kommandot + exit, gateens egen summary-rad, och en
separat kontroll av filen/DB-raden den påstår sig skriva. En gate som
skriver `Events: 12` men lämnar `03-Queue/03-extractedevents/` tomt har inte
lyckats.

## Cross-refs

- Discovery-sidan (P3A–P3D som producerar `sources/*.jsonl`) ligger i
  `verify-eventpulse-discovery`. Handoff-färdigheten — att en promotead
  källa faktiskt passerar `isInScope()` och körs i A — verifieras i
  `verify-eventpulse-handoff` (räckas).
- Dashboard-läsningen av `runtime/ingestion-cron.status.json` på port 7777
  ligger i `verify-eventpulse-agent`.

**Senast uppdaterad (2026-10-23, create-pass):** 9 feature-filer + SKILL.md +
`doctor-ingestion.sh`, skrivna efter fix-setet som gjorde promoteade källor
nåbara för ingestion (migration `20261021-0003`, `city` genom hela kedjan,
slug-kollisionsfix i `sandbox.ts`, stale-reclaim i claim-RPC:n).