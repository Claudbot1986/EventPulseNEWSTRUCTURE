/**
 * _generate-community-retag-migration.ts
 *
 * Reads the v3 retag suggestions (MiniMax-M2.7 batch from 2026-09-29),
 * patches deprecated slugs (`musical` → `musical-theatre`), filters to
 * confidence ≥ threshold + non-community suggestions, and writes a DRY-RUN
 * SQL migration file to `05-Supabase/migrations/`.
 *
 * This script is READ-ONLY on the database (no fetches, no writes).
 * It only reads the vault JSONL and writes a local .sql file.
 *
 * The migration must NEVER be applied without explicit user approval
 * (per CLAUDE.md policy.md risk boundary `critical`).
 *
 * Usage:
 *   tsx 04-Normalizer/_scripts/_generate-community-retag-migration.ts
 *   tsx 04-Normalizer/_scripts/_generate-community-retag-migration.ts --min-confidence=0.85
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const VAULT_DIR = join(process.cwd(), '00-Vault/01-Projects/EventPulse/04-Sources');
const MIGRATIONS_DIR = join(process.cwd(), '05-Supabase/migrations');
const SUGGESTIONS_FILE = 'retag-suggestions-v3-2026-09-29.jsonl';
const DATE_TAG = '2026-10-01';
const MIGRATION_FILE = `${DATE_TAG}-0001-retag-community-batch-dry-run.sql`;

// ─── Configuration ─────────────────────────────────────────────────────────

/** Confidence threshold. Higher = safer (fewer false-positives), lower = bigger impact. */
const MIN_CONFIDENCE = parseFloat(
  process.argv.find((a) => a.startsWith('--min-confidence='))?.split('=')[1] ?? '0.85',
);

/** Deprecated slug → canonical v3 slug. Keys are lowercase. */
const DEPRECATED_TO_CANONICAL: Record<string, string> = {
  musical: 'musical-theatre',
  // Future additions go here when old names surface (e.g. 'art' → 'exhibition',
  // 'theater' → 'theatre-drama' — though those should already be caught by the
  // canonicalize step in 04-Normalizer/categoryCanonicalize.ts).
};

// ─── Types ─────────────────────────────────────────────────────────────────

interface Suggestion {
  id: string;
  category: string;
  confidence: number;
  reasoning: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function loadSuggestions(): Promise<Suggestion[]> {
  const path = join(VAULT_DIR, SUGGESTIONS_FILE);
  const text = await readFile(path, 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((l, idx) => {
      try {
        return JSON.parse(l) as Suggestion;
      } catch (e) {
        throw new Error(`Ogiltig JSON på rad ${idx + 1}: ${(e as Error).message}`);
      }
    });
}

/**
 * Patch deprecated slugs to their canonical v3 equivalent. Returns the
 * patched slug AND a flag indicating whether a rename occurred.
 */
function patchSlug(slug: string): { slug: string; patched: boolean } {
  const canonical = DEPRECATED_TO_CANONICAL[slug.toLowerCase()];
  if (canonical) return { slug: canonical, patched: true };
  return { slug, patched: false };
}

function escapeSqlString(s: string): string {
  // Single-quote escape for SQL: ' → ''
  return s.replace(/'/g, "''");
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[retag-migration] Reading ${SUGGESTIONS_FILE}…`);
  const raw = await loadSuggestions();
  console.log(`[retag-migration] Loaded ${raw.length} suggestions`);

  // Statistics: count per category before filtering
  const beforeByCategory = new Map<string, number>();
  for (const s of raw) {
    beforeByCategory.set(s.category, (beforeByCategory.get(s.category) ?? 0) + 1);
  }

  // Patch deprecated slugs
  let patchedCount = 0;
  const patched: Suggestion[] = raw.map((s) => {
    const { slug, patched } = patchSlug(s.category);
    if (patched) patchedCount++;
    return { ...s, category: slug };
  });
  console.log(`[retag-migration] Patched ${patchedCount} deprecated slugs (musical → musical-theatre)`);

  // Filter: confidence ≥ MIN_CONFIDENCE AND category !== 'community'
  const filtered = patched.filter((s) => s.confidence >= MIN_CONFIDENCE && s.category !== 'community');
  console.log(
    `[retag-migration] After filter (confidence ≥ ${MIN_CONFIDENCE} AND category !== 'community'): ${filtered.length} suggestions`,
  );

  // Statistics: count per category after filtering
  const afterByCategory = new Map<string, number>();
  for (const s of filtered) {
    afterByCategory.set(s.category, (afterByCategory.get(s.category) ?? 0) + 1);
  }

  // Group by category for the migration
  const byCategory = new Map<string, Suggestion[]>();
  for (const s of filtered) {
    const arr = byCategory.get(s.category) ?? [];
    arr.push(s);
    byCategory.set(s.category, arr);
  }

  // Build the dry-run SQL file
  await mkdir(MIGRATIONS_DIR, { recursive: true });
  const outPath = join(MIGRATIONS_DIR, MIGRATION_FILE);

  const headerLines: string[] = [
    `-- ─────────────────────────────────────────────────────────────────────────`,
    `-- DRY RUN — DO NOT APPLY WITHOUT EXPLICIT USER APPROVAL`,
    `-- Generated: ${new Date().toISOString()}`,
    `-- Source: ${SUGGESTIONS_FILE} (MiniMax-M2.7 retag batch, 2026-09-29)`,
    `--`,
    `-- Purpose:`,
    `--   Re-categorize community-bucket events that v3 retag suggested with`,
    `--   confidence ≥ ${MIN_CONFIDENCE}. After apply, 'community' should be`,
    `--   a GENUINE semantic category (local/community events), not a fallback.`,
    `--`,
    `-- Safety:`,
    `--   * WHERE clause: id = '<uuid>' AND category_slug = 'community'`,
    `--     → rör endast events som FORTFARANDE är i community.`,
    `--   * Each UPDATE is idempotent — running twice has no effect.`,
    `--   * Patched deprecated slugs (musical → musical-theatre) to canonical v3.`,
    `--`,
    `-- Stats:`,
    `--   Total suggestions loaded:           ${raw.length}`,
    `--   Patched (musical → musical-theatre): ${patchedCount}`,
    `--   After filter (≥ ${MIN_CONFIDENCE}, ≠ 'community'):  ${filtered.length}`,
    `--   Excluded (community or low conf):   ${raw.length - filtered.length}`,
    `--`,
    `-- Per-category distribution (before → after filter):`,
    ...Array.from(beforeByCategory.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat, before]) => {
        const after = afterByCategory.get(cat) ?? afterByCategory.get(DEPRECATED_TO_CANONICAL[cat] ?? '') ?? 0;
        const note = DEPRECATED_TO_CANONICAL[cat] ? ` (renamed → ${DEPRECATED_TO_CANONICAL[cat]})` : '';
        return `--     ${cat.padEnd(20)} ${String(before).padStart(5)} → ${String(after).padStart(5)}${note}`;
      }),
    `-- ─────────────────────────────────────────────────────────────────────────`,
    ``,
    `BEGIN;`,
    ``,
  ];

  const updateLines: string[] = [];
  updateLines.push('-- ─── UPDATE statements (one per event) ───────────────────────────────');
  for (const [category, suggestions] of Array.from(byCategory.entries()).sort((a, b) => b[1].length - a[1].length)) {
    updateLines.push('');
    updateLines.push(`-- Category: ${category} (${suggestions.length} events)`);
    for (const s of suggestions) {
      const escapedReasoning = escapeSqlString(s.reasoning.slice(0, 200));
      updateLines.push(
        `UPDATE events SET category_slug = '${category}', updated_at = now() WHERE id = '${s.id}' AND category_slug = 'community'; -- conf=${s.confidence.toFixed(2)} | ${escapedReasoning}`,
      );
    }
  }

  const footerLines: string[] = [
    ``,
    `-- ─── Statistics (run AFTER apply to verify) ─────────────────────────────`,
    `-- SELECT category_slug, COUNT(*) AS n,`,
    `--        ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER(), 1) AS pct`,
    `-- FROM events GROUP BY category_slug ORDER BY n DESC;`,
    `--`,
    `-- Expected after apply:`,
    `--   * 'community' should drop to ~5-10 % (from 25 %).`,
    `--   * 'musical-theatre' should appear with ${byCategory.get('musical-theatre')?.length ?? 0} new events (was 0 in v3 batch since v2 didn't exist yet).`,
    `--   * No event moved to a slug NOT in 04-Normalizer/categoryDefinitions.ts.`,
    ``,
    `COMMIT;`,
    ``,
    `-- END OF DRY RUN — review carefully before applying.`,
    `-- To apply (AFTER user approval):`,
    `--   supabase db execute --file ${MIGRATION_FILE}`,
    `-- or via Supabase Management API (see 04-Normalizer/_scripts/_apply-retag.ts).`,
  ];

  await writeFile(outPath, headerLines.concat(updateLines).concat(footerLines).join('\n'));
  console.log(`[retag-migration] ✅ Wrote dry-run SQL → ${outPath}`);

  // Print summary
  console.log('');
  console.log('SUMMARY');
  console.log('───────');
  console.log(`Loaded:               ${raw.length}`);
  console.log(`Patched (musical → musical-theatre): ${patchedCount}`);
  console.log(`Filtered (conf ≥ ${MIN_CONFIDENCE}, ≠ community): ${filtered.length}`);
  console.log('');
  console.log('Per-category (after filter):');
  for (const [cat, n] of Array.from(afterByCategory.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(20)} ${n}`);
  }
}

main().catch((e) => {
  console.error('[retag-migration] Fatal:', e);
  process.exit(1);
});
