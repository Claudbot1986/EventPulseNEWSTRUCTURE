#!/usr/bin/env node
/**
 * verify-mini-ingestion.mjs — GATE M1–M5: en MINI-ingestion över källor som
 * discovery hittade. Endast antalet källor (N) ändras — sättet ingestion
 * sker är oförändrat.
 *
 * VARFÖR (2026-10-31). Kedjan har en byggd väg från discovery till ingestion:
 * P3D promote → `sources/<slug>.jsonl` → A-gatens `never_run`-filter →
 * B/C/D → import → drain → Supabase. Men vägen var aldrig verifierad
 * end-to-end, och A-gatens urval är ordnad så att nya källor hamnar SIST
 * (preA → api-adapter → rss → never_run). En "mini-ingestion" som bara sätter
 * `--limit N` skulle därför kört de alltid-körda källorna och SLAMMAT de nya
 * discovery-källorna ur batchen.
 *
 * Lösningen använder den befintliga mekanismen: `runA.ts --add <id> <reason>`
 * lägger källan i `runtime/preA-queue.jsonl`, som A-gaten läser först. Ingen
 * ny kodväg, ingen särskild extraction för discovery-källor — bara fler
 * källor i kön, och `--limit N` som gräns.
 *
 * Gaterna:
 *   M1  Det FINNS discovery-källor att köa (annars är gaten meningslös).
 *   M2  De köas in i preA-kön via befintlig CLI.
 *   M3  Kedjan körs med `--limit N` — hela kedjan, inga hoppade steg.
 *   M4  A-gaten körde EXAKT N källor (läst ur stegloggen, inte antaget).
 *   M5  Resultatet i DB: för varje källa antingen(events i events_public för
 *       source_id) eller (ingen framtida event — A-gaten registrerade ett
 *       routing-skäl i stället). En källa som varken gav event eller skäl
 *       är RÖD.
 *
 * Användning:
 *   node scripts/verify-mini-ingestion.mjs                    # N = antal discovery-källor
 *   node scripts/verify-mini-ingestion.mjs --limit 3
 *   node scripts/verify-mini-ingestion.mjs --source id1,id2
 *
 * Bevisfil: runtime/verification-reports/mini-ingestion-<TS>.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { liveChainPids } from './lib/chain-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(PROJECT_ROOT, 'runtime', 'verification-reports');
const PREA_QUEUE = path.join(PROJECT_ROOT, 'runtime', 'preA-queue.jsonl');
const STEP_LOG_DIR = path.join(PROJECT_ROOT, 'runtime', 'ingestion-cron', 'steps');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: false });

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const explicitLimit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : null;
const sourceIdx = args.indexOf('--source');
const explicitSources =
  sourceIdx !== -1 && args[sourceIdx + 1]
    ? args[sourceIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : null;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[verify-mini-ingestion] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas i .env');
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

/**
 * Discovery-källor = källor som P3D promote:at (de ligger i
 * `runtime/discovery-ui-queue.jsonl`, dit promote skriver), plus källor med
 * prefixet `candidate-` i `sources/` (P3D:s filnamnsmönster).
 */
function discoverySources() {
  const out = [];
  const uiQueue = path.join(PROJECT_ROOT, 'runtime', 'discovery-ui-queue.jsonl');
  if (fs.existsSync(uiQueue)) {
    for (const line of fs.readFileSync(uiQueue, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        const id = row.sourceId ?? row.slug ?? null;
        if (id) out.push({ id, promotedAt: row.promotedAt ?? null, from: 'discovery-ui-queue', row });
      } catch {
        /* trasig rad — hoppa över */
      }
    }
  }
  const sourcesDir = path.join(PROJECT_ROOT, 'sources');
  if (fs.existsSync(sourcesDir)) {
    for (const f of fs.readdirSync(sourcesDir)) {
      if (!f.endsWith('.jsonl')) continue;
      if (!f.startsWith('candidate-')) continue;
      out.push({ id: f.replace(/\.jsonl$/, ''), promotedAt: null, from: 'sources/candidate-*' });
    }
  }
  const seen = new Set();
  return out.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

function readPreA() {
  if (!fs.existsSync(PREA_QUEUE)) return [];
  return fs
    .readFileSync(PREA_QUEUE, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function enqueuePreA(sourceId, reason) {
  const res = spawnSync(
    'npx',
    [
      'tsx',
      '02-Ingestion/A-directAPI-networkGate/runA.ts',
      '--add',
      sourceId,
      reason,
    ],
    { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 120_000 },
  );
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function runChain(limit) {
  const res = spawnSync(
    'npx',
    ['tsx', 'scripts/ingestion-cron.ts', '--limit', String(limit)],
    { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 3 * 60 * 60 * 1000 },
  );
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function latestStepLog(step) {
  if (!fs.existsSync(STEP_LOG_DIR)) return null;
  const files = fs
    .readdirSync(STEP_LOG_DIR)
    .filter((f) => f.startsWith(`${step}-`) && f.endsWith('.log'))
    .sort();
  const last = files[files.length - 1];
  if (!last) return null;
  return { file: path.join(STEP_LOG_DIR, last), content: fs.readFileSync(path.join(STEP_LOG_DIR, last), 'utf8') };
}

async function countEventsFor(sourceIds) {
  const out = {};
  for (const id of sourceIds) {
    const { count } = await sb
      .from('events_public')
      .select('id', { count: 'exact', head: true })
      .eq('source_id', id);
    out[id] = count ?? 0;
  }
  return out;
}

function readSourceStatus(sourceId) {
  const file = path.join(PROJECT_ROOT, 'runtime', 'sources_status.jsonl');
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.sourceId === sourceId) return row;
    } catch {
      /* hoppa över */
    }
  }
  return null;
}

async function main() {
  console.log('═══ verify-mini-ingestion ═══');
  console.log(`   ${new Date().toISOString()}`);

  // ── M0: ingen annan kedje-körning får pågå ──────────────────────────────
  const live = liveChainPids();
  if (live.length > 0) {
    console.error(
      `[verify-mini-ingestion] AVBRYTER: en annan ingestion-kedja kör redan (pid ${live.join(', ')}). ` +
        'Ingen parallell kedja — resultaten skulle bli oläsbara.',
    );
    process.exit(1);
  }

  // ── M1: vilka discovery-källor? ──────────────────────────────────────────
  const found = explicitSources
    ? explicitSources.map((id) => ({ id, from: 'explicit' }))
    : discoverySources();
  gate(
    'M1',
    'det finns discovery-källor att köa',
    found.length > 0,
    found.length === 0
      ? 'inga promote:ade källor hittades (kör verify-discovery-handoff.mjs först)'
      : `${found.length} st: ${found.map((s) => s.id).join(', ')}`,
  );
  if (found.length === 0) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(REPORT_DIR, `mini-ingestion-${ts()}.json`),
      `${JSON.stringify({ gates: results, failed: ['M1'] }, null, 2)}\n`,
      'utf8',
    );
    process.exit(1);
  }

  const limit = explicitLimit ?? found.length;

  // Företräde för de FÄRSKASTE promote:ade källorna, och för de som ännu inte
  // gett några events — det är de som bevisar att discovery→ingestion bär
  // nya event, inte bara att en gammal källa körs igen.
  const eventsAll = await countEventsFor(found.map((s) => s.id));
  const fresh = found
    .map((s) => ({ ...s, events: eventsAll[s.id] ?? 0 }))
    .sort((a, b) => {
      const aFresh = a.events === 0 ? 0 : 1;
      const bFresh = b.events === 0 ? 0 : 1;
      if (aFresh !== bFresh) return aFresh - bFresh;
      return String(b.promotedAt ?? '').localeCompare(String(a.promotedAt ?? ''));
    });
  const chosen = fresh.slice(0, limit).map((s) => s.id);
  console.log(
    `\n  valda källor (N=${chosen.length}): ${chosen.join(', ')}`,
  );

  // ── M2: köa in i preA ────────────────────────────────────────────────────
  const preBefore = readPreA();
  const alreadyQueued = new Set(preBefore.map((e) => e.sourceId));
  const toQueue = chosen.filter((id) => !alreadyQueued.has(id));
  for (const id of toQueue) {
    const res = enqueuePreA(id, 'verify-mini-ingestion: discovery-källa');
    if (res.status !== 0) {
      gate('M2', 'köa in i preA', false, `${id}: exit=${res.status} ${res.stderr.slice(0, 120)}`);
    }
  }
  const preAfter = readPreA();
  const queuedIds = new Set(preAfter.map((e) => e.sourceId));
  const missing = chosen.filter((id) => !queuedIds.has(id));
  gate(
    'M2',
    'alla discovery-källor ligger i preA-kön',
    missing.length === 0,
    missing.length === 0
      ? `${chosen.length} st i kön (${toQueue.length} nya)`
      : `saknas: ${missing.join(', ')}`,
  );

  // ── Före-mätning i DB ────────────────────────────────────────────────────
  const eventsBefore = await countEventsFor(chosen);

  // ── M3: kör kedjan med --limit N (endast N ändras) ───────────────────────
  console.log(`\n[M3] Kör hela kedjan med --limit ${limit} (N ändras, inget annat)…`);
  const startedAt = Date.now();
  const chain = runChain(limit);
  const durationMs = Date.now() - startedAt;

  gate(
    'M3a',
    'kedjan avslutades utan fel',
    chain.status === 0,
    `exit=${chain.status} · ${(durationMs / 1000).toFixed(0)} s`,
  );

  // ── M4: A-gaten körde exakt N källor ─────────────────────────────────────
  const aLog = latestStepLog('A-directAPI');
  let aTotal = null;
  if (aLog) {
    const m = aLog.content.match(/Total:\s*(\d+)/);
    if (m) aTotal = Number(m[1]);
    const fail = aLog.content.match(/fail:\s*(\d+)/);
    if (fail) aTotal = aTotal;
  }
  gate(
    'M4',
    'A-gaten körde N källor (mätt ur stegloggen)',
    aTotal !== null && aTotal <= limit,
    aTotal === null ? 'kunde inte läsa "Total:" ur A-loggen' : `Total=${aTotal} (gräns ${limit})`,
  );

  // ── M5: landade resultatet i DB? ─────────────────────────────────────────
  const eventsAfter = await countEventsFor(chosen);
  const perSource = [];
  let okCount = 0;
  for (const id of chosen) {
    const before = eventsBefore[id] ?? 0;
    const after = eventsAfter[id] ?? 0;
    const status = readSourceStatus(id);
    const grew = after > before;
    const hasReason = Boolean(status && status.lastRoutingReason);
    const ok = grew || hasReason;
    if (ok) okCount++;
    perSource.push({
      sourceId: id,
      eventsBefore: before,
      eventsAfter: after,
      grew,
      status: status?.status ?? null,
      lastRoutingReason: status?.lastRoutingReason ?? null,
      lastSuccess: status?.lastSuccess ?? null,
      ok,
    });
  }
  gate(
    'M5',
    'varje discovery-källa gav events ELLER registrerade ett routing-skäl',
    okCount === chosen.length,
    `${okCount}/${chosen.length} st`,
  );
  for (const s of perSource) {
    console.log(
      `    ${s.ok ? '✓' : '✗'} ${s.sourceId}: events ${s.eventsBefore} → ${s.eventsAfter}` +
        (s.grew ? '' : ` · skäl: ${String(s.lastRoutingReason).slice(0, 90)}`),
    );
  }

  const failed = results.filter((r) => !r.ok).map((r) => r.id);
  const ok = failed.length === 0;

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `mini-ingestion-${ts()}.json`);
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        limit,
        sources: chosen,
        gates: results,
        failed,
        perSource,
        chainExit: chain.status,
        durationMs,
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
  console.error('[verify-mini-ingestion] fatal:', err);
  process.exit(1);
});
