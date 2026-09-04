// Verifierar att varje provider-källa i services/sources exporterar minst en funktion.
// Kör: npm run verify-providers
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcesDir = path.join(here, '..', 'services', 'sources');
const files = readdirSync(sourcesDir).filter((f) => f.endsWith('.js'));

let failed = 0;
for (const file of files) {
  try {
    const mod = await import(path.join(sourcesDir, file));
    const fns = Object.values({ ...mod, ...(mod.default ?? {}) }).filter(
      (v) => typeof v === 'function'
    );
    if (fns.length === 0) {
      console.error(`MISS: ${file} exporterar ingen funktion`);
      failed++;
    } else {
      console.log(`OK:   ${file} (${fns.length} export/fn)`);
    }
  } catch (err) {
    console.error(`FAIL: ${file} kunde inte importeras: ${err.message}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} provider(s) felaktiga`);
  process.exit(1);
}
console.log(`\nAlla ${files.length} providers OK`);
