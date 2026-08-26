#!/usr/bin/env node
/**
 * redact-secrets.ts — Secret redactor (Phase L-E + K3 feedback)
 *
 * Per master-prompt §20: redact secrets/personuppgifter från episode-data.
 *
 * Två lager (per K3):
 *   1. EXPORT_FIELD_ALLOWLIST — vitlista över fältnamn som FÅR exporteras.
 *      Allt annat filtreras bort.
 *   2. Regex-redaction av känsliga patterns i strängvärden som passerat
 *      allowlist (andra försvaret om allowlist missar något).
 *
 * Patterns som redigeras (per §20):
 *   - api[_-]?key, secret, password, access[_-]?token, supabase_service_role
 *   - .env values, cookies, credentials, private keys
 */

export const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "api_key", re: /api[_-]?key\s*[:=]\s*[^\s,;'"]+/gi },
  { name: "secret", re: /secret\s*[:=]\s*[^\s,;'"]+/gi },
  { name: "password", re: /password\s*[:=]\s*[^\s,;'"]+/gi },
  { name: "access_token", re: /access[_-]?token\s*[:=]\s*[^\s,;'"]+/gi },
  { name: "supabase_service_role", re: /supabase_service_role[a-zA-Z0-9_]*\s*[:=]\s*[^\s,;'"]+/gi },
  { name: "bearer", re: /Bearer\s+[A-Za-z0-9._-]+/gi },
  { name: "private_key", re: /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g },
];

export const EXPORT_FIELD_ALLOWLIST: ReadonlySet<string> = new Set([
  // Top-level episode fields (always safe)
  "episode_id",
  "schema_version",
  "created_at",
  "mission_id",
  "session_id",
  "terminal_state",
  "cohort",
  "review_eligible",
  "learning_quality_score",
  "historical_backfill",
  "optimizer_eligibility",
  // metadata (working_tree_fp EXCLUDED — fingerprint kan vara känsligt)
  "metadata.verification_profile",
  "metadata.head_sha",
  "metadata.agent",
  // outcome (tokens_input/output/cost EXCLUDED — kan avslöja usage-patterns)
  "outcome.task_success",
  "outcome.first_attempt_passed",
  "outcome.duration_ms",
  "outcome.gates_passed",
  "outcome.gates_failed",
  "outcome.gates_unknown",
  // state_machine (timestamps OK)
  "state_machine.active_at",
  "state_machine.implemented_at",
  "state_machine.verified_at",
  "state_machine.reconciled_at",
  "state_machine.finalized_at",
  // corrections (typ + before/after refs OK om de är paths/IDs)
  "corrections[].correction_id",
  "corrections[].type",
  "corrections[].reason",
  "corrections[].at",
  // evidence_refs (paths only, no inline content)
  "evidence_refs[]",
  "redaction_policy",
]);

// Format-specific top-level allowlists (defense-in-depth — transformers already
// hand-pick fields, this catches any unintended leakage).
export const FORMAT_ALLOWLISTS: Record<string, ReadonlySet<string>> = {
  router: new Set([
    "episode_id",
    "mission_id",
    "session_id",
    "terminal_state",
    "task_success",
    "verification_profile",
    "gates_passed",
    "gates_failed",
    "quality_tier",
  ]),
  classifier: new Set([
    "episode_id",
    "mission_id",
    "terminal_state",
    "task_success",
    "first_attempt_passed",
    "verification_profile",
    "gates_passed",
    "gates_failed",
    "quality_tier",
  ]),
  preference: new Set([
    "episode_id",
    "mission_id",
    "corrections",
    "corrections[].correction_id",
    "corrections[].type",
    "corrections[].reason",
    "quality_tier",
  ]),
  sft: new Set([
    "episode_id",
    "mission_id",
    "input",
    "input.mission_id",
    "input.verification_profile",
    "input.required_gates",
    "output",
    "output.terminal_state",
    "output.task_success",
    "output.first_attempt_passed",
    "quality_tier",
  ]),
  eval: new Set([
    "episode_id",
    "mission_id",
    "held_out",
    "fixture",
    "fixture.terminal_state",
    "fixture.task_success",
    "fixture.gates_passed",
    "fixture.gates_failed",
    "fixture.verification_profile",
    "quality_tier",
  ]),
};

export function redactString(input: string): string {
  let out = input;
  for (const { name, re } of SECRET_PATTERNS) {
    out = out.replace(re, `${name}=<REDACTED>`);
  }
  return out;
}

export function redactSecrets<T>(input: T): T {
  if (typeof input === "string") {
    return redactString(input) as T;
  }
  if (Array.isArray(input)) {
    return input.map((v) => redactSecrets(v)) as T;
  }
  if (input && typeof input === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = redactSecrets(v);
    }
    return out as T;
  }
  return input;
}

export interface AllowlistCheckResult {
  allowed: boolean;
  path: string;
  reason?: string;
}

/**
 * Check if a given field path is allowed for export.
 * Path can be nested (e.g. "metadata.verification_profile") or array-indexed
 * (e.g. "corrections[].type", "evidence_refs[]").
 */
export function isFieldAllowed(path: string): AllowlistCheckResult {
  if (EXPORT_FIELD_ALLOWLIST.has(path)) {
    return { allowed: true, path };
  }
  // Allow array wildcard matches
  const arrayPath = path.replace(/\[\d+\]/g, "[]");
  if (EXPORT_FIELD_ALLOWLIST.has(arrayPath)) {
    return { allowed: true, path };
  }
  return {
    allowed: false,
    path,
    reason: `field '${path}' not in EXPORT_FIELD_ALLOWLIST`,
  };
}

export function filterByAllowlist<T>(obj: T): {
  filtered: any;
  dropped_paths: string[];
} {
  const dropped: string[] = [];
  function walk(value: any, pathPrefix: string): any {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
      // Special case: array of primitives (e.g. evidence_refs[])
      if (value.every((v) => typeof v !== "object" || v === null)) {
        const check = isFieldAllowed(`${pathPrefix}[]`);
        if (!check.allowed) {
          dropped.push(`${pathPrefix}[]`);
          return undefined;
        }
        return value.map((v) => (typeof v === "string" ? redactString(v) : v));
      }
      return value.map((item, i) => walk(item, `${pathPrefix}[${i}]`));
    }
    if (typeof value === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(value)) {
        const childPath = pathPrefix ? `${pathPrefix}.${k}` : k;
        // Two-step filter: (1) check exact leaf path; (2) recurse into nested objects
        // regardless of whether the parent path is allowed (parent containers are
        // transparent — only leaf paths must be in the allowlist).
        if (v !== null && typeof v === "object" && !Array.isArray(v)) {
          // Recurse into nested object — children may have allowed leaves
          const recursed = walk(v, childPath);
          if (recursed && Object.keys(recursed).length > 0) {
            out[k] = recursed;
          } else {
            dropped.push(childPath);
          }
        } else if (Array.isArray(v)) {
          // Arrays always recurse — child elements may be allowed
          const recursed = walk(v, childPath);
          if (recursed !== undefined) out[k] = recursed;
          else dropped.push(childPath);
        } else {
          // Primitive leaf — must match allowlist
          const exact = isFieldAllowed(childPath);
          if (exact.allowed) {
            out[k] = typeof v === "string" ? redactString(v) : v;
          } else {
            dropped.push(childPath);
          }
        }
      }
      return out;
    }
    // Primitive at root (shouldn't normally happen)
    if (pathPrefix === "") return value;
    const check = isFieldAllowed(pathPrefix);
    if (check.allowed) return value;
    dropped.push(pathPrefix);
    return undefined;
  }
  const filtered = walk(obj, "");
  return { filtered, dropped_paths: dropped };
}
