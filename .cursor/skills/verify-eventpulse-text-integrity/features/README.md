# verify-eventpulse-text-integrity/features — index

Feature-map för textintegritets-skillen. Frågan varje feature svarar på:
**"visas det något som inte hör hemma i det språk appen visar just nu?"**

| # | Feature | Fil | Status | Live-verifierad 2026-10-30 |
|---|---|---|---|---|
| 1 | Hem — kort och karuseller | `hem-kort-och-karuseller.md` | live | 306 textnoder, 0 fynd |
| 2 | Event-detaljvy | `event-detaljvy.md` | live | 21 textnoder, 0 fynd |
| 3 | Utforska — lista och kategorier | `utforska-och-sok.md` | live | **18 fynd (koreanska lokal)** |
| 4 | Sök och sökresultat | `utforska-och-sok.md` | live | 18 fynd i söklistan |
| 5 | Menyer, flikar och språkväljare | `menyer-och-sprakvaljare.md` | live | 3 fynd — **korrekta** (språknamn) |
| 6 | Karta | `utforska-och-sok.md` | live | 24 textnoder, 0 fynd |
| 7 | Notiser | `menyer-och-sprakvaljare.md` | live | 17 textnoder, 0 fynd |
| 8 | Databasen (alla events) | `databasen-och-ingestion.md` | live | 1 008 fynd i 936 events |

## Vad som räknas som fel

| Fynd | Rätt eller fel? |
|---|---|
| Kinesiska/han i ett eventkort i en svensk app | **Fel** |
| Koreanska lokalnamn i listan | **Fel** |
| Rysk titel i en svensk app | **Fel i presentation** — ska översättas, aldrig raderas |
| "简体中文" i språkväjaren | **Rätt** — språkets eget namn |
| "العربية" i språkväjaren | **Rätt** |

Skriptet vet skillnaden genom `--language`: skript som språket självt
använder räknas aldrig som främmande.

## Gemensamma selektorer (verifierade live)

| Sak | Selektor |
|---|---|
| Hem-roten | `[data-testid="home-screen"]` |
| Eventkort | `<button>` med `aria-label="<meta> — <titel>"` |
| Sökfält | `[data-testid="explore-search-input"]` |
| Flik | `[role="tab"]` med `aria-label` (Hem / Utforska / Karta / Notiser / Profil) |
| Tillbaka | text innehåller "Tillbaka" — **inte** `role=button` |

## Tre landminer

1. **Utan lokal agent på 8787 laddas ingen feed** → audit blir falskt ren.
2. **Appen har två tabbares i DOM** — tryck bara på synliga.
3. **"Tillbaka" lämnar Hem kvar i DOM** om du inte väntar in att Hem syns igen.
