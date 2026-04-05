# Source Verification Status — Facit

**Senast uppdaterad:** 2026-04-05

## Tre separata data-nivåer

| Evidens | Betydelse | Exakt tolkning |
|---------|------------|----------------|
| `sources/*.jsonl` | Source definitions | Katalog med potentiella källor. `preferredPath: unknown` = import-default, INTE "aldrig testad" |
| `runtime/sources_status.jsonl` | Runtime status | Körda ELLER importerade. Varje rad = en triage-körning, EJ fullständig test av alla paths |
| `status: "success"` med `eventsFound > 0` | VERKLIGT verifierad | Endast dessa bevisar framgång |

## Vanliga fel

| Fel | Korrekt |
|-----|---------|
| "420 status-rader = 420 fullständigt testade" | NEJ — varje rad betyder triage körts, inte alla paths testats |
| "`preferredPath: unknown` = aldrig körd" | NEJ — betyder path ej bestämd vid import |
| "sources/ har 420 filer = 420 testade" | NEJ — sources/ är definitions, inte testresultat |
| "status: fail = har testats och misslyckats" | EJ NÖDVÄNDIGT — kan vara infra-fail (DNS, timeout) |
| "C1=säger html_candidate = C är bevisat" | NEJ — C1 är pre-check, extraktion kan ge 0 events |

## Korrekt analys-format

```
Sources-filer (sources/):           X poster
Status-rader (sources_status.jsonl): Y poster
其中 `success`:                  Z poster (verkligt verifierade)
其中 `preferredPath: unknown`:    W poster (import-default, ospecificerat)
```

## preferredPath-tolkning

| Värde | Tolkning | Verifiering krävs |
|--------|----------|-------------------|
| `unknown` | Path ej bestämd vid import | JA — testa alla paths |
| `jsonld` | JSON-LD path bekräftad | NEJ — redan verifierad |
| `network` | Network path bekräftad | NEJ — redan verifierad |
| `html` | HTML path med events > 0 | NEJ — bevis finns |
| `render` | Render path (PENDING) | PENDING — ej integrerat |

## methodCandidate vs. verificationStatus

| Fält | Möjliga värden | Betydelse |
|------|----------------|-----------|
| `methodCandidate` | `jsonld`, `network`, `html`, `render`, `unknown` | Vad systemet TROR kan fungera baserat på initial screening |
| `verificationStatus` | `untested`, `tested_no_events`, `tested_with_events`, `blocked` | Vad som faktiskt HAR VERIFIERATS genom körning |
| `checkedSubpages` | `["/events", "/kalender"]` | Vilka subpages som testats för A+B |

## Fem metodkategorier: Kandidat vs. Verifierad

### A — JSON-LD
- **Verifierad A:** Riktig schema.org/Event i `<script type="application/ld+json">`
- **A-kandidat:** Sajten HAR script-taggar men vi har inte testat om de innehåller events

### B — Network/API
- **Verifierad B:** Intern API/XHR hittad OCH returnerar structured event data OCH är stabil
- **B-kandidat:** Nätverksförfrågningar observerade, men vi har inte bekräftat att de ger events

### C — HTML
- **Verifierad C:** HTML-extraktion har bevisat sig ge events > 0
- **C-kandidat:** Sajten har `<main>`/HTML-struktur men extraktion är inte verifierad

### D — Render (PENDING)
- **D-pending:** Misstanke om JS-rendering baserat på weak/no-main i C1
- **D-integrerad:** EJ ännu — D-renderGate är inte integrerat i pipeline

### E — Manual
- **E-verklig:** Alla A→B→C→D testade och misslyckade, mänsklig granskning krävs
