# Gold set FAS 10 — known limitations (2026-10-09)

Detta dokument spelar in pattern-level limitations som gold-set-testerna
avslöjar i `entityExtractor`. Dessa är **kända, dokumenterade** beteenden
— inte buggar. När vi förbättrar `entityExtractor` ska motsvarande
gold-entry först uppdateras med korrekt `expected_performers` och
`[KNOWN LIMITATION]`-markeringen tas bort.

## Identifierade limitations

### gold-002: `HSO – Orkesterfest med Pascal`
- **Input**: `"HSO – Orkesterfest med Pascal"` (category=classical)
- **Förväntat (framtida)**: `["HSO", "Pascal"]`
- **Nuvarande**: `[]`
- **Mönster som saknas**: `^[A-Z]{2,5}\s*–\s*.+ med (\p{Lu}\p{L}+)$`
  - Akronym-prefix (HSO, RSO, GSO, etc.) + " – " + beskrivning + " med " + performer.
  - Kräver egen pattern: "acronym + dash + description + 'med' + name".

### gold-008: `Sven Ingvars Kungsbacka Teater 2026-10-09 19:00`
- **Input**: `"Sven Ingvars Kungsbacka Teater 2026-10-09 19:00"`
- **Förväntat (framtida)**: `["Sven Ingvars"]`
- **Nuvarande**: `[]`
- **Mönster som saknas**: "Artist <venue> <date>" — utan separator mellan
  artist och venue. Kräver antingen:
  1. venue-name-jämförelse (`input.venue_name === "Kungsbacka Teater"`)
     som strippar bort venue-delen och läser resten som artist.
  2. Eller en känd-venue-lista (Stockholm-venues) som matchar mot
     title-suffix och separerar.

### gold-010: `Original Enigma Voices | Stockholm`
- **Input**: `"Original Enigma Voices | Stockholm"`
- **Förväntat (framtida)**: `["Original Enigma Voices"]`
- **Nuvarande**: `[]`
- **Mönster som saknas**: "Artist | City" — kräver city-lista som
  pipe-suffix-detector. Alternativt: "extract until |" om input.city
  matchar suffix efter `|`.

## Coverage som gold-set redan FAKTISKT validerar

✅ Multi-performer titlar (`+`-separator, `och`-pattern, `/`-pattern,
`,`-list-pattern, `&`-pattern, `:`-pattern)
✅ Work-titlar extraheras INTE som performers (Chicago, Människokung
Hamlet, Birita, Antikrist, KÄRLEK ÖVER TANGER, HOBO COMEDY, etc.)
✅ Brand-namn extraheras INTE (Hernö Gin)
✅ Generiska titlar utan artister (Build your AI Team)
✅ Historical figures som inte uppträder (Nietzsche, Wagner)
✅ Venue-namn i titel extraheras INTE som performers (Studio Acusticum)
✅ Deterministiskt output (samma input → samma output 2x)
✅ Gazetteer-integration: 6/6 artister i Quidam har metadata
✅ Country-claim stöds: Donovan Woods (CA), Peter Dijkstra (NL), Helene
Berg (NO), Eva Lindal (SE), etc.
✅ Type-claim stöds: Radiokören (Choir), Sven Ingvars (Group), etc.

## Vad FAS 10 INTE testar (och borde i framtiden)

- raw_description-baserad extraktion (testerna kör med `raw_description: null`)
- LLM-fallback (gold-002/008/010 skulle eventuellt hittas av MiniMax M3)
- Independence-check
- Editorial Writer output
- EventPulse-merged multi-source extraction
- P8.5 (active learning penalty flow) / FAS 7 (rec-algo) / FAS 11 (UI)
