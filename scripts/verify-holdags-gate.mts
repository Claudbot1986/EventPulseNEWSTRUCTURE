/**
 * verify-holdags-gate.mts — bevis för datumvaktens fix (gate G8).
 *
 * Kör den RIKTIGA importkoden (03-Queue/importToEventPulse.importSource)
 * i dry-run mot en temporär katalog med två rader:
 *
 *   1. ett holdags-event DATED IDAG     → ska BEHÅLLAS (enqueued)
 *   2. ett holdags-event DATED I GÅR    → ska KASTAS BORT (skippedPast)
 *
 * Rad 1 är regressionen: före 2026-10-24 tolkades "2026-10-24" som
 * UTC-midnatt, så eventet föll bort så snart klockan passerade 00:00 UTC —
 * trots att det pågår hela dagen. Rad 2 är den negativa kontrollen: utan
 * den skulle gaten "passa" även om vakten kastade bort allt.
 *
 * Skriver ut en maskinläsbar sista rad: "G8RESULT {json}".
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { importSource } from '../03-Queue/importToEventPulse';

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const now = new Date();
const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

const today = isoDate(now);
const yesterday = isoDate(yesterdayDate);

const dir = mkdtempSync(path.join(tmpdir(), 'ep-g8-'));
try {
  const rows = [
    { title: 'GATE-HELDAGS-TODAY', date: today, source: 'g8-fixture' },
    { title: 'GATE-HELDAGS-YESTERDAY', date: yesterday, source: 'g8-fixture' },
  ];
  writeFileSync(
    path.join(dir, 'g8-fixture.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  );

  const result = await importSource('g8-fixture', true, dir);

  console.log(`G8RESULT ${JSON.stringify({ ...result, today, yesterday })}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
