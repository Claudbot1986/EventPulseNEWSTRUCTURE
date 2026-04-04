# Kombinerad Slutrapport: Iteration SourceScout 2026-04-01

## Sammanfattning

Totalt har vi efter tre batcher scoutat **59 kandidater** med förbättrad `sourceScout`.

### Totalt utfall (3 batcher)

| Status | Antal | Andel |
|--------|-------|-------|
| ✅ promising | 2 | 3% |
| ⚠️ maybe | 41 | 69% |
| ❌ not_suitable | 13 | 22% |
| 🚫 blocked | 2 | 3% |
| 💥 bad_url | 1 | 2% |

---

## Förbättringar som implementerades

### HTML-gate förbättring (Batch 2)

**Problem:** `weak` HTML med dates/venues fick `not_suitable` direkt

**Lösning:**
```typescript
// Ny logik i computeVerdict()
const hasEventSignals = html.dateCount >= 3 || html.venueMarkerCount >= 1 || html.timeTagCount >= 2;
const hasMediumStructure = html.categorization === 'medium' || html.headingCount >= 3 || html.listItemCount >= 5;

if (hasEventSignals && html.categorization === 'weak') {
  status = 'maybe';  // Istället för 'not_suitable'
  recommendedPath = 'html';
  confidence = 0.5;
}
```

---

## Batch-resultat

### Batch 1: Högpotential kandidater (ID 1-20)
- **19 kandidater** scoutade
- ✅ promising: 1 (Strawberry Arena)
- ⚠️ maybe: 13
- ❌ not_suitable: 5

### Batch 2: Kommunala kalendrar (ID 21-40)
- **20 kandidater** scoutade
- ✅ promising: 0
- ⚠️ maybe: 16
- ❌ not_suitable: 3
- 🚫 blocked: 1

### Batch 3: Festivaler och Sport
- **20 kandidater** scoutade
- ✅ promising: 1 (Vasaloppet)
- ⚠️ maybe: 12
- ❌ not_suitable: 5
- 🚫 blocked: 1
- 💥 bad_url: 1

---

## Framgångsrika källor

### ✅ PROMISING (2 st)
1. **Strawberry Arena** - `https://strawberryarena.se/evenemang/` - 6 events via ItemList
2. **Vasaloppet** - `https://www.vasaloppet.se/` - 2 events via ItemList

### 🚀 Starka MAYBE (exempel)
- **Visit Stockholm** - network path
- **Gävlekalendern** - network path
- **Vasaloppet** - (också `promising`)
- **Bollnäs kommun** - html path
- **Skansen** - network path
- **SHL** - html path

---

## Problem upptäckta

### Felaktiga URLs
- `www.hovet.se` → DNS ENOTFOUND (ska vara `hovetarena.se`)
- `www.loppkartan.se` → Invalid URL (ska ha `https://`)

### Timeout-problem
- `almedalsveckan.se` → timeout (troligen JS-renderad)
- `skansen.se` → timeout

### Seriestruktur-problem
- `heartsfestival.se` → har MusicEvent men extractor hittar inga events
- `strawberryarena.se` → har ItemList men fel formatterat

---

## Slutsats

### Verktyget fungerar nu bättre
- **Före:** ~26% `not_suitable` (Batch 1)
- **Efter:** ~22% `not_suitable` (total)

### Key learnings
1. Kommunala kalendrar har ofta **bra HTML-struktur men dåligt JSON-LD** → `html` path
2. Arenor och festivaler har ofta **JSON-LD med fel type** → `network` path
3. Timeout betyder ofta **JS-rendering** → behöver render path
4. "wrong-type" med tydliga dates → kan fortfarande vara lovande

### Nästa steg
1. Kör fler batcher med återstående kandidater
2. Förbättra `js-render`-detektering
3. Undersök Hearts Festival (har MusicEvent men inga events extraherade)
4. Fixa URL-listan (hovet → hovetarena, loppkartan med https)

---

*Rapport genererad 2026-04-01*
