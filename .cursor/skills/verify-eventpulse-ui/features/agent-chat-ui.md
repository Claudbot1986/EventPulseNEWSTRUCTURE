# Agent-chatt (UI)

## Sub-features

- Agenten kan **inte nås från UI** i den utskickade appen: `06-UI/index.js` registrerar `AppShell`, som bara renderar Hem/Utforska/Karta/Notiser/Profil.
- `06-UI/app/AgentScreen.js` finns i koden men monteras ingenstans (ingen import av `AgentScreen` finns i `App.js`/`AppShell.js`).
- Agent-API:t `/agent/chat` är uppe och svarar `{"ok":true,"phase":0}`.

## How to get to it (user POV)

**Det finns ingen väg in i UI.** En användare kan inte nå chatten i den nuvarande builden. Detta är en avvikelse mot `06-UI/FEATURE_MAP.md` § 3 som listar agent-chatt som "live".

## Driving it with Playwright

Spec: ingen live-drive möjlig — **verified-unreachable**.

För att dokumentera läget:

1. Öppna appen på `http://localhost:9090`.
2. Läs `[role="tab"]`-elementen: de ska vara exakt Hem, Utforska, Karta, Notiser, Profil — **ingen agent-flik**.
3. Sök DOM:en efter "Agent" / "chat" → ska inte finnas någon synlig ingång.

## Gotchas

- Om `AppShell` senare börjar rendera agentchatten behöver den en egen feature-fil och en riktig drive. Tills dess är FEATURE_MAP § 3 **fel**.
- `agentClient.js` har `sendChatMessage`/recommendation-stöd som används av agent-API:t men inte av UI:t.
- Att API:t svarar bevisar **inte** att chatten är nåbar — verifiera alltid vägen från användaren.
