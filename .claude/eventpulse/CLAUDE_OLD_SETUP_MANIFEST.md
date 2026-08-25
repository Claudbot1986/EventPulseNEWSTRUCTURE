# CLAUDE_OLD_SETUP_MANIFEST.md

**Created:** 2026-08-24
**Author:** Claude Code (Phase 1, EventPulse Agent Runtime)
**Phase 0 plan:** `/Users/claudgashi/.claude/plans/calm-orbiting-wilkinson.md`

## Why this file exists

Before disabling the **Everything Claude Code** plugin in `~/.claude/settings.json`, every file required for full restoration was snapshotted. This manifest records what was preserved, where, and how to restore. **Nothing was deleted.** All changes are reversible.

## Backup location

```
~/.claude/ecc-backup-20260824-212053/
├── settings.json              (1 801 bytes — pre-edit global settings)
├── installed_plugins.json     (457 bytes — plugin registry)
├── known_marketplaces.json    (574 bytes — marketplace config)
├── blocklist.json             (414 bytes — plugin blocklist)
└── HASHES.txt                 (SHA256 of the four files above)
```

## Original paths → backup paths

| Original | Backup |
|---|---|
| `~/.claude/settings.json` | `~/.claude/ecc-backup-20260824-212053/settings.json` |
| `~/.claude/plugins/installed_plugins.json` | `~/.claude/ecc-backup-20260824-212053/installed_plugins.json` |
| `~/.claude/plugins/known_marketplaces.json` | `~/.claude/ecc-backup-20260824-212053/known_marketplaces.json` |
| `~/.claude/plugins/blocklist.json` | `~/.claude/ecc-backup-20260824-212053/blocklist.json` |

## SHA256 hashes

```
b1dc19702f4a958ff7b43be6337fc2914c1f5c37c284e704a47ed9495b8f13b8  settings.json
06a2b868cef45a2eba733513013f2db88883981d775a7bb02dbbd47dd0e6fffc  installed_plugins.json
94b3f044d1f6c5357b740f16820facfadfe383a6111e2af41f4bef174c31792d  known_marketplaces.json
8c4c50017ba994b20c8dbeb62391df840e961087a61dcdba847347421ef9a204  blocklist.json
```

## What was NOT copied (and why)

| Path | Size | Reason |
|---|---|---|
| `~/.claude/plugins/cache/` | ~104 MB | Runtime cache for ECC v1.10.0. Not load-bearing for rollback — re-created by Claude Code from the marketplace on first enable. |
| `~/.claude/plugins/data/everything-claude-code-*` | small | Plugin-private state. Re-created on re-enable. |
| `~/.claude/plugins/marketplaces/everything-claude-code/` | ~few MB | Marketplace checkout. Re-fetched by Claude Code if missing. |
| `NEWSTRUCTURE/everything-claude-code/` (project tree clone) | 156 MB | Dormant local clone. Claude Code does not load from this path — the cache copy is authoritative. Preserved in place at the original location. |

## Pre-edit state summary

| Setting | Value (before) |
|---|---|
| `enabledPlugins.everything-claude-code@everything-claude-code` | `true` |
| `enabledPlugins` key | present in `~/.claude/settings.json` |
| `mcpServers` block in `~/.claude/settings.json` | not present (servers were loaded through ECC plugin namespace) |
| ECC hooks registered via `hooks/hooks.json` | ~10 (PreToolUse/PostToolUse/PreCompact sub-hooks) |
| Custom hook: `PostToolUse *` → `autonomous-activity-hook.js` | active (vault bridge, unchanged) |
| Custom hook: `SessionEnd` → `vault-sync-session-end.js` | active (vault bridge, unchanged) |

## ECC source for rollback reference

- Repo: `https://github.com/affaan-m/everything-claude-code.git`
- Installed version: `1.10.0`
- Installed commit: `1a50145d39c0fa415311da62e7a018edd4e6d976`
- Installed date: 2026-04-17
- Installed at (cache): `~/.claude/plugins/cache/everything-claude-code/everything-claude-code/1.10.0/`
- Installed at (marketplace): `~/.claude/plugins/marketplaces/everything-claude-code/`

## Mechanism used (post Phase 1)

The original plan §19 specified adding a top-level `mcpServers` block in `~/.claude/settings.json`. **Claude Code v2.1.96 settings.json schema rejects top-level `mcpServers`** (verified: `Settings validation failed: - : Unrecognized field: mcpServers`). The actual supported mechanism for user-scoped MCP servers is a `.mcp.json` file.

| Concern | Plan said | Reality | File |
|---|---|---|---|
| Disable ECC | `enabledPlugins.everything-claude-code@everything-claude-code: false` in `~/.claude/settings.json` | same | `~/.claude/settings.json` (line 19) |
| Re-declare 6 MCPs | top-level `mcpServers` block in `~/.claude/settings.json` | top-level `~/.claude/.mcp.json` (Claude Code native location) | `~/.claude/.mcp.json` |

`~/.claude/.mcp.json` content mirrors the ECC cache `.mcp.json` verbatim — same `command/args` (with pinned versions) and same `exa` HTTP URL. After Phase 1, the 6 MCPs continue to work; tool namespaces change from `mcp__plugin_everything-claude-code_<name>__*` to `mcp__<name>__*`. This matches the namespace change already noted in this manifest.

## Restore instructions

### Lightweight rollback (re-enable ECC)

Edit `~/.claude/settings.json`:

```diff
- "enabledPlugins": { "everything-claude-code@everything-claude-code": false }
+ "enabledPlugins": { "everything-claude-code@everything-claude-code": true }
```

Then restart Claude Code. ECC hook chain re-attaches; plugin auto-loads from cache.

### Full rollback (restore the four JSON files verbatim)

```bash
BACKUP=~/.claude/ecc-backup-20260824-212053
cp "$BACKUP/settings.json" ~/.claude/settings.json
cp "$BACKUP/installed_plugins.json" ~/.claude/plugins/installed_plugins.json
cp "$BACKUP/known_marketplaces.json" ~/.claude/plugins/known_marketplaces.json
cp "$BACKUP/blocklist.json" ~/.claude/plugins/blocklist.json
```

Then restart Claude Code.

### Verify restoration

After restart:
1. `/mcp list` should show six servers: context7, exa, github, memory, playwright, sequential-thinking. **Note**: tool names change namespace from `mcp__plugin_everything-claude-code_<name>__*` to `mcp__<name>__*` (achieved via `~/.claude/.mcp.json` — see "Mechanism used" above) — this is the only user-visible behavior change.
2. Calling `mcp__context7__resolve-library-id` (or equivalent) should succeed.
3. The ECC `pre-bash-dispatcher` PostToolUse log lines should reappear in stderr.

**Note on the namespace change:** If this is unacceptable (any active skill references the old namespace), the lightweight rollback below restores the OLD namespace automatically. Use the full rollback when restoring after a future disable.

## Active state after Phase 1

| Item | State |
|---|---|
| ECC plugin (`enabledPlugins`) | **disabled** (will take effect on next Claude Code restart) |
| ECC cache + marketplace + local clone | preserved on disk |
| MCP servers (6 used by the user) | re-declared in `~/.claude/.mcp.json` (mirrors ECC cache verbatim) |
| Custom vault hooks (`autonomous-activity-hook.js`, `vault-sync-session-end.js`) | unchanged, still active |
| `~/.claude/agents/*.md` (8 EventPulse agent files) | unchanged |
| Project `.claude/settings.local.json` (Bash allow-list) | unchanged |
| `.claude/rules/{common,typescript}/*.md` | unchanged |

## Operator notes

- The current Claude Code session will continue with its existing set of tools. **Restart Claude Code after Phase 1 completes** to pick up the new settings.
- If something goes wrong (MCP tools missing, hooks misbehaving), run the lightweight rollback above first; if that fails, run full rollback.
- Phase 2 (scaffold `policy.md` + agent role files) does **not** depend on Phase 1 success — they are independent. But Phase 1 must complete before Phase 3 (router hook) to avoid ECC hook contention.

---

**This manifest is part of the EventPulse Agent Runtime.** Do not delete while the runtime is active.
