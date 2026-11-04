# Publicerad IPA

## Sub-features

- `PrivacyInfo.xcprivacy` i **app-target** (inte bara i bibliotekens bundles).
- `UIDeviceFamily == [1]` → iPhone-only → inga iPad-skärmbilder behövs.
- Entitlements: `aps-environment = production`, Sign in with Apple.
- JS-bundlen innehåller de nya juridiska texterna och saknar de gamla.
- Version/build läst ur `Info.plist`.

## How to get to it (user POV)

Det här lagret syns inte i UI:t — det är det Apple packar upp när den
granskar binären. Beviset är alltså artefakten: den IPA som lämnas in.

## Driving it with <harness>

```bash
node .cursor/skills/verify-eventpulse-launch/scripts/check-ipa.mjs <url|path.ipa>
```

Hämta IPA:n från `eas build:list` (senaste production-bygget) eller från
`docs/APPLE-SUBMISSION-METADATA.md`. Skriptet laddar ner, packar upp och
kontrollerar 26 punkter.

## Gotchas

- **Hermes + UTF-16.** Strängar med å/ä/ö lagras som UTF-16 i
  `main.jsbundle`. `grep "MiniMax"` ger 0 träffar trots att texten finns.
  Skriptet söker i båda encodings — gör du samma i egna grepar.
- **Aggregering.** Manifestet i app-targeten innehåller även de accessed-API:er
  som biblioteken deklarerat (UserDefaults CA92.1, FileTimestamp C617.1,
  SystemBootTime 35F9.1). Det är korrekt — byggen aggregerar.
- **`aps-environment` står som `development` i repot** men blir `production` i
  release-arkivet (Xcode gör bytet). Verifiera i **artefakten**, inte i
  `app.json`.
- **Buildnumret styrs av EAS** (`appVersionSource: remote`), inte av
  `app.json`. Senaste: 1.0.0 (3).
- **Bygget är inte TestFlight.** `eas submit` kräver App Store Connect-inloggning
  som inte finns i den här miljön. Steget är blockerat för ägaren.
