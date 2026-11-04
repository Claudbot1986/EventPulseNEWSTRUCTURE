# Profil + GDPR

## Sub-features

- Fliken "Profil" → "PROFIL / Sparade & inställningar".
- **Gästgren** (inte inloggad): "Lägg till e-post"-knapp, **juridiska länkar** (integritetspolicy + användarvillkor, med `LegalModal`), språkchips, "Om EventPulse".
- **Inloggad gren**: Konto/Logga ut, Radera konto, Följer-chips, push-växlar, **Integritet**-sektionen med GDPR-växeln, LegalLinks, språk, About.
- GDPR-växeln: "Anonym användarstatistik" → consent-nyckel `analytics.consent` (i `services/analyticsClient.js`, **inte** i `storage.js`).
- Språkbyte: **alla 15 språk** som chips, varje språk **med sitt eget namn** (`Svenska`, `English`, `Deutsch`, `简体中文`, `العربية`, `فارسی` …) → `eventpulse.language` (AsyncStorage; på web = `localStorage`). Icke-latina namn är **korrekta**, inte fel.

## How to get to it (user POV)

Klicka "Profil" i bottenstaplen.

## Driving it with Playwright

Ingen spec ännu. Recept för gästvägen:

1. Öppna appen, klicka fliken "Profil" (synlig `[role="tab"]`, `aria-label="Profil"`).
2. Vänta på texten "Sparade & inställningar".
3. Assera att **GDPR-växeln inte syns** för gäst (`analytics-consent-switch` ska ha count 0).
4. **Juridiska länkar syns för gäst** (Apple §5.1.1(i)): `[data-testid="open-privacy-policy"]` och `[data-testid="open-terms-of-service"]` ska ha count 1 vardera. Tryck policyn → modalen ska innehålla riktig text och **inga** råa `legal.privacy.`/`legal.terms.`-nycklar. Stäng via `[data-testid="legal-modal-close"]`.
5. Tryck språkchipen "English" → rubriken ska byta till "Saved & settings" och `localStorage['eventpulse.language']` ska vara `'en'`. Tryck sedan "Svenska" tillbaka.
6. Tryck "Lägg till e-post" → login-modalen ska öppna ("Logga in med email").

## Gotchas

- **GDPR-växeln är onåbar för gäster.** `ProfileScreen.js:672` returnerar gästgrenen före Integritet-sektionen. FEATURE_MAP § 9 ("GDPR-samtycke") är därmed **inte** som beskrivet — bara inloggade når växeln.
- `aria-selected` finns inte i DOM (RNW mappar inte `accessibilityState.selected`). Välj flik på `role="tab"` + synlighet.
- **En "Profil"-etikett i DOM** (sedan 2026-10-28). App.js:s egen tabbar döljs via `hideInternalTabBar` (`AppShell.js:592` → `App.js:2370`) — verifierat live 2026-11-04: `[role="tab"]` → 5 träffar, `role="tablist"` → 0.
- `Alert.alert()` är **no-op på web** (RNW-stub) → "Radera konto"-bekräftelsen och unfollow-arken är döda i webbbygget utan felmeddelande.
- `ActionSheetIOS` importeras men exporteras inte av RNW → `undefined` på web (skyddat av `Platform.OS === 'ios'`).
- **Rätta 2026-11-04:** `LegalModal` visar **inte** längre råa i18n-nycklar. `buildSections` filtrerar bort nyckel-ekot (`LegalModal.js:259-269`), så `legal.privacy.p1.bullets` / `p2a/p2b/p2c.body` inte renderas. Regressionstest: `e2e/legal-policy.test.mjs`.
- **Rätta 2026-11-04:** inga `[TODO: …]`-rader kvar i `i18n/strings/{sv,en,it}.js`, och AI-utkastbannern är borta (`_legalDraftOnly` = `'0'`). Samma regressionstest.
- **Juridiska länkar och `LegalModal` finns i gästgrenen** (Apple §5.1.1(i)). Verifierat live 2026-11-04: `[data-testid="open-privacy-policy"]` och `[data-testid="open-terms-of-service"]` synliga utan inloggning.
- **ProfilScreen läser sessionen bara vid mount** (`ProfileScreen.js:377-391`). Efter en demologin måste sidan laddas om innan inloggad gren syns.
- "Om EventPulse" har **ingen** `onPress` → död kontroll.
