#!/usr/bin/env node
/**
 * Doctor för verify-eventpulse-handoff.
 * Read-only. Svarar på "finns det en brygga från discovery till ingestion
 * värd att verifiera just nu?" — kör INGA gates, skriver INGA filer.
 *
 *   node .cursor/skills/verify-eventpulse-handoff/scripts/doctor-handoff.mjs
 *
 * Använder `pg` mot DATABASE_URL (Supabase pooler). Projektets
 * Management-API-tokener är ogiltiga och `psql` finns inte på maskinen —
 * detta är den fungerande vägen.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { Client } from 'pg';

const ROOT = process.cwd();
const TS = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, 'Z');
mkdirSync('runtime/verification-reports', { recursive: true });
const OUT = `runtime/verification-reports/handoff-doctor-${TS}.json`;

/** Läs en nyckel ur .env utan att ladda dotenv (vi vill bara ha DATABASE_URL). */
function envKey(key) {
  if (!existsSync('.env')) return undefined;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

const reasons = [];
const ok = { value: true };
const addReason = (r) => { reasons.push(r); ok.value = false; };

const DBURL = process.env.DATABASE_URL ?? envKey('DATABASE_URL');
if (!DBURL) {
  addReason('DATABASE_URL saknas i .env — ingen DB-fråga kan besvaras');
  writeFileSync(OUT, JSON.stringify({ ts: TS, ok: false, reasons, db: { reachable: false }, files: {} }, null, 2));
  console.log(readFileSync(OUT, 'utf8'));
  console.log(`\n→ ${OUT}`);
  process.exit(0);
}

const client = new Client({ connectionString: DBURL });
/** @returns {Promise<number>} */
async function q(sql) {
  const r = await client.query(sql);
  return Number(r.rows[0].c);
}

try {
  await client.connect();

  const candidates = {
    total: await q('SELECT count(*)::int AS c FROM source_candidates'),
    withCity: await q("SELECT count(*)::int AS c FROM source_candidates WHERE city IS NOT NULL AND btrim(city) <> ''"),
    stockholm: await q("SELECT count(*)::int AS c FROM source_candidates WHERE btrim(city) = 'Stockholm'"),
    engines: (await client.query(
      "SELECT engine, count(*)::int AS n FROM source_candidates GROUP BY engine ORDER BY 2 DESC",
    )).rows.map((r) => ({ engine: r.engine, n: Number(r.n) })),
  };

  const queue = {
    pending: await q("SELECT count(*)::int AS c FROM source_candidate_test_queue WHERE status = 'pending'"),
    processing: await q("SELECT count(*)::int AS c FROM source_candidate_test_queue WHERE status = 'processing'"),
    stuckReclaimable: await q(
      "SELECT count(*)::int AS c FROM source_candidate_test_queue WHERE status = 'processing' AND (locked_at IS NULL OR locked_at < now() - interval '30 minutes')",
    ),
    passed: await q("SELECT count(*)::int AS c FROM source_candidate_test_queue WHERE status = 'passed'"),
    failed: await q("SELECT count(*)::int AS c FROM source_candidate_test_queue WHERE status = 'failed'"),
    manualReview: await q("SELECT count(*)::int AS c FROM source_candidate_test_queue WHERE status = 'manual_review'"),
    nullCity: await q('SELECT count(*)::int AS c FROM source_candidate_test_queue WHERE city IS NULL'),
  };

  const decisions = {
    promote: await q("SELECT count(*)::int AS c FROM source_candidate_test_decisions WHERE decision = 'promote'"),
    reject: await q("SELECT count(*)::int AS c FROM source_candidate_test_decisions WHERE decision = 'reject'"),
    manualReview: await q("SELECT count(*)::int AS c FROM source_candidate_test_decisions WHERE decision = 'manual_review'"),
    promoteBlocked: await q("SELECT count(*)::int AS c FROM source_candidate_test_decisions WHERE reason LIKE 'promote blocked%'"),
  };

  // Promoteade filer på disk, samt hur många som bär city=Stockholm.
  let sourceFiles = 0;
  let inStockholm = 0;
  try {
    for (const f of readdirSync('sources').filter((x) => x.endsWith('.jsonl'))) {
      sourceFiles++;
      const content = readFileSync(`sources/${f}`, 'utf8').trim();
      if (!content) continue;
      let obj = null;
      try { obj = JSON.parse(content); } catch { /* JSONL-format */ }
      const rows = obj ? [obj] : content.split('\n').filter((l) => l.trim()).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      if (rows.some((r) => String(r?.city ?? '').trim() === 'Stockholm')) inStockholm++;
    }
  } catch { /* sources/ saknas */ }

  let uiQueueEntries = 0;
  try { uiQueueEntries = readFileSync('runtime/discovery-ui-queue.jsonl', 'utf8').split('\n').filter((l) => l.trim()).length; } catch { /* saknas */ }

  if (queue.stuckReclaimable !== 0) {
    addReason(`${queue.stuckReclaimable} rader i source_candidate_test_queue sitter i processing >30 min. Reclaim-logiken i claim_source_candidate_test_queue(task_limit, target_phase) tar inte fast dem om migration 20261021-0003 inte är applicerad.`);
  }
  if (queue.pending === 0 && queue.stuckReclaimable === 0) {
    addReason('Inga pending och inga reclaimbara rader i test-kön — P3D har inget att jobba på. Kör P3A/P3B/P3C först, eller rapportera att loopen är tom.');
  }
  // Den faktiska bryggan: promoteade källor som A-gatet faktiskt kan se.
  // Utan city bär de inte isInScope() och kedjan är trossad utan felmeddelande.
  if (decisions.promote > 0 && inStockholm === 0) {
    addReason(`${decisions.promote} promote-beslut finns men NOLL promoteade filer bär city="Stockholm". Bryggan är trossad — A-gatets isInScope() filtrerar bort allt.`);
  }

  const report = {
    ts: TS,
    ok: ok.value,
    reasons,
    db: { reachable: true },
    candidates,
    queue,
    decisions,
    files: { sourceFiles, sourcesInStockholmScope: inStockholm, uiQueueEntries },
  };
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`\n→ ${OUT}`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  writeFileSync(OUT, `${JSON.stringify({ ts: TS, ok: false, reasons: [`databasfel: ${msg}`], db: { reachable: false } }, null, 2)}\n`);
  console.error(`[doctor-handoff] ${msg}`);
  console.error(`→ ${OUT}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}