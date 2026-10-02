#!/usr/bin/env node
// scripts/vault-sync-session-end.js — LEGACY wrapper around scripts/autonomy/vault-sync.mjs
//
// Original version of vault-sync-session-end.js hardcoded PROJECT_ROOT to a stale
// path and ran an unbounded `npx vitest run --reporter=json`, which caused sessions
// to hang for >30s when vitest exceeded the execSync timeout.
//
// This file is now a thin delegator. All real logic lives in
// scripts/autonomy/vault-sync.mjs (harness-independent, bounded timeouts,
// auto-detects cwd).
//
// Usage (unchanged):
//   node scripts/vault-sync-session-end.js
//   node scripts/vault-sync-session-end.js --skip-tests
//   node scripts/vault-sync-session-end.js --dry-run

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const inner = join(__dirname, "autonomy", "vault-sync.mjs");

const res = spawnSync("node", [inner, "run", ...process.argv.slice(2)], {
  stdio: "inherit",
  timeout: 60_000, // hard cap on this whole wrapper
});

process.exit(res.status ?? 0);