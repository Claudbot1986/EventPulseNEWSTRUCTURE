# Profil + GDPR

## Sub-features

- Fliken "Profil" → "PROFIL / Sparade & inställningar".
- **Gästgren** (inte inloggad): "Lägg till e-post"-knapp, språkchips, "Om EventPulse".
- **Inloggad gren**: Konto/Logga ut, Radera konto, Följer-chips, push-växlar, **Integritet**-sektionen med GDPR-växeln, Integritetspolicy, Användarvillkor, språk, About.
- GDPR-växeln: "Anonym användarstatistik" → consent-nyckel `analytics.consent` (i `services/analyticsClient.js`, **inte** i `storage.js`).
- Språkbyte: **alla 15 språk** som chips, varje språk **med sitt eget namn** (`Svenska`, `English`, `Deutsch`, `简体中文`, `العربية`, `فارسی` …) → `eventpulse.language` (AsyncStorage; på web = `localStorage`). Icke-latina namn är **korrekta**, inte fel.

## How to get to it (user POV)

Klicka "Profil" i bottenstaplen.

## Driving it with Playwright

Ingen spec ännu. Recept för gästvägen:

1. Öppna appen, klicka fliken "Profil" (synlig `[role="tab"]`, `aria-label="Profil"`).
2. Vänta på texten "Sparade & inställningar".
3. Assera att **GDPR-växeln inte syns** för gäst (`analytics-consent-switch` ska ha count 0).
4. Tryck språkchipen "English" → rubriken ska byta till "Saved & settings" och `localStorage['eventpulse.language']` ska vara `'en'`. Tryck sedan "Svenska" tillbaka.
5. Tryck "Lägg till e-post" → login-modalen ska öppna ("Logga in med email").

## Gotchas

- **GDPR-växeln är onåbar för gäster.** `ProfileScreen.js:614` returnerar gästgrenen före Integritet-sektionen. FEATURE_MAP § 9 ("GDPR-samtycke") är därmed **inte** som beskrivet — bara inloggade når växeln.
- `aria-selected` finns inte i DOM (RNW mappar inte `accessibilityState.selected`). Välj flik på `role="tab"` + synlighet.
- **Två "Profil"-etiketter i DOM** (dold App.js-tabb + synlig BottomTabBar) → välj den synliga.
- `Alert.alert()` är **no-op på web** (RNW-stub) → "Radera konto"-bekräftelsen och unfollow-arken är döda i webbbygget utan felmeddelande.
- `ActionSheetIOS` importeras men exporteras inte av RNW → `undefined` på web (skyddat av `Platform.OS === 'ios'`).
- `LegalModal` visar **råa i18n-nycklar** (`legal.privacy.p2a.body` m.fl.) i 27 av 28 stycken — sv/en saknar `body`/`bullets` för de flesta sektionerna.
- Policytexten innehåller kvarhållna `[TODO: …]`-rader som exponeras för slutanvändare.
- "Om EventPulse" har **ingen** `onPress` → död kontroll.
