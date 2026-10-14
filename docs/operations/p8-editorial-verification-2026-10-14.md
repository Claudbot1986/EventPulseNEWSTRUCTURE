# Editorial Description Verification — 2026-10-14

## Sample: 21 events från 7 kategorier (theatre-drama, music, community, exhibition, opera, sports, family)

### Resultat: 18/21 OK, 3 false positives
- 3 "flaggade" exhibition-events säger "Typ: exhibition" — detta är KORREKT efter reklassificeringen (exhibition är egen event_type).
- Mitt script hade en gammal mappning (exhibition → community) som är inaktuell.

### Konklusion: 21/21 description är spårbara och icke-vilseledande.

## Hur verifiering gick till
- Sample av 21 events (3 från varje kategori × 7 kategorier)
- Parsa `Typ:`, `Plats:`, `Pris:`, `Medverkande:` från description
- Korskolla mot Profile (performers, genres), venue_full_name, price_min_sek, is_free, start_time

## Säkerhetsantaganden
- Description är deterministiskt genererad från strukturerade fält (Profile + events-tabell).
- Inga LLM-gissningar (--no-m3 aktivt under backfill).
- Alla label:value-par spårbara till Profile eller DB-kolumner.

## Testresultat
- 433/433 editor-tester gröna (15 NLI-tester + 418 befintliga)
- 9 nya commits på bfl-branch denna session
