/**
 * apply-migration.ts — apply a SQL migration file to live Supabase.
 *
 * Reads DATABASE_URL from .env (pg connection string), connects, runs the SQL
 * file. Idempotent — uses CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
 * / CREATE OR REPLACE VIEW / REVOKE / GRANT.
 *
 * Run with:  npx tsx 08-Agent/scripts/apply-migration.ts <path/to/migration.sql>
 * Default:   /Volumes/2TB filer/NEWSTRUCTURE-COPY/05-Supabase/migrations/20260818-0001-agent-event-graph.sql
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';

const DEFAULT_MIGRATION =
  '/Volumes/2TB filer/NEWSTRUCTURE-COPY/05-Supabase/migrations/20260818-0001-agent-event-graph.sql';
const MIGRATION_PATH = resolve(process.argv[2] ?? DEFAULT_MIGRATION);

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
  // Dollar-quoted bodies ($$ ... $$ / $tag$ ... $tag$) hold PL/pgSQL where
  // semicolons are statement separators, not statement terminators. Without
  // this the splitter cuts CREATE FUNCTION in half (2026-10-21).
  let dollarTag: string | null = null;
  for (let i = 0; i < noComments.length; i++) {
    const c = noComments[i];
    if (dollarTag) {
      if (c === '$' && noComments.startsWith(dollarTag, i)) {
        buf += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
      } else {
        buf += c;
      }
      continue;
    }
    if (!inString && c === '$') {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(noComments.slice(i));
      if (m) {
        dollarTag = m[0];
        buf += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }
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
