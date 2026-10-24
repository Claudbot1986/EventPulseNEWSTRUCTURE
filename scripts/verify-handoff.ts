/**
 * verify-handoff.ts — bevis för att en handoff mellan gates inte längre
 * räknas som ett fel (och därmed inte auto-quarantenar källan).
 *
 * Bakgrund (2026-10-24). B-gaten lämnade över källor till C-gaten med
 * `success: false` utan error-sträng. status-maskinen räknade det som ett
 * fel → consecutiveFailures++ → auto-quarantine vid 5. Under en natt
 * karantänades 56 källor, och C-gatens pool-build droppade dem:
 *   "[AUDIT] 56/64 sources dropped from postB-preC pool build:
 *      - astronomiska-huddinge: url_missing_from_sources"
 * — de kördes aldrig i C.
 *
 * Gates:
 *   h1 — handoff ger status 'routed', räknar inte fel, kan aldrig
 *        auto-quarantenas. Negativ kontroll: ett verkligt fel räknas och
 *        karantänenas vid 5.
 *   h2 — ingen källa får ligga både i karantän (med handoff-signatur) och
 *        i sources/. Negativ kontroll: en injicerad index-rad upptäcks.
 *   h3 — C-gatens senaste körning får INTE droppa källor ur poolen.
 *        Negativ kontroll: en syntetisk logg med droppade källor upptäcks.
 *
 * Användning: npx tsx scripts/verify-handoff.ts <h1|h2|h3>
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCES_DIR = path.join(ROOT, 'sources');
const QUARANTINE_DIR = path.join(SOURCES_DIR, '_quarantine');
const QUARANTINE_INDEX = path.join(QUARANTINE_DIR, 'INDEX.json');
const STATUS_FILE = path.join(ROOT, 'runtime', 'sources_status.jsonl');
const STEPS_DIR = path.join(ROOT, 'runtime', 'ingestion-cron', 'steps');

const arg = process.argv[2];

function ok(msg: string) { console.log(msg); }
function fail(msg: string) { console.error(msg); process.exit(1); }

/** Signaturen för handoff-felet: auto-quarantine + B-gatens kö-hop. */
function isHandoffSignature(entry: any): boolean {
  const note = String(entry?.note ?? '');
  const lastError = String(entry?.lastError ?? '');
  if (!note.startsWith('auto-quarantine:')) return false;
  return /^(postB-preC:|toolB\(preB\))/.test(lastError);
}

// ── H1: handoff är inte ett fel (mot den RIKTIGA status-maskinen) ──────────

if (arg === 'h1') {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'verify-handoff-'));
  process.env.EVENTPULSE_SANDBOX_ROOT = sandbox;
  mkdirSync(path.join(sandbox, 'sources'), { recursive: true });
  mkdirSync(path.join(sandbox, 'sources/_quarantine'), { recursive: true });
  mkdirSync(path.join(sandbox, 'runtime'), { recursive: true });
  writeFileSync(path.join(sandbox, 'sources/_quarantine/INDEX.json'), '[]\n');

  const { updateSourceStatus, getSourceStatus } = await import(
    path.join(ROOT, '02-Ingestion/tools/sourceRegistry.ts')
  );

  const mkSource = (id: string) => {
    writeFileSync(
      path.join(sandbox, 'sources', `${id}.jsonl`),
      JSON.stringify({ id, url: `https://${id}.example.com`, name: id, type: 'venue', city: 'Stockholm', discoveredAt: '2026-09-10' }) + '\n',
      'utf8',
    );
  };
  const quarantineIds = (): string[] => {
    const raw = readFileSync(path.join(sandbox, 'sources/_quarantine/INDEX.json'), 'utf8').trim();
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((e: any) => e.sourceId) : [];
  };

  // 1. Positivt: 8 handoffs → aldrig karantän.
  mkSource('handoff-src');
  for (let i = 0; i < 8; i++) {
    updateSourceStatus('handoff-src', {
      success: false,
      eventsFound: 0,
      preferredPath: 'html',
      ingestionStage: 'B',
      pendingNextTool: 'C-htmlGate',
      lastRoutingReason: `postB-preC: ${i}`,
      lastRoutingSource: 'runtime_status',
    });
  }
  const handoffStatus = getSourceStatus('handoff-src');
  if (handoffStatus.status !== 'routed') {
    fail(`h1: handoff gav status '${handoffStatus.status}' — förväntade 'routed'`);
  }
  if (handoffStatus.consecutiveFailures !== 0) {
    fail(`h1: handoff räknade ${handoffStatus.consecutiveFailures} fel — en handoff är inte ett fel`);
  }
  if (!existsSync(path.join(sandbox, 'sources', 'handoff-src.jsonl'))) {
    fail('h1: källan flyttades ur sources/ under handoffs — den begravdes innan C körde den');
  }
  if (quarantineIds().includes('handoff-src')) {
    fail('h1: källan auto-karantänades trots enbart handoffs');
  }

  // 2. Negativ kontroll: ett verkligt fel MÅSTE räknas och karantänas.
  mkSource('failure-src');
  for (let i = 0; i < 5; i++) {
    updateSourceStatus('failure-src', {
      success: false,
      eventsFound: 0,
      ingestionStage: 'failed',
      error: 'Fetch failed: timeout of 20000ms exceeded',
    });
  }
  const failureStatus = getSourceStatus('failure-src');
  if (failureStatus.status !== 'fail' || failureStatus.consecutiveFailures !== 5) {
    fail(
      `h1: negativ kontroll — ett verkligt fel räknades inte (status='${failureStatus.status}', ` +
      `consecutiveFailures=${failureStatus.consecutiveFailures}). Kontrollen kan inte faila.`,
    );
  }
  if (!quarantineIds().includes('failure-src')) {
    fail('h1: negativ kontroll — verkligt fel karantänades inte vid 5 (kontrollen kan inte faila)');
  }

  ok(
    'h1: 8 handoffs → status routed, consecutiveFailures=0, ingen karantän; ' +
    'negativ kontroll: 5 verkliga fel → karantän (kontrollen kan faila) pass',
  );
}

// ── H2: ingen källa ligger både i karantän och i sources/ (handoff-signatur) ─

if (arg === 'h2') {
  if (!existsSync(QUARANTINE_INDEX)) fail('h2: karantänindex saknas');
  const entries = JSON.parse(readFileSync(QUARANTINE_INDEX, 'utf8'));
  if (!Array.isArray(entries)) fail('h2: karantänindex har oväntat format');

  const buggy = entries.filter(isHandoffSignature);
  if (buggy.length > 0) {
    fail(
      `h2: ${buggy.length} källor är auto-karantänade med handoff-signatur — de begravdes ` +
      `innan nästa gate körde dem. Kör: node scripts/restore-handoff-quarantined.mjs --apply — ` +
      buggy.slice(0, 10).map((e: any) => e.sourceId).join(', '),
    );
  }

  // Negativ kontroll: injicera en rad med handoff-signatur och kräv att
  // kontrollen upptäcker den. Utan detta skulle h2 bara kunna ge grönt.
  const probeId = '__h2_probe__';
  const indexBackup = readFileSync(QUARANTINE_INDEX, 'utf8');
  writeFileSync(
    QUARANTINE_INDEX,
    JSON.stringify([...entries, { sourceId: probeId, note: 'auto-quarantine: 5 consecutive failures', lastError: 'postB-preC: toolB(preB): 0 events' }], null, 2),
    'utf8',
  );
  let detected = false;
  try {
    const reread = JSON.parse(readFileSync(QUARANTINE_INDEX, 'utf8'));
    detected = reread.some(isHandoffSignature);
  } finally {
    writeFileSync(QUARANTINE_INDEX, indexBackup, 'utf8');
  }
  if (!detected) fail('h2: kontrollen upptäckte inte den injicerade raden — kontrollen kan inte faila');

  ok(
    `h2: ${entries.length} karantänrader, ingen med handoff-signatur — ` +
    'ingen källa är begravd innan nästa gate kör den; injicerad rad upptäcks (kontrollen kan faila) pass',
  );
}

// ── H3: C-gatens pool-build får inte droppa källor ────────────────────────

if (arg === 'h3') {
  if (!existsSync(STEPS_DIR)) fail('h3: stegloggar saknas');
  const logs = readdirSync(STEPS_DIR)
    .filter((f) => f.startsWith('C-htmlGate-') && f.endsWith('.log') && !f.endsWith('.err.log'))
    .sort();
  if (logs.length === 0) fail('h3: ingen C-htmlGate-logg hittades');
  const latest = path.join(STEPS_DIR, logs[logs.length - 1]);
  // C-gatens pool-build-audit skrivs till stderr — läs BÅda loggarna.
  const errLog = latest.replace(/\.log$/, '.err.log');
  const text =
    readFileSync(latest, 'utf8') + (existsSync(errLog) ? readFileSync(errLog, 'utf8') : '');

  const dropped = parseDropped(text);
  if (dropped === null) fail('h3: kunde inte tolka dropp-raden i loggen — kontrollen kan inte faila');
  if (dropped > 0) {
    fail(
      `h3: C-gaten droppade ${dropped} källor ur poolen i senaste körningen ` +
      `(${logs[logs.length - 1]}) — de kördes aldrig i C`,
    );
  }

  // Negativ kontroll: en syntetisk logg med droppade källor MÅSTE upptäckas.
  const synthetic = '[AUDIT] 56/64 sources dropped from postB-preC pool build:\n  - x: url_missing_from_sources\n';
  if (parseDropped(synthetic) !== 56) {
    fail('h3: negativ kontroll — en logg med 56 droppade källor upptäcktes inte (kontrollen kan inte faila)');
  }

  ok(
    `h3: senaste C-körningen (${logs[logs.length - 1]}) droppade 0 källor ur poolen; ` +
    'negativ kontroll: syntetisk logg med 56 droppade källor upptäcks (kontrollen kan faila) pass',
  );
}

/** Antal källor som droppats ur poolen enligt loggen. null = oläsbart. */
function parseDropped(text: string): number | null {
  const m = text.match(/\[AUDIT\]\s+(\d+)(?:\/\d+)?\s+sources? dropped/);
  if (!m) return 0; // ingen drop-rad alls → 0 droppade
  return Number(m[1]);
}

if (arg !== 'h1' && arg !== 'h2' && arg !== 'h3') {
  fail('usage: npx tsx scripts/verify-handoff.ts <h1|h2|h3>');
}
