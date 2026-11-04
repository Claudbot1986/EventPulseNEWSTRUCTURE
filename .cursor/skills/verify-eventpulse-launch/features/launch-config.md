# Lanseringskonfiguration

## Sub-features

- `ios.privacyManifests`: sex datatyper, tracking false, inga tracking-domäner.
- `ios.supportsTablet: false` → iPhone-only.
- `ITSAppUsesNonExemptEncryption: false` och `NSAllowsArbitraryLoads: false`.
- EAS production-profil: demo-flaggan på, **inget lösenord i git**.
- Juridiska texter i sv/en/it: inga `[TODO:]`, `_legalDraftOnly = '0'`,
  MiniMax, eu-north-1, `hej@eventpulse.nu`, 18 år, inga gamla formuleringar.
- Kartprovider: `PROVIDER_APPLE` i båda kartvyer.
- `LegalLinks` renderas i både gäst- och inloggad gren.

## How to get to it (user POV)

Det här är lagret Apple läser ur `app.json` innan appen ens startar. Det
syns inte för användaren — det är därför det måste verifieras separat från
det som syns.

## Driving it with <harness>

```bash
node .cursor/skills/verify-eventpulse-launch/scripts/check-app-config.mjs .
```

49 kontroller, exit non-zero vid första felet. Kräver ingen Metro — det är
en ren filkontroll.

## Gotchas

- **`PROVIDER_DEFAULT` i kommentarer är okej.** Koden förklarar varför vi
  *inte* använder Google Maps. Skriptet särskiljer kommentarrader från kod —
  gör inte samma fel när du skriver egna grepar.
- **Tre språk, tre filer.** `sv.js`, `en.js`, `it.js` har juridisk text.
  Skriptet hittar dem automatiskt via `legal.privacy.p1.body`.
- **`app.json` och `eas.json` är olika lager.** `app.json` beskriver appen,
  `eas.json` bygget. Demo-flaggan ligger i `eas.json`, policy manifestet i
  `app.json`.
- **`.env` är gitignored** och innehåller demolösenordet. Lägg aldrig in
  lösenord i `eas.json` — skriptet assertar att det inte finns.
