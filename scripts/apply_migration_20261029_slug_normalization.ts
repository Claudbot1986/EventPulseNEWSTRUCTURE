/**
 * scripts/apply_migration_20261029_slug_normalization.ts
 *
 * Kör SQL-migrationen 20261029-0001-normalize-legacy-category-slugs.sql
 * mot live-DB via direkt Postgres-anslutning (DATABASE_URL).
 *
 * Varför inte Supabase JS-klienten: migrationen innehåller DDL (CHECK-
 * constraint + funktion) och DO-block, vilket REST-API:t inte kan köra.
 * SQL-filen är enda källan — detta skriptet applicerar den ordagrant.
 *
 * Användning:
 *   node --env-file=.env --import tsx scripts/apply_migration_20261029_slug_normalization.ts
 *   node --env-file=.env --import tsx scripts/apply_migration_20261029_slug_normalization.ts --dry-run
 *
 * --dry-run: kör migrationen i en transaktion och ROLLBACKar — verifierar
 * att SQL:et är giltigt och mäter effekten utan att skriva.
 */

import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION_PATH = resolve(
  process.cwd(),
  '05-Supabase/migrations/20261029-0001-normalize-legacy-category-slugs.sql',
);

const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[migrate] DATABASE_URL saknas i .env');
    process.exit(1);
  }

  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  console.log(`[migrate] ${MIGRATION_PATH}`);
  console.log(`[migrate] ${sql.split('\n').length} rader SQL · mode=${dryRun ? 'DRY-RUN' : 'APPLY'}`);

  // VIKTIGT: SQL-filen har sin egen BEGIN/COMMIT. I dry-run-läge måste de
  // tas bort — annars COMMIT:ar filen och den yttre ROLLBACKen gör inget,
  // vilket gör "dry-run" till en riktig körning. (Buggen upptäcktes
  // 2026-10-29: första dry-run applicerade migrationen.)
  const sqlForDryRun = sql.replace(/^\s*COMMIT;\s*$/gm, '');
  if (dryRun && sqlForDryRun === sql) {
    console.warn('[migrate] VARNING: hittade ingen COMMIT; att ta bort — dry-run kan komma att skriva.');
  }

  const client = new Client({ connectionString });
  // Visa RAISE NOTICE från migrationens verifieringsblock.
  client.on('notice', (n) => console.log('[db]', n.message));
  await client.connect();

  try {
    if (dryRun) {
      // Kör allt i en explicit transaktion som rullas tillbaka.
      await client.query('BEGIN');
      try {
        await client.query(sqlForDryRun);
        const { rows } = await client.query(`
          SELECT
            (SELECT COUNT(*)::int FROM events WHERE category_slug IS NULL)                              AS null_slugs,
            (SELECT COUNT(*)::int FROM events e LEFT JOIN categories c ON c.slug = e.category_slug
              WHERE e.category_slug IS NOT NULL AND c.id IS NULL)                                       AS invalid_slugs,
            (SELECT COUNT(DISTINCT category_slug)::int FROM events)                                     AS categories,
            (SELECT COUNT(*)::int FROM events)                                                         AS total_events
        `);
        console.log('[migrate] DRY-RUN-resultat:', rows[0]);
      } finally {
        await client.query('ROLLBACK');
        console.log('[migrate] ROLLBACK — inga ändringar gjorda.');
      }
      return;
    }

    await client.query(sql);
    console.log('[migrate] Migration applicerad.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[migrate] FEL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
