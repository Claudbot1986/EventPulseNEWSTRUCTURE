#!/usr/bin/env node
/**
 * Kör en SELECT mot EventPulses databas och skriv ut TSV.
 *
 *   node .cursor/skills/verify-eventpulse-handoff/scripts/dbq.mjs "SELECT 1"
 *
 * Varför inte psql: det finns ingen psql på maskinen.
 * Varför inte supabase-js: projektets Management-API-tokener är ogiltiga.
 * Vägen som fungerar är DATABASE_URL + pg, samma som
 * 08-Agent/scripts/apply-migration.ts.
 *
 * Endast SELECT. Skrivande SQL avvisas med exit 2 — det här är ett
 * läsverktyg för verifiering, inte ett migreringsverktyg.
 */
import { existsSync, readFileSync } from 'node:fs';
import { Client } from 'pg';

function envKey(key) {
  if (!existsSync('.env')) return undefined;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

const sql = process.argv.slice(2).join(' ').trim();
if (!sql) {
  console.error('usage: dbq.mjs "<SELECT ...>"');
  process.exit(2);
}
// Skrivande SQL avvisas. Strängliteraler maskeras först, så att
// `WHERE last_error LIKE 'Failed to update%'` inte falskt utlöser guarden.
const sqlNoLiterals = sql.replace(/'(?:[^']|'')*'/g, "''");
if (!/^\s*(select|with)\b/i.test(sqlNoLiterals) || /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i.test(sqlNoLiterals)) {
  console.error('[dbq] endast SELECT/WITH accepteras — det här är ett läsverktyg.');
  process.exit(2);
}

const url = process.env.DATABASE_URL ?? envKey('DATABASE_URL');
if (!url) {
  console.error('[dbq] DATABASE_URL saknas i .env och i process.env');
  process.exit(1);
}

const client = new Client({ connectionString: url });
try {
  await client.connect();
  const { rows } = await client.query(sql);
  if (rows.length === 0) {
    console.log('(0 rader)');
    process.exit(0);
  }
  const cols = Object.keys(rows[0]);
  // TSV: tabor mellan, nyrader i fält escapes som \n så utdata går att jq:a radvis.
  const esc = (v) => String(v ?? '').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
  console.log(cols.join('\t'));
  for (const r of rows) console.log(cols.map((c) => esc(r[c])).join('\t'));
} catch (err) {
  console.error(`[dbq] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}