# C-Kandidat-Rapport: TRIAGE_REQUIRED A/B-Förprövning

**Genererad:** 2026-04-05  
** Källa:** `02-Ingestion/C-candidates-report.md` + subagent A/B-test  
** Grupp:** 13 källor från `triage_required`

---

## Översikt

Av 13 triage_required-källor:

| Preliminär klassning | Antal | Källa |
|---------------------|-------|-------|
| **B-verifierad** | 1 | kungliga-musikhogskolan |
| **B-kandidat (begränsad)** | 1 | svenska-fotbollf-rbundet |
| **C-kandidat** | 8 | (se nedan) |
| **Ej collectable** | 3 | (se nedan) |

**Ingen källa blev A-verifierad eller D-pending.**

---

## Detaljerade resultat

### B-VERIFIERAD (1)

| Källa | URL | A: JSON-LD | B: Network | Events | Path |
|-------|-----|-----------|-----------|--------|------|
| **kungliga-musikhogskolan** | kmh.se | NEJ | **JA** — `/api/events?version=2` | ~42 | B |

**Detaljer:** `/api/events?version=2` returnerar komplett JSON med konserter (uuid, title, lead, start, stop, image, genre, premise). Version=1 ger 400-fel.

---

### B-KANDIDAT — begränsad (1)

| Källa | URL | A: JSON-LD | B: Network | Events | Observation |
|-------|-----|-----------|-----------|--------|-------------|
| **svenska-fotbollf-rbundet** | svenskfotboll.se | NEJ | **JA** — `/api/livescore-ticker/?date=...` | Sportspecifikt | Livescore, inte kalender |

**Detaljer:** API returnerar matchdata (games array med lag, resultat, tider) — sportspecifikt, inte generiska events. Kräver custom adapter.

---

### C-KANDIDATER (8)

| Källa | URL | A: JSON-LD | B: Network | CMS/Tech | Observation |
|-------|-----|-----------|-----------|----------|-------------|
| **hallsberg** | hallsberg.se | NEJ | NEJ | SiteVision | Events som statisk HTML |
| **ifk-uppsala** | ifkuppsala.se | NEJ | NEJ | WordPress | WP REST finns men ingen event-endpoint |
| **karlskoga** | karlskoga.se | NEJ | NEJ | SiteVision | `/uppleva--gora/evenemang.html` finns (103KB) |
| **lulea-tekniska-universitet** | ltu.se | NEJ (bara BreadcrumbList) | NEJ | SiteVision | Statisk HTML på homepage |
| **naturhistoriska-riksmuseet** | nrm.se | NEJ | NEJ | SiteVision | Statisk HTML, `/vart-utbud/kalendarium/` |
| **orebro-sk** | orebrosk.se | NEJ | NEJ | WordPress | WP REST finns men ingen event-endpoint |
| **polismuseet** | polismuseet.se | NEJ | NEJ | Server-side rendering | Statisk HTML, `/besok-polismuseet/kalendarium/` |
| **stockholm-jazz-festival-1** | stockholmjazz.com | NEJ (bara BreadcrumbList) | NEJ | WordPress | WP REST finns men ingen event-endpoint |

**Gemensamt:** Ingen JSON-LD, ingen Network API. Alla behöver HTML-extraction (C).

---

### EJ COLLECTABLE (3)

| Källa | URL | A: JSON-LD | B: Network | Anledning |
|-------|-----|-----------|-----------|-----------|
| **kumla** | kumla.se | NEJ | NEJ | Events länkas externt till visitkumla.se (Wix) |
| **uppsala-kommun** | uppsala.se | NEJ | NEJ | ASP.NET/EPiServer utan event-API. `/api/kalender` = 404 |
| **ystad** | ystad.se | NEJ | NEJ | Events länkas externt till visitystadosterlen.se (Wix) |

**Anledning:** Dessa har inga egna events — de pekar på externa samlingssajter.

---

## Subpage-inspektion: Sammanfattning

| Källa | Root-testat | Subpage testat | Event-subpage hittad | A på subpage | B på subpage |
|-------|------------|---------------|---------------------|--------------|--------------|
| hallsberg | ✓ | ✓ | NEJ | — | — |
| ifk-uppsala | ✓ | ✓ | NEJ | — | — |
| karlskoga | ✓ | ✓ | JA (`/uppleva--gora/evenemang.html`) | NEJ | NEJ |
| kumla | ✓ | ✓ | NEJ (extern) | — | — |
| kungliga-musikhogskolan | ✓ | ✓ | NEJ | NEJ | **JA** |
| lulea-tekniska-universitet | ✓ | ✓ | NEJ | — | — |
| naturhistoriska-riksmuseet | ✓ | ✓ | JA (`/vart-utbud/kalendarium/`) | NEJ | NEJ |
| orebro-sk | ✓ | ✓ | NEJ | — | — |
| polismuseet | ✓ | ✓ | JA (`/besok-polismuseet/kalendarium/`) | NEJ | NEJ |
| stockholm-jazz-festival-1 | ✓ | ✓ | NEJ | — | — |
| svenska-fotbollf-rbundet | ✓ | ✓ | NEJ | — | — |
| uppsala-kommun | ✓ | ✓ | NEJ (extern) | — | — |
| ystad | ✓ | ✓ | NEJ (extern) | — | — |

---

## Preliminär slutlig klassning

| # | Källa | methodCandidate | verificationStatus | Slutsats |
|---|-------|----------------|-------------------|----------|
| 1 | kungliga-musikhogskolan | network | **B-verifierad** | B → `/api/events?version=2` fungerar |
| 2 | svenska-fotbollf-rbundet | network | B-kandidat | B → livescore-api begränsat, custom adapter krävs |
| 3 | hallsberg | html | C-kandidat | C → SiteVision, statisk HTML |
| 4 | ifk-uppsala | html | C-kandidat | C → WordPress utan event-endpoint |
| 5 | karlskoga | html | C-kandidat | C → SiteVision, `/evenemang.html` finns |
| 6 | lulea-tekniska-universitet | html | C-kandidat | C → SiteVision, statisk HTML |
| 7 | naturhistoriska-riksmuseet | html | C-kandidat | C → SiteVision, `/kalendarium/` statisk HTML |
| 8 | orebro-sk | html | C-kandidat | C → WordPress utan event-endpoint |
| 9 | polismuseet | html | C-kandidat | C → Server-side rendering, statisk HTML |
| 10 | stockholm-jazz-festival-1 | html | C-kandidat | C → WordPress utan event-endpoint |
| 11 | kumla | — | **ej collectable** | Extern källa (visitkumla.se) |
| 12 | uppsala-kommun | — | **ej collectable** | ASP.NET utan event-API |
| 13 | ystad | — | **ej collectable** | Extern källa (visitystadosterlen.se) |

---

## Förändring jämfört med original triage_required

| Kategori | Original | Efter A/B-test |
|----------|----------|----------------|
| B-verifierad | 0 | 1 (kungliga-musikhogskolan) |
| B-kandidat | 0 | 1 (svenska-fotbollf-rbundet) |
| C-kandidat | 13 | 8 |
| Ej collectable | 0 | 3 |

**Slutsats:** A/B-förprövning omklassificerade 5 av 13 källor. 1 blev B-verifierad, 1 blev B-kandidat (begränsad), 3 blev ej collectable.

---

## Nästa steg för C-kandidaterna (8)

De 8 C-kandidaterna behöver:
1. C0→C1 screening på event-subpage (där sådan finns)
2. C2-htmlGate test
3. extractFromHtml() körning

**Prioritering baserat på känd information:**

| Prioritet | Källa | Varför |
|-----------|-------|--------|
| 1 | karlskoga | `/uppleva--gora/evenemang.html` (103KB) — tydlig event-sida |
| 2 | polismuseet | `/besok-polismuseet/kalendarium/` — tydlig kalendarium-sida |
| 3 | naturhistoriska-riksmuseet | `/vart-utbud/kalendarium/` — tydlig kalendarium-sida |
| 4 | hallsberg | SiteVision, events på startsidan |
| 5 | ifk-uppsala | WordPress, event-sida bör finnas |
| 6 | lulea-tekniska-universitet | SiteVision, statisk HTML |
| 7 | orebro-sk | WordPress, event-sida bör finnas |
| 8 | stockholm-jazz-festival-1 | WordPress, event-sida bör finnas |

---

## Osäkerheter kvar

1. **C1-preHtmlGate har redan körts** på dessa 8 — de fick `html_candidate`. Men C1 kördes på rätt page? Vi testade root + event-subpages.
2. **Ingen C2 kördes** på event-subpages för de 8 — det återstår.
3. **svenska-fotbollf-rbundet** är tekniskt B men livescore ≠ kalender-events. Custom adapter krävs.
