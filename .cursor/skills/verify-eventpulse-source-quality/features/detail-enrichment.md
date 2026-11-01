# Detaljberikning — informationen som ligger utanför biljettkortet

## Sub-features

- **HTML-parsning** — `extractDetailFacts` läser JSON-LD, `og:`-metataggar
  och brödtext ur evenemangssidan: beskrivning, bild, plats, adress, starttid.
- **Sammanslagning** — `mergeEnrichment` fyller **bara saknade fält** och
  skriver aldrig över ett värde som redan finns.
- **Utval** — `isDetailUrl` väljer de rader som pekar på en egen evenemangssida
  (url ≠ sourceUrl). Listningsrader hoppas över.
- **Budget** — `--per-source` och `--global` sätter tak, så en natt med
  tusentals rader inte blir tusentals hämtningar.
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

Verifiera att sammanslagningen fyller saknade och inte skriver över:

```bash
npx vitest run 02-Ingestion/
# sök efter testerna som täcker mergeEnrichment
```

## Gotchas

- **Villkoret var INVERTERAT fram till 2026-11-01.** `mergeEnrichment` fyllde
  ett fält bara när raden redan *hade* ett värde, och fyllde aldrig de fält
  som faktiskt saknades. Hela berikningen var därmed en no-op för beskrivning
  och plats. Om berikningen verkar göra ingenting: läs
  `missingEnrichableFields` och `mergeEnrichment` i samma fil — de ska dela
  definition av "saknat".
- **"Saknad beskrivning" betyder under 40 tecken.** En kort text räknas som
  saknad och kan skrivas över med sidans egen.
- **En generisk `og-image.jpg` räknas som saknad bild** — och skrivs över
  med sidans riktiga bild.
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
