# C3-aiExtractGate

**⚠️ NAMNRÖRA-VARNING:** Se [C-status-matrix.md](../C-status-matrix.md) för förklaring av C0/C1/C2/C3/C4-AI-namnröran innan du läser denna fil.

`C3-aiExtractGate/` i nuvarande implementation matchar canonical **C4-AI** (AI-fallback), inte canonical C3. Namnet är vilseledande.

---

AI-augmented extraction step. Activated when C2 returns "promising" but `extractFromHtml()` finds 0 events.

## Position in Pipeline

```
Page HTML → A-directAPI-networkGate → B-JSON-feedGate → C1-preHtmlGate → C2-htmlGate → C3-aiExtractGate → D-renderGate
```

## Trigger Condition

C3 runs when:
- C2 verdict is "promising"
- `extractFromHtml()` returns 0 events
- OR C2 score is borderline and we want higher recall

## Responsibilities

1. **Semantic DOM Analysis** — AI understands page structure
2. **Event Scope Detection** — AI identifies where events live
3. **Field Extraction** — AI extracts title, date, time, venue, url, ticket_url
4. **Confidence Scoring** — AI rates extraction quality per field and overall

## What it does NOT do

- No browser rendering (D-renderGate handles JS)
- No feed discovery (B-JSON-feedGate handles that)
- No JSON-LD extraction (F-eventExtraction handles that)

## AI Strategy

C3 uses structured AI prompting to:

1. **Analyze page semantically**
   - "What type of page is this? (calendar, listing, article, etc.)"
   - "Where on the page are events displayed?"
   - "What HTML structure contains event information?"

2. **Identify event scopes**
   - Return ranked list of CSS selectors with event probability
   - Example: `ul.event-list li` (0.92), `div.card` (0.78), `article.event` (0.85)

3. **Extract events**
   - For each scope, extract structured event data
   - Use multi-pass: title → date → venue → url → ticket

4. **Return confidence**
   - Per-field confidence (title: 0.9, date: 0.85, etc.)
   - Overall extraction confidence
   - Reasoning for each extraction

## Output Schema

```typescript
interface AiExtractResult {
  success: boolean;
  events: AiExtractedEvent[];
  scopes: { selector: string; confidence: number }[];
  reasoning: string;
  fallbackToRender: boolean; // true if JS likely needed
}

interface AiExtractedEvent {
  title: string;
  date?: string;
  time?: string;
  venue?: string;
  url?: string;
  ticketUrl?: string;
  confidence: {
    overall: number;
    fields: Record<string, number>;
  };
}
```

## Model

Uses configured AI model (from environment). Default: configured in `@ai/aiConfig`.

## Fallback

If AI extraction fails:
- Return `fallbackToRender: true` if page likely needs JS
- Return `fallbackToRender: false` if no events found despite good scope

## Usage

```typescript
import { evaluateAiExtract } from './C3-aiExtractGate';

const result = await evaluateAiExtract(url, html, c2Result);
// result.success: boolean
// result.events: extracted events with confidence
// result.scopes: identified event-containing areas
// result.fallbackToRender: suggests D-renderGate if JS likely
```