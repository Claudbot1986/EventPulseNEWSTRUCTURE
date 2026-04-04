# C2-htmlGate

Main HTML extraction using DOM heuristics. Applies CSS selector patterns, microdata extraction, and common DOM structure analysis to extract event data from rendered HTML.

## Extraction Techniques

- **CSS selectors** — targeting common event card patterns (`.event-card`, `[data-event]`, `.listing-item`)
- **Microdata/schema.org** — `itemtype="Event"` patterns in HTML
- **Common DOM structures** — date tables, venue blocks, ticket price spans
- **Text pattern matching** — regex for dates, times, addresses within text nodes

## Position in Pipeline

```
Page HTML → B-networkGate → [no API] → C1-preHtmlGate → C2-htmlGate → D-renderGate (if needed)
```

## Version

C-htmlGate v2.2 — precision calibration with weighted scoring and noise reduction.

## Current Status

**Active development.** This is the core extraction engine for non-API sources. Accuracy varies significantly by source page structure. The v2.2 weighted scoring improved precision but some false positives on blog/news pages remain a known issue.
