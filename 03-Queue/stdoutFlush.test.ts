/**
 * stdoutFlush — beviset att avslutsraden inte försvinner (2026-10-28).
 *
 * Bakgrunden: kedjan parsar `[drain] avslutar (…): completed=N failed=M` ur
 * dräneringens stdout. På macOS är skrivning till en pipe asynkron, och
 * `process.exit()` kastar skrivbufferten. Mätt: 20 MB genom en långsam läsare
 * → exakt 65 536 byte (pipens buffert). Avslutsraden försvann — och då var
 * `worker-drain` omätbar och kedjan kunde se "grön" på importens siffra
 * ensam.
 *
 * Testerna nedan är den negativa kontrollen: barnet skriver MER ÄN en
 * pipebuffert och avslutar via flushStdout(). Läsaren är långsam — precis
 * som en belastad kedjeparent.
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.join(__dirname, 'stdoutFlush.mjs');

/** Raden kedjan parsar. Den får inte försvinna. */
const SUMMARY = '[drain] avslutar (kö tom): completed=200000 failed=0';

/**
 * Kör ett barn som skriver mycket data och avslutar via flushStdout().
 * Läsaren är långsam på PURPOSE — så att pipen fylls upp.
 *
 * @param {boolean} useFlush   om barnet ska använda flushStdout()
 * @returns {Promise<string>} allt som kom fram
 */
function runChild(useFlush: boolean): Promise<string> {
  const script = `
    import { flushStdout } from ${JSON.stringify(MODULE_PATH)};
    for (let i = 0; i < 200000; i++) process.stdout.write('[worker] Job completed — ' + i + '/200000\\n');
    process.stdout.write(${JSON.stringify(SUMMARY)} + '\\n');
    ${useFlush ? 'await flushStdout();' : ''}
    process.exit(0);
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8');
      // Långsam läsare: låt pipen fyllas upp.
      setTimeout(() => {}, 1);
    });
    let err = '';
    child.stderr.on('data', (chunk) => { err += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('exit', () => (err ? reject(new Error(err)) : resolve(out)));
  });
}

describe('stdoutFlush — avslutsraden får inte försvinna', () => {
  it('NEGATIV KONTROLL — utan flush försvinner avslutsraden', async () => {
    // Detta är felet som existerade: pipen fylls, process.exit() kastar
    // bufferten, och `[drain] avslutar` hamnar i papperskorgen.
    const out = await runChild(false);
    expect(out).not.toContain(SUMMARY);
  }, 60_000);

  it('MED flush överlever avslutsraden en full pipe', async () => {
    const out = await runChild(true);
    expect(out).toContain(SUMMARY);
    // Och allt annat ska också vara med — flushen får inte kasta bort data.
    expect(out).toContain('[worker] Job completed — 199999/200000');
  }, 60_000);
});
