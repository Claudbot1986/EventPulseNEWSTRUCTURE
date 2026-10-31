#!/usr/bin/env node
/**
 * verify-discovery-handoff.mjs — GATE D1–D4: discovery hittar NYA källor och
 * för dem vidare till ingestion.
 *
 * VARFÖR (2026-10-31). Nattkörningen 2026-10-31 såg grön ut i sin helhet:
 * P3A skrev 93 nya kandidater, P3D gick exit 0 på 746 ms — och testade NOLL
 * kandidater. Rotorsaken varit en trasig länk i kedjan: P3A skriver
 * kandidater till `source_candidates`, men ingen kod anropade
 * `enqueue_source_candidate_tests()`. Testkön var fryst sedan 2026-10-23,
 * och dessutom filtrerar claim-funktionen på `city = 'Stockholm'` — medan
 * 215 kö-rader hade city=NULL (alltså oclaimbara).
 *
 * Mätningen: 116 pending Stockholm-kandidater väntade i databasen, 0 i kön,
 * 0 testade, 0 nya källor, 0 nya events.
 *
 * Gaterna här bevisar motsatsen — med riktiga körningar:
 *
 *   D1  Kön ÄR matad. Pending-kandidater finns i kön OCH är claimbara
 *       (status='pending' + city='Stockholm'). Negativ kontroll: en pending
 *       Stockholm-kandidat som INTE finns i kön = trasig länk = rött.
 *   D2  P3D claimar och testar med den RIKTIGA A/B/C/D-gaten
 *       (Alltools-E2E/e2e.py). Negativ kontroll: test-run-raderna måste
 *       innehålla kommandot `e2e.py` — en rad utanför det är en simulering.
 *   D3  Beslutet sparas: nya rader i `source_candidate_test_runs` +
 *       `source_candidate_test_decisions` för de claimade kandidaterna.
 *   D4  Promote → ingestion: en kandidat som passerar skrivs till
 *       `sources/<slug>.jsonl` (city=Stockholm) och ska sedan kunna plockas
 *       upp av A-gatens `never_run`-filter. Negativ kontroll: filen ska finnas
 *       PÅ DISK och innehålla city Stockholm — inte bara finnas i DB.
 *
 * Användning:
 *   node scripts/verify-discovery-handoff.mjs                  # D1 + D2/D3/D4 med limit 3
 *   node scripts/verify-discovery-handoff.mjs --limit 5        # fler kandidater
 *   node scripts/verify-discovery-handoff.mjs --state-only     # bara D1, ingen körning
 *   node scripts/verify-discovery-handoff.mjs --no-promote     # kräv inte en promote (D4 mjuk)
 *
 * Bevisfil: runtime/verification-reports/discovery-handoff-<TS>.json
 * Exit: 0 = alla gater gröna, 1 = minst en röd.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(PROJECT_ROOT, 'runtime', 'verification-reports');
const SOURCES_DIR = path.join(PROJECT_ROOT, 'sources');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: false });

const args = process.argv.slice(2);
const stateOnly = args.includes('--state-only');
const noPromote = args.includes('--no-promote');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 3;

const PHASE = 'smoke';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[verify-discovery-handoff] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas i .env');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const results = [];
function gate(id, title, ok, detail) {
  results.push({ id, title, ok, detail });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${id} ${title}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// ─── D1: är kön matad? ──────────────────────────────────────────────────────

async function gateQueueFed() {
  console.log('\n[D1] Testkön matad?');
  const { data: candidates, error: cErr } = await sb
    .from('source_candidates')
    .select('id, url, city, status, priority_score')
    .eq('status', 'pending');
  if (cErr) {
    gate('D1', 'kandidater lästa ur DB', false, cErr.message);
    return { claimable: 0 };
  }

  const stockholmCandidates = (candidates ?? []).filter((c) => c.city === 'Stockholm');
  const { data: queue, error: qErr } = await sb
    .from('source_candidate_test_queue')
    .select('id, source_candidate_id, status, city, phase');
  if (qErr) {
    gate('D1', 'kön läst ur DB', false, qErr.message);
    return { claimable: 0 };
  }

  const queuedIds = new Set(
    (queue ?? [])
      .filter((q) => q.phase === PHASE)
      .map((q) => q.source_candidate_id),
  );
  const notQueued = stockholmCandidates.filter((c) => !queuedIds.has(c.id));
  const claimable = (queue ?? []).filter(
    (q) => q.phase === PHASE && q.status === 'pending' && q.city === 'Stockholm',
  ).length;

  gate(
    'D1a',
    'pending Stockholm-kandidater finns',
    stockholmCandidates.length > 0,
    `${stockholmCandidates.length} st`,
  );
  gate(
    'D1b',
    'NEGATIV KONTROLL: ingen pending-kandidat utanför kön',
    notQueued.length === 0,
    notQueued.length === 0
      ? 'alla är i kön'
      : `${notQueued.length} saknas i kön (t.ex. ${notQueued[0]?.url ?? '?'})`,
  );
  gate(
    'D1c',
    'kön har claimbara rader (status=pending + city=Stockholm)',
    claimable > 0,
    `${claimable} st`,
  );

  return { claimable, pendingCandidates: stockholmCandidates.length };
}

// ─── D2/D3: kör P3D mot den riktiga gaten ───────────────────────────────────

function runP3D(limit) {
  const res = spawnSync(
    'npx',
    ['tsx', '07-Discovery/src/sourceTesting/runSourceCandidateTests.ts', `--phase=${PHASE}`, `--limit=${limit}`],
    { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 15 * 60 * 1000 },
  );
  return {
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    status: res.status,
  };
}

async function gateRealRun(limit) {
  console.log(`\n[D2] Kör P3D med riktiga A/B/C/D-gates (limit=${limit})…`);
  const startedAt = Date.now();
  // Bindning till DENNA körning: utan tidsgränsen kan rader från tidigare
  // nätter uppfylla D2b/D3 (negativa kontrollerna ska gälla det vi körde).
  const runStartedAt = new Date().toISOString();
  const run = runP3D(limit);
  const durationMs = Date.now() - startedAt;

  const decisions = run.stdout
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  gate(
    'D2a',
    'P3D claimade minst en kandidat',
    decisions.length > 0,
    decisions.length === 0
      ? `0 claimade (körningens stdout: ${run.stdout.trim().slice(0, 120) || '(tomt)'})`
      : `${decisions.length} st`,
  );

  // Negativ kontroll: testkörningarna ska ha anropat den RIKTIGA e2e.py-gaten.
  // Bara rader från denna körning räknas.
  //
  // 2026-10-31 — read-after-write-lag: raden skrivs ~1 s innan gaten läser,
  // och Supabase REST läser från replika → 0 rader trots att körningen skrev
  // dem. Därför läses om med korta pauser (max 3 försök, 1,5 s emellan).
  let runs = [];
  let runsError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await sb
      .from('source_candidate_test_runs')
      .select('source_candidate_id, commands_run, tool_a, tool_b, tool_c, tool_d, created_at')
      .gte('created_at', runStartedAt)
      .order('created_at', { ascending: false })
      .limit(limit * 3);
    if (res.error) {
      runsError = res.error;
      runs = [];
    } else {
      runs = res.data ?? [];
      runsError = null;
    }
    if (runs.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  const recent = runs ?? [];
  const withRealTool = recent.filter((r) =>
    JSON.stringify(r.commands_run ?? []).includes('e2e.py'),
  );
  gate(
    'D2b',
    'NEGATIV KONTROLL: testerna körde Alltools-E2E/e2e.py (ingen simulering)',
    withRealTool.length > 0,
    runsError
      ? `DB-fel: ${runsError.message}`
      : `${withRealTool.length}/${recent.length} körningar från denna körning använde e2e.py`,
  );

  const { data: decisionsRows } = await sb
    .from('source_candidate_test_decisions')
    // `promoted_source_id` MÅSTE vara med — utan det kan D4 aldrig veta vilken
    // fil som skapades (2026-10-31: D4 var död av just den anledningen).
    .select('source_candidate_id, decision, reason, promoted_source_id, created_at')
    .gte('created_at', runStartedAt)
    .order('created_at', { ascending: false })
    .limit(limit * 3);
  const decisionRows = decisionsRows ?? [];
  gate(
    'D3',
    'beslut sparades för testade kandidater',
    decisionRows.length > 0,
    `${decisionRows.length} beslutsrader från denna körning (senaste: ${decisionRows[0]?.decision ?? '?'})`,
  );

  return { decisions, recentRuns: recent, decisionRows, durationMs, exitCode: run.status };
}

// ─── D4: promote → ingestion ───────────────────────────────────────────────

function promotedSourcesFromDecisionRows(decisionRows) {
  const out = [];
  for (const d of decisionRows) {
    if (d.decision !== 'promote') continue;
    const sourceId = d.promoted_source_id ?? d.promotedSourceId ?? null;
    if (!sourceId) continue;
    const file = path.join(SOURCES_DIR, `${sourceId}.jsonl`);
    const exists = fs.existsSync(file);
    let city = null;
    let url = null;
    let eventUrls = [];
    if (exists) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8').trim());
        city = parsed.city ?? null;
        url = parsed.url ?? null;
        const meta = parsed.metadata ?? {};
        eventUrls = Array.isArray(meta.eventUrls) ? meta.eventUrls : [];
      } catch {
        /* trasig fil — city/url lämnas null */
      }
    }
    out.push({ sourceId, file, exists, city, url, eventUrls, reason: d.reason });
  }
  return out;
}

async function gatePromote(decisionRows) {
  console.log('\n[D4] Promote → ingestion?');
  const promoted = promotedSourcesFromDecisionRows(decisionRows);

  // 2026-10-31 — D4a får INTE röda på ett legitimt utfall. Att en kandidat
  // avvisas ("no event signal") är normalt; de flesta Exa-träffar är väggar
  // eller redan kända källor. Rött ska betyda "promote-mekanismen är trasig",
  // inte "just den här körningen råkade inte hitta någon bra kandidat".
  if (promoted.length === 0) {
    // Finns det en promote från en nyligen (≤ 24 h) som faktiskt skrivit en
    // källfil? Då fungerar mekanismen — denna körning råkade bara inte
    // träffa någon ny kandidat.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recent } = await sb
      .from('source_candidate_test_decisions')
      .select('source_candidate_id, decision, promoted_source_id, created_at')
      .eq('decision', 'promote')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20);

    const withFile = (recent ?? []).filter((r) => {
      const id = r.promoted_source_id;
      if (!id) return false;
      return fs.existsSync(path.join(SOURCES_DIR, `${id}.jsonl`));
    });

    const ok = withFile.length > 0;
    gate(
      'D4a',
      'promote-mekanismen har skrivit källfiler (senaste 24 h)',
      ok,
      ok
        ? `0 promotes i denna körning (legitimat — kandidaterna gav ingen evenemangsignal); senaste: ${withFile[0].promoted_source_id} (${withFile[0].created_at.slice(0, 16)})`
        : 'inga promotes de senaste 24 h med källfil — promote-mekanismen kan vara trasig',
    );
    return { promoted: [] };
  }

  const onDisk = promoted.filter((p) => p.exists);
  gate(
    'D4a',
    'promote skrev sources/<slug>.jsonl',
    onDisk.length === promoted.length,
    `${onDisk.length}/${promoted.length} filer finns: ${promoted.map((p) => p.sourceId).join(', ')}`,
  );

  // Negativ kontroll: filen måste bära city=Stockholm, annars kastar A-gatens
  // isInScope bort källen (city !== 'Stockholm') och den körs aldrig.
  const withCity = promoted.filter((p) => p.city === 'Stockholm');
  gate(
    'D4b',
    'NEGATIV KONTROLL: promote-filen bär city=Stockholm (annars filtrerar A-gatens isInScope bort den)',
    withCity.length === promoted.length,
    `${withCity.length}/${promoted.length} har city Stockholm (filer: ${promoted
      .map((p) => `${p.sourceId}=${p.city}`)
      .join(', ')})`,
  );

  const { data: statusRows } = await sb
    .from('source_candidates')
    .select('id, status')
    .in('id', decisionRows.map((d) => d.source_candidate_id).slice(0, 50));
  const verified = (statusRows ?? []).filter((s) => s.status === 'verified');
  gate(
    'D4c',
    'promote-kandidaten är markerad verified i kandidattabellen',
    verified.length > 0,
    `${verified.length} st verified`,
  );

  // Bevis att promote också syns i discovery-UI-kön (det är den lista
  // operatören ser, och som mini-ingestionen väljer källor ifrån).
  const uiQueue = path.join(PROJECT_ROOT, 'runtime', 'discovery-ui-queue.jsonl');
  let uiHit = 0;
  if (fs.existsSync(uiQueue)) {
    const text = fs.readFileSync(uiQueue, 'utf8');
    uiHit = promoted.filter((p) => text.includes(`"sourceId":"${p.sourceId}"`)).length;
  }
  gate(
    'D4d',
    'promote finns i runtime/discovery-ui-queue.jsonl',
    uiHit === promoted.length,
    `${uiHit}/${promoted.length} i UI-kön`,
  );

  return { promoted };
}

// ─── main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══ verify-discovery-handoff ═══');
  console.log(`   ${new Date().toISOString()} · mode=${stateOnly ? 'state-only' : 'live'}`);

  const d1 = await gateQueueFed();

  let run = { decisions: [], recentRuns: [], decisionRows: [], durationMs: 0, exitCode: null };
  if (!stateOnly) {
    run = await gateRealRun(LIMIT);
  }

  // I state-only läge körs bara D1 (kön matad?). D2–D4 kräver en körning, och
  // en promote-gate utan promote-beslut skulle ge ett rött läge som inte
  // betyder något.
  const d4 = stateOnly ? { promoted: [] } : await gatePromote(run.decisionRows);

  const failed = results.filter((r) => !r.ok).map((r) => r.id);
  const ok = failed.length === 0;

  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `discovery-handoff-${ts()}.json`);
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        mode: stateOnly ? 'state-only' : 'live',
        limit: LIMIT,
        gates: results,
        failed,
        queueClaimable: d1.claimable,
        decisions: run.decisions,
        promoted: d4.promoted,
        durationMs: run.durationMs,
        exitCode: run.exitCode,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log('\n═══ RESULTAT ═══');
  console.log(`bevis: ${reportPath}`);
  console.log(ok ? '✓ alla gater passerade' : `✗ röda gater: ${failed.join(', ')}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[verify-discovery-handoff] fatal:', err);
  process.exit(1);
});
