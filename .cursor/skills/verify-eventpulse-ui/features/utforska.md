# Utforska — kategorier och sök

## Sub-features

- Sökrutan (`data-testid="explore-search-input"`) ligger **högst upp i Utforska-fliken** — sök sker i samma vy, ingen separat sökskärm.
- **18 kategorirutor** i ett 2×9-rutnät, alltid synliga: Musik, Opera, Komedi, Drama, Dans, Cirkus, Utställning, Loppis, Mat & Dryck, Vintasting, Barn, Familj, Film, Föreläsningar, Workshop, Sport, Nattliv, Community.
- En kategori öppnar `ExploreDetailScreen` (`data-testid="utforska-section-screen"`) med rubrikformen `RUBRIK · N EVENEMANG`, en rullista av events och en "Tillbaka"-knapp.
- Varje rad har en egen "⋯"-meny (`aria-label="Fler alternativ"`) med åtgärder (bl.a. Inte intresserad / Spara / Dela).
- Rader laddas mer vid scroll (`EXPLORE_PAGE_SIZE = 15`).
- Det finns **en** synlig tabbar i DOM: AppShells `BottomTabBar`. App.js:s egen renderas inte (AppShell passerar `hideInternalTabBar`).

## How to get to it (user POV)

Klicka "Utforska" i bottenstaplen. Kategorirutorna ligger ovanför söklistan.

## Driving it with Playwright

Spec: `06-UI/e2e/utforska-categories.test.mjs`.

Nycklar:

- Kategoriknapparna är `<button>` med `aria-label` = kategorinamn exakt ("Musik", "Mat & Dryck").
- Detaljskärmen: `data-testid="utforska-section-screen"`, rubrik `RUBRIK · N EVENEMANG`.
- Tillbaka: texten `"< Tillbaka"` (inte `role=button`).
- Radens tryckyta är `div[role="button"]` (inte `<button>`) med `aria-label="<titel> — <undertext>"` — matcha på `[role="button"]`; radmenyn: `aria-label="Fler alternativ"`.

Recept: öppna Utforska → för varje kategori: tryck kategorinamn → vänta på `utforska-section-screen` → läs rubrikens evenemangstal → tryck "Tillbaka" → nästa kategori.

## Gotchas

- **Agent-API:t rate-limitar** (token bucket, 10 rps / burst 40 per IP för `/agent/feed` — 5 rps / burst 20 gäller `/agent/chat`). Snabb kategoribrowsing ger **429**; appen visar då ärligt felmeddelandet "Kunde inte hämta evenemang. Försök igen." Det är verifierat felbeteende, inte en krasch — kör specen med paus mellan kategorier.
- Det finns **två** `ProfileScreen`-/`Karta`-etiketter i DOM (dold + synlig tabbar). Tryck bara på **synliga** element.
- `ExploreDetailScreen` gör **två** feed-anrop per kategori (sida + total), vilket dubblerar rate-limittrycket.
- `aria-selected` finns **inte** i DOM (RNW mappar inte `accessibilityState.selected`) — välj flik på `role="tab"` + synlighet, inte på `aria-selected`.
- Radens "⋯"-knapp låg tidigare **inuti** radens `<button>` → "button cannot be a descendant of `<button>`". Fixat 2026-10-28 genom att göra raden till en `View` med en tryckbar yta.
- Sökfel **sväljs tyst** (`services/agentClient.js` → `search.error`, ingen synlig feedback i UI). Det är en produktlucka, inte en harnesslucka.
