# verify-eventpulse-ui/features — index

Feature-map för verify-skillen. Speglar `06-UI/FEATURE_MAP.md` — **men beskriver
det som faktiskt är monterat 2026-10-28**, inte det kartan påstår.
Där kartan och verkligheten skiljer sig står det i respektive feature-fil under
"Likely drift" / "Gotchas".

| # | Feature | Fil | Status | Native-unreachable del | Live-verifierad 2026-10-28 |
|---|---|---|---|---|---|
| 1 | save-favorite | `save-favorite.md` | live (men **persisterar inget**) | – | UI flippar, 0 persistens — bevisad lucka |
| 2 | push-notiser | `push-din-helg.md` | behind-flag | ja | nej (native) |
| 3 | agent-chatt (UI) | `agent-chat-ui.md` | **dormant** — ingen ingång | – | verified-unreachable (ingen flik) |
| 4 | utforska | `utforska.md` | live | – | **18/18 kategorier öppnade** |
| 5 | hem | `hem.md` | live | – | **9/9 sektioner öppnade + Tillbaka OK** |
| 6 | karta | `karta.md` | live | ja | fliken öppnar, panel visas; **krasch fixad** |
| 7 | sök | `search.md` | live (i Utforska) | – | sökfältet finns; SearchScreen är död kod |
| 8 | onboarding | `onboarding.md` | live | – | ej driven (skip-flagga satt) |
| 9 | profil + gdpr | `profil.md` | live | – | fliken öppnar; **GDPR-växeln onåbar för gäst** |
| 10 | notifikationer (lista) | `notifications.md` | live | – | tomt läge verifierat |
| 11 | bildgenerering | utanför — se `08-Agent` | experimental | – | utanför scope |
| 12 | autentisering | `auth.md` | live | ja (Apple) | vägen från UI verifierad i källan |
| 13 | locale / i18n | `i18n.md` | live | – | 15 språk, inte 10 |
| 14 | analytics | `analytics.md` | **avstängd i default-build** | – | 0 requests utan env + konto |
| 15 | helg-chips + intent | `helg-chips.md` | **dormant** — inga chips monterade | – | verified-unreachable via UI |

Nytillkommet (2026-10-28) som inte finns i `06-UI/FEATURE_MAP.md`:

| # | Feature | Fil | Status | Native-unreachable del | Live-verifierad 2026-10-28 |
|---|---|---|---|---|---|
| 16 | event-detalj (DetailsScreen / NewEventCard) | `event-detail.md` | live | delvis (kalender/dela) | **6/6 knappar tryckta, 0 fel, 0 kapslade knappar** |

Cross-cutting concerns som INTE har egna feature-filer:
- `06-UI/services/storage.js` (AsyncStorage-wrapper; web = `window.localStorage`, **utan prefix**)
- `06-UI/services/supabaseAuthClient.js`
- `06-UI/i18n/` (runtime; 15 språk)
- `06-UI/web-shims/` (react-native-maps m.fl. — måste finnas för att webbbygget ska boota)
- dark mode tokens

Varje feature-fil har fyra H2:er: `Sub-features`, `How to get to it (user POV)`,
`Driving it with <harness>`, `Gotchas`. Drift i någon av dessa är
`verify-eventpulse-ui`-skillens ansvar — produktkod-drift rapporteras separat
och fixas i produktkod, inte i dokumentationen.

## Gemensamma selektorer (verifierade live)

| Sak | Selektor |
|---|---|
| Hem-roten | `[data-testid="home-screen"]` |
| Karusell (sektion) | `[role="list"]` med `aria-label="<Rubrik> — karusell"` |
| Eventkort (tryckbart) | `<button>` med `aria-label="<meta> — <titel>"` |
| Detaljskort-knappar | `aria-label` = Spara / Visa karta / Lägg till i kalender / Dela / Fler alternativ |
| "Läs mer" | `[data-testid="event-card-read-more"]` |
| Kategorirutor | `<button>` med `aria-label` = kategorinamnet |
| Kategoriskärm | `[data-testid="utforska-section-screen"]` |
| Sökfält | `[data-testid="explore-search-input"]` |
| Flik | `[role="tab"]` med `aria-label` ( Hem / Utforska / Karta / Notiser / Profil ) |
| Tillbaka | texten `"< Tillbaka"` — **inte** `role=button` |

## Tre landmines

1. **Appen har två tabbares i DOM.** App.js:s egen är dold (`display:none`), AppShells är synlig. Tryck bara på **synliga** element, annars träffar du den dolda.
2. **`aria-selected` finns inte i DOM.** RNW mappar inte `accessibilityState.selected`.
3. **Tryck måste ske via pointer-events** (`pointerdown` + `pointerup` + `click`). `page.click()` triggar inte RNW:s Pressable — använd `e2e/helpers/ui.mjs`.
