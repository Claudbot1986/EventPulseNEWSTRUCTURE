/**
 * runC-one-time-only.ts
 *
 * Kör varje källa genom C exakt 1 gång (--max-rounds 1).
 * Allt annat är identiskt med run-dynamic-pool.ts.
 *
 * Usage:
 *   npx tsx 02-Ingestion/C-htmlGate/runC-one-time-only.ts
 *   npx tsx 02-Ingestion/C-htmlGate/runC-one-time-only.ts --workers 5
 *   npx tsx 02-Ingestion/C-htmlGate/runC-one-time-only.ts --no-c4 --workers 8
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const poolScript = path.join(__dirname, 'run-dynamic-pool.ts');
const extraArgs = ['--max-rounds', '1', '--no-c4'];
const passthrough = process.argv.slice(2);

const child = spawn(
  'npx',
  ['tsx', poolScript, ...extraArgs, ...passthrough],
  { stdio: 'inherit', cwd: process.cwd() }
);

child.on('exit', (code) => process.exit(code ?? 0));
