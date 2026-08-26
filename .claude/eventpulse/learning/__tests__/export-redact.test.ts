/**
 * export-redact.test.ts — Phase L-H tester (5 tester)
 *
 * Verifierar att export-redaction:
 *   1. redactString fångar api_key, secret, password, access_token, supabase_service_role
 *   2. redactString fångar Bearer-token och private keys
 *   3. isFieldAllowed tillåter whitelisted paths (top-level + nested + array)
 *   4. isFieldAllowed blockerar paths som inte är i EXPORT_FIELD_ALLOWLIST
 *   5. filterByAllowlist filtrerar bort disallowed fields och returnerar dropped_paths
 */

import { describe, it, expect } from "vitest";
import { redactString, redactSecrets, isFieldAllowed, filterByAllowlist, EXPORT_FIELD_ALLOWLIST, FORMAT_ALLOWLISTS } from "../scripts/redact-secrets";

describe("redact-secrets", () => {
  it("1. redactString fångar api_key, secret, password, access_token, supabase_service_role", () => {
    const input = 'config: api_key=ABC123 secret=hunter2 password=p@ss access_token=tok-1 supabase_service_role=eyJabc';
    const out = redactString(input);
    expect(out).toContain("api_key=<REDACTED>");
    expect(out).toContain("secret=<REDACTED>");
    expect(out).toContain("password=<REDACTED>");
    expect(out).toContain("access_token=<REDACTED>");
    expect(out).toContain("supabase_service_role=<REDACTED>");
    expect(out).not.toContain("ABC123");
    expect(out).not.toContain("hunter2");
  });

  it("2. redactString fångar Bearer-token och private keys", () => {
    const input = `Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAK...
-----END RSA PRIVATE KEY-----`;
    const out = redactString(input);
    expect(out).toMatch(/bearer=<REDACTED>/i);
    expect(out).toContain("private_key=<REDACTED>");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).not.toContain("MIIEowIBAAK");
  });

  it("3. isFieldAllowed tillåter whitelisted paths (top-level + nested + array)", () => {
    expect(isFieldAllowed("episode_id").allowed).toBe(true);
    expect(isFieldAllowed("metadata.verification_profile").allowed).toBe(true);
    expect(isFieldAllowed("corrections[0].type").allowed).toBe(true);
    expect(isFieldAllowed("evidence_refs[2]").allowed).toBe(true);
    expect(isFieldAllowed("outcome.gates_passed").allowed).toBe(true);
  });

  it("4. isFieldAllowed blockerar paths som inte är i EXPORT_FIELD_ALLOWLIST", () => {
    expect(isFieldAllowed("tokens_input").allowed).toBe(false);
    expect(isFieldAllowed("metadata.working_tree_fp").allowed).toBe(false); // EXCLUDED per §20
    expect(isFieldAllowed("outcome.cost_usd").allowed).toBe(false); // EXCLUDED per §20
    expect(isFieldAllowed("secret_notes").allowed).toBe(false);
    expect(isFieldAllowed("api_key").allowed).toBe(false);
  });

  it("5. filterByAllowlist filtrerar bort disallowed fields och rapporterar dropped_paths", () => {
    const input = {
      episode_id: "EP-001",
      mission_id: "M-001",
      terminal_state: "completed",
      // disallowed
      tokens_input: 1500,
      secret_notes: "should be dropped",
      metadata: {
        verification_profile: "standard",
        working_tree_fp: "fp-123", // disallowed
        agent: "ep-test",
      },
      outcome: {
        task_success: true,
        gates_passed: ["g1"],
      },
    };
    const { filtered, dropped_paths } = filterByAllowlist(input);
    expect(filtered.episode_id).toBe("EP-001");
    expect(filtered.metadata.verification_profile).toBe("standard");
    expect(filtered.outcome.task_success).toBe(true);
    expect(filtered.tokens_input).toBeUndefined();
    expect(filtered.secret_notes).toBeUndefined();
    expect(filtered.metadata.working_tree_fp).toBeUndefined();
    expect(dropped_paths.length).toBeGreaterThan(0);
    expect(dropped_paths.some((p: string) => p.includes("tokens_input"))).toBe(true);
    expect(dropped_paths.some((p: string) => p.includes("working_tree_fp"))).toBe(true);
    // Sanity: ALLOWLIST och FORMAT_ALLOWLISTS har rätt keys
    expect(EXPORT_FIELD_ALLOWLIST.has("episode_id")).toBe(true);
    expect(FORMAT_ALLOWLISTS.router).toBeDefined();
    expect(FORMAT_ALLOWLISTS.classifier).toBeDefined();
  });
});
