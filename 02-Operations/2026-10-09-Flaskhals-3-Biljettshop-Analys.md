# Flaskhals 3 — biljettshop.se ticket-detail scope-fel

**Datum:** 2026-10-09
**Stream:** Stream A / Flaskhals-utredning (forts. från Väg A+B slutrapport)
**Scope:** Site-Specific analys — INTE en C0/C1-ändring

## Sammanfattning (TL;DR)

Biljettshop.se är en **ticket-resale aggregator** (inte ett venue). 4 källor i poolen pekar på ticket-detail URLs för enskilda konsertevents. C0 redirectar dessa till `/sitemap-app.xml` (density 9606) istället för att crawla sidan de pekar på.

**Direkt hämtning av ticket-detail URLs visar:**
- `sven-ingvars-2026-04-19` (sv+en): 34 events via JSON-LD (A1)
- `niklas-stromstedt-2026-04-19`: 12 events via JSON-LD (A1)
- `matt-rife-2026-04-20`: 0 events (sidan saknar JSON-LD-events, bara 3 ISO-dates)

Så 2 av 4 URLs HAR events. Men pipeline kommer aldrig dit — C0 → sitemap → C1 no-main → exit.

**Rekommendation:** Ta bort biljettshop.se-URLs ur source-poolen. De representerar venue-ticketing som ligger utanför Stockholm-prioriteringen (Halmstad, Gamla Uppsala, Halland). Använd respektive venues egna eventsidor (t.ex. halmstad-konserthus.se) istället.

## Detaljerad analys

### Varför C0 redirectar till sitemap

Biljettshop.se har en `sitemap-app.xml` med tusentals event-URLs. C0 hittar den via sitemap-discovery (Fas 2 2026-10-09) och plockar den som winner pga hög density (9606). Den faktiska ticket-detail URL:en får aldrig crawlas.

### Vad direkt hämtning visar

| URL | bytes | JSON-LD events | Status |
|-----|-------|----------------|--------|
| `/sv/sven-ingvars-2026-04-19/` | 97255 | 34 (A1) | ✅ har events |
| `/en/sven-ingvars-2026-04-19/` | 97178 | 34 (A1) | ✅ har events (duplicate av sv) |
| `/sv/niklas-stromstedt-2026-04-19/` | 48111 | 12 (A1) | ✅ har events |
| `/sv/matt-rife-2026-04-20/` | 18956 | 0 | ❌ tom sida (3 ISO-dates bara) |

Båda sven-ingvars-URLs är duplicate (sv/en) — en borde bort.

### Varför Flaskhals 1 (alt-main) INTE löser Flaskhals 3

Biljettshop.se-sidorna har:
- `<main>` = false
- `<article>` = false
- `[role="main"]`, `.main-content`, `.content`, `.kalender`, etc. = false (flat React SPA)

`measure-c1-alt-main-all.ts` resultat 2026-10-09:
- halmstad-konserthus-2: ❌ NO_MAIN_STILL
- gamla-uppsala-2: ❌ NO_MAIN_STILL
- halland-2: ❌ NO_MAIN_STILL
- globen-3: ❌ NO_MAIN_STILL

Alt-main fallback hittar inget — sidan är en React-SPA utan traditionell main/article-wrapping.

### Varför vi INTE bör ändra C0/C1 för detta

Per **Generalization Protection Rule** (CLAUDE.md):
> Site-Specific: Only one domain exhibits the issue → STOP; use source adapter, source-specific config, or manual review

Biljettshop.se är ENDASTA kända fallet där:
1. Source URL:en själv är en event-detail-page
2. Sitemap har högre density än källan
3. Sitemap saknar `<main>`/`<article>`

Att lägga till en "skip sitemap if source has events"-regel i C0 vore Site-Specific och bryter mot regeln.

## Möjliga lösningar (utanför C0/C1)

### Alt 1 (rekommenderad): Ta bort biljettshop.se URLs från source-poolen

**Varför:**
- Biljettshop.se är inte Stockholm-prioriterat (Halmstad, Gamla Uppsala, Halland).
- Respektive venues har egna eventsidor.
- Duplicate URLs (sv/en för samma event).

**Action:** Filtrera bort `biljettshop.se` från `01-Sources/phase1-approved.jsonl` (eller liknande). Verifiera att venue-sajterna redan finns i poolen.

### Alt 2: Source-adapter / route-bypass

Skapa en route där URL-pattern `biljettshop.se/*/YYYY-MM-DD-*/` skippar C0 och går direkt till C2/C3. Implementation: derived-rule med `kind: 'NEEDS_SUBPAGE_DISCOVERY'` som mappar till source URL direkt.

**Kostnad:** 1–2h implementation + test, men bara 2/4 URLs är produktiva (matt-rife har 0 events). ROI låg.

### Alt 3: Acceptera `manual-review` som slutstatus

Pipelinen ger redan `routeSuggestion: 'manual-review'` för dessa 4 URLs. En människa kan manuellt crawla och lägga till events för de 2 som fungerar.

**Kostnad:** Manuellt arbete vid varje ny biljettshop-URL.

## Val av lösning

**Alt 1** är mest aligned med projektets strategiska riktning (Stockholm-prioritering, Stockholm density, inget scope creep till Halmstad/Halland).

Nästa steg: kontrollera om venue-sajterna redan finns i source-poolen:
- halmstad-konserthus.se (Halmstad)
- gamla-uppsala.se (Gamla Uppsala)  
- globen.se / aviciiarena.se (Stockholm — Matt Rife)

Om ja → bara ta bort biljettshop.se-URLs från poolen.
Om nej → lägg till venue-sajterna + ta bort biljettshop.se.

## På människospråk

Vi har fyra URL:er i vår lista som pekar på biljettshop.se — en sajt som säljer biljetter åt olika konserthallar (Halmstad, Gamla Uppsala, m.fl.). Problemet är att vår pipeline alltid väljer biljettshops egen "sitemap"-sida istället för den faktiska evenemangsidan, och sen kraschar eftersom sitemap-sidan inte ser ut som en vanlig evenemangssida.

Det visar sig att två av fyra URL:er faktiskt har evenemang (via JSON-LD, alltså strukturerad data som webbsajter kan bädda in). Men vi kommer aldrig dit eftersom pipelinen väljer fel sida från början.

Enligt vår regel "generaliseringsskydd" ska vi inte lägga in specialfixar för en enskild sajt i grundkoden. Och biljettshop.se ligger dessutom utanför vår Stockholms-prioritering. Därför rekommenderar jag att vi helt enkelt tar bort de fyra URL:erna från vår lista och använder respektive konserthalls egen sajt istället — om den finns i vår lista. Om inte, lägg till den och ta bort biljettshop-URL:en.

Ingen kod ändras i C0/C1. Bara en liten lista i sources som städas.