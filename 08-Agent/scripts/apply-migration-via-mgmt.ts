/**
 * apply-migration-via-mgmt.ts — apply a SQL migration to live Supabase
 * via the Management API (`POST /v1/projects/{ref}/database/query`).
 *
 * Used when DNS to the Postgres host is blocked in this environment but the
 * Management API endpoint is reachable. Reads SUPABASE_PAT (Personal Access
 * Token) from .env. Defaults to SUPABASE_URL-derived project ref.
 *
 * Idempotent for `ADD COLUMN IF NOT EXISTS` / `CREATE OR REPLACE VIEW`.
 * DO-blocks guard constraint creation.
 *
 * Run:
 *   npx tsx 08-Agent/scripts/apply-migration-via-mgmt.ts <path/to/migration.sql>
 */

import { config as dotenvConfig } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Walk up from CWD to find the project-root .env (it lives outside 08-Agent).
for (const candidate of [process.cwd(), resolve(process.cwd(), '..'), resolve(process.cwd(), '../..')]) {
  dotenvConfig({ path: resolve(candidate, '.env') });
}

const PAT = process.env.SUPABASE_PAT;
if (!PAT) {
  console.error('[apply-migration-via-mgmt] SUPABASE_PAT not set in .env');
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const refMatch = SUPABASE_URL.match(/^https:\/\/([^.]+)\.supabase\.co/);
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? refMatch?.[1];
if (!PROJECT_REF) {
  console.error('[apply-migration-via-mgmt] cannot derive project ref from SUPABASE_URL');
  process.exit(2);
}

const DEFAULT_MIGRATION =
  '/Volumes/2TB filer/NEWSTRUCTURE-COPY/05-Supabase/migrations/20260826-0001-events-image-ai-optout.sql';
const MIGRATION_PATH = resolve(process.argv[2] ?? DEFAULT_MIGRATION);

function splitSqlStatements(sql: string): string[] {
  const noComments = sql
    .replace(/^BEGIN;\s*$/gm, '')
    .replace(/^COMMIT;\s*$/gm, '')
    .replace(/^--.*$/gm, '');
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  let inString = false;
  let dollarTag: string | null = null;
  for (let i = 0; i < noComments.length; i++) {
    const c = noComments[i];
    // Dollar-quoted string handling — $$...$tag$...$tag$
    if (!inString && c === '$') {
      const m = noComments.slice(i).match(/^\$([A-Za-z0-9_]*)\$/);
      if (m) {
        if (dollarTag === null) {
          dollarTag = m[1];
        } else if (m[1] === dollarTag) {
          dollarTag = null;
        }
        buf += m[0];
        i += m[0].length - 1;
        continue;
      }
    }
    if (dollarTag !== null) {
      buf += c;
      continue;
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

async function runQuery(query: string): Promise<unknown> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function main(): Promise<void> {
  console.log(`[apply-migration-via-mgmt] project_ref=${PROJECT_REF}`);
  console.log(`[apply-migration-via-mgmt] reading ${MIGRATION_PATH}`);
  const sql = readFileSync(MIGRATION_PATH, 'utf-8');
  const statements = splitSqlStatements(sql);
  console.log(`[apply-migration-via-mgmt] ${statements.length} statements`);
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 80);
    try {
      const result = await runQuery(stmt);
      console.log(`  [${i + 1}/${statements.length}] OK  ${preview}…`);
      if (Array.isArray(result) && result.length > 0 && result.length <= 5) {
        console.log('    →', JSON.stringify(result).slice(0, 200));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${i + 1}/${statements.length}] ERR ${preview}…`);
      console.error(`    → ${msg}`);
      throw err;
    }
  }
  console.log('[apply-migration-via-mgmt] done');
}

main().catch((err) => {
  console.error('[apply-migration-via-mgmt] FAILED:', err && err.message ? err.message : err);
  process.exit(1);
});