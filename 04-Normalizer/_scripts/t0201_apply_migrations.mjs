/**
 * T0201 Migration Apply — kör båda T0201-migrationerna mot live Supabase via
 * Management API (samma mönster som 09-ScrapingSupervisor/tools/apply-link-health-migrations.mjs).
 *
 * Beroende: SB_ACCESS_TOKEN (Supabase Personal Access Token) i .env.
 *
 * Kör: tsx --env-file=.env 04-Normalizer/_scripts/t0201_apply_migrations.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const token = process.env.SB_ACCESS_TOKEN ?? '';
const sbUrl = process.env.SUPABASE_URL ?? '';
const ref = sbUrl.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1];

if (!token || !ref) {
  console.error('FAIL: SB_ACCESS_TOKEN eller SUPABASE_URL saknas');
  process.exit(2);
}

const apiBase = `https://api.supabase.com/v1/projects/${ref}/database/query`;

async function runSql(label, query) {
  const res = await fetch(apiBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error(`[${label}] FAIL (${res.status}):`, t.slice(0, 2000));
    return null;
  }
  return res.json();
}

const MIGRATIONS = [
  '20261005-0001-description-rights-summary.sql',
  '20261005-0002-events-public-view-t0201.sql',
];

const results = [];

for (const file of MIGRATIONS) {
  const path = resolve(process.cwd(), '05-Supabase/migrations', file);
  const sql = readFileSync(path, 'utf8');
  console.log(`\n=== Applying ${file} ===`);
  console.log(`  bytes: ${sql.length}`);
  const res = await runSql(file, sql);
  if (res === null) {
    console.error(`Migration ${file} failed — aborting remaining.`);
    process.exit(1);
  }
  console.log(`  OK`);
  results.push({ file, ok: true, bytes: sql.length });
}

console.log('\n=== Resultat ===');
console.log(JSON.stringify(results, null, 2));

// Verifiering: kolla att nya kolumner finns
console.log('\n=== Verifiering: T0201-kolumner ===');
const verify = `
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='description_license') AS has_description_license,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='raw_description') AS has_raw_description,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='raw_description_captured_at') AS has_raw_description_captured_at,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='eventpulse_summary') AS has_eventpulse_summary,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='eventpulse_summary_facts') AS has_eventpulse_summary_facts,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='eventpulse_summary_provenance') AS has_eventpulse_summary_provenance,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='eventpulse_summary_generated_at') AS has_eventpulse_summary_generated_at,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='eventpulse_summary_model') AS has_eventpulse_summary_model,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='description_attribution') AS has_description_attribution,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='description_source_url') AS has_description_source_url,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events_public' AND column_name='eventpulse_summary') AS view_has_eventpulse_summary,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events_public' AND column_name='description_license') AS view_has_description_license;
`;
const v = await runSql('verify', verify);
console.log(JSON.stringify(v, null, 2));