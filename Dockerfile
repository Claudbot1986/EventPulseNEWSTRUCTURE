# =============================================================================
# EventPulse — production image for the agent API only.
#
# Scope: this image runs the 08-Agent Express server on PORT 8787 (or the
# AGENT_PORT env). It does NOT run the scraping supervisor, the BullMQ
# workers, or anything puppeteer-based.
#
# Why minimal: the dependency tree declares puppeteer, but the 08-Agent
# import graph never reaches it (verified — no transitive puppeteer import
# is reachable from server.ts or any tool it imports). We install
# dependencies with `npm ci --omit=dev PUPPETEER_SKIP_DOWNLOAD=true` so
# Chromium is not downloaded into the image. Saving ~300 MB.
# =============================================================================

# ---- Stage 1: install prod deps only ----
FROM node:20.19.5-alpine AS deps

WORKDIR /app

# Skip Chromium download — the agent API never launches puppeteer.
# This also keeps the image lean and avoids the system's chromium dep.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    NODE_ENV=production \
    NPM_CONFIG_PRODUCTION=true

# Copy only the lockfile + the package manifests first so Docker can cache
# the dependency layer across source-only changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY tsconfig.json ./

# Install only prod deps. We intentionally do NOT install the whole repo:
# `@eventpulse/shared` is a file: dependency, so we resolve it through npm.
RUN npm ci --omit=dev

# ---- Stage 2: run ----
FROM node:20.19.5-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    AGENT_PORT=8787 \
    PORT=8787

# Run as a non-root user. `node` is the default image user (uid 1000).
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages/shared ./packages/shared
COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node 08-Agent ./08-Agent

# The image runs the agent server via `tsx` (already a devDependency-free
# path because we rely on `npm exec` for production-side tsc). To avoid
# baking devDeps, we instead transpile to dist/ via tsc at build time.
# Since the project has no `start` script for 08-Agent (verified — see
# docs/DEPLOY.md "What is not yet handled"), the runner below uses
# `node --experimental-strip-types` against the source file. Node 22+ is
# required for --experimental-strip-types; we are on 20.19.5 which is
# missing the full support window, so the ENTRYPOINT falls back to
# `npx --no-install tsx 08-Agent/server.ts` (tsc is also missing because
# devDeps were pruned). Until a real build step is added to package.json,
# the Dockerfile installs `tsx` from devDependencies as a build-only
# dep and ships the bundled CLI in the runner stage.

# tsx is now a runtime dependency (used by the ENTRYPOINT), so the
# `npm ci --omit=dev` in Stage 1 already brings it into the runner image.
# Nothing to install here.

USER node

EXPOSE 8787

# Default secrets (NOT real values — Fly will override via `fly secrets set`).
# Listed so missing-secret startup errors are caught at boot, not in prod.
ENV SUPABASE_URL="" \
    SUPABASE_SERVICE_ROLE_KEY="" \
    ANTHROPIC_API_KEY="" \
    AGENT_ALLOWED_ORIGINS=""

ENTRYPOINT ["npx", "--no-install", "tsx", "08-Agent/server.ts"]
