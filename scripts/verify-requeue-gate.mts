/**
 * verify-requeue-gate — bevisar att operatörverktyget requeue-sources gör
 * det den lovar: en specifik källa kan köras om i C-gaten.
 *
 * Körs i en isolerad sandbox (EVENTPULSE_SANDBOX_ROOT) så den riktiga kön
 * och den riktiga statusfilen inte rörs.
 *
 * Tre saker mäts:
 *   1. Positivt: en känd källa läggs i postB-preC-kön med rätt format, och
 *      statusen sätts till 'routed' (handoff — inte fel) med
 *      consecutiveFailures = 0.
 *   2. Idempotens: en andra körning av samma källa ger 'already_queued' och
 *      skriver ingen andra post.
 *   3. Negativ kontroll: en källa som inte finns skriver INGEN post — så
 *      gaten kan skilja "verkligen köad" från "tycktes köad".
 *
 * Utskrift: en maskinläsbar sista rad `G9RESULT {json}`.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const sandbox = mkdtempSync(path.join(tmpdir(), 'ep-requeue-gate-'));
const sourcesDir = path.join(sandbox, 'sources');
const runtimeDir = path.join(sandbox, 'runtime');
mkdirSync(sourcesDir, { recursive: true });
mkdirSync(runtimeDir, { recursive: true });

// En källfil som en riktig sources/<id>.jsonl (en rad JSON).
writeFileSync(
  path.join(sourcesDir, 'gate-source.jsonl'),
  JSON.stringify({ id: 'gate-source', url: 'https://gate.example.se', city: 'Stockholm' }) + '\n',
  'utf8',
);

// Måste sättas FÖRE importen: quarantineGuard slår upp sina sökvägar vid
// modul-laddning.
process.env.EVENTPULSE_SANDBOX_ROOT = sandbox;

const { runRequeue } = await import('../02-Ingestion/tools/requeue-sources');

const out: Record<string, unknown> = {};

try {
  // 1) Positivt
  const first = runRequeue({ sourceIds: ['gate-source'], reason: 'gate' });
  const firstPlan = first.plan[0];
  out.firstOutcome = firstPlan?.outcome;
  out.firstWritten = first.written;

  const queueFile = path.join(runtimeDir, 'postB-preC-queue.jsonl');
  const queueRows = existsSync(queueFile)
    ? readFileSync(queueFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    : [];
  out.queueRows = queueRows.length;
  out.queueEntry = queueRows[0] ?? null;

  const statusFile = path.join(runtimeDir, 'sources_status.jsonl');
  const statusRows = existsSync(statusFile)
    ? readFileSync(statusFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    : [];
  out.statusRows = statusRows.length;
  out.status = statusRows[0] ?? null;

  // 2) Idempotens
  const second = runRequeue({ sourceIds: ['gate-source'], reason: 'gate' });
  out.secondOutcome = second.plan[0]?.outcome;
  out.secondWritten = second.written;
  const queueRows2 = readFileSync(queueFile, 'utf8').split('\n').filter(Boolean);
  out.queueRowsAfterSecond = queueRows2.length;

  // 3) Negativ kontroll — okänd källa får inte skriva något
  const third = runRequeue({ sourceIds: ['saknas-i-sources'], reason: 'gate' });
  out.unknownOutcome = third.plan[0]?.outcome;
  out.unknownWritten = third.written;
  const queueRows3 = readFileSync(queueFile, 'utf8').split('\n').filter(Boolean);
  out.queueRowsAfterUnknown = queueRows3.length;
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(`G9RESULT ${JSON.stringify(out)}`);
