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
// --recheck <rapport.json>: mät om M4/M5 mot en KÖRD kedja utan att köra
// kedjan igen. Behövs när kedjan avbröts efter att A/B/C hunnit köra (t.ex.
// avbruten drain) — då är rapportens "events före" fortfarande giltigt, men
// "events efter" måste mätas igen när drainen är slut.
// --chain-started <ISO>: kedjans starttid (för färskhetskravet i M5).
const recheckIdx = args.indexOf('--recheck');
const recheckReport = recheckIdx !== -1 ? args[recheckIdx + 1] : null;
const chainStartedIdx = args.indexOf('--chain-started');
const explicitChainStarted =
  chainStartedIdx !== -1 && args[chainStartedIdx + 1] ? args[chainStartedIdx + 1] : null;

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
 * Discovery-källor = kandidater som P3D promote:at. Promote skriver
 * `sources/<slug>.jsonl` och en rad i `runtime/discovery-ui-queue.jsonl`.
 *
 * 2026-10-31 — viktig lärdom från källgenomgången: **UI-köns `sourceId` är
 * inte alltid filnamnet i `sources/`.** Av 89 rader resolve bara 36 direkt;
 * 47 matchar en källfil på samma värd men under ett annat id (t.ex. UI
 * `wwwdramatense` ↔ fil `dramaten.jsonl`), och 52 har ingen URL-träff alls.
 * En id som inte finns → A-gaten hittar ingen källfil och **raderar posten
 * ur preA-kön tyst** (`runA.ts:293-298`) → gaten skulle se "M2 grön, M5 röd".
 * Därför resolve:ar vi varje post mot verkliga källfiler innan vi köar.
 */
function resolveSourceFile(sourceId, url) {
  const sourcesDir = path.join(PROJECT_ROOT, 'sources');
  const direct = path.join(sourcesDir, `${sourceId}.jsonl`);
  if (fs.existsSync(direct)) return { file: direct, id: sourceId, via: 'id' };

  // Matcha på värd: UI-rader och källfiler kan ha olika id men samma domän.
  let host = null;
  try {
    host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    host = null;
  }
  if (host) {
    for (const f of fs.readdirSync(sourcesDir)) {
      if (!f.endsWith('.jsonl')) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(sourcesDir, f), 'utf8').trim());
        const h = String(parsed.url ?? '').match(/^https?:\/\/([^/]+)/)?.[1];
        if (h && h.replace(/^www\./, '').toLowerCase() === host) {
          return { file: path.join(sourcesDir, f), id: f.replace(/\.jsonl$/, ''), via: 'host' };
        }
      } catch {
        /* trasig fil — hoppa över */
      }
    }
  }
  return null;
}

function discoverySources() {
  const out = [];
  const uiQueue = path.join(PROJECT_ROOT, 'runtime', 'discovery-ui-queue.jsonl');
  if (fs.existsSync(uiQueue)) {
    for (const line of fs.readFileSync(uiQueue, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        const id = row.sourceId ?? row.slug ?? null;
        if (!id) continue;
        const resolved = resolveSourceFile(id, row.url ?? '');
        out.push({
          id,
          url: row.url ?? null,
          promotedAt: row.promotedAt ?? null,
          from: 'discovery-ui-queue',
          resolved,
        });
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
      const id = f.replace(/\.jsonl$/, '');
      out.push({
        id,
        url: null,
        promotedAt: null,
        from: 'sources/candidate-*',
        resolved: { file: path.join(sourcesDir, f), id, via: 'id' },
      });
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

function latestStepLog(step, sinceMs = 0) {
  if (!fs.existsSync(STEP_LOG_DIR)) return null;
  const files = fs
    .readdirSync(STEP_LOG_DIR)
    .filter((f) => f.startsWith(`${step}-`) && f.endsWith('.log') && !f.endsWith('.err.log'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(STEP_LOG_DIR, f)).mtimeMs }))
    .filter((f) => f.mtime >= sinceMs)
    .sort((a, b) => a.mtime - b.mtime);
  const last = files[files.length - 1];
  if (!last) return null;
  return {
    file: path.join(STEP_LOG_DIR, last.name),
    content: fs.readFileSync(path.join(STEP_LOG_DIR, last.name), 'utf8'),
  };
}

/**
 * Stegloggen för en given kedjekörning.
 *
 * Filnamnet bär starttiden (`A-directAPI-2026-10-31T09-04-26-442Z.log`), så
 * vi kan identifiera rätt logg för en körning utan att gissa på mtime —
 * mtime ändras när kedjan skriver i loggen efteråt.
 */
function stepLogForRun(step, notAfterIso) {
  if (!fs.existsSync(STEP_LOG_DIR)) return null;
  const cutoff = notAfterIso ? Date.parse(notAfterIso) : Infinity;
  const files = fs
    .readdirSync(STEP_LOG_DIR)
    .filter((f) => f.startsWith(`${step}-`) && f.endsWith('.log') && !f.endsWith('.err.log'))
    .map((f) => {
      const stamp = f.slice(step.length + 1, -'.log'.length);
      // Filnamnets tidsstämpel har `:` ersatta med `-` (t.ex.
      // 2026-10-31T09-04-26-442Z) — det är inte giltig ISO, så det måste
      // återställas innan Date.parse kan läsa den.
      const iso = stamp.replace(
        /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
        '$1T$2:$3:$4.$5Z',
      );
      return { name: f, startedAt: Date.parse(iso) };
    })
    .filter((f) => Number.isFinite(f.startedAt) && f.startedAt <= cutoff)
    .sort((a, b) => a.startedAt - b.startedAt);
  const last = files[files.length - 1];
  if (!last) return null;
  return {
    file: path.join(STEP_LOG_DIR, last.name),
    startedAt: new Date(last.startedAt).toISOString(),
    content: fs.readFileSync(path.join(STEP_LOG_DIR, last.name), 'utf8'),
  };
}

async function countEventsFor(sourceIds) {
  const out = {};
  for (const id of sourceIds) {
    // `events_public` har kolumnen `source` (INTE `source_id`) — mätt på
    // fel kolumn ger tyst 0 i stället för ett fel.
    const { count, error } = await sb
      .from('events_public')
      .select('id', { count: 'exact', head: true })
      .eq('source', id);
    if (error) {
      console.error(`[verify-mini-ingestion] kunde inte räkna events för ${id}: ${error.message}`);
    }
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

/**
 * Recheck — mät om M4 och M5 mot en kedja som ALREADY körts.
 *
 * När kan det behövas? När kedjan avbröts efter att A/B/C hunnit köra men
 * innan drainen persisterat eventsen (t.ex. avbruten av en operatör eller av
 * en yttre SIGTERM). Då är rapportens "events före" fortfarande giltigt, men
 * "events efter" måste mätas om när drainen är slut — och A-gatens logg finns
 * kvar som bevis.
 *
 * Recheck kör INTE kedjan. Den mäter mot rapporten + databasen + stegloggen.
 */
async function recheck(reportPath) {
  console.log(`\n  recheck av ${path.basename(reportPath)}\n`);
  if (!fs.existsSync(reportPath)) {
    console.error(`[verify-mini-ingestion] rapporten finns inte: ${reportPath}`);
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const sources = report.sources ?? [];
  const limit = report.limit ?? sources.length;
  const beforeById = {};
  for (const s of report.perSource ?? []) beforeById[s.sourceId] = s.eventsBefore ?? 0;

  // Kedjans starttid: explicit flagga > rapporten > A-stegloggens filnamn.
  let chainStarted = explicitChainStarted ?? report.chainStartedAt ?? null;
  const aLog = stepLogForRun('A-directAPI', report.startedAt);
  if (!chainStarted && aLog) chainStarted = aLog.startedAt;
  if (!chainStarted) {
    console.error(
      '[verify-mini-ingestion] kan inte härleda kedjans starttid — ange --chain-started <ISO>',
    );
    process.exit(1);
  }
  console.log(`  kedjans starttid: ${chainStarted}`);

  // ── M4: A-gaten körde exakt N källor i DENNA körning ─────────────────────
  let aTotal = null;
  if (aLog) {
    const m = aLog.content.match(/Total:\s*(\d+)/);
    if (m) aTotal = Number(m[1]);
  }
  gate(
    'M4',
    'A-gaten körde N källor (mätt ur stegloggen från DENNA körning)',
    aTotal !== null && aTotal === limit,
    aTotal === null
      ? `kunde inte läsa "Total:" ur A-logg för körningen (${aLog ? aLog.file : 'ingen logg hittades'})`
      : `Total=${aTotal} (förväntat ${limit}) · logg: ${path.basename(aLog.file)}`,
  );

  // ── M5: landade resultatet i DB? ─────────────────────────────────────────
  const chainStartedMs = Date.parse(chainStarted);
  const eventsAfter = await countEventsFor(sources);
  const perSource = [];
  let okCount = 0;
  for (const id of sources) {
    const before = beforeById[id] ?? 0;
    const after = eventsAfter[id] ?? 0;
    const status = readSourceStatus(id);
    const grew = after > before;
    const ranAt = status?.lastRun ? Date.parse(status.lastRun) : NaN;
    const isFresh = Number.isFinite(ranAt) && ranAt >= chainStartedMs - 60_000;
    const hasReason = Boolean(status && status.lastRoutingReason);
    const ok = grew || (hasReason && isFresh);
    if (ok) okCount++;
    perSource.push({
      sourceId: id,
      eventsBefore: before,
      eventsAfter: after,
      grew,
      status: status?.status ?? null,
      lastRun: status?.lastRun ?? null,
      routingReasonFresh: hasReason && isFresh,
      lastRoutingReason: status?.lastRoutingReason ?? null,
      lastSuccess: status?.lastSuccess ?? null,
      ok,
    });
  }
  gate(
    'M5',
    'varje discovery-källa gav events ELLER registrerade ett FRISKT routing-skäl',
    okCount === sources.length,
    `${okCount}/${sources.length} st`,
  );
  for (const s of perSource) {
    console.log(
      `    ${s.ok ? '✓' : '✗'} ${s.sourceId}: events ${s.eventsBefore} → ${s.eventsAfter}` +
        (s.grew
          ? ''
          : ` · skäl: ${String(s.lastRoutingReason).slice(0, 90)}${s.routingReasonFresh ? '' : ' (FÄRSKT? nej)'}`),
    );
  }

  const failed = results.filter((r) => !r.ok).map((r) => r.id);
  const ok = failed.length === 0;
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath2 = path.join(REPORT_DIR, `mini-ingestion-recheck-${ts()}.json`);
  fs.writeFileSync(
    reportPath2,
    `${JSON.stringify(
      {
        recheckOf: reportPath,
        startedAt: new Date().toISOString(),
        chainStartedAt: chainStarted,
        originalChainExit: report.chainExit ?? null,
        limit,
        sources,
        gates: results,
        failed,
        perSource,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log('\n═══ RESULTAT (recheck) ═══');
  console.log(`bevis: ${reportPath2}`);
  console.log(
    `original kedje-exit: ${report.chainExit ?? 'okänd'} · recheck: ${ok ? '✓ alla gater passerade' : `✗ röda gater: ${failed.join(', ')}`}`,
  );
  process.exit(ok ? 0 : 1);
}

async function main() {
  console.log('═══ verify-mini-ingestion ═══');
  console.log(`   ${new Date().toISOString()}`);

  // ── Recheck: mät om M4/M5 mot en redan körd kedja ───────────────────────
  if (recheckReport) {
    await recheck(recheckReport);
    return;
  }

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
  const allFound = explicitSources
    ? explicitSources.map((id) => ({
        id,
        url: null,
        promotedAt: null,
        from: 'explicit',
        resolved: resolveSourceFile(id, ''),
      }))
    : discoverySources();

  // Endast källor som faktiskt finns som källfil kan köas — annars raderar
  // A-gaten posten ur preA-kön tyst och körden blir en tyst no-op.
  const found = allFound.filter((s) => s.resolved);
  const unresolvable = allFound.filter((s) => !s.resolved);

  gate(
    'M1',
    'det finns discovery-källor att köa (med verklig källfil)',
    found.length > 0,
    found.length === 0
      ? `inga promote:ade källor med källfil hittades (${unresolvable.length} poster utan källfil)`
      : `${found.length} st: ${found.map((s) => s.resolved.id).join(', ')}`,
  );
  if (unresolvable.length > 0) {
    console.log(
      `  ℹ ${unresolvable.length} discovery-poster saknar källfil (äldre domän-sluggar) — hoppas över: ${unresolvable
        .slice(0, 5)
        .map((s) => s.id)
        .join(', ')}${unresolvable.length > 5 ? ' …' : ''}`,
    );
  }
  if (found.length === 0) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(REPORT_DIR, `mini-ingestion-${ts()}.json`),
      `${JSON.stringify({ gates: results, failed: ['M1'] }, null, 2)}\n`,
      'utf8',
    );
    process.exit(1);
  }

  // Företräde för de FÄRSKASTE promote:ade källorna, och för de som ännu inte
  // gett några events — det är de som bevisar att discovery→ingestion bär
  // nya event, inte bara att en gammal källa körs igen.
  const eventsAll = await countEventsFor(found.map((s) => s.resolved.id));
  const fresh = found
    .map((s) => ({ ...s, events: eventsAll[s.resolved.id] ?? 0 }))
    .sort((a, b) => {
      const aFresh = a.events === 0 ? 0 : 1;
      const bFresh = b.events === 0 ? 0 : 1;
      if (aFresh !== bFresh) return aFresh - bFresh;
      return String(b.promotedAt ?? '').localeCompare(String(a.promotedAt ?? ''));
    });

  // Standard-N: de källor som ännu inte gett events, högst 5. Utan ett
  // tak vore det "alla 89 historiska" — det är inte en mini-ingestion.
  const defaultLimit = Math.min(
    fresh.filter((s) => s.events === 0).length || fresh.length,
    5,
  );
  const limit = explicitLimit ?? defaultLimit;
  const chosen = fresh.slice(0, limit).map((s) => s.resolved.id);
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

  // M2b — position i kön. preA-kön har ingen kapacitet och ingen
  // åldersfilter, och nya poster appenderas SIST. En kö med gamla poster kan
  // därför skjuta våra källor bakom `--limit N`, så att de aldrig körs.
  const positions = {};
  preAfter.forEach((e, i) => {
    positions[e.sourceId] = i + 1;
  });
  const beyondLimit = chosen.filter((id) => (positions[id] ?? 999) > limit);
  gate(
    'M2b',
    'valda källor ligger inom de första N platserna i preA-kön',
    beyondLimit.length === 0,
    beyondLimit.length === 0
      ? `positioner: ${chosen.map((id) => `${id}=${positions[id]}`).join(', ')}`
      : `bakom gränsen: ${beyondLimit.map((id) => `${id}=${positions[id]}`).join(', ')} (gräns ${limit}) — gamla poster i kön blockerar`,
  );

  // ── Före-mätning i DB ────────────────────────────────────────────────────
  const eventsBefore = await countEventsFor(chosen);

  // ── M3: kör kedjan med --limit N (endast N ändras) ───────────────────────
  console.log(`\n[M3] Kör hela kedjan med --limit ${limit} (N ändras, inget annat)…`);
  const chainStartedAt = Date.now();
  const chain = runChain(limit);
  const durationMs = Date.now() - chainStartedAt;

  gate(
    'M3a',
    'kedjan avslutades utan fel',
    chain.status === 0,
    `exit=${chain.status} · ${(durationMs / 1000).toFixed(0)} s`,
  );

  // ── M4: A-gaten körde exakt N källor ─────────────────────────────────────
  // Loggen MÄSTE vara skriven under just den här körningen — annars mäter vi
  // en tidigare natt.
  const aLog = latestStepLog('A-directAPI', chainStartedAt);
  let aTotal = null;
  if (aLog) {
    const m = aLog.content.match(/Total:\s*(\d+)/);
    if (m) aTotal = Number(m[1]);
  }
  gate(
    'M4',
    'A-gaten körde N källor (mätt ur stegloggen från DENNA körning)',
    aTotal !== null && aTotal === limit,
    aTotal === null
      ? `kunde inte läsa "Total:" ur en A-logg från denna körning (${aLog ? aLog.file : 'ingen logg hittades'})`
      : `Total=${aTotal} (förväntat ${limit})`,
  );

  // ── M5: landade resultatet i DB? ─────────────────────────────────────────
  // 2026-10-31 — gate-brag: routing-skälet i `runtime/sources_status.jsonl`
  // är FÄRSKT (från en tidigare körning) om källan inte kördes i den här
  // kedjan. Utan färskhetskravet blevir M5 grönt av en gammal rad — källan
  // kan ha hoppats över helt och gaten mäter ändå "routing-skäl".
  // `lastRun` sätts till `now` i `updateSourceStatus` (sourceRegistry.ts:451),
  // så det är det enda fältet som bevisar att källan faktiskt rördes här.
  const eventsAfter = await countEventsFor(chosen);
  const perSource = [];
  let okCount = 0;
  for (const id of chosen) {
    const before = eventsBefore[id] ?? 0;
    const after = eventsAfter[id] ?? 0;
    const status = readSourceStatus(id);
    const grew = after > before;
    const ranAt = status?.lastRun ? Date.parse(status.lastRun) : NaN;
    const isFresh = Number.isFinite(ranAt) && ranAt >= chainStartedAt - 60_000;
    const hasReason = Boolean(status && status.lastRoutingReason);
    const ok = grew || (hasReason && isFresh);
    if (ok) okCount++;
    perSource.push({
      sourceId: id,
      eventsBefore: before,
      eventsAfter: after,
      grew,
      status: status?.status ?? null,
      lastRun: status?.lastRun ?? null,
      routingReasonFresh: hasReason && isFresh,
      lastRoutingReason: status?.lastRoutingReason ?? null,
      lastSuccess: status?.lastSuccess ?? null,
      ok,
    });
  }
  gate(
    'M5',
    'varje discovery-källa gav events ELLER registrerade ett FRISKT routing-skäl',
    okCount === chosen.length,
    `${okCount}/${chosen.length} st`,
  );
  for (const s of perSource) {
    console.log(
      `    ${s.ok ? '✓' : '✗'} ${s.sourceId}: events ${s.eventsBefore} → ${s.eventsAfter}` +
        (s.grew
          ? ''
          : ` · skäl: ${String(s.lastRoutingReason).slice(0, 90)}${s.routingReasonFresh ? '' : ' (FÄRSKT? nej)'}`),
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
        chainStartedAt: new Date(chainStartedAt).toISOString(),
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
