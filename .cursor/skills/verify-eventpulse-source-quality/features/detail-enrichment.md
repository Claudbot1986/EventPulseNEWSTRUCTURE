# Detaljberikning — informationen som ligger utanför biljettkortet

## Sub-features

- **HTML-parsning** — `extractDetailFacts` läser JSON-LD, `og:`/`twitter:`-
  metataggar och `<meta name="description">` ur evenemangssidan: beskrivning,
  bild, plats, adress, starttid. **Ingen brödtext läsas** — plats, adress och
  starttid kommer enbart från JSON-LD.
- **Sammanslagning** — `mergeEnrichment` fyller **bara saknade fält** och
  skriver aldrig över ett värde som redan finns.
- **Utval** — `isDetailUrl` väljer de rader som pekar på en egen evenemangssida
  (url ≠ sourceUrl). Listningsrader hoppas över.
- **Budget** — `--per-source` och `--global` sätter tak på antalet
  **hämtningar**, så en natt med tusentals rader inte blir tusentals hämtningar.
- **Kedjesteg** — `enrich-event-details` i `scripts/ingestion-cron.ts`, efter
  gaterna och före importen.

## How to get to it (user POV)

Användarens iakttagelse (2026-11-01): "info om eventet kan även ligga utanför
självaste biljettkortet på en hemsida". Listningen ger ofta bara titel, datum
och en generisk bild. På evenemangssidan står den riktiga beskrivningen, den
exakta platsen och en riktig bild.

Mätt: 84 % av raderna pekade på en detaljsida vi aldrig besökte, 18 % hade
plats (mot 87 % för övriga källor) och 0 % hade beskrivning.

## Driving it with <harness>

```bash
cd /Users/claudgashi/EventPulse

# Berikning UTAN att skriva (alltid först)
npx tsx scripts/enrich-event-details.mjs --dry-run --per-source 2 --global 8
```

Utskrift (mätt 2026-11-01):

```
  filer genomskummade : 392
  rader granskade    : 9031
  rader hämtade      : 8
  rader berikade     : 5
  rader hoppade över : 9023
  hämtningar misslyckade: 0

  fält ifyllda: {"description":2,"venue":4,"image":5,"startTime":2}
  sidor som deklarerar artikel : 0
  sidor som deklarerar evenemang: 5

  exempel:
    · 3arena: "Hammarby Fotboll" → description, venue, image
    · 3arena: "Sverige–Skottland" → venue, image, startTime
    · astronomiska-huddinge: "Program hösten 2012" → image
```

Siffrorna varierar med hur mycket som är nytt. Nyckeln är att
`rader berikade > 0` och att fälten fylls med **beskrivning/plats/bild** —
det är dem berikningen finns för. `sidor som deklarerar evenemang` bör vara
högre än `sidor som deklarerar artikel` för riktiga eventkällor.

Verifiera att en enskild sida faktiskt bär uppgifterna:

```bash
npx tsx -e "
(async () => {
  const { extractDetailFacts } = await import('./02-Ingestion/tools/detailEnrichment.ts');
  const res = await fetch('https://kulturhusetstadsteatern.se/laslovet-2026');
  const f = extractDetailFacts(await res.text());
  console.log('beskrivning:', f.description?.length, 'tecken');
  console.log('jsonLd:', f.jsonLdTypes, 'og:', f.ogType);
})();
"
```

Verifiera att sammanslagningen fyller saknade och inte skriver över — direkt
mot modulen, utan nätverk och utan att skriva något:

```bash
npx tsx -e "
(async () => {
  const m = await import('./02-Ingestion/tools/detailEnrichment.ts');
  const facts = {
    title: null,
    description: 'Beskrivning från evenemangssidan som är längre än fyrtio tecken',
    image: 'https://ex.se/media/real.jpg',
    venue: 'Stora Teatern',
    address: 'Götgatan 4, Stockholm',
    startDate: '2026-11-02T19:00:00Z',
    jsonLdTypes: ['event'], ogType: 'website',
    declaredArticle: false, declaredEvent: true,
  };
  const saknad = {
    title: 'X', url: 'https://ex.se/e/1', sourceUrl: 'https://ex.se/listing',
    description: 'kort', imageUrl: 'https://ex.se/media/og-image.jpg', venue: '', venue_name: '',
  };
  console.log('missing(saknad rad):', m.missingEnrichableFields(saknad));
  const a = m.mergeEnrichment(saknad, facts);
  console.log('filled:', a.filled);
  console.log('audit:', JSON.stringify(a.row.raw_payload.enrichment));

  const har = { ...saknad,
    description: 'En redan färdig beskrivning som är längre än fyrtio tecken',
    venue: 'Kungliga Operan', imageUrl: 'https://ex.se/media/keep.jpg' };
  const b = m.mergeEnrichment(har, facts);
  console.log('filled(redan komplett rad):', b.filled);
  console.log('beskrivning oförändrad:', b.row.description === har.description,
              '| plats oförändrad:', b.row.venue === har.venue,
              '| bild oförändrad:', b.row.imageUrl === har.imageUrl);
  console.log('isDetailUrl(listningsrad):', m.isDetailUrl({ url:'https://ex.se/listing', sourceUrl:'https://ex.se/listing' }));
  console.log('isDetailUrl(detaljsida):', m.isDetailUrl({ url:'https://ex.se/e/1', sourceUrl:'https://ex.se/listing' }));
})();
"
# → förväntat: missing = ['description','venue','image'],
#   filled = ['description','venue','venue_address','image','startTime'],
#   och på den redan kompletta raden: beskrivning/plats/bild oförändrade.
```

**Det finns INGA enhetstester för `mergeEnrichment` i repot.** Kör därför
inte `npx vitest run 02-Ingestion/` som "bevis" — kommandot kör andra tester och
bevisar ingenting om sammanslagningen. Receptet ovan är beviset.

## Gotchas

- **Villkoret var INVERTERAT fram till 2026-11-01.** `mergeEnrichment` fyllde
  ett fält bara när raden redan *hade* ett värde, och fyllde aldrig de fält
  som faktiskt saknades. Hela berikningen var därmed en no-op för beskrivning
  och plats. Om berikningen verkar göra ingenting: läs
  `missingEnrichableFields` och `mergeEnrichment` i samma fil — de ska dela
  definition av "saknat".
- **"Saknad beskrivning" betyder under 40 tecken.** En kort text räknas som
  saknad och skrivs över med sidans egen. Mätt 2026-11-01: 825 av 3 663
  icke-tomma beskrivningar är kortare än 40 tecken — de **kommer** att
  skrivas över. Läs alltså "skriver inte över" som "skriver inte över ett
  användbart värde".
- **En generisk `og-image.jpg` räknas som saknad bild** — och skrivs över
  med sidans riktiga bild.
- **`venue_address` och `startTime` fylls utanför "saknat"-mängden.** De är
  inte i `missingEnrichableFields`, men skrivs ändå när de saknas. Därför kan
  `filled` innehålla fält som inte står i `missing`.
- **Beskrivning är fortfarande 0 % i grafen.** 211/518 rader har plats (41 %,
  baslinj 18 %) men 0/518 har beskrivning. Berikningen skriver `description`
  i extraktionsfilerna; importen mappar det vidare, men det har inte gått
  igenom en hel kedja ännu. Behandla som **ej verifierat**.
- **`--dry-run` skriver inte tillbaka.** Utan den skrivs
  `03-Queue/03-extractedevents/` över — en dataändring, inte en verifiering.
- **Rader med `mailto:` hämtas inte.** De är inte hämtbara, och de räknades
  tidigare som nätverksfel. `isFetchableUrl` filterar bort dem.
- **Kedjesteget ligger efter gaterna och före importen.** Gaternas beteende är
  oförändrat — berikningen är ett eget steg i
  `scripts/ingestion-cron.ts`, inte en del av gaten.
- **`--skip-images` hoppar över berikningen.** Steget ligger inuti ett
  `if (!skipImages)`-block i `ingestion-cron.ts` som också omslutar importen.
  Kör du med `--skip-images` laddas varken berikning eller import.
- **`startTime` skrivs ordagrant från JSON-LD.** Ett datum utan tid
  (`"2026-11-12"`) skrivs som det är, utan kedjans `toIsoStartTime`-konvention.
  Och en rad som redan bär `start_time` i snake_case behåller det — den
  berikade `startTime` ignoreras vid import (`eventStartTime` föredrar
  `start_time`).
