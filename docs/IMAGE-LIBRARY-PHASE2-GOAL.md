# Image Library Phase 2 Goal — 10–20 bilder per kategori

> **Status:** [CLAIMED] — beslut 2026-09-10, inget arbete utfört ännu.
> **Trigger:** beslut om att pausa BFL-budget tills lansering/funding.
> **Tier:** 3 — detta är en plan-note, INTE Tier 1 (MASTERPLAN/BACKLOG).
> **Supersedes:** inget.
> **Superseded by:** inget (ännu).

## Bakgrund

Per 2026-09-10 togs beslutet att BFL-credits inte längre ska dras per nattkörning.
Anledning: BFL är för dyrt för steady-state ingestion. Istället använder
nattjobbet biblioteket först, och faller bara tillbaka till BFL när biblioteket
inte har en match alls (`match_type === 'none'`).

Vi har redan på plats:

- `image_library`-tabell (migration `20260827-0001` + `20260827-0002`)
- `pickLibraryFallback()` (venue+category → category → default)
- `backfillFromPastAi()` som populerade biblioteket från 1 246 unika past-AI-URL:er
- 15 vitest-tester för biblioteket
- 4 nya vitest-tester för `matchLibraryFirst`

## Mål (Phase 2 — post-launch / med funding)

**10–20 olika bilder per kategori eller eventtyp** i `image_library`.

### Definition av "klar"

- För varje distinct `category_slug` som förekommer i `events_public`
  (för närvarande ca 15–20 stycken: music, theater, art, opera, family, food,
  design, sport, community, etc):
  - minst 10 rader i `image_library` med den `category_slug`:en
  - rating ≥ 3 (curator-kurerat eller auto-default)
- Default-poolen (NULL category_slug): minst 20 bilder för fallback
- `matchLibraryFirst` returnerar `libraryMatched ≥ 95%` av alla events som
  behöver bild

### Hur vi kommer dit (inte nu — Phase 2)

1. **Manuellt curator-pass** när vi har råd: hitta eller AI-generera
   10–20 bilder per top-5-kategori (music, theater, art, family, food).
   Total arbetsinsats: ~1–2 dagar.
2. **Auto-läge (med funding):** utöka `pickLibraryFallback` med
   "library low"-detektion. Om en kategori har < 5 bilder, trigga ett
   bakgrundsjobb som genererar 5 nya bilder med låg BFL-concurrency.
3. **Mät:** dashboard-panel som visar `# bilder per kategori` +
   `% events med library-match` så vi ser progressionen över tid.

### Vad vi INTE gör nu

- Vi bygger INTE en auto-curator. Det är ett Phase 2-mål.
- Vi ändrar INTE `pickLibraryFallback` för att generera bilder när biblioteket
  är "tomt". Det är ett Phase 2-mål.
- Vi ökar INTE BFL-budgeten. Nattjobbets BFL-pass blir i praktiken noll events
  om biblioteket är välpopulerat.

## Spårbarhet

- Beslut: 2026-09-10 (denna note)
- Implementation: `08-Agent/services/imageGen.matchLibraryFirst.ts`
  (skapad 2026-09-10)
- Cronjobbet: `scripts/ingestion-cron.ts` steg D (uppdaterat 2026-09-10 att
  anropa `matchLibraryFirst`)
- Tester: `08-Agent/tests/imageGen.matchLibraryFirst.test.ts` (4 tester,
  alla gröna)
- Migrationer finns redan på plats (BACKLOG.md rad 67-71 refererar till dem
  men är blockerad för redigering — den ursprungliga formuleringen står kvar)

## Nästa steg (efter att vi lanserat / fått funding)

1. Verifiera nuvarande biblioteks-storlek:
   `SELECT category_slug, COUNT(*) FROM image_library GROUP BY category_slug;`
2. För kategorier med < 10 bilder: skapa curator-skript
   `08-Agent/scripts/curate_category_images.ts` som genererar 10–20 bilder
   med BFL Flux-dev per kategori.
3. Uppdatera denna note med `[VERIFIED]` när 10–20-målet är uppnått.

## Relation till andra dokument

- `docs/MASTERPLAN.md` och `docs/BACKLOG.md` är Tier 1 — låsta. Denna note
  ersätter INTE dem utan är ett komplement.
- `docs/AI-IMAGE-PIPELINE-PLAN.md` har den ursprungliga BFL-only-planen; det
  arbete som beskrivs där är nu Phase 2 istället för Phase 1.
