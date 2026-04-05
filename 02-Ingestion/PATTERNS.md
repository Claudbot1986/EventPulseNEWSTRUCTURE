# Pattern Registry — EventPulse HTML Path

## Syfte

Denna fil fångar **potentiellt generella mönster** upptäckta genom site-specifika fall. Mönster härifrån får ENDAST generaliseras till C-lager efter att ha verifierats på **minst 2–3 olika sajter**.

---

## Aktiva mönster (needsVerification = true)

---

### Pattern: Webflow CMS Extraction Gap

**Klassificering:** Provisionally General
**Upptäckt via:** debaser.se
**Datum:** 2026-04-04

**Potentiellt generellt problem:**
`extractFromHtml()` letar efter URL-mönster (`/YYYY-MM-DD-HHMM/` eller `/kalender/`) men Webflow-baserade sajter har:
- Event-URLs utan datum: `/events/[slug]`
- Datum i text men inte i URL
- Event-listor i `<div class="w-dyn-list">` istället för `<main>/<article>`

**URL-struktur som påverkas:** `/events/[slug]` (Webflow standard)

**CMS/Platform:** Webflow (identifierbar via `w-dyn-list`, `w-dyn-item` CSS-klasser)

**Antal sajter verifierade:** 1
**Sajter att söka verifiering på:** Mål: 2-3 andra Webflow-sajter

**Status:** needsVerification = true
**Nästa steg:** Sök och analysera 2-3 andra Webflow-sajter (t.ex. andra svenska venue-sajter byggda på Webflow)

**Detaljer:**
- extractFromHtml() scope (rad 632) = `main, article, [role="main"], .content, .event-content, .kalender, .event-list`
- Webflow event-listor använder: `<div class="w-dyn-list">` + `<div class="w-dyn-item">`
- Dessa är INTE i nuvarande scope

---

### Pattern: www Redirect Blocks C0 Discovery

**Klassificering:** Provisionally General
**Upptäckt via:** folkoperan.se
**Datum:** 2026-04-05

**Potentiellt generellt problem:**
C0 (htmlFrontierDiscovery) misslyckas med att hitta event-candidates när käll-URL har `www` som pekar på icke-www via 301-redirect:
- `https://www.folkoperan.se` → 301 → `https://folkoperan.se/`
- C0 analyserar www-versionen och hittar inga candidates
- C0 med direkt non-www hittar `/pa-scen/` med density=114 och 8 events

**URL-struktur som påverkas:** Alla sajter med www→non-www redirect

**Root-cause:** C0 använder käll-URL för link discovery, men redirect-status påverkar vilka links som hittas.

**Antal sajter verifierade:** 1 (folkoperan)

**Sajter att söka verifiering på:** Mål: 2-3 andra sajter med www-redirect

**Status:** needsVerification = true

---

### Pattern: timeTagCount utan datum-filter

**Klassificering:** Provisionally General
**Upptäckt via:** polismuseet.se
**Datum:** 2026-04-05

**Potentiellt generellt problem:**
`timeTagCount` i C1 (rad 147 i C1-preHtmlGate.ts) räknar ALLA `<time[datetime]>` elements, inklusive:
- Öppettider (`datetime="11:00:00"`) — UTAN datum
- Stängtider
- Tid-only timestamps

Men modellen behandlar alla time-tags som "event-tider".

**Root-cause:**
```
C1: const timeTagCount = $('time[datetime]').length;
```
Svenska sajter använder ofta `<time datetime="11:00:00">` för öppettider, t.ex.:
```html
<time datetime="11:00:00">Öppet 11:00</time>
<time datetime="17:00:00">Stängt 17:00</time>
```

**Vad modellen tror:** "24tt = många event-tider"
**Verklighet:** "24tt = öppettider för utställningar"

**Förbättrad signal behövs:**
- `datetime` med datum → event-tid (t.ex. `datetime="2026-05-01T19:00"`)
- `datetime` UTAN datum → öppettid (t.ex. `datetime="11:00:00"`)

**CMS/Platform:** Ej CMS-specifikt — öppettider är vanligt överallt

**Antal sajter verifierade:** 1 (polismuseet)
**Sajter att söka verifiering på:** Mål: 2-3 andra sajter med öppettider (t.ex. museer, biografer, badhus)

**Status:** needsVerification = true
**Nästa steg:** Undersök 2-3 triage_required-sources för att bekräfta mönstret

---

### Pattern: SiteVision CMS med `/visit-events/` utan tid

**Klassificering:** Provisionally General
**Upptäckt via:** borlange-kommun, malmo-stad, uppsala-kommun, stenungsund
**Datum:** 2026-04-05

**Potentiellt generellt problem:**
`extractFromHtml()` URL-mönster (rad 546-605) kräver:
- Pattern A: `/YYYY-MM-DD-HHMM/` (datum + tid)
- Pattern B: `/YYYYMMDD-HHMM/`
- Pattern C: `/YYYY/MM/DD/`

Men SiteVision-baserade kommunsajter har:
- `/visit-events/YYYY-MM-DD-title` (datum UTAN tid)
- Kalenderwidget-datum räknas som `dateCount` i C1 men representerar UI-text, inte event-links
- `<article class="item-*">` i custom webapp components, INTE i C1 scope

**URL-struktur som påverkas:** `/visit-events/YYYY-MM-DD-title` (SiteVision standard)

**CMS/Platform:** SiteVision CMS (identifierbar via `/visit-events/` paths)

**Antal sajter verifierade:** 4 (borlange, malmo, uppsala, stenungsund)

**Status:** needsVerification = true

---

## Avvisade mönster

(Inga ännu)

---

##Verifierade mönster (klara för C-lager)

(Inga ännu)

---

## Hur man använder denna fil

1. **När du upptäcker ett Site-Specific-fall** som kan vara generellt → spara i "Aktiva mönster" med needsVerification = true
2. **När du arbetar med nya sajter** → kolla här för att se om de bekräftar ett existerande mönster
3. **När du verifierar** → om samma mönster hittas på 2+ sajter → flytta till "Verifierade mönster" och föreslå C-lager ändring
4. **Om mönster inte bekräftas** → behåll i "Aktiva" men notera "ej bekräftat" + nya sajter som testades

---

## Krav för generalisering till C-lager

|| Steg | Krav |
||------|------|
|| 1 | Mönster dokumenterat här med minst 1 sajt |
|| 2 | Samma mönster verifierat på 2–3 ytterligare sajter |
|| 3 | Sajterna ska vara från OLIKA organisationer/ägare (ej samma CMS-implementation) |
|| 4 | CRAFT-regler godkänner ändringen |
|| 5 | Output från Steg 2c (Pattern Capture) dokumenterad |

---

*Senast uppdaterad: 2026-04-05*
