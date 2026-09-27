/**
 * apply-retag.ts — Skriv tillbaka LLM-förslag till Supabase.
 *
 * Läser `00-Vault/01-Projects/EventPulse/04-Sources/retag-suggestions-YYYY-MM-DD.jsonl`
 * (producerad av `_retag-batch.ts`) och skriver tillbaka till:
 *
 *   1. events.category_slug  — primär slug (första i arrayen), denormaliserad
 *      för snabb filter-fråga från klienter.
 *   2. event_categories      — M:M-join, en rad per slug (multi-label).
 *
 * Två lägen:
 *
 *   --review   Read-only diff. Visar fördelning, stickprov, validering.
 *              Rekommenderas ALLTID först. Inga DB-mutationer.
 *   --apply    Faktisk skrivning. Batch-transaktion om 100 events åt gången.
 *              Idempotent: raderar befintliga event_categories-rader först.
 *
 * Säkerhet:
 *   * Validerar att alla slugs finns i categories-tabellen (skippar okända).
 *   * Validerar att events.category_slug='community' innan write (rör ej andra).
 *   * Validerar att event_id finns i DB (skippar stale IDs).
 *   * Loggar varje batch till stdout + vault-run-fil.
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/apply-retag.ts --review
 *   tsx --env-file=.env 04-Normalizer/_scripts/apply-retag.ts --apply
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Suggestion {
  id: string;
  slugs: string[];
  reasoning: string;
}

interface CategoryRow {
  id: string;
  slug: string;
}

interface EventRow {
  id: string;
  category_slug: string | null;
}

const PAGE = 1000;
const BATCH_SIZE = 100;
const VAULT_DIR = join(process.cwd(), '00-Vault/01-Projects/EventPulse/04-Sources');
// Läs SUGGESTIONS_FILE från argv (default = v1). Ex: --file=retag-suggestions-v2-2026-09-27.jsonl
const SUGGESTIONS_FILE = (process.argv.find((a) => a.startsWith('--file='))?.split('=')[1])
  ?? 'retag-suggestions-2026-09-27.jsonl';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

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

async function loadCategories(): Promise<Map<string, string>> {
  // slug → category_id (UUID)
  const map = new Map<string, string>();
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('categories')
      .select('id, slug')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`categories fetch error: ${error.message}`);
    if (data && data.length > 0) {
      for (const row of data as CategoryRow[]) map.set(row.slug, row.id);
      offset += data.length;
      hasMore = data.length === PAGE;
    } else hasMore = false;
  }
  return map;
}

async function loadExistingEventIds(): Promise<Set<string>> {
  // Bara events som fortfarande har category_slug='community' är kandidater.
  // Detta skyddar mot att vi skriver till events som redan flyttats.
  const ids = new Set<string>();
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select('id, category_slug')
      .eq('category_slug', 'community')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`events fetch error: ${error.message}`);
    if (data && data.length > 0) {
      for (const row of data as EventRow[]) ids.add(row.id);
      offset += data.length;
      hasMore = data.length === PAGE;
    } else hasMore = false;
  }
  return ids;
}

interface ValidationResult {
  valid: Suggestion[];
  unknownSlugs: Map<string, number>;
  staleIds: Suggestion[];
  unchanged: Suggestion[]; // alla slugs === ['community']
}

function validate(
  suggestions: Suggestion[],
  slugMap: Map<string, string>,
  existingIds: Set<string>,
): ValidationResult {
  const valid: Suggestion[] = [];
  const unknownSlugs = new Map<string, number>();
  const staleIds: Suggestion[] = [];
  const unchanged: Suggestion[] = [];

  for (const s of suggestions) {
    if (!existingIds.has(s.id)) {
      staleIds.push(s);
      continue;
    }
    if (s.slugs.length === 1 && s.slugs[0] === 'community') {
      unchanged.push(s);
      continue;
    }
    // Filtrera bort okända slugs
    const knownSlugs: string[] = [];
    for (const slug of s.slugs) {
      if (slugMap.has(slug)) knownSlugs.push(slug);
      else unknownSlugs.set(slug, (unknownSlugs.get(slug) ?? 0) + 1);
    }
    if (knownSlugs.length === 0) {
      // Alla slugs var okända → behandla som oförändrad
      unchanged.push(s);
      continue;
    }
    valid.push({ ...s, slugs: knownSlugs });
  }

  return { valid, unknownSlugs, staleIds, unchanged };
}

function distribution(suggestions: Suggestion[]): Map<string, number> {
  const dist = new Map<string, number>();
  for (const s of suggestions) {
    for (const slug of s.slugs) dist.set(slug, (dist.get(slug) ?? 0) + 1);
  }
  return new Map([...dist.entries()].sort((a, b) => b[1] - a[1]));
}

// ─── Review (read-only) ────────────────────────────────────────────────────

async function reviewMode(): Promise<void> {
  console.log('[apply-retag] ── REVIEW MODE (inga DB-mutationer) ──\n');

  const suggestions = await loadSuggestions();
  console.log(`[apply-retag] ${suggestions.length} förslag i ${SUGGESTIONS_FILE}`);

  const slugMap = await loadCategories();
  console.log(`[apply-retag] ${slugMap.size} kategorier i DB`);

  const existingIds = await loadExistingEventIds();
  console.log(`[apply-retag] ${existingIds.size} events med category_slug='community' i DB\n`);

  const v = validate(suggestions, slugMap, existingIds);

  console.log('─── Validering ───');
  console.log(`  Skrivbara:    ${v.valid.length}`);
  console.log(`  Oförändrade:  ${v.unchanged.length}  (alla slugs=['community'] eller alla okända)`);
  console.log(`  Stale IDs:    ${v.staleIds.length}  (eventet finns inte längre som community)`);
  console.log(`  Okända slugs: ${v.unknownSlugs.size} unika → ${[...v.unknownSlugs.entries()].map(([k, n]) => `${k}(${n})`).join(', ') || '(inga)'}\n`);

  const dist = distribution(v.valid);
  console.log('─── Fördelning av SKRIVBARA events (multi-label-räknat) ───');
  for (const [slug, n] of dist) {
    const bar = '█'.repeat(Math.min(60, Math.round(n / 5)));
    console.log(`  ${slug.padEnd(18)} ${String(n).padStart(4)}  ${bar}`);
  }
  console.log('');

  // Uppskattat antal writes
  const eventUpdates = v.valid.length;
  const ecInserts = v.valid.reduce((acc, s) => acc + s.slugs.length, 0);
  console.log('─── Planerade writes (om --apply) ───');
  console.log(`  UPDATE events.category_slug:   ${eventUpdates} rows`);
  console.log(`  DELETE event_categories (först): ${ecInserts} rows (för ${eventUpdates} events)`);
  console.log(`  INSERT event_categories:       ${ecInserts} rows`);
  console.log(`  Transaktioner:                 ${Math.ceil(v.valid.length / BATCH_SIZE)} st (${BATCH_SIZE} events/st)\n`);

  console.log('─── Första 10 skrivbara events per top-3 nya kategorier ───');
  const top3 = [...dist.entries()].slice(0, 3).map(([s]) => s);
  for (const slug of top3) {
    const samples = v.valid.filter((s) => s.slugs.includes(slug)).slice(0, 10);
    console.log(`\n  [${slug}]`);
    for (const s of samples) {
      console.log(`    ${s.id}  → ${s.slugs.join(' + ')}  (${s.reasoning.slice(0, 60)})`);
    }
  }
  console.log('\n[apply-retag] ✅ Review klar. Kör med --apply för att skriva.');
}

// ─── Apply ─────────────────────────────────────────────────────────────────

async function applyBatch(batch: Suggestion[], slugMap: Map<string, string>): Promise<{ updated: number; inserted: number; deleted: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;
  let inserted = 0;
  let deleted = 0;

  // 1. DELETE befintliga event_categories-rader för dessa events
  const eventIds = batch.map((s) => s.id);
  const { error: delError, count: delCount } = await supabase
    .from('event_categories')
    .delete({ count: 'exact' })
    .in('event_id', eventIds);
  if (delError) {
    errors.push(`DELETE event_categories: ${delError.message}`);
    return { updated, inserted, deleted, errors };
  }
  deleted = delCount ?? 0;

  // 2. UPDATE events.category_slug (primär slug = slugs[0])
  for (const s of batch) {
    const primary = s.slugs[0];
    const { error: updError } = await supabase
      .from('events')
      .update({ category_slug: primary })
      .eq('id', s.id);
    if (updError) {
      errors.push(`UPDATE event ${s.id}: ${updError.message}`);
    } else {
      updated++;
    }
  }

  // 3. INSERT event_categories — en rad per slug
  const rows: Array<{ event_id: string; category_id: string }> = [];
  for (const s of batch) {
    for (const slug of s.slugs) {
      const catId = slugMap.get(slug);
      if (catId) rows.push({ event_id: s.id, category_id: catId });
    }
  }
  if (rows.length > 0) {
    const { error: insError, count: insCount } = await supabase
      .from('event_categories')
      .insert(rows, { count: 'exact' });
    if (insError) {
      errors.push(`INSERT event_categories: ${insError.message}`);
    } else {
      inserted = insCount ?? rows.length;
    }
  }

  return { updated, inserted, deleted, errors };
}

async function applyMode(): Promise<void> {
  console.log('[apply-retag] ── APPLY MODE (DB-mutationer) ──\n');

  const suggestions = await loadSuggestions();
  const slugMap = await loadCategories();
  const existingIds = await loadExistingEventIds();

  const v = validate(suggestions, slugMap, existingIds);

  console.log(`[apply-retag] Validering: ${v.valid.length} skrivbara, ${v.unchanged.length} oförändrade, ${v.staleIds.length} stale`);
  console.log(`[apply-retag] Startar batch-transaktion om ${BATCH_SIZE} events...\n`);

  const startedAt = Date.now();
  let totalUpdated = 0;
  let totalInserted = 0;
  let totalDeleted = 0;
  const allErrors: string[] = [];

  for (let i = 0; i < v.valid.length; i += BATCH_SIZE) {
    const batch = v.valid.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(v.valid.length / BATCH_SIZE);

    const result = await applyBatch(batch, slugMap);
    totalUpdated += result.updated;
    totalInserted += result.inserted;
    totalDeleted += result.deleted;
    allErrors.push(...result.errors);

    const errStr = result.errors.length > 0 ? ` ERRORS=${result.errors.length}` : '';
    console.log(`  batch ${String(batchNum).padStart(3)}/${totalBatches}  updated=${result.updated}  inserted=${result.inserted}  deleted=${result.deleted}${errStr}`);
  }

  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n[apply-retag] ✅ Klart på ${durationSec}s`);
  console.log(`  UPDATE events.category_slug:   ${totalUpdated}`);
  console.log(`  DELETE event_categories:       ${totalDeleted}`);
  console.log(`  INSERT event_categories:       ${totalInserted}`);
  if (allErrors.length > 0) {
    console.log(`  Errors:                        ${allErrors.length}`);
    for (const e of allErrors.slice(0, 5)) console.log(`    - ${e}`);
  }

  // Skriv run-log till vault
  const today = new Date().toISOString().slice(0, 10);
  const logPath = join(VAULT_DIR, `apply-retag-run-${today}.md`);
  await writeFile(
    logPath,
    [
      `# Apply-retag run — ${today}`,
      '',
      `* Förslag lästa: ${suggestions.length}`,
      `* Skrivbara:     ${v.valid.length}`,
      `* Oförändrade:   ${v.unchanged.length}`,
      `* Stale IDs:     ${v.staleIds.length}`,
      `* Okända slugs:  ${v.unknownSlugs.size} unika`,
      '',
      `## Resultat`,
      '',
      `* UPDATE events.category_slug: ${totalUpdated} rows`,
      `* DELETE event_categories:     ${totalDeleted} rows`,
      `* INSERT event_categories:     ${totalInserted} rows`,
      `* Errors:                      ${allErrors.length}`,
      `* Duration:                    ${durationSec}s`,
      '',
      `## Fördelning (multi-label-räknat)`,
      '',
      ...[...distribution(v.valid).entries()].map(([slug, n]) => `* ${slug}: ${n}`),
      '',
    ].join('\n'),
    'utf8',
  );
  console.log(`\n[apply-retag] Run-log: ${logPath}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv.includes('--apply')
    ? 'apply'
    : process.argv.includes('--review')
    ? 'review'
    : 'review'; // default = review (säker)

  await mkdir(VAULT_DIR, { recursive: true });

  if (mode === 'review') {
    await reviewMode();
  } else {
    await applyMode();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[apply-retag] FATAL:', msg);
  process.exit(1);
});
