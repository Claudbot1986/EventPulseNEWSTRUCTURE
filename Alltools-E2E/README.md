# Alltools-E2E

## Vad det är

Orkestrator för **verktyg 17/18** i `db.py`: kör **samma TypeScript-ingestion** som produktionen (A → B → C → D), **ingen** simulerad extraktion.

- **Ingång:** `--from-preA` — batch = översta N raderna i projektets `runtime/preA-queue.jsonl`.
- **Körning:** `npx tsx` mot  
  `runA.ts` → `runB-parallel.ts` → `runC-one-time-only.ts` → `runD-scrapingbee.ts`  
  med `cwd` = **projektrot** (där `02-Ingestion/` och `runtime/` ligger).
- **Batch-isolering:** innan B/C/D skrivs köfiler om så att aktuella batch-`sourceId` hamnar **först** i `preB`, `postB-preC`, `postTestC-D` (samma `limit`-semantik som verktygen).
- **Rapport:** `Alltools-E2E/runtime/reports/run-*.json` (mätt från köer + `03-extractedevents/` + `sources_status`).

## Plan & policy

- Integrationsplan: Obsidian `00-Inbox/E2E-Integration-Plan-Alltools-med-D.md`
- Ingen fejkdata: `CLAUDE.md` (Operator tools) + `.cursor/rules/no-simulated-production-ingestion.mdc`

## CLI

```bash
# Kräver --from-preA. Utan --apply: skriver endast torrkörningskommandon + rapport.
python3 Alltools-E2E/e2e.py --limit 10 --from-preA
python3 Alltools-E2E/e2e.py --limit 10 --apply --sync-legacy --from-preA
```

`--sync-legacy` är **no-op** (TS skriver redan till projektets `runtime/`).

## Moduler

- `e2e.py` — CLI
- `core/real_pipeline.py` — subprocess-kedja + kö-reordering
- `core/e2e_report.py` — rapport utan simulation
- `core/legacy_sync.py` — endast `audit_legacy_runtime` före `--apply` (inga dubletter i köer)
