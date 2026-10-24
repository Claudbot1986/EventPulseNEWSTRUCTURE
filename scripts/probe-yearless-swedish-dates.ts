/**
 * probe-yearless-swedish-dates.ts — mäter hur VANLIGT det är att en svensk
 * evenemangssida visar datumet som "D MMM" UTAN år ("23 okt", "24 okt lör").
 *
 * Varför: 2026-10-24 — två verkliga venue-källor (nojesfabriken.se,
 * scalateatern.se) gav 0 events trots att sidorna visar tiotals riktiga
 * evenemang med datum. C3:s svenska datum-regex kräver ett år
 * (DD MMM ÅÅÅÅ) och matchar därför aldrig "23 okt".
 *
 * Generalization Protection Rule: en ändring i C-lagret får bara göras om
 * mönstret är verifierat på 2–3+ ORELATERADE domäner. Det här skriptet
 * mäter hur många domäner som visar mönstret — inget mer.
 *
 * Kör:  npx tsx --env-file=.env scripts/probe-yearless-swedish-dates.ts [antal]
 */

import * as fs from 'fs';
import * as path from 'path';

const CANDIDATE_FILE = path.resolve(process.cwd(), '02-Ingestion/C-candidates-queue.jsonl');

/** "23 okt", "24 okt lördag", "1 nov" — men INTE "23 okt 2026". */
const YEARLESS_RX = /\b([0-3]?\d)\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\b(?!\s*[0-9]{4})/i;

/** Samma mönster men med år — ska inte räknas som träff. */
const WITH_YEAR_RX = /\b([0-3]?\d)\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)[a-zåäö]*\s+[0-9]{4}\b/i;

interface Hit {
  id: string;
  url: string;
  type: string;
  samples: string[];
}

async function probeUrl(id: string, url: string, type: string): Promise<Hit | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept-Language': 'sv-SE,sv;q=0.9',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    // Yearless matches that are not part of a full date.
    const stripped = html.replace(WITH_YEAR_RX, ' ');
    const m = stripped.match(YEARLESS_RX);
    if (!m) return null;
    const samples: string[] = [];
    const rx = new RegExp(YEARLESS_RX.source, 'gi');
    let hit: RegExpExecArray | null;
    while ((hit = rx.exec(stripped)) !== null && samples.length < 4) {
      const ctx = stripped.slice(Math.max(0, hit.index - 60), hit.index + 60).replace(/\s+/g, ' ').trim();
      samples.push(ctx);
      if (hit.index === rx.lastIndex) rx.lastIndex++;
    }
    return { id, url, type, samples };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const limit = Number(process.argv[2] ?? 90);
  const rows = fs
    .readFileSync(CANDIDATE_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((d: any) => d?.url && d?.type);

  // Sprid urvalet över typerna så vi inte bara mäter teatrar.
  const byType = new Map<string, any[]>();
  for (const r of rows) {
    if (!byType.has(r.type)) byType.set(r.type, []);
    byType.get(r.type)!.push(r);
  }
  const picked: any[] = [];
  const types = [...byType.keys()].sort();
  let i = 0;
  while (picked.length < limit && types.length > 0) {
    const t = types[i % types.length];
    const bucket = byType.get(t)!;
    if (bucket.length === 0) {
      types.splice(i % types.length, 1);
      continue;
    }
    picked.push(bucket.shift());
    i++;
  }

  console.log(`Prober ${picked.length} kandidatkällor för årslösa datum…\n`);

  const hits: Hit[] = [];
  const CONCURRENCY = 6;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < picked.length) {
      const r = picked[cursor++];
      const hit = await probeUrl(r.id, r.url, r.type);
      if (hit) {
        hits.push(hit);
        console.log(`★ ${hit.id} (${hit.type}) ${hit.url}`);
        for (const s of hit.samples.slice(0, 2)) console.log(`    …${s}…`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const domains = new Set(hits.map((h) => new URL(h.url).hostname.replace(/^www\./, '')));
  console.log(`\n═══ RESULTAT ═══`);
  console.log(`källor med årslöst datum: ${hits.length}/${picked.length}`);
  console.log(`orelaterade domäner:      ${domains.size}`);
  console.log(`domäner: ${[...domains].join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
