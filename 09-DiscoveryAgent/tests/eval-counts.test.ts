/**
 * 09-DiscoveryAgent/tests/eval-counts.test.ts
 *
 * Regressionstester för count-hjälparna i eval.ts.
 *
 * ROTORSAK (2026-10-31): countarna räknade direkt på `runtime/sources_status.jsonl`
 * utan att joina mot `sources/`-registry. Statusfilen innehåller 225 orphan-rader
 * (käll-id som inte längre finns), så `countFailingSources()` rapporterade 177
 * "failing sources" medan den verkliga siffran för aktiva källor var 0.
 *
 * Testerna använder EVENTPULSE_SANDBOX_ROOT (samma sandbox som sourceRegistry
 * stöder) så att vi aldrig rör den riktiga statusfilen. Sandboxen sätts FÖR
 * importen — sourceRegistry räknar ut källkatalogen vid modulimport, så utan
 * det pekar källkatalogen på den riktiga `sources/`.
 */
import { test, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const originalRoot = process.env.EVENTPULSE_SANDBOX_ROOT;

afterEach(() => {
  if (originalRoot === undefined) delete process.env.EVENTPULSE_SANDBOX_ROOT;
  else process.env.EVENTPULSE_SANDBOX_ROOT = originalRoot;
  vi.resetModules();
});

/**
 * Bygger en sandbox: sources/ med två aktiva källor och runtime/ med
 * statusrader — varav två hör till källor som inte finns (orphan).
 */
function setupSandbox(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'ep-status-'));
  mkdirSync(path.join(root, 'sources'), { recursive: true });
  mkdirSync(path.join(root, 'runtime'), { recursive: true });

  writeFileSync(
    path.join(root, 'sources', 'alpha.jsonl'),
    JSON.stringify({ id: 'alpha', url: 'https://a.se', name: 'A', type: 'venue', city: 'Stockholm' }) + '\n',
  );
  writeFileSync(
    path.join(root, 'sources', 'beta.jsonl'),
    JSON.stringify({ id: 'beta', url: 'https://b.se', name: 'B', type: 'venue', city: 'Stockholm' }) + '\n',
  );

  const statusRows = [
    { sourceId: 'alpha', consecutiveFailures: 0, status: 'success' },
    { sourceId: 'beta', consecutiveFailures: 3, status: 'fail' },
    { sourceId: 'ghost-source', consecutiveFailures: 5, status: 'fail' },
    { sourceId: 'another-ghost', consecutiveFailures: 4, status: 'fail' },
  ];
  writeFileSync(
    path.join(root, 'runtime', 'sources_status.jsonl'),
    statusRows.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );

  return root;
}

async function loadEval(root?: string) {
  if (root) process.env.EVENTPULSE_SANDBOX_ROOT = root;
  else delete process.env.EVENTPULSE_SANDBOX_ROOT;
  vi.resetModules();
  return import('../eval.js');
}

test('countFailingSources räknar bara källor som finns i registry', async () => {
  const root = setupSandbox();
  const evalMod = await loadEval(root);
  // beta (cf=3) är aktiv och failing. ghost-source/another-ghost är orphan.
  expect(evalMod.countFailingSources(2)).toBe(1);
});

test('countHealthySources räknar bara källor som finns i registry', async () => {
  const root = setupSandbox();
  const evalMod = await loadEval(root);
  expect(evalMod.countHealthySources()).toBe(1); // endast alpha
});

test('countOrphanStatusRows räknar rader vars källa saknas', async () => {
  const root = setupSandbox();
  const evalMod = await loadEval(root);
  expect(evalMod.countOrphanStatusRows()).toBe(2);
});

test('mot den riktiga statusfilen: failing-siffran är 0 och orphan-raderna är rensade', async () => {
  const evalMod = await loadEval();
  // Sanity-kontroll mot produktion: 0 aktiva källor är failing (139 av 140 har
  // consecutiveFailures=0, 1 har 1). Orphan-raderna rensades 2026-10-31 med
  // `node scripts/prune-orphan-source-status.mjs --apply` (225 → 0).
  expect(evalMod.countFailingSources(2)).toBe(0);
  expect(evalMod.countOrphanStatusRows()).toBe(0);
});
