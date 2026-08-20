# Deploying the agent backend

Status: **Draft — for Workstream E, MVP hardening 2026-08-20.**

This document covers the **08-Agent** Express server (`08-Agent/server.ts`)
only. The scraping supervisor, BullMQ workers, ingestion tooling, and the
Expo app have their own runbooks and are not deployed via this guide.

---

## 1. What this deploys

A single Express app that exposes the private agent API:

| Method | Path                                  | Notes                              |
|--------|---------------------------------------|------------------------------------|
| GET    | `/agent/health`                       | Liveness probe (no Supabase call). |
| GET    | `/agent/feed`                         | Browse-window reader.              |
| POST   | `/agent/chat`                         | Magic-slice endpoint.              |
| POST   | `/agent/feedback`                     | Interaction logging.               |
| GET    | `/agent/metrics`                      | Aggregate counts.                  |
| GET    | `/agent/experiments/personalization`  | Phase 2 A/B lift.                  |

Default port: **8787** (`AGENT_PORT` env). The image binds to `0.0.0.0:8787`
and Fly's HTTPS terminator fronts it.

---

## 2. Prerequisites

- A Fly.io account with the `fly` CLI installed and authenticated.
- A Supabase project. You need:
  - `SUPABASE_URL` (project URL, public).
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only — never bundled, never
    Expo-public).
- An Anthropic API key (`ANTHROPIC_API_KEY`) — server-only. The agent
  degrades gracefully to a deterministic reply without it, but Phase 1
  composer needs it.
- The Expo app's public origin, e.g. `https://your-app.expo.app` or the
  deployed Expo web/preview URL. This is needed for `AGENT_ALLOWED_ORIGINS`.

---

## 3. Secrets (set these BEFORE the first deploy)

```
fly secrets set \
  SUPABASE_URL="https://your-project-ref.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="sb_service_role_xxx" \
  ANTHROPIC_API_KEY="sk-ant-xxx" \
  AGENT_ALLOWED_ORIGINS="https://your-app-name.fly.dev,https://your-app.expo.app"
```

Notes:
- These are stored encrypted by Fly. They are **never** written to
  `fly.toml` or to any tracked file.
- Rotation: re-run the `fly secrets set` command with the new value.
  Old versions are not kept; Fly replaces in place.
- If a value has ever been pasted into a chat, a screenshot, a commit,
  or a public log, treat it as compromised and rotate immediately.

---

## 4. First deploy

```
fly launch --no-deploy --copy-config
fly deploy
```

The `fly.toml` in this repo is the source of truth. Do not commit secrets
into it. The `--copy-config` flag (or answering "no" to the database
question) skips launching a Postgres app and uses the existing config.

If this is the very first deploy, `fly launch` will offer to create the
app. Decline any "create Postgres?" question — the agent uses Supabase
elsewhere.

---

## 5. Verify

```
# 1. Health endpoint
curl https://eventpulse-agent.fly.dev/agent/health
# → { "ok": true, "phase": 0 }

# 2. Fly machines status
fly status

# 3. Logs
fly logs
```

Expected log line on boot:
```
[08-Agent] listening on :8787
```

A boot that fails to read `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
will throw `SUPABASE_URL not configured` (see `08-Agent/server.ts:58-61`)
on the first request that needs Supabase.

---

## 6. Point the Expo app at the deployed URL

`06-UI/services/agentClient.js` reads `EXPO_PUBLIC_AGENT_URL`. Set it in
`06-UI/.env.local`:

```
EXPO_PUBLIC_AGENT_URL=https://eventpulse-agent.fly.dev
```

Then rebuild the Expo bundle:

```
cd 06-UI
npx expo start -c
```

Remember: any `EXPO_PUBLIC_*` variable is **bundled into the JS** that the
app ships. It is public. Never put `SUPABASE_SERVICE_ROLE_KEY` or
`ANTHROPIC_API_KEY` in those variables.

---

## 7. Local development fallback

For laptop dev, the agent can run on the developer's machine:

```
npm run --silent exec -- tsx 08-Agent/server.ts
# or, with explicit port:
AGENT_PORT=8787 npx tsx 08-Agent/server.ts
```

The Expo app then stays on `EXPO_PUBLIC_AGENT_URL=http://<LAN-IP>:8787`
or `http://localhost:8787` for emulator-only dev.

---

## 8. What is NOT yet handled

The MVP hardening plan (Workstream E) ships deploy scaffolding only. The
following are deliberately out of scope and must be addressed before any
non-developer user touches the deployed endpoint:

1. **Authentication.** `/agent/chat` currently accepts an opaque
   `client_user_id` UUID with no proof of identity. A single global
   attacker who discovers the URL can send feedback and impressions
   under arbitrary user ids. Phase 2 auth (still unscheduled) gates
   this.
2. **Rate limiting.** No per-IP or per-client_user_id limit. A bad
   client (or a hostile one) can run up Anthropic costs. Add a
   token-bucket middleware before exposing beyond the developer's
   phone.
3. **Monitoring / alerting.** Boot logs are visible via `fly logs`,
   but there is no uptime check, no error-rate metric, no PagerDuty
   integration.
4. **CI / deploy-on-merge.** `fly deploy` is manual. No GitHub Actions
   integration is set up to deploy on merge to `main`.
5. **`package.json` start script for the agent.** The Dockerfile
   invokes `npx tsx 08-Agent/server.ts` directly. Root `package.json`
   has no `start:agent` script. Add one (something like
   `"start:agent": "tsx 08-Agent/server.ts"`) once a reviewer can
   confirm the script does not pull in puppeteer or any other
   scraping-only dependency. Until then, this Dockerfile bakes
   `tsx` directly into the runner stage.
6. **Puppeteer / Chromium in the dependency tree.** `puppeteer` is
   listed at the repo root but the agent's import graph does not
   reach it (verified — `grep -r puppeteer 08-Agent packages/shared`
   finds nothing). The Dockerfile passes `PUPPETEER_SKIP_DOWNLOAD=true`
   so the post-install hook does not try to download Chromium. If a
   future change adds a puppeteer dependency to the agent (it must
   not), this assumption breaks.
7. **Vault and supervisor paths.** `EVENTPULSE_VAULT_ROOT` and
   `EVENTPULSE_PROJECT_ROOT` are referenced by the **scraping
   supervisor**, not the agent. They are listed in `.env.example`
   for completeness but must NOT be set on the Fly app.
8. **HTTPS-only CORS.** `AGENT_ALLOWED_ORIGINS` must be HTTPS when
   the Expo app is served over HTTPS. Mixed content from the deployed
   agent will be blocked by the browser.

---

## 9. Rollback

```
fly releases
fly releases rollback <version>
```

The MVP hardening plan tags `pre-mvp-hardening-2026-08-20` (commit
`01807e0`) as the rollback point. This deploy file does not exist at
that commit — it is part of Workstream E. To roll back past it, revert
the deploy infra files and redeploy.

---

## 10. Files in this deploy

| File             | Role                                            |
|------------------|-------------------------------------------------|
| `Dockerfile`     | Multi-stage build, agent-only.                  |
| `.dockerignore`  | Build-context exclusions.                       |
| `fly.toml`       | Fly service config (port, region, healthcheck). |
| `.env.example`   | Full variable inventory grouped by subsystem.   |
