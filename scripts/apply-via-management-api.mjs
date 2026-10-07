#!/usr/bin/env node
/**
 * apply-via-management-api.mjs — Kör en .sql-fil mot live Supabase med SUPABASE_PAT.
 *
 * Användning:
 *   node scripts/apply-via-management-api.mjs <migration-file.sql>
 *
 * Kräver:
 *   - SUPABASE_PAT i .env (sbp_xxx)
 *   - SUPABASE_URL i .env (https://xxxx.supabase.co)
 */

import 'dotenv/config';
import { readFileSync } from 'fs';

const PAT = process.env.SUPABASE_PAT;
const URL = process.env.SUPABASE_URL;
if (!PAT || !URL) { console.error('Missing SUPABASE_PAT or SUPABASE_URL in .env'); process.exit(2); }

const projectRef = URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!projectRef) { console.error('Could not parse project ref from URL'); process.exit(2); }

const sqlFile = process.argv[2];
if (!sqlFile) { console.error('Usage: node scripts/apply-via-management-api.mjs <file.sql>'); process.exit(2); }

const sql = readFileSync(sqlFile, 'utf8');
console.log(`Loaded ${sqlFile}: ${sql.length} chars, ${sql.split('\n').length} lines`);

const apiUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
console.log(`POST ${apiUrl}`);

const res = await fetch(apiUrl, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${PAT}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

const text = await res.text();
console.log(`HTTP ${res.status}`);
if (!res.ok) {
  console.error('Error:\n' + text);
  process.exit(1);
}
console.log('Response:\n' + text);
console.log('\n✓ Migration applied');