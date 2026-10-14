/**
 * lib/quota.ts
 *
 * Räknar hur många BFL-bilder en kategori behöver.
 *
 * Formel (användarbeslut 2026-10-12, uppdaterad från 10 → 20 minimum):
 *   target = max(20, ceil(events / 30))
 *   need   = max(0, target - library)
 *
 * Inga nätverksanrop. Ren beräkning. Inga sidoeffekter.
 */

export interface QuotaInput {
  events: number;
  library: number;
}

export interface QuotaResult {
  target: number;
  need: number;
  reason: 'small-min' | 'one-per-thirty';
}

/**
 * Returnerar antal bilder som bör finnas i biblioteket,
 * hur många som saknas, och anledningen.
 *
 * @example
 *   quota({ events: 264, library: 0 })
 *   // => { target: 20, need: 20, reason: 'small-min' }
 *
 *   quota({ events: 5009, library: 264 })
 *   // => { target: 167, need: 0, reason: 'one-per-thirty' }
 */
export function quota(input: QuotaInput): QuotaResult {
  const { events, library } = input;

  if (events < 0 || library < 0 || !Number.isFinite(events) || !Number.isFinite(library)) {
    throw new Error(`Invalid input: events=${events} library=${library}`);
  }

  const per30 = Math.ceil(events / 30);
  const target = Math.max(20, per30);
  const need = Math.max(0, target - library);
  const reason: QuotaResult['reason'] = events < 600 ? 'small-min' : 'one-per-thirty';

  return { target, need, reason };
}

// ---- Inline-tester (kör med `tsx lib/quota.ts`) ----

const cases: Array<{ name: string; input: QuotaInput; expected: QuotaResult }> = [
  {
    name: 'tom kategori → minst 20',
    input: { events: 0, library: 0 },
    expected: { target: 20, need: 20, reason: 'small-min' },
  },
  {
    name: 'liten kategori (264 ev, 0 lib) → 20',
    input: { events: 264, library: 0 },
    expected: { target: 20, need: 20, reason: 'small-min' },
  },
  {
    name: 'liten kategori (264 ev, 264 lib) → 0 behov',
    input: { events: 264, library: 264 },
    expected: { target: 20, need: 0, reason: 'small-min' },
  },
  {
    name: 'stor kategori (5009 ev, 264 lib) → ceil(5009/30)=167',
    input: { events: 5009, library: 264 },
    expected: { target: 167, need: 0, reason: 'one-per-thirty' },
  },
  {
    name: 'mellan (1776 ev, 0 lib) → ceil(1776/30)=60',
    input: { events: 1776, library: 0 },
    expected: { target: 60, need: 60, reason: 'one-per-thirty' },
  },
  {
    name: 'exakt vid 600 events → 20',
    input: { events: 600, library: 0 },
    expected: { target: 20, need: 20, reason: 'one-per-thirty' },
  },
];

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function runTests(): void {
  let passed = 0;
  let failed = 0;
  for (const c of cases) {
    const got = quota(c.input);
    const ok = deepEqual(got, c.expected);
    if (ok) {
      passed++;
      console.log(`  ✓ ${c.name}`);
    } else {
      failed++;
      console.log(`  ✗ ${c.name}`);
      console.log(`    expected: ${JSON.stringify(c.expected)}`);
      console.log(`    got:      ${JSON.stringify(got)}`);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} av ${cases.length} tester misslyckades.`);
    process.exit(1);
  }
  console.log(`\nAlla ${passed} tester passerade.`);
}

// CLI-runnable: `tsx lib/quota.ts` kör tester.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runTests();
}