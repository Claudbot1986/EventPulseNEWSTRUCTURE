# C-Kandidat-Kö: Användarguide

**Skapad:** 2026-04-05  
**Status:** C-kandidat = KÖ för HTML-testning, INTE verifierad slutklassning

---

## Vad är C-Kandidat-Kön?

C-Kandidat-Kön är en strukturerad kö av ~368 källor som ska testas systematisk med HTML-metoden (C0→C1→C2→extractFromHtml).

**Viktigt:** En källa i denna kö betyder INTE att den "är C" eller att HTML-metoden fungerar. Det betyder att källan är en lämplig kandidat för testning.

---

## Exkluderade från C-Kön

Dessa källor är redan hanterade och ska INTE testas igenom C:

| Kategori | Antal | Källa |
|----------|-------|-------|
| A-verifierad | 2 | berwaldhallen (network), svenska-schackf-rbundet (jsonld) |
| C-verifierad | 19 | konserthuset, malmo-opera, avicii-arena, etc. |
| B-verifierad | 1 | kungliga-musikhogskolan (/api/events) |
| B-pending | 2 | ticketmaster, eventbrite (API-nyckel saknas) |
| B-kandidat begränsad | 1 | svenska-fotbollf-rbundet (livescore ≠ kalender) |
| D-pending | 5 | debaser, cirkus, arkdes, akersberga, bor-s-zoo-animagic |
| E-manual | 3 | bokmassan, smalandsposten, stenungsund |
| Ej collectable | 3 | kumla, uppsala-kommun, ystad |
| TRIAGE_REQUIRED A/B-testade | 13 | (alla 13 testade, varav 8=C, 1=B, 1=B-limited, 3=ej collectable) |
| HTML-failed | 4 | vasamuseet, scandinavium, folkoperan, astronomiska-huddinge |
| B-failed | 3 | kulturhuset, fryshuset, gso |

---

## C-Köns struktur

### Filer

| Fil | Innehåll |
|-----|-----------|
| `C-candidates-queue.jsonl` | Masterkö med alla 368 kandidater |
| `C-candidates-queue.md` | Läsbar Markdown-version av masterkön |
| `C-candidates-batches-meta.jsonl` | Metadata för alla 37 batchar |
| `C-candidates-batch-001.jsonl` | Batch 1 (källa 1-10) |
| `C-candidates-batch-002.jsonl` | Batch 2 (källa 11-20) |
| ... | ... |
| `C-candidates-batch-037.jsonl` | Batch 37 (källa 361-368) |

### Batch-indelning

- **37 batchar** totalt
- **10 källor per batch** (sista har 8)
- **368 källor totalt**

### Metadatafält per källa

```json
{
  "id": "musikforetaget",
  "url": "https://www.musikforetaget.se",
  "name": "Musikföretaget",
  "type": "musik",
  "city": "Stockholm",
  "preferredPath": "unknown",
  "verificationStatus": "untested",
  "methodCandidate": "html",
  "batch": 12,
  "batchStatus": "pending|testing|completed|failed",
  "lastTested": "2026-04-05T12:00:00Z",
  "eventsFound": 0,
  "notes": "",
  "grouping": {
    "siteFamily": null,
    "likelyCms": null,
    "contentPatternGuess": null,
    "likelyEventPresentation": null,
    "likelyJsShell": null,
    "candidateDifficulty": null,
    "needsSubpageDiscovery": null
  }
}
```

### Grupperingsfält (pre-C-entry)

**Viktigt:** Gruppering ska ske INNAN en källa väljs in i en C-batch, inte efter. Detta möjliggör smart batchurval baserat på liknande källtyper.

#### Fältbeskrivning

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `siteFamily` | string? | huvudkategori: kommunal, museum, universitet, idrott, teater, etc. |
| `likelyCms` | string? | upptäckt CMS: sharepoint, wordpress, custom-js, sitevision, unknown |
| `contentPatternGuess` | string? | sidstruktur: root-event-page, subpage-event-calendar, article-list, etc. |
| `likelyEventPresentation` | string? | eventvisning: time-tag-list, card-grid, agenda-list, calendar-widget |
| `likelyJsShell` | string? | js-risk: none, possible, likely, verified |
| `candidateDifficulty` | string? | svårighet: easy, medium, hard, unknown |
| `needsSubpageDiscovery` | boolean? | behöver undersöka undersidor: true, false, unclear |

#### Varför pre-C-gruppering?

- **Smarta batchar:** Batchar grupperas efter liknande siteFamily eller contentPattern
- **Homogena batcher:** Max 2 siteFamily per batch för effektivt lärande
- **Tidig riskbedömning:** likelyJsShell och candidateDifficulty identifieras före batchval

### Batch-status

| Status | Betydelse |
|--------|-----------|
| `pending` | Ej testad ännu |
| `testing` | Testas just nu |
| `completed` | Testad, extraction försökt |
| `failed` | Kunde inte testas (infra, timeout, etc.) |

---

## Hur man använder C-Kön i 123-loopar

### Steg 1: Välj nästa batch

```bash
# Ta nästa pending batch
cat 02-Ingestion/C-candidates-batches-meta.jsonl | grep '"status": "pending"' | head -1
```

### Steg 2: Kör 123 på batchen

För varje källa i batchen:
1. Kör C0 (density check)
2. Kör C1 (preHtmlGate)
3. Om C1 = html_candidate/strong: kör C2
4. Kör extractFromHtml()
5. Dokumentera eventsFound
6. Uppdatera entry i `C-candidates-batch-XXX.jsonl`

### Steg 3: Uppdatera batch-status

När batchen är klar:
1. Sätt `batchStatus` = `completed` i meta-filen
2. Sätt `verificationStatus` = `tested_no_events` eller `tested_with_events`
3. Sätt `lastTested` = ISO timestamp

### Steg 4: Nästa batch

Upprepa tills alla batchar är klara.

---

## Kategori-fördelning i C-Kön

| Kategori | Antal | Exempel |
|----------|-------|---------|
| museum | 55 | biologiska, tekniska, regionala |
| idrott | 46 | sportföreningar, idrottsplatser |
| nattliv | 35 | nattklubbar, barer |
| teater | 34 | regionala teatrar |
| festival | 29 | kulturfestivaler, musikfestivaler |
| kommunal | 27 | kommunala evenemangs-sajter |
| konserthus | 23 | konserthus, musikscener |
| arena | 19 | sportarenor, multiarenor |
| scen | 18 | scener, kulturhus |
| turism | 14 | turistbyråer, besökscentra |
| sport | 12 | idrottsförbund |
| park | 11 | nöjesparker, djurparker |
| akademi | 10 | högskolor, folkhögskolor |
| mässa | 8 | mäss- och konferensanläggningar |
| universitet | 8 | universitet |
| förening | 6 | föreningar |
| media | 6 | tidningar, radio |
| kulturhus | 5 | kulturhus |
| mat | 4 | matfestivaler |
| eventportal | 4 | evenemangsportaler |
| nöje | 4 | nöjesanläggningar |
| opera | 3 | operahus |
| familj | 2 | familjeevenemang |
| musik | 2 | musikställen |
| aggregator | 1 | aggregatorsajter |
| underhållning | 1 | underhållning |

---

## Bevisstandard för C-Kandidat

### C-kandidat (methodCandidate=html)
- preferredPath = unknown ELLER preferredPath = html
- verificationStatus = untested
- Inga kända A eller B paths

### C-verifierad (VERKLIGT)
- extractFromHtml() returnerade eventsFound > 0
- preferredPath uppdateras till "html"
- verificationStatus = tested_with_events

### Ej C
- A eller B path fungerar (→ A-verifierad eller B-verifierad)
- D-renderGate behövs (→ D-pending)
- Alla paths testade och misslyckade (→ E-manual)

---

## Nästa steg

1. **Batch 1-5:** Kör C0→C1 på första 50 källor
2. **Analysera C1-resultat:** Vilka får html_candidate/strong?
3. **Batch C2:** Kör C2 på de som fick html_candidate
4. **Extract:** Kör extractFromHtml() på C2-positive
5. **Model Improvement:** Identifiera mönster från C1/C2-resultat

---

## Regler för C-Köhantering

1. ** röra inte verified sources** — de är redan klara
2. **Dokumentera ALLTID** eventsFound efter varje test
3. **Säg ifrån** om en källa verkar vara B eller A, inte C
4. **Markera D-pending** korrekt, kör inte D-renderGate
5. **Håll isär** methodCandidate (vad vi tror) och verificationStatus (vad som bevisades)

---

## Arkitektonisk separation: Pre-C vs Post-C

### Pre-C: Gruppering i C-candidates-queue

Grupperingsfält i `C-candidates-queue.jsonl` fylls i av `phase1ToQueue.ts` **innan** en källa väljs in i en batch. Detta möjliggör:

- Smart batchurval baserat på siteFamily, likelyCms, contentPatternGuess
- Homogena batchar med ≤2 siteFamily för effektivt lärande
- Tidig riskbedömning (likelyJsShell, candidateDifficulty)

### Post-C: Batchkörning och rapportering

När en batch väl körs:
- `batch-state.jsonl` innehåller **köra metadata** (cyclesCompleted, plateauDecision, etc.)
- `batch-XXX/sources/*.md` innehåller **per-källa resultat**
- Rapporter beskriver resultat, INTE gruppering

### Vad som SKA vara var

| Aktivitet | Plats | Tid |
|-----------|-------|-----|
| Gruppering (siteFamily, likelyCms, etc.) | `C-candidates-queue.jsonl` | Pre-batch |
| Batch-val (vilka källor körs ihop) | `batch-state.jsonl` | Vid batchstart |
| Per-cykel mätning (eventsDelta, etc.) | `batch-state.jsonl` | Post-varje-cykel |
| Per-källa resultat | `batch-XXX/sources/*.md` | Post-varje-källa |
| Mönsterlärande | `improvements-bank.jsonl` | Post-batch |
