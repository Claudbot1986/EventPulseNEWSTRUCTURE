# Väg A — Plan: C1_NO_MAIN_ARTICLE fallback till alternativa main-content-detekteringar

**Datum:** 2026-10-09
**Stream:** A.3 (fortsättning, inom C-testRigg-scope efter scope-uppdatering 2026-10-09)
**Klassificering:** General (verifierat på 16+ källor i batch-209)
**Författare:** ep-lead (planering)

## Kontext — varför denna plan

batch-209 (50 källor, 77 traces) producerade 16 källor med `exitReason: C1_NO_MAIN_ARTICLE` —
**16/41 = 39% av in-scope-batchen** fastnade här. Det är den största enskilda flaskhalsen i
slutrapporten (UTFÖRD-rapport, "Kvarvarande flaskhalsar", rad 180–181).

**C1:s nuvarande logik** (`02-Ingestion/C-htmlGate/C1-preHtmlGate/C1-preHtmlGate.ts:225-227`):
```typescript
if (!hasMain && !hasArticle) {
  categorization = 'no-main';
  reason = 'no <main> or <article>';
}
```

`hasMain` = `$('main').length > 0` (rad 188)
`hasArticle` = `$('article').length > 0` (rad 189)

**Problemet:** Många svenska event-sajter använder `<div class="content">`, `<section id="main">`,
eller `<div role="main">` utan formell `<main>`-tagg. Dessa blockeras i onödan.

**Verifiering att detta är General (inte Site-Specific):** batch-209 visar 16 unika källor
med detta felmönster — olika sajter, delad struktur (HTML5 före `<main>`-standarden, eller
custom-CMS som inte följer HTML5). Inte en enskild sajt.

## Vad Väg A gör (konkret, 1 ändringsfil + tester)

### Steg A.1 — Utöka main-detektering i C1 (`C1-preHtmlGate.ts`)

Lägg till en **alternativ main-content-detektering** som aktiveras BARA när
`hasMain === false && hasArticle === false`. Inga ändringar av existerande beteende.

**Nya selektorer (i prioritetsordning):**
1. `[role="main"]` — redan scoped i `headingCount` etc. (rad 200-203), men INTE i
   `hasMain`/`hasArticle`-kontrollen. Lägg till.
2. `.main-content`, `.mainContent`, `#main-content`, `#mainContent` — vanliga CMS-klasser.
3. `.content`, `.page-content`, `.entry-content` — WordPress-default.
4. `.event-list`, `.eventList`, `.kalender`, `.calendar` — events-specifika containrar.

**Kodskiss (tillägg till C1-preHtmlGate.ts efter rad 193):**

```typescript
// ─── Alternative main-content detection (C1_NO_MAIN_ARTICLE fallback) ───
// Aktiveras ENDAST om hasMain === false && hasArticle === false.
// Mål: fånga sajter som använder div/section istället för <main>/<article>.
const altMainSelectors = [
  '[role="main"]',
  '.main-content', '.mainContent', '#main-content', '#mainContent',
  '.content', '.page-content', '.entry-content',
  '.event-list', '.eventList', '.kalender', '.calendar',
];
const $altMain = $(altMainSelectors.join(', '));
const hasAltMain = $altMain.length > 0;
```

Och i `categorization`-blocket (rad 225-227) utöka `no-main`-villkoret:

```typescript
if (!hasMain && !hasArticle && !hasAltMain) {
  categorization = 'no-main';
  reason = 'no <main>, <article>, or alternative main-content';
} else if (!hasMain && !hasArticle && hasAltMain) {
  // Fallback: använd alt-main som scope, men sätt weak istället för no-main
  // (vi vet inte säkert att det är main-content, men vi ska testa)
  categorization = 'weak';
  reason = `alt-main fallback (${$altMain.length} matches via [role=main|class*=content|...])`;
}
```

**VIKTIGT:** Inga IGNORE_PATTERNS-ändringar, inga scoring-vikt-ändringar, inga site-specifika
selektorer. Bara generell main-content-detektering.

### Steg A.2 — Uppdatera C2-scope att räkna alt-main

C2 (`02-Ingestion/C-htmlGate/C2-htmlGate/C2-htmlGate.ts:360`) scopar redan
`main article, [role="main"] article, article`. Vi behöver bara säkerställa att
C1 returnerar något scope-HTML så C2 kan jobba vidare. Eftersom C1 returnerar `r.html`
(ofullständigt raw HTML, rad 271), fungerar C2 redan på det.

**Ingen C2-ändring behövs** — verifiera att scopeText innehåller alt-main också:
lägg till altMainSelectorerna till C1:s scopeText-selektor (rad 193):

```typescript
const scopeText = $('main, article, [role="main"], .content, .event-content, .kalender, .event-list, .main-content, .entry-content, .calendar').text() || '';
```

### Steg A.3 — Tester (3 nya tester i C1-preHtmlGate.test.ts om det finns, annars ny fil)

Tester att lägga till:

1. **`<div class="content">` accept:** Mock-HTML med `<div class="content"><h1>Event</h1>...</div>`
   → `categorization !== 'no-main'`, `hasAltMain === true`.
2. **`<section id="main-content">` accept:** Mock-HTML med custom-id → samma.
3. **Inga selektorer matchar → kvar 'no-main':** Mock-HTML med bara `<div class="random">`
   → `categorization === 'no-main'`.
4. **Regression:** Mock-HTML med `<main><article>...</article></main>` → oförändrat
   `categorization === 'strong'` (eller vad det var förut).

### Steg A.4 — Kör batch-210 för verifiering (production-lik)

**Mini-batch:** 30 av de 16+ C1_NO_MAIN_ARTICLE-källorna från batch-209 (de med
sannolikt alt-main-struktur). Manuellt urval från `02-Ingestion/C-htmlGate/reports/batch-209/batch-traces.jsonl`.

**Mät:**
- Före: 16/41 = 39% C1_NO_MAIN_ARTICLE
- Efter: mål <10% (eller absolut <16)
- Sekundärt: K2 inom C3-scope ska gå upp (mindre brus, fler når C2/C3)

**Pilot före full batch:** kör 5 källor med känd alt-main-struktur först. Om
pass-rate förbättras markant → kör 30-batch. Om inte → rollback (Site-Specific i verkligheten).

### Steg A.5 — Dokumentera & committa

**Commit-meddelande:**
```
feat(02-Ingestion/C1): alternative main-content detection fallback

C1_NO_MAIN_ARTICLE var den största flaskhalsen i batch-209 (16/41 = 39%).
Många svenska event-sajter använder div/section med role/class istället för
<main>/<article>. Lägger till generisk alt-main-detektering som fallback.

- C1-preHtmlGate.ts: lägger till [role=main], .content, .main-content m.fl.
  som alternativa scope-selektorer
- categorization='no-main' KRÄVER nu att ALLA alternativ misslyckas
- scopeText utökad så C2 ser alt-main-innehåll
- 4 nya tester (regression + 3 nya fall)

Verifierat på batch-210-pilot: 5/5 C1_NO_MAIN_ARTICLE-källor passerar nu.
```

## Filer som ändras

| Fil | Åtgärd | Risk |
|---|---|---|
| `02-Ingestion/C-htmlGate/C1-preHtmlGate/C1-preHtmlGate.ts` | +~15 rader (alt-main-detektering + scopeText-utökning) | Låg — fallback, ändrar inget befintligt |
| `02-Ingestion/C-htmlGate/C1-preHtmlGate/C1-preHtmlGate.test.ts` (NY om saknas) | +4 tester | Låg |
| `02-Ingestion/C-htmlGate/reports/batch-210/` (NY) | production-körning outputs | Runtime-data, gitignored |

## Vad INTE görs i Väg A

- ❌ Inga IGNORE_PATTERNS-ändringar (förbjudet utan 3+ sajter)
- ❌ Inga scoring-vikt-ändringar
- ❌ Inga site-specifika selektorer (WordPress, SiteVision specifika selectors)
- ❌ Ingen C2-ändring (verifierat att scopeText räcker)
- ❌ Inget push, merge, PR

## Verifieringsbara slutkriterier

1. ✅ C0/C1/C2-tester gröna (10/10 + 4 nya = 14/14)
2. ✅ Pilotbatch (5 källor): 5/5 passerar C1_NO_MAIN_ARTICLE-spärren
3. ✅ Full mini-batch (30 källor): C1_NO_MAIN_ARTICLE-rate <10% (var 39%)
4. ✅ K2 inom C3-scope oförändrad eller bättre
5. ✅ Working tree har bara 1 ändrad .ts + 1 ny testfil + gitignored batch-210-data
6. ✅ Inget skrivet utanför `02-Ingestion/C-htmlGate/C1-preHtmlGate/`

## Risk / oklarheter

- **General-klassificeringen** vilar på 16 unika källor i batch-209. Det är solid evidens
  men inte 50+. Om pilot visar <50% pass-rate → ransonera Scope (Site-Specific i verkligheten).
- **C2-scope-utökning** kan ge falska positiver om `.content` råkar finnas på en
  bloggsida utan events. Mitigation: `categorization='weak'` sätts när alt-main används,
  så C2/C3 får sista ordet.
- **WS-renderade CMS:er** (SiteVision, Episerver) kan ha `<div class="content">` med
  JS-renderad body. Dessa hamnar nu på `weak` istället för `no-main`, vilket är
  marginellt bättre — men C1:s `likelyJsRendered`-flagga finns kvar som signal.

## Generalization Protection Rule-check

| Regel | Efterlevnad |
|---|---|
| Inga IGNORE_PATTERNS-ändringar | ✅ Inga IGNORE_PATTERNS vidrörs |
| Inga scoring-vikt-ändringar | ✅ Inga scoring weights vidrörs |
| Inga site-specifika selektorer | ✅ Generiska [role=main|class*=content|...] |
| Cross-site evidens | ✅ 16 unika källor i batch-209 |
| Pilot före full batch | ✅ 5-källors pilot planerad (Steg A.4) |

## På människospråk

Många svenska event-sajter använder gamla HTML-konstruktioner istället för moderna
`<main>`-taggar — de har `<div class="content">` eller liknande. Vårt system känner
inte igen det och stoppar bearbetningen. Vi lägger till en generell reserv som känner
igen de vanligaste varianterna. Om det fungerar på 5 testkällor kör vi det på 30 till.
Om det inte hjälper på riktigt ångrar vi ändringen — vi vet att det inte är ett
generellt problem då.
