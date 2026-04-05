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
