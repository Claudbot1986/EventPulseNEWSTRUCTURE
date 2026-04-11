# C2-htmlGate

**⚠️ NAMNRÖRA-VARNING:** Se [C-status-matrix.md](../C-status-matrix.md) för förklaring av C0/C1/C2/C3/C4-AI-namnröran innan du läser denna fil.

`C2-htmlGate/` matchar canonical **C2** (Grov HTML-screening + routing-signal). Namnet är korrekt.

---

Main HTML extraction using DOM heuristics. Applies CSS selector patterns, microdata extraction, and common DOM structure analysis to extract event data from rendered HTML.

## Extraction Techniques

- **CSS selectors** — targeting common event card patterns (`.event-card`, `[data-event]`, `.listing-item`)
- **Microdata/schema.org** — `itemtype="Event"` patterns in HTML
- **Common DOM structures** — date tables, venue blocks, ticket price spans
- **Text pattern matching** — regex for dates, times, addresses within text nodes

## Position in Pipeline

```
Page HTML → A-directAPI-networkGate → B-JSON-feedGate → C1-preHtmlGate → C2-htmlGate → D-renderGate (if needed)
```

## Version

C-htmlGate v2.2 — precision calibration with weighted scoring and noise reduction.

## Current Status

**Active development.** This is the core extraction engine for non-API sources. Accuracy varies significantly by source page structure. The v2.2 weighted scoring improved precision but some false positives on blog/news pages remain a known issue.
