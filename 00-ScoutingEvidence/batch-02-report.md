# Batch 2 Grovscoutnings-rapport
## Datum: 2026-04-01 06:50
## Batch: Kommunala kalendrar och turistbyråer (20 URL:er)

---

## Förbättringar implementerade före denna batch

### 1. Förbättrad HTML-gate logik
**Före:** `weak` HTML → `not_suitable` direkt
**Efter:** `weak` HTML med dates/venues → `maybe` + `html` path

**Kodändring i `computeVerdict()`:**
```typescript
const hasEventSignals = html.dateCount >= 3 || html.venueMarkerCount >= 1 || html.timeTagCount >= 2;
if (hasEventSignals && html.categorization === 'weak') {
  status = 'maybe';
  recommendedPath = 'html';
  confidence = 0.5;
}
```

### 2. Lista för listItemCount i HtmlEvidence
Lade till `listItemCount` i `HtmlEvidence`-typen.

---

## Sammanfattning

| Status | Antal | Andel |
|--------|-------|-------|
| ✅ promising | 0 | 0% |
| ⚠️ maybe | 16 | 80% |
| ❌ not_suitable | 3 | 15% |
| 🚫 blocked | 1 | 5% |
| 💥 bad_url | 0 | 0% |
| 🔍 manual_review | 0 | 0% |

**Total:** 20 kandidater scoutade

---

## Detaljerade Resultat

### ⚠️ MAYBE (16)

| Källa | URL | Path | Confidence | Reason |
|-------|-----|------|------------|--------|
| Visit Stockholm | https://www.visitstockholm.se/event/ | network | 70% | wrong-type JSON-LD, routing to network |
| Malmö Stad | https://evenemang.malmo.se/ | html | 70% | no-jsonld but strong HTML signals |
| Göteborg Stad | https://goteborg.se/... | html | 45% | wrong-type (BreadcrumbList) |
| Gävlekalendern | https://www.gavle.se/gavlekalendern/ | network | 65% | no-jsonld, routing to network |
| Bollnäs | https://www.bollnas.se/... | html | 70% | no-jsonld, event signals in HTML |
| Staffanstorp | https://staffanstorp.se/... | network | 65% | wrong-type JSON-LD |
| Tanums | http://www.tanum.se/... | html | 70% | no-jsonld but HTML has signals |
| Svedala | https://www.svedala.se/uppleva/kalender | html | 50% | no-jsonld, HTML signals |
| Piteå | https://www.pitea.se/en/visitors/events/ | html | 50% | no-jsonld, HTML signals |
| Sundbyberg | http://www.sundbyberg.se/... | html | 70% | no-jsonld, HTML strong signals |
| Destination Uppsala | https://destinationuppsala.se/ | network | 65% | wrong-type JSON-LD |
| Vad händer i Sverige | https://vadhanderisverige.se/... | network | 65% | wrong-type JSON-LD |
| Lokalhelhet | https://www.lokalhelhet.se/kalender/ | network | 65% | wrong-type (Event type but no events extracted) |
| Dagen | https://www.dagen.se/kalendern/ | html | 45% | wrong-type JSON-LD |
| Visit Örebro | https://www.visitorebro.se/... | network | 65% | wrong-type JSON-LD |
| Visit Norrköping | https://visit.norrkoping.se/... | html | 45% | no-jsonld, HTML signals |

### ❌ NOT_SUITABLE (3)

| Källa | URL | Reason |
|-------|-----|--------|
| Vellinge | https://vellinge.se/evenemangskalender/ | no-jsonld, HTML low-signal |
| Evenemangskalender.se | https://evenemangskalender.se/ | no-jsonld, no event structure |
| Turistinfo Lund | https://www.turistinformationlund.se/ | no-jsonld, no event structure |

### 🚫 BLOCKED (1)

| Källa | URL | Reason |
|-------|-----|--------|
| Weekend Malmö | https://www.weekendmalmo.se/kalender | HTTP 500 - Server error |

---

## Jämförelse: Batch 1 vs Batch 2

| Status | Batch 1 | Batch 2 | Trend |
|--------|---------|---------|-------|
| promising | 1 | 0 | -1 |
| maybe | 13 | **16** | +3 |
| not_suitable | 5 | **3** | -2 |
| blocked | 0 | 1 | +1 |

**Slutsats:** Förbättringen fungerar - fler kandidater får `maybe` istället för `not_suitable`.

---

## Återkommande Mönster

### Framgångsrikt:
- Kommunala kalendrar utan JSON-LD men med HTML-struktur får nu `maybe`
- Bollnäs, Sundbyberg, Tanum - alla fick `maybe` med `html` path

### Problem kvar:
- `evenemangskalender.se` - ren aggregator utan egen struktur → `not_suitable` (korrekt)
- `weekendmalmo.se` - HTTP 500 → `blocked` (korrekt)
- Vellinge - för liten/svag struktur → `not_suitable` (korrekt)

---

## Skapade Filer

### I `01-Sources/candidates/` (16 filer):
Alla med status `maybe`, routes till `html` eller `network`

### I `01-Sources/scouted-not-suitable/` (3 filer):
- `260401-06:45-vellinge-se-evenemangskalender.md` ❌
- `260401-06:46-evenemangskalender-se.md` ❌
- `260401-06:48-turistinformationlund-se.md` ❌

---

## Nästa steg

Förbättringarna fungerar bra. Nästa batch bör testa:
- Festivaler (ID 35-50)
- Sport/Idrott (ID 53-59, 166-180)

 Verktyget är nu redo för större batcher.
