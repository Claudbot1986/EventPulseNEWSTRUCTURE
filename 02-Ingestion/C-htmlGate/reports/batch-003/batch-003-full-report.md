# Batch 003 Rapport

**Document Type: HISTORICAL REPORT**
**Datum:** 2026-04-06  
**Batch:** 003  
**Sources:** 10 (polismuseet, stockholm-jazz-festival-1, uppsala-kommun, ystad, svenska-fotbollf-rbundet, hallsberg, ifk-uppsala, karlskoga, kumla, kungliga-musikhogskolan)  
**Resultat:** 1/10 success, 1 event totalt  
**Status:** completed  
**StopReason:** plateau

---

## Baseline Resultat

| Source | Events | C0 Candidates | C2 Verdict | C2 Score | Winner URL |
|--------|--------|--------------|------------|----------|-----------|
| polismuseet | 0 | 0 | promising | 124 | (root) |
| stockholm-jazz-festival-1 | 0 | 0 | promising | 134 | (root) |
| uppsala-kommun | **1** | 0 | maybe | 11 | /arrangera-evenemang/ |
| ystad | 0 | 0 | unclear | 7 | /ystads-teater |
| svenska-fotbollf-rbundet | 0 | 0 | promising | 12 | /biljett/ |
| hallsberg | 0 | 0 | promising | 44 | (root) |
| ifk-uppsala | 0 | 0 | promising | 31 | (root) |
| karlskoga | 0 | 0 | promising | 12 | /bygga-bo--miljo/ |
| kumla | 0 | 0 | maybe | 16 | /agenda-2030.html |
| kungliga-musikhogskolan | 0 | 0 | promising | 431 | /konserter---evenemang.html |

---

## Ackumulerad Analysis (Batch 001-003)

### Problem Distribution

| Problem | Batch 001 | Batch 002 | Batch 003 | Ackumulerat |
|---------|-----------|-----------|-----------|-------------|
| C0=0 candidates | 9/10 | 4/4 | 9/10 | ~22+ sources |
| C2=promising, 0 events | 6/10 | 3/4 | 8/10 | ~17+ sources |
| C2=maybe, <5 events | 1/10 | 1/4 | 1/10 | ~3 sources |
| Success (events>0) | 3/10 | 0/4 | 1/10 | 4 total |

### Root-Cause Bekräftad

**C0 link-discovery hittar 0 candidates för ~22+ sajter.**

C2 ger höga density-scores (12-431) men extraction=0. Detta bekräftar:
1. C0 hittar inte event-links i nav/header på dessa sajter
2. C2:s density-scoring mäter rätt saker (dateringar, liststruktur) men på fel sidor
3. extractFromHtml() kräver Swedish date-text in anchor eller URL-embedded dates

### Sources-klassificeringar från Batch 003

- **uppsala-kommun:** 1 event — marginell, ej statistiskt signifikant
- **svenska-fotbollf-rbundet:** C2=promising(12), likelyJsRendered=false, winner=/biljett/ — ej D-kandidat, event-sida saknas
- **kungliga-musikhogskolan:** C2=promising(431), winner=/konserter---evenemang.html — hög density, men extraction=0

---

## Plateau-Beslut

**StopReason:** plateau

**Motivering:**
- Inga generella mönster förbättringar identifierbara från 3 batchar
- C0=0 barriären är konsekvent över alla 22+ testade sajter
- Nästa förbättring kräver rotorsaksanalys som Generalization Gate inte tillåter
- Max 3 batch-förbättringscykler tillåtna

---

## Sources-Status Uppdatering

Efter batch 003:
- **success:** 25 → 26 (uppsala-kommun: 0→1)
- **remaining html_candidates:** 0 (alla 11 obatchade körda i batch 001-003)
- **pending_render_gate:** 6 (oförändrat)

---

## Slutsatser

1. **C-Batch-Loop Pool Utömd:** Alla 11 html_candidates körda via batch 001-003
2. **C0=0 Barriär Stabil:** Konsekvent över 22+ sajter
3. **C2 Density vs Extraction Gap:** Hög score ≠ framgång
4. **Inga Generella Förbättringar Möjliga:** Utan rotorsaksanalys på 2-3+ sajter

---

## Nästa Steg (enligt handoff)

1. **Skapa D-renderGate** — 6 sources blockerade
2. **Köra scheduler på återstående success-sources** — bredda DB
3. **Investigera mislabeled fail-sources** — datakvalitet
