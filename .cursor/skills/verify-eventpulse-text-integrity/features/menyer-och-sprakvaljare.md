# Menyer, flikar och språkväljare

## Sub-features

- **Bottenflikar** — Hem, Utforska, Karta, Notiser, Profil.
- **Språkväljare** (Profil) — alla 15 språk med sina egna namn.
- **Notiser** — påminnelser, ny matchning, svar.
- **Profil** — språk, GDPR-växel, inställningar.

## How to get to it (user POV)

Tryck respektive flik i bottenfältet. Språkväjaren ligger i Profil.

## Driving it with Playwright

```bash
node .cursor/skills/verify-eventpulse-text-integrity/scripts/text-integrity-scan.mjs \
  --language sv --screenshot
```

Drivaren går igenom Utforska → Karta → Notiser → Profil och scannar varje yta.

## Gotchas

- **Språkväjarens språknamn är korrekta icke-latina tecken.** "简体中文",
  "العربية" och "فارسی" ska INTE rapporteras som fel. Skriptet vet detta
  eftersom `--language` anger vad som är tillåtet — men en audit som
  körs med fel språkflagga flaggar dem.
- Det finns **två tabbares i DOM** (App.js:s egen är dold). Tryck bara på
  synliga flikar.
- Notiser och Profil kan vara tomma för en gäst — det är ett korrekt
  "tomt läge", inte ett fel.
