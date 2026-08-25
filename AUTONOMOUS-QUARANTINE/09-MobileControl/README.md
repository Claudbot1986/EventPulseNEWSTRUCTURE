# 09-MobileControl

Phase 2 — mobile monitoring + control layer for EventPulse.

## Vad det är

En tunn Express-server som läser Phase 1:s persistenta tillstånd
(`runtime/autonomous-loop/state.json`, `23-Active-Task-Queue.md`,
`loop.log`, git) och exponerar det via REST + SSE för en mobil-first
dashboard.

**Inget duplicerat projekt-tillstånd.** Allt läses från Phase 1 direkt.
Styr-kommandon skriver tillbaka till Phase 1-filer (queue, instructions,
STOP-flagga).

## Snabbstart

```bash
# 1. Installera Tailscale (se TAILSCALE.md)
brew install --cask tailscale

# 2. Installera tmux (för persistent terminal)
brew install tmux

# 3. Starta allt
bash scripts/start-mobile-control.sh

# 4. Hitta din Tailscale-IP
tailscale ip -4

# 5. Öppna på telefonen (i Tailscale-nätverket)
# http://<tailscale-ip>:8788/?token=<token från .env.mobile>
```

## Arkitektur

```
PHONE (Tailscale-app, Safari/Chrome)
   │
   │ http(s) via Tailscale WireGuard tunnel
   ▼
[Mobile Control Server :8788]  ← binder 127.0.0.1 (localhost only)
   │
   │ läser Phase 1 state direkt
   ▼
00-Vault/.../23-Active-Task-Queue.md
runtime/autonomous-loop/state.json
runtime/autonomous-loop/loop.log
runtime/autonomous-loop/iter-N.{json,err}
git log
00-Vault/.../19-Decision-Log.md
00-Vault/.../24-Discovered-Work.md
```

## REST API

Alla `/api/*` kräver `Authorization: Bearer <token>` (eller `?token=...`).

| Method | Path | Body | Syfte |
|--------|------|------|-------|
| GET | `/api/status` | — | Full state snapshot |
| GET | `/api/activity?limit=N` | — | Senaste N aktivitets-events |
| GET | `/api/logs?tail=N` | — | Sista N raderna av loop.log |
| GET | `/api/terminal` | — | tmux pane content (live) |
| POST | `/api/terminal/send` | `{keys}` | Injicera keystrokes i tmux |
| POST | `/api/instruct` | `{message}` | Skicka instruktion till lead |
| POST | `/api/tasks` | `{priority, title, verify}` | Lägg till task i kö |
| POST | `/api/pause` | — | Touch STOP file |
| POST | `/api/resume` | — | Spawna tmux + autonomous-loop |
| GET | `/api/stream` | — | SSE: state-snapshot var 2s |
| GET | `/health` | — | tmux_available + tmux_running |

## Säkerhet

- **Bearer-token** i env-var `MOBILE_CONTROL_TOKEN` (genereras vid första start, sparas i `.env.mobile`, mode 600)
- **Bind 127.0.0.1** default → endast lokalt åtkomligt; Tailscale-interface syns genom `tailscale0`
- **Inga publika portar** — Tailscale hanterar all tunneling + WireGuard-kryptering
- **Fail-closed** — utan giltig token vägrar servern starta

## Persistent terminal (tmux)

Autonomous-loop körs inuti tmux-session `eventpulse`. Telefonen kan:

- Se sista 200 raderna av tmux-pane via `/api/terminal`
- Skicka keystrokes (för inspektion/interaktion) via `/api/terminal/send`
- Koppla upp sig igen efter disconnect — sessionen överlever
- `tmux attach -t eventpulse` från Mac för full interaktivitet

## Filer

```
09-MobileControl/
├── README.md           ← denna fil
├── TAILSCALE.md        ← säkerhets- + nätverkssetup
├── package.json        ← npm start, npm test
├── tsconfig.json       ← TypeScript strict
├── server.ts           ← Express + SSE
├── state.ts            ← läser Phase 1 state
├── activity.ts         ← append-only JSONL stream
├── auth.ts             ← bearer-token middleware
├── tmux.ts             ← tmux wrapper
├── public/
│   ├── index.html      ← mobil dashboard
│   ├── style.css       ← mörkt tema, thumb-reach
│   └── dashboard.js    ← fetch + EventSource
├── tests/
│   └── state.test.ts   ← verifierar parser mot riktig Phase 1-data
└── runtime/
    └── activity.jsonl  ← append-only event log (skapas vid körning)
```

## Begränsningar (ärliga)

- Första mobile-control-servern har manuell Tailscale-installation
  (kan inte automatiseras — kräver användarens Tailscale-konto)
- `auth.ts` använder enkel bearer-token (high-entropy 32 hex = 256 bit).
  Inte OAuth/JWT eftersom vi inte har identity-provider
- Pre-emptive `/compact` finns beskrivet i CLAUDE.md men saknar automatisk
  injektor (nästa naturliga steg)
- launchd från Sequoia extern volym blockeras fortfarande — tmux ersätter

## Nästa naturliga steg

1. **Live instruktions-kö:** `scripts/autonomous-loop.sh` ska läsa
   `runtime/instructions/pending.md` i början av varje iteration
2. **Vault-sync via activity-events:** när `vault_reconciled` registreras,
   synka `01-Current-State.md`
3. **Multi-device:** Tailscale ACL för telefoner + Macs
4. **Tailscale SSH** för att kunna köra kommandon från telefonen utan
   dashboard (ren shell-in)