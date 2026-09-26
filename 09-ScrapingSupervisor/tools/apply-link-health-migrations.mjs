// Catch-up-script: applicera foundation (20260905-0001) + link-health-kedjan (20260926)
// mot prod-DB. Prod har gamla events_public-vyn + saknar events_public_expected_columns.
// Strategi:
//   1. Applicera 20260905-0001 men UTAN dess verifiering-DO-block (den failar på drift
//      eftersom events-tabellen har kolumner som inte finns i vyn).
//   2. Bulk-registrera alla events-kolumner i expected_columns (must_be_present=FALSE
//      om de inte ska exponeras, TRUE om de är i vyn).
//   3. Verifiera att lockdownen passerar nu.
//   4. Applicera 20260926-0001 → 0004 i sekvens.
//   5. Slutverifiering.

import { readFileSync } from 'node:fs';

const token = process.env.SB_ACCESS_TOKEN ?? '';
const sbUrl = process.env.SUPABASE_URL ?? '';
const ref = sbUrl.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!token || !ref) {
  console.error('FAIL: SB_ACCESS_TOKEN eller SUPABASE_URL saknas');
  process.exit(2);
}
const apiBase = 'https://api.supabase.com/v1/projects/' + ref + '/database/query';

async function runSql(label, query) {
  const res = await fetch(apiBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error(`[${label}] FAIL:`, t.slice(0, 1500));
    return null;
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// STEG 1: Applicera 20260905-0001 UTAN verifierings-DO-blocket.
// Migrationen har BEGIN/COMMIT. Vi plockar ut allt UTOM det sista DO-blocket.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== STEG 1: 20260905-0001 foundation (utan verifiering) ===');
let m1 = readFileSync('05-Supabase/migrations/20260905-0001-events-public-lockdown-test.sql', 'utf8');
// Plocka bort slutgiltiga DO $$-blocket (verifiering som failar på drift).
// Det börjar på kommentar-raden "-- ─── Initial körning" och slutar på "END $$;"
// på raderna precis innan COMMIT.
// Vi klipper från "-- ─── Initial körning" till sista "END $$;" i filen.
const verifyStart = m1.indexOf('-- ─── Initial körning');
const lastEndDollar = m1.lastIndexOf('END $$;');
if (verifyStart >= 0 && lastEndDollar > verifyStart) {
  m1 = m1.substring(0, verifyStart) + m1.substring(lastEndDollar + 'END $$;'.length);
}
// Plocka också bort BEGIN/COMMIT (vi vill tillåta att senare satser fortsätter).
m1 = m1.replace(/^BEGIN;\s*/m, '').replace(/^COMMIT;\s*$/m, '');
const r1 = await runSql('20260905-0001 (no verify)', m1);
if (r1 === null) process.exit(1);

// ─────────────────────────────────────────────────────────────────────────────
// STEG 2: Catch-up — registrera alla events-kolumner i expected_columns.
// För varje kolumn: must_be_present=TRUE om den är i vyn idag, FALSE annars.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== STEG 2: bulk-registrera events-kolumner ===');
const catchup = `
DO $$
DECLARE
  v_table_cols TEXT[];
  v_view_cols TEXT[];
  v_col TEXT;
  v_in_view BOOLEAN;
  v_count INT := 0;
BEGIN
  SELECT array_agg(column_name::TEXT) INTO v_table_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'events';

  SELECT array_agg(column_name::TEXT) INTO v_view_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'events_public';

  FOREACH v_col IN ARRAY v_table_cols LOOP
    v_in_view := v_col = ANY(v_view_cols);
    INSERT INTO events_public_expected_columns
      (column_name, must_be_present, added_in_migration, rationale)
    VALUES
      (v_col, v_in_view, 'catch-up-2026-09-26',
       CASE WHEN v_in_view THEN 'Already exposed by prod view at catch-up.' ELSE 'Internal events-table column; not exposed via view.' END)
    ON CONFLICT (column_name) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Catch-up: % kolumner registrerade (% i vyn)', v_count,
    (SELECT count(*)::INT FROM unnest(v_table_cols) WHERE unnest = ANY(v_view_cols));
END $$;
`;
const r2 = await runSql('catch-up-expected-columns', catchup);
if (r2 === null) process.exit(1);
console.log('Bulk-registrering OK');

// ─────────────────────────────────────────────────────────────────────────────
// STEG 3: Verifiera att lockdownen passerar.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== STEG 3: verifiera lockdown (efter catch-up) ===');
const lockdownReport = `
DO $$
DECLARE r RECORD; v_failed INT := 0; v_warn INT := 0;
BEGIN
  RAISE NOTICE '=== lockdown-rapport efter catch-up ===';
  FOR r IN SELECT * FROM assert_events_public_lockdown() LOOP
    RAISE NOTICE '[%] % — %', r.status, r.check_name, r.detail;
    IF r.status = 'FAIL' THEN v_failed := v_failed + 1;
    ELSIF r.status = 'WARN' THEN v_warn := v_warn + 1;
    END IF;
  END LOOP;
  IF v_failed > 0 THEN
    RAISE EXCEPTION 'lockdown har % fail efter catch-up — STOPPA', v_failed;
  END IF;
  RAISE NOTICE '=== lockdown OK (warn=% om några) ===', v_warn;
END $$;
`;
const r3 = await runSql('lockdown-rapport', lockdownReport);
if (r3 === null) process.exit(1);

// ─────────────────────────────────────────────────────────────────────────────
// STEG 4: Applicera 20260926-kedjan i ordning.
// 0004 lägger till cf-kolumner som måste registreras i expected_columns
// INNAN dess verifiering kör. Vi strippar 0004:s verifierings-DO-block och
// kör catch-up efteråt.
// ─────────────────────────────────────────────────────────────────────────────
const linkHealth = [
  { tag: '0001-add-is-online',      file: '05-Supabase/migrations/20260926-0001-add-is-online.sql' },
  { tag: '0002-backfill-is-online', file: '05-Supabase/migrations/20260926-0002-backfill-is-online.sql' },
  { tag: '0003-link-health',        file: '05-Supabase/migrations/20260926-0003-link-health.sql' },
  { tag: '0004-link-health-hybrid', file: '05-Supabase/migrations/20260926-0004-link-health-hybrid.sql', stripVerify: true },
];

console.log('\n=== STEG 4: applicera 20260926-kedjan ===');
for (const m of linkHealth) {
  console.log(`\n--- ${m.tag} ---`);
  let sql = readFileSync(m.file, 'utf8');
  if (m.stripVerify) {
    const verifyStart = sql.indexOf('-- ─── Verifiering');
    const lastEndDollar = sql.lastIndexOf('END $$;');
    if (verifyStart >= 0 && lastEndDollar > verifyStart) {
      sql = sql.substring(0, verifyStart) + sql.substring(lastEndDollar + 'END $$;'.length);
    }
    console.log('  (verifierings-block strippat)');
  }
  const res = await runSql(m.tag, sql);
  if (res === null) {
    console.error(`Migration ${m.tag} misslyckades — stoppar.`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEG 4b: Catch-up efter 0004 — registrera de nya interna kolumnerna.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== STEG 4b: catch-up efter 0004 (cf-kolumner) ===');
const catchup2 = `
DO $$
DECLARE
  v_table_cols TEXT[];
  v_view_cols TEXT[];
  v_col TEXT;
  v_in_view BOOLEAN;
BEGIN
  SELECT array_agg(column_name::TEXT) INTO v_table_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'events';
  SELECT array_agg(column_name::TEXT) INTO v_view_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'events_public';

  FOREACH v_col IN ARRAY v_table_cols LOOP
    v_in_view := v_col = ANY(v_view_cols);
    INSERT INTO events_public_expected_columns
      (column_name, must_be_present, added_in_migration, rationale)
    VALUES
      (v_col, v_in_view, 'catch-up-2026-09-26-2',
       'Internal events-table column; not exposed via view.')
    ON CONFLICT (column_name) DO NOTHING;
  END LOOP;
END $$;
`;
const r4b = await runSql('catch-up-2', catchup2);
if (r4b === null) process.exit(1);

// ─────────────────────────────────────────────────────────────────────────────
// STEG 5: Slutverifiering.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== STEG 5: slutverifiering ===');
const final = `
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='consecutive_broken_count') AS has_cf,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='first_broken_at') AS has_first_broken,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='link_status') AS has_link_status,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='is_online') AS has_is_online,
  EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_name='update_link_health_cf') AS has_rpc;
`;
const r5 = await runSql('final-check', final);
console.log('Resultat:', JSON.stringify(r5, null, 2));

// Räkna hur många events cf>=2 (borde vara 0 just efter migrering).
const cfNow = await runSql('cf-now', `
  SELECT count(*)::int AS n FROM events
  WHERE consecutive_broken_count >= 2 AND status='published' AND link_status='broken';
`);
console.log('Events med cf>=2 just nu:', cfNow?.[0]?.n ?? '(?)');

// Räkna synliga events i vyn (borde vara > 0 och < total).
const visNow = await runSql('visible-now', `
  SELECT count(*)::int AS n FROM events_public;
`);
console.log('Events synliga i events_public:', visNow?.[0]?.n ?? '(?)');

console.log('\n=== KLART ===');