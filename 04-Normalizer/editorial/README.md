# Editorial Description Engine

EventPulse Editorial Engine — AI-baserad generering av redaktionella beskrivningar för events där source description inte får användas direkt (copyright, scrape-skydd).

## Pipeline (6 steg)

```
source description (BARA för oberoende-kontroll)
        ↓
   eventUnderstanding.ts → EventProfile (semantisk extraktion UTAN source-text)
        ↓
   textualFirewall.ts → WriterSafeInputs (brandväggen strippar source)
        ↓
   editorialWriter.ts → EditorialDraft (LLM-anrop med bara Profile + EventPulse-data)
        ↓
   factualityCheck.ts → FactualityResult (claims stödda av Profile?)
        ↓
   independenceCheck.ts → IndependenceResult (draft skiljer sig från source?)
        ↓
   index.ts → orchestrator (regenerera vid fail, max 2 försök)
```

## Garantier

1. **Writer får ALDRIG source description, html_source, scraped_copy, original_title, raw_description** — textualFirewall.ts kastar om dessa smyger in.
2. **Profile byggs UTAN source-text** — bara strukturerade fält (category_slug, venue, datum, pris, performers från artistResolver). Inga påhitt.
3. **Factuality + independence är POST-write filter** — regenerering möjlig om något misslyckas.

## Filer

| Fil | Roll |
|---|---|
| `types.ts` | TypeScript-typer (EventProfile, WriterSafeInputs, EditorialDraft, Factuality/Independence-result) |
| `eventUnderstanding.ts` | Semantisk extraktion, 23 v3-kategorier |
| `textualFirewall.ts` | Runtime-brandvägg + STYLE_GUIDE |
| `editorialWriter.ts` | LLM-anrop (OpenAI primär, mock för tester) |
| `factualityCheck.ts` | Deterministisk claim-verifiering |
| `independenceCheck.ts` | Jaccard-likhet + fras-match mot source |
| `index.ts` | Pipeline-orchestrator |
| `normalizerIntegration.ts` | Koppling in i normalizer (opt-in via EDITORIAL_ENABLED=1) |
| `metrics.ts` | JSONL-loggning av pipeline-resultat |

## Aktivering

Sätt env-flagga:
```bash
EDITORIAL_ENABLED=1
```

Övriga env som krävs:
- `OPENAI_API_KEY` (om ej satt → använder mock-LLM)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (för DB-skrivning)

## DB-schema

Migration `05-Supabase/migrations/20261007-0001-editorial-description-engine.sql`:
- `events.event_profile JSONB`
- `events.editorial_description TEXT`
- `events.editorial_description_generated_at TIMESTAMPTZ`
- `events.editorial_info_level TEXT` (CHECK: RICH/MEDIUM/LOW/VERY_LOW)
- `events.editorial_model TEXT`
- `events.editorial_prompt_version TEXT`

## Tester

61 tester i 9 filer:
- 3 types
- 11 eventUnderstanding
- 9 textualFirewall
- 4 editorialWriter
- 8 factualityCheck
- 5 independenceCheck
- 7 index
- 8 regression
- 6 eventTypes

Kör: `npx vitest run 04-Normalizer/editorial/`

## Definition of Done — 15 steg

- [x] P7-1: types.ts
- [x] P7-2: eventUnderstanding.ts
- [x] P7-3: textualFirewall.ts
- [x] P7-4: editorialWriter.ts
- [x] P7-5: factualityCheck.ts
- [x] P7-6: independenceCheck.ts
- [x] P7-7: index.ts (orchestrator)
- [x] P7-8: DB-migration
- [x] P7-9: normalizer integration (opt-in)
- [x] P7-10: 6 event-typer end-to-end
- [x] P7-11: 8 regressionstester
- [x] P7-12: metrics.ts
- [x] P7-13: README.md (denna fil)
- [ ] P7-14: vault-sync (kör vid behov)
- [ ] P7-15: before/after metrics (kör när EDITORIAL_ENABLED varit på ett tag)