# Juridisk text i appen

## Sub-features

- Integritetspolicyn i appen (11 avsnitt, sv/en/it).
- Användarvillkoren i appen.
- AI-utkastsbanner (`_legalDraftOnly`) som inte får visas.
- Rätt leverantörsuppgifter: MiniMax som AI-mottagare, Supabase-region
  eu-north-1, kontakt `hej@eventpulse.nu`.
- Att policy-raderna finns i **gästläget** (appens defaultläge).

## How to get to it (user POV)

Öppna appen → fliken **Profil** → **Integritetspolicy** (eller
**Användarvillkor**). Ingen inloggning behövs. I gästläget ligger länkerna
under konto-sektionen; i inloggat läge under GDPR-sektionen.

## Driving it with Playwright

```bash
cd 06-UI
BASE_URL=http://localhost:9090 npx playwright test e2e/legal-policy.test.mjs
```

Specen öppnar Profil → trycker `[data-testid="open-privacy-policy"]` /
`[data-testid="open-terms-of-service"]` och **läser den renderade texten**.
Den assertar att:

- ingen `[TODO:` syns,
- bannern inte syns,
- "MiniMax" och "eu-north-1" finns,
- `privacy@eventpulse.nu` och "salt-nyckel" inte finns,
- villkoren säger 18 år (inte 16),
- inga konsolfel under körningen.

Bevis: `runtime/verification-reports/ui-verify-<ts>/privacy-policy.png` och
`terms-of-service.png`.

## Gotchas

- **Gästläget är default.** En refaktorering av `ProfileScreen` som flyttar
  `LegalLinks` ur gästgrenen gör att en granskare inte hittar policyn
  alls. Specen fångar detta (testet kör som gäst).
- **`_legalDraftOnly` styr visningen, inte texten.** Strängen "AI-utkast"
  finns kvar i bundlen — bara bannern är avstängd. Verifiera i UI:t, inte i
  grep.
- **Tre språk har juridisk text** (sv, en, it). Övriga 12 språk faller
  tillbaka på engelska via `i18n/index.js`. En ändring måste göras i alla
  tre, annars skiljer sig innehållet åt.
- **Rätt kontaktadress** är `hej@eventpulse.nu` (den adress som används på
  webbplatsen). `privacy@` togs bort 2026-11-04.
