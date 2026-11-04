# verify-eventpulse-ui/features — index

Feature-map för verify-skillen. Speglar `06-UI/FEATURE_MAP.md` — **men beskriver
det som faktiskt är monterat och verifierat 2026-11-04**, inte det kartan påstår.
Där kartan och verkligheten skiljer sig står det i respektive feature-fil under
"Likely drift" / "Gotchas".

> **Underhållspass 2026-11-04:** 15 read-only `explore`-subagenter (en per feature-fil)
> + live-pass över hela e2e-sviten. **Outcome: `changed`** — 11 feature-filer rättade,
> 2 harness-fixar + 4 visual-regression-baselines tillagda. Detaljer i `SKILL.md` (Maintenance).

| # | Feature | Fil | Status | Native-unreachable del | Senast live-verifierad |
|---|---|---|---|---|---|
| 1 | save-favorite | `save-favorite.md` | live (men **persisterar inte för användaren**) | – | 2/2 tester gröna 2026-11-04 |
| 2 | push-notiser | `push-din-helg.md` | prompten **syns på webb** (verifierat) men är inert | ja (token) | prompt-modal renderad 2026-11-04 |
| 3 | agent-chatt (UI) | `agent-chat-ui.md` | **dormant** — ingen ingång | – | verified-unreachable (ingen flik) |
| 4 | utforska | `utforska.md` | live | – | **18/18 kategorier** öppnade |
| 5 | hem | `hem.md` | live | – | **9/9 sektioner** öppnade + Tillbaka OK |
| 6 | karta | `karta.md` | live | ja (pins) | 4 filter + TOTAL/VISIBLE verifierat (baseline) |
| 7 | sök | `search.md` | live (i Utforska) | – | 3/3 tester gröna; SearchScreen är död kod |
| 8 | onboarding | `onboarding.md` | live | – | ej driven (bypasses i .env) |
| 9 | profil + gdpr | `profil.md` | live | – | gästgren + **juridiska länkar** verifierade |
| 10 | notifikationer (lista) | `notifications.md` | live | – | tomt läge verifierat |
| 11 | bildgenerering | utanför — se `08-Agent` | experimental | – | utanför scope |
| 12 | autentisering | `auth.md` | live (+ demologin) | ja (Apple) | 2 PASS + 1 korrekt skip 2026-11-04 |
| 13 | locale / i18n | `i18n.md` | live | – | **15 språk**, inte 10 |
| 14 | analytics | `analytics.md` | env-gaten är **ÖPPEN** i lokal build | – | 0 requests som gäst; väntar på consent |
| 15 | helg-chips + intent | `helg-chips.md` | **dormant** — inga chips monterade | – | verified-unreachable via UI |
| 16 | event-detalj | `event-detail.md` | live | delvis (kalender/dela) | **6/6 knappar tryckta**, 0 fel, 0 kapslade knappar |

Nytillkommet (2026-10-28) som inte finns i `06-UI/FEATURE_MAP.md`:

| # | Feature | Fil | Status | Native-unreachable del | Senast live-verifierad |
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

## Gemensamma selektorer (verifierade live 2026-11-04)

| Sak | Selektor |
|---|---|
| Hem-roten | `[data-testid="home-screen"]` |
| Karusell (sektion) | `[role="list"]` med `aria-label="<Rubrik> — karusell"` |
| Eventkort (tryckbart) | `<button>` med `aria-label` = `<underetikett> — <titel>` (Senaste: omvänd ordning; med flera datum: tredje del `— N andra datum`) |
| Detaljskort-knappar | `aria-label` = Spara / Visa karta / Lägg till i kalender / Dela / Fler alternativ |
| Bild i karusell | `[data-testid="event-card-image"]` · Senaste: `event-card-image-latest` |
| "Läs mer" | `[data-testid="event-card-read-more"]` |
| Kategorirutor | `<button>` med `aria-label` = kategorinamnet |
| Kategoriskärm | `[data-testid="utforska-section-screen"]` |
| Sökfält | `[data-testid="explore-search-input"]` / `explore-search-textinput` |
| Flik | `[role="tab"]` med `aria-label` ( Hem / Utforska / Karta / Notiser / Profil ) — **exakt 5** |
| Tillbaka (detaljskärm) | texten `"< Tillbaka"` — naket `<div>`, ingen aria-label |
| Tillbaka (kategoriskärm) | `<button aria-label="Tillbaka">` |
| Juridiska länkar | `[data-testid="open-privacy-policy"]` / `open-terms-of-service` |
| Juridisk modal | `[data-testid="legal-modal-close"]` |
| Push-prompt | `[data-testid="push-prompt-modal"]` / `push-prompt-accept` / `push-prompt-decline` |
| Demologin | `[data-testid="demo-login-email"]` / `-password` / `-submit` |

## Tre landminer

1. **EN tabbar i DOM.** App.js:s egen är dold via `hideInternalTabBar` (`AppShell.js:592` → `App.js:2370`). Verifierat live 2026-11-04: `[role="tab"]` → **5**, `role="tablist"` → **0**. Tryck bara på **synliga** element.
2. **`aria-selected` finns inte i DOM.** RNW mappar inte `accessibilityState.selected`. Välj flik på `[role="tab"]` + synlighet.
3. **Tryck måste ske via pointer-events** (`pointerdown` + `pointerup` + `click`). `page.click()` triggar inte RNW:s Pressable — använd `e2e/helpers/ui.mjs`.

> **Fynd 2026-11-04:** `tapTab` matchade tidigare bland *alla* knappar med "innehåller etiketten". "Hem" träffade ett evenemang med "hemsidan" i titeln. Nu söks `[role="tab"]` först (exakt matchning före delmatchning).

## Visual regression

Baselines: `06-UI/e2e/visual-regression/baseline/*.png` (4 live-vyer + 2 fixtures).
**Baselines saknades helt tills 2026-11-04** och de gamla "kritiska vyerna" navigerade via
webbroutes — appen har ingen router, så alla fyra skärmbilder visade Hem. Specen klickar
nu flikar och väntar på skärmspecifika markörer. `AGENT — Chatt` ersattes av
`PROFIL — Gästvy + juridik` (chatten är dormant).
