# Agent-chatt (UI)

## Sub-features

- Agenten kan **inte nås från UI** i den utskickade appen: `06-UI/index.js:14,22` registrerar `AppShell`, som bara renderar Hem/Utforska/Karta/Notiser/Profil (`AppShell.js:51, 637-641`).
- `06-UI/app/AgentScreen.js` implementerar en full chat-UI (rubrik "EventPulse Agent", förslagschips, fritextfält "Vad vill du göra ikväll?", skickknapp "Skicka", svarstext, eventkort, förtydligandechips, follow-venue long-press, share-session).
- **Rättat 2026-11-04:** skärmen monteras **inte "ingenstans"** — den monteras av `06-UI/App-agent.js:17,24`, men **ingen importerar den**. Det shippade rotregistrerar `AppShell`. Rätt formulering: monteras av en ingång som inget importerar.
- Chatten anropar `chatWithAgent()` (`services/agentClient.js:148-208`) → `POST /agent/chat` med Bearer-JWT. Klienten vägrar anropa utan session (`agentClient.js:149`).
- Ingen deep link leder till chatten (`services/deepLinkRouter.js:56-60`).
- Agenten är alltså bara indirekt nåbar: via Utforska-sök mot servern (`/agent/feed?q=`) och via Hem→Utforska-filter.
- `POST /agent/chat` kräver JWT (`08-Agent/server.ts:588`). `{"ok":true,"phase":0}` är svaret på **`/agent/health`** (`server.ts:239-241`) — inte på chatten.

## How to get to it (user POV)

**Det finns ingen väg in i UI.** En användare kan inte nå chatten i den nuvarande builden. Detta är en avvikelse mot `06-UI/FEATURE_MAP.md` § 3 som listar agent-chatt som "live".

## Driving it with Playwright

Spec: ingen live-drive möjlig — **verified-unreachable**.

För att dokumentera läget:

1. `page.addInitScript(() => { globalThis.__SKIP_ONBOARDING__ = true; })` (mönster från `e2e/multi-date-verification.test.mjs:57-61`) → `goto('http://localhost:9090')` → vänta på `[data-testid="home-screen"]`.
2. Läs `[role="tab"]` → de ska vara exakt 5: Hem, Utforska, Karta, Notiser, Profil (sv-SE via `playwright.config.js:38`).
3. Assera att **ingen** chattyta syns: `getByText('EventPulse Agent')` count 0, `getByPlaceholder('Vad vill du göra ikväll?')` count 0, `getByText('Skicka', { exact: true })` count 0.
4. **Avgörande assertion:** fånga requests och assera **noll** anrop vars URL innehåller `/agent/chat` medan du sveper alla 5 flikar och skriver ≥3 tecken i `explore-search-textinput` (då ska `/agent/feed?q=` vara > 0 i stället).

## Gotchas

- Om `AppShell` senare börjar rendera agentchatten behöver den en egen feature-fil och en riktig drive. Tills dess är FEATURE_MAP § 3 **fel**.
- Klienten heter `chatWithAgent` — det finns **ingen** `sendChatMessage`. Recommendation-stödet finns bara i `HEM-QUARANTINE/screens/HomeScreen.js:51` (ommonterat).
- **DOM-sök på "Agent"/"chat" är skört:** juridiktexten innehåller "agentchatten"/"event-agent" (`i18n/strings/sv.js:663,683`), och fliketiketterna är språkberoende. Använd de exakta selektorerna ovan.
- Att API:t svarar bevisar **inte** att chatten är nåbar — verifiera alltid vägen från användaren.
- Demologin ger nu en riktig JWT, så `/agent/chat` går att testa **via API** — fortfarande inte via UI.
