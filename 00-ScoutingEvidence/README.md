# 00-ScoutingEvidence

## Purpose

First-pass assessment tool for evaluating candidate event source URLs. Not full ingestion — just a clear verdict: is this source promising, and which path should it take next?

## Tool

**`scouting/sourceScout.ts`** — Main scouting entrypoint

```
npx tsx 00-ScoutingEvidence/scouting/sourceScout.ts <url>
npx tsx 00-ScoutingEvidence/scouting/sourceScout.ts --batch <urls.txt>
```

## Flow

1. **URL Sanity** — Can the URL be reached? Does it need normalization?
2. **JSON-LD** — Is there structured Event data?
3. **Network** — Are there open API signals? (if JSON-LD didn't succeed)
4. **HTML** — Does the page structure look event-like? (if Network didn't route elsewhere)
5. **Verdict** — Single unified `ScoutResult`

## Output

Every scout run produces:
- A `ScoutResult` object (status, recommended path, confidence, reasons)
- A `.md` candidate file saved to either:
  - `01-Sources/candidates/` (promising/maybe sources)
  - `01-Sources/scouted-not-suitable/` (rejected sources)

## Result format

```typescript
ScoutResult = {
  url: string;
  sourceName?: string;
  status: 'promising' | 'maybe' | 'not_suitable' | 'blocked' | 'bad_url' | 'manual_review';
  recommendedPath: 'jsonld' | 'network' | 'html' | 'render' | 'manual' | 'reject';
  confidence: number; // 0-1
  reasons: string[];
  evidence: {
    urlSanity?: UrlSanityEvidence;
    jsonLd?: JsonLdEvidence;
    network?: NetworkEvidence;
    html?: HtmlEvidence;
  };
  nextStep: string;
  timestamp: string;
}
```

## Reuses

- `01-Sources/diagnostics/jsonLdDiagnostic.ts` — JSON-LD first pass
- `02-Ingestion/B-JSON-feedGate/networkInspector.ts` — Network/API inspection
- `02-Ingestion/B-JSON-feedGate/A-networkGate.ts` — GotEvent model routing
- `02-Ingestion/C-htmlGate/C1-preHtmlGate/C1-preHtmlGate.ts` — HTML structure screening
- `02-Ingestion/tools/fetchTools.ts` — HTTP fetching

## Files

- `scouting/scoutResult.ts` — Shared result types
- `scouting/urlSanity.ts` — URL health check
- `scouting/sourceScout.ts` — Main entrypoint

## Notes

- Scout verdict is NOT full ingestion approval — it's a routing decision
- Promising sources still need Phase 1 (sanity) → Phase 2 (breadth) → Phase 3 (smoke)
- Candidate files use naming format: `ååmmdd-hh:mm-slug.md`
