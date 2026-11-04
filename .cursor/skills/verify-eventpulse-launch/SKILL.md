---
name: verify-eventpulse-launch
description: |
  Verify EventPulse against Apple's App Store submission requirements. Use for
  /verify-eventpulse-launch, before an App Store review, after touching
  app.json, the legal texts, the i18n strings, the map provider, the auth
  client or the EAS build — or when a reviewer-visible fact (privacy policy,
  demo access, privacy manifest, device family, entitlements) must be proven
  rather than assumed. Checks the repo config, the built IPA artifact and the
  live website; drives the real app for the legal modal and demo login.
disable-model-invocation: false
---

# verify-eventpulse-launch

Apple godkänner en **artefakt**, inte ett repo. Den här skillen verifierar
alla tre lager som Apple faktiskt granskar: konfigurationen i repot, den
byggda IPA:n och den live-webbsidan — plus de två appflöden som en granskare
gör: att läsa policyn och att logga in.

## Launch

Ingen server att starta för gate-skripten — de arbetar mot filer och en
publicerad artefakt. För de **live-appflödena** (policyn, demologin) behövs
samma instans som `verify-eventpulse-ui`:

```bash
cd /Users/claudgashi/EventPulse
npm run start:agent &                       # 08-Agent/server.ts → :8787
cd 06-UI
EXPO_PUBLIC_AGENT_URL=http://localhost:8787 ./scripts/launch-metro.sh
```

Ready-signal: loggen visar `Waiting on http://localhost:9090` och första
`GET /` svarar 200. Vänta på `[Web] Bundled` (30–60 s).

Isolering: en Metro-process äger 9090. Skicka inte in parallella `expo start`.
För parallell körning: `PORT=9091` + `BASE_URL=http://localhost:9091`.

**Demo-flaggan är bundle-time.** `EXPO_PUBLIC_ENABLE_DEMO_LOGIN` +
`EXPO_PUBLIC_DEMO_EMAIL` + `EXPO_PUBLIC_DEMO_PASSWORD` ligger i `06-UI/.env`
(gitignored). Utan dem är demologinen medvetet borta ur UI:t, och
`e2e/demo-login.test.mjs` skippar då fallen.

## Doctor

```bash
cd /Users/claudgashi/EventPulse/06-UI && ./scripts/doctor-metro.sh
```

Exit non-zero = instansen är inte värd att driva. Doctor svarar på Metro-root,
Expo-mount-point, webb-bundle och agent-API. Stoppa och relauncha.

För gate-skripten: `check-app-config.mjs` är sin egen doktor för repo-lagret —
den kör utan Metro.

## Drive

| Vad | Kommando | Vad det bevisar |
|---|---|---|
| Repo-lagret | `node .cursor/skills/verify-eventpulse-launch/scripts/check-app-config.mjs .` | 49 kontroller: privacy manifest, iPhone-only, demo-flagga, juridiska texter i sv/en/it, kartprovider, policy i gästläget |
| Artefakten | `node .cursor/skills/verify-eventpulse-launch/scripts/check-ipa.mjs <url\|path.ipa>` | 26 kontroller i den byggda IPA:n: manifest, UIDeviceFamily, entitlements, och att de nya texterna finns i JS-bundlen |
| Live-webben | `node .cursor/skills/verify-eventpulse-launch/scripts/check-live-site.mjs` | Att `eventpulse.nu/privacy/` (sv + en) faktiskt innehåller den publicerade policyn |
| Policyn i appen | `cd 06-UI && BASE_URL=http://localhost:9090 npx playwright test e2e/legal-policy.test.mjs` | Att appen visar rätt policy, utan platshållare och utan AI-utkastsbanner — i **gästläget** |
| Demologin | `cd 06-UI && BASE_URL=http://localhost:9090 npx playwright test e2e/demo-login.test.mjs` | Att en granskare kan logga in med demokontot |

Bevisstandarden är samma som för `verify-eventpulse-ui`: kör den riktiga
user-vägen, fånga konsolfel, och lita inte på att en fil innehåller rätt text
— läs det som renderas.

**Artefaktens IPA-URL** finns i `docs/APPLE-SUBMISSION-METADATA.md` och i
`eas build:list` ( senaste production-bygget ).

## Evidence

- Gate-utdata: sparas med `tee` under
  `06-UI/runtime/verification-reports/launch-<timestamp>/` (gitignored — kopiera
  det som ska levereras).
- Playwright-bevis: `06-UI/runtime/verification-reports/ui-verify-<ts>/`
  (skärmbilder av policy och demologin).
- IPA-gate: artefakten lämnas kvar i sin temp-mapp och **refereras i utdata**;
  radera inte beviset före rapporten.

Bevisstandard: en kontroll som "grön" i ett skript räcker bara om skriptet
kördes mot den sak som ska godkännas — repot för konfigurationen, **den
publicerade IPA:n** för binären, den **live** sajten för webbpolicyn.

## Cleanup

```bash
cd /Users/claudgashi/EventPulse/06-UI && ./scripts/cleanup-metro.sh
```

Dödar bara PID:en i `.runtime-metro.pid` och en eventuell lyssnare på PORT
(default 9090). Rör aldrig 8081. Gate-skripten lämnar inga processer igång;
`check-ipa.mjs` skapar en temp-mapp under `$TMPDIR` som får ligga kvar tills
beviset är refererat.

## Helpers

- `.cursor/skills/verify-eventpulse-launch/scripts/check-app-config.mjs` —
  repo-gate (konfiguration + juridiska texter + kartprovider + gäst-policy).
- `.cursor/skills/verify-eventpulse-launch/scripts/check-ipa.mjs` — IPA-gate
  (manifest, device family, entitlements, bundle-strängar).
- `.cursor/skills/verify-eventpulse-launch/scripts/check-live-site.mjs` —
  live-policy-gate för `eventpulse.nu`.
- `06-UI/e2e/legal-policy.test.mjs` — live-drive av policyn i appen.
- `06-UI/e2e/demo-login.test.mjs` — live-drive av demologinen.
- `06-UI/scripts/{launch,doctor,cleanup}-metro.sh` — Metro-harnessen från
  `verify-eventpulse-ui`.

## Gotchas

1. **Hermes lagrar icke-ASCII som UTF-16.** Ett `grep "MiniMax"` i
   `main.jsbundle` ger **0 träffar** trots att texten finns. Sök i båda
   encodings (`check-ipa.mjs` gör det). Samma gäller "Användarvillkor",
   "eu-north-1" och alla svenska strängar med å/ä/ö.
2. **`_legalDraftOnly` styr bannern, inte texten.** Strängen "AI-utkast"
   finns kvar i bundlen (flaggan är '0'), men den **visas inte**. Ett grep i
   bundlet är därför inte ett bevis på att bannern syns — driva UI:t.
3. **Gästläget är appens defaultläge** (Apple §5.1.1(i) kräver policy
   *inne i* appen). Policy-raderna ligger i `ProfileScreen.js` → `LegalLinks`,
   som renderas i både gäst- och inloggad gren. Om du refaktorerar
   `ProfileScreen`, kör `e2e/legal-policy.test.mjs` — den fångar när
   gästgrenen tappar länkarna igen.
4. **`PROVIDER_DEFAULT` är Google Maps på iOS**, inte MapKit. Koden får
   nämna det i kommentarer, men `provider={PROVIDER_DEFAULT}` får inte
   finnas — `check-app-config.mjs` särskiljer kommentar från kod.
5. **Live-webben deployas inte från den här chatten.** Båda Cloudflare-
   token i `.env` ger "Authentication error", så `check-live-site.mjs` kan
   vara röd tills ägaren deployat `site/`. Det är ett **blockerat steg**, inte
   ett fel i appen.
6. **Byggnumret styrs av EAS**, inte `app.json` (`appVersionSource: remote`).
   Senaste production-bygget var 1.0.0 (3) — kontrollera `eas build:list`.
7. **Ingen Xcode på maskinen** → inga simulatorskärmbilder och ingen
   riktig enhetskontroll av kartan/push. Det är kvar att göra av ägaren.

## Maintenance

Kör `/maintain-verification-skill` när feature-kartan här eller
`06-UI/FEATURE_MAP.md` ändras. Senast: 2026-11-04 (skapad i samband med
Apple-lanseringsunderbyggnaden).
