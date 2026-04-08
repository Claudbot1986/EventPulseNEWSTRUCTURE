# Phase 1 Reset Report — Queue Routing

**Skapad:** 2026-04-08T16:35:03.209Z
**Phase:** Fas 1 — Reset enligt RebuildPlan.md
**Kördes:** reset-queue-routing.ts (komplettering till reset-sources-state.ts)

---

## Sammanfattning

Reset av Phase 5 queue-routing som återinfördes efter initial reset.

| Kategori | Antal |
|----------|-------|
| Total sources | 425 |
| Med legacyQueueRouting (hade Phase 5 routing) | 425 |
| Utan Phase 5 routing | 0 |

---

## Queue-filer arkiverade

| Kö | Filer arkiverade |
|----|-----------------|
| A-queue | 3 |
| B-queue | 2 |
| C-queue | 415 |
| D-queue | 2 |
| H-queue | 5 |

Arkiv: runtime/archive/queues_PRE_RESET/

---

## Source-filer uppdaterade

Uppdaterade fält i sources/*.jsonl:
- currentQueue -> "pending" (neutraliserat, ej styrande)
- routingConfidence -> "reset" (neutraliserat, ej styrande)
- routingReason -> legacy-prefix tillagt
- legacyQueueRouting -> nytt fält med Phase 5-data bevarad

Bevarade fält (ej ändrade):
- id, url, name, type, city, discoveredAt, discoveredBy
- preferredPath, preferredPathReason, metadata
- route-history (historik bevarad)

---

## Nollställd state

runtime/sources_reset_state.jsonl innehåller 425 poster.
Alla har:
- status: "untreated"
- preferredPath: "unknown"
- legacyState med tidigare state

---

## Arkivstruktur

runtime/archive/
  sources_status_PRE_RESET.jsonl  <- reset-sources-state.ts (2026-04-06)
  queues_PRE_RESET/               <- reset-queue-routing.ts (2026-04-08T16:35:03.209Z)
    A-queue/
    B-queue/
    C-queue/
    D-queue/
    H-queue/

---

## Nästa steg (enligt RebuildPlan)

1. **Fas 2:** Fastställ eller bygg 00A-verktyget
2. **Fas 3:** Canonical Sources Architecture
3. **Fas 4:** Queue Architecture (ny, tunn)
4. **Fas 5:** Kör initial routing igen efter reset

---

**Reset status:** COMPLETE
