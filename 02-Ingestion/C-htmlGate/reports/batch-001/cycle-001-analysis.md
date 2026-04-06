# Batch 001 — AI Analys (Cycle 1)

## Baseline Resultat

| Källa | C0 | C1 | C2 | Events |
|--------|----|----|-----|--------|
| hallsberg | 0 | - | promising(44) | 0 |
| ifk-uppsala | 0 | - | promising(31) | 0 |
| karlskoga | 2 | - | promising(12) | 0 |
| kumla | 1 | - | maybe(16) | 0 |
| kungliga-musikhogskolan | 1 | - | promising(431) | 0 |
| lulea-tekniska-universitet | 2 | - | unclear(9) | **1** |
| moderna-museet | 0 | - | promising(59) | **4** |
| naturhistoriska-riksmuseet | 2 | - | promising(118) | 0 |
| orebro-sk | 0 | - | maybe(11) | **1** |
| polismuseet | 0 | - | promising(124) | 0 |

**Resultat:** 3/10 success, 6 events total

---

## AI-analys: Generella mönster

### Mönster 1: Lyckade källor har Swedish date i anchor-href

**moderna-museet (4 events):** Root-sida har anchor-meddelanden med Swedish datum-text och href.

**orebro-sk (1 event):** Root-sida har anchor-meddelanden med Swedish datum.

**lulea-tekniska-universitet (1 event):** `/utbildning/upplev-studentlivet-hos-oss` extraherade 1 event.

### Mönster 2: Misslyckade källor — fel candidate-page vald

**karlskoga:** C0 vann `/bygga-bo--miljo/kulturmiljoprogrammet.html` (density=15) — ingen event-sida. Rätt candidate borde varit `/kalender/` eller `/evenemang/`.

**kumla:** C0 vann `/kommun-och-politik/agenda-2030.html` (density=12) — fel page. Inget events.

**kungliga-musikhogskolan:** C0 vann `/konserter---evenemang.html` (density=395, 84 time-tags) — detta borde vara rätt page, MEN 0 events. SiteVision menar timing.

### Mönster 3: Hög density ≠ events

**kungliga-musikhogskolan:** density=395, 84 time-tags, C2=promising(431) → 0 events

**nrm.se:** density=298, C2=promising(118) → 0 events

**polismuseet:** C2=promising(124) → 0 events

---

## Root-cause: C2 vs extractFromHtml() osynkning

C2 säger "promising" baserat på page-level signals (cards, lists, density), MEN extractFromHtml() kräver:

1. **Datum i URL:** `/2026-04-17-19-00/` eller `/kalender/20260417/`
2. **Datum i anchor href med Swedish date-text:** `7 april 2026`
3. **ISO-datum i path:** `/2026/04/17/`

Utan dessa specifika mönster → 0 events, oavsett C2 score.

---

## Möjlig generell förbättring

**Förbättring:** Låt extractFromHtml() försöka med Swedish date-pattern även när URL saknar datum.

**Risk:** Medium — kan öka brus från nyhetssidor.

**Nödvändig verifiering:** Behövs på 2-3 andra sajter för att vara General.

---

## Stop Reason

`no-general-improvement` — nästa föreslagna ändring (Swedish date-pattern) kräver verifiering på minst 2-3 sajter först.

