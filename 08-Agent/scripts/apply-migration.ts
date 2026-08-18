/**
 * apply-migration.ts — apply 20260818-0001-agent-event-graph.sql to live Supabase.
 *
 * Reads DATABASE_URL from .env (pg connection string), connects, runs the SQL
 * file. Idempotent — uses CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
 * / CREATE OR REPLACE VIEW / REVOKE / GRANT.
 *
 * Run with:  npx tsx 08-Agent/scripts/apply-migration.ts
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { Client } from 'pg';

const MIGRATION_PATH =
  '/Volumes/2TB filer/NEWSTRUCTURE/05-Supabase/migrations/20260818-0001-agent-event-graph.sql';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set in .env');

  const sql = readFileSync(MIGRATION_PATH, 'utf-8');
  const client = new Client({ connectionString: url });
  await client.connect();
  console.log('[apply-migration] connected');

  try {
    // pg driver does not allow multiple statements in a single .query() by
    // default — strip the trailing COMMIT and split on semicolons at depth 0.
    const statements = splitSqlStatements(sql);
    console.log(`[apply-migration] ${statements.length} statements`);
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      const preview = stmt.replace(/\s+/g, ' ').slice(0, 80);
      try {
        await client.query(stmt);
        console.log(`  [${i + 1}/${statements.length}] OK  ${preview}…`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  [${i + 1}/${statements.length}] ERR ${preview}…`);
        console.error(`    → ${msg}`);
        throw err;
      }
    }
    console.log('[apply-migration] done');
  } finally {
    await client.end();
  }
}

function splitSqlStatements(sql: string): string[] {
  // strip comments and the explicit COMMIT/ BEGIN wrappers
  const noComments = sql
    .replace(/^BEGIN;\s*$/gm, '')
    .replace(/^COMMIT;\s*$/gm, '')
    .replace(/^--.*$/gm, '');
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  let inString = false;
  for (let i = 0; i < noComments.length; i++) {
    const c = noComments[i];
    if (c === "'" && noComments[i - 1] !== '\\') inString = !inString;
    if (!inString) {
      if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    if (c === ';' && depth === 0 && !inString) {
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = '';
    } else {
      buf += c;
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

main().catch((err) => {
  console.error('[apply-migration] FAILED:', err && err.message ? err.message : err);
  process.exit(1);
});
