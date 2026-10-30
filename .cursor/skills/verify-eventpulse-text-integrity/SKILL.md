---
name: verify-eventpulse-text-integrity
description: "Verify EventPulse's text integrity — drives the real Expo web app across every surface and finds Chinese/Asian/other non-Latin scripts that do not belong in the language the app is showing. Use for /verify-eventpulse-text-integrity, 'check for Chinese characters in the app', 'teckenkontroll', text-integrity regression checks, or after any ingestion run that may have introduced foreign scripts."
---

# verify-eventpulse-text-integrity

## Launch

Web build via Metro på port **9090** + **lokal agent på 8787**.

```bash
cd 06-UI
npm --prefix .. run start:agent &                        # 08-Agent/server.ts → :8787
EXPO_PUBLIC_AGENT_URL=http://localhost:8787 PORT=9090 ./scripts/launch-metro.sh
EXPO_PUBLIC_AGENT_URL=http://localhost:8787 PORT=9090 ./scripts/doctor-metro.sh
```

**Varför lokal agent (inte prod):** prod-API:t på `eventpulse-agent.fly.dev` har en
origin-allowlist (`AGENT_ALLOWED_ORIGINS`). Utan `localhost:9090` i listan
svarar servern 403 och appen loggar "Failed to load events". Då laddas **ingen
feed** och en audit blir falskt "ren" — det värsta utfallet. Detta är
harnessens jobb, inte appens.

Ready-signal: Metro-loggen visar "Waiting on http://localhost:9090", första
`GET /` svarar 200, och `curl -s http://localhost:8787/agent/health` ger
`{"ok":true,"phase":0}`.

Isolering: en Metro-process äger 9090, en agentprocess äger 8787. Kör inte två
`expo start` parallellt — byt port (`PORT=9091`) och sätt `BASE_URL` om du
måste köra samtidigt.

`EXPO_PUBLIC_*` läses vid **bundle-time**. Ändra `.env` → starta om Metro.

## Doctor

```bash
cd 06-UI && EXPO_PUBLIC_AGENT_URL=http://localhost:8787 PORT=9090 ./scripts/doctor-metro.sh
```

Kontrollerar Metro-root (200), Expo-mount-point, att **web-bundlen byggs**, och
att agent-API:t svarar. Exit non-zero = stoppa och relauncha.

**Extra kontroll som doctor inte gör:** öppna `http://localhost:9090` och
bekräfta att Hem faktiskt visar eventkort. En tom feed (403/CORS) ger 0
fynd utan att felet syns i auditrapporten.

## Drive

Harness: Playwright (installeras i `06-UI/node_modules`, nås via
`createRequire` mot `06-UI/package.json`).

```bash
cd /Users/claudgashi/EventPulse
node .cursor/skills/verify-eventpulse-text-integrity/scripts/text-integrity-scan.mjs \
  --language sv --screenshot
node .cursor/skills/verify-eventpulse-text-integrity/scripts/text-integrity-scan.mjs \
  --language sv --search "VIKING" --screenshot
```

Flaggor: `--base-url`, `--language` (visningsspråk), `--search` (sökterm),
`--event-title` (vilket kort på Hem som ska öppnas), `--out` (rapportmapp),
`--screenshot`.

Ytor som scannas: `hem`, `hem-detalj`, `utforska`, `karta`, `notiser`,
`profil`, `sok`, `sok-detalj`.

Skanningen görs med `packages/shared/src/text/scriptScan.js` — samma modul som
DB-skriptet och agentens visningsskydd använder. En sanningskälla, tre ställen.

### Databasen (komplement, inte ersättning)

DOM-auditen ser bara det som renderas just nu. För hela databasen:

```bash
npx tsx --env-file=.env scripts/check_asian_chars.ts --within-days 365 \
  --json runtime/text-integrity/scan.json
```

`scripts/check_asian_chars.ts` skannar ALLA publicerade events (paginerat) och
klassar fynden:

- `defect` — främmande skript i text VI genererat (`eventpulse_summary`,
  `editorial_description`) eller i lokaldata (`venue_full_name`).
- `source-content` — främmande skript i källans egen titel/beskrivning.
  Inte ett fel; ska översättas, inte raderas.

## Evidence

- **Live-bevis:** `06-UI/runtime/verification-reports/text-integrity-<ts>/`
  med `text-integrity-report.json` + skärmbilder per yta. Gitignored — kopiera
  det som ska levereras.
- **DB-rapport:** `runtime/text-integrity/asian-chars-<ts>.json`.
- **Metro-transcript:** `/tmp/eventpulse-metro-9090.log`.

Bevisstandard: kör den riktiga user path (flik → scroll → sök → öppna event),
inte API-anrop ihopkopplade förbi UI:t. En audit som bara läser databasen
bevisar inte att appen är ren — och en audit som bara läser DOM:en missar
events som inte råkar renderas.

## Cleanup

```bash
cd 06-UI && ./scripts/cleanup-metro.sh
kill "$(cat /tmp/eventpulse-agent-8787.pid)" 2>/dev/null || true
```

Lämna rapporter och skärmbilder intakta — de är beviset.

## Helpers

- `scripts/text-integrity-scan.mjs` — DOM-audit av hela appen.
- `scripts/check_asian_chars.ts` — DB-audit av alla publicerade events.
- `scripts/repair_asian_text.ts` — reparera lokal-läcka och regenerera summary.
- `scripts/translate_foreign_titles.mjs` — översätt främmande titlar (MiniMax M3).

## Gotchas

1. **Utan lokal agent är auditen meningslös.** Feeden laddas inte → 0 fynd →
   falsk "ren". Kontrollera `surfaces` och `console_errors` i rapporten.
2. **Appen har två tabbares i DOM.** App.js:s egen är dhidden. Tryck bara på
   synliga flikar.
3. **Tryck måste ske via pointer-events** (`pointerdown` + `pointerup` +
   `click`). `page.click()` triggar inte React Native Web:s Pressable.
4. **"Tillbaka" är inte en `<button>`** och texten är "< Tillbaka" (med
   chevron). Matcha på "innehåller Tillbaka", inte på likhet.
5. **Detaljvyn lämnar Hem kvar i DOM.** Tryck "Tillbaka" och vänta in att
   `[data-testid="home-screen"]` syns igen, annars scannar nästa yta
   detaljvyn i stället för fliken.
6. **Språkväjarens egna språknamn är korrekta icke-latina tecken**
   ("简体中文", "العربية", "فارسی"). De ska INTE räknas som fel. Skanna alltid
   med `--language` så skriptet vet vad som är tillåtet.
7. **Sökfältet** har `data-testid="explore-search-input"`.

## Maintenance

Kör `/maintain-verification-skill` när appen får nya ytor, när språklistan
ändras, eller när `packages/shared/src/text/scriptScan.js` får nya skript.
