/**
 * liveSampleSummary.ts — analyserar en redan genererad live-sample JSONL
 * och skriver summary + manuell review.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

const REPORT_DIR = path.resolve(process.cwd(), 'runtime');

function findLatestTraceFile(): string {
  const files = readdirSync(REPORT_DIR)
    .filter((f: string) => f.startsWith('live-sample-') && f.endsWith('.jsonl'))
    .sort()
    .reverse();
  if (files.length === 0) throw new Error('Inga live-sample trace-filer hittades');
  return path.resolve(REPORT_DIR, files[0]);
}

interface Trace {
  event_id: string;
  title: string;
  category: string | null;
  venue: string | null;
  city: string | null;
  start_time: string;
  source: string;
  source_richness: string;
  raw_description_length: number;
  profile_summary: {
    event_type: string;
    performers_count: number;
    genres: string[];
    duration_minutes: number | null;
  };
  llm: { model: string; attempts: number; finish_reason: string | null; latency_ms: number | null };
  pipeline: {
    status: string;
    final_text: string | null;
    final_text_length: number;
    factuality_pass: boolean | null;
    independence_pass: boolean | null;
    unsupported_claims: string[];
    fallback_reason: string | null;
  };
  error: string | null;
}

function analyze(traces: Trace[]) {
  const total = traces.length;
  const pass = traces.filter((t) => t.pipeline.status === 'passed').length;
  const fallback = traces.filter((t) => t.pipeline.status.startsWith('fallback')).length;
  const failed = traces.filter((t) => t.pipeline.status === 'failed').length;

  // Per kategori
  const byCategory: Record<string, { count: number; pass: number; fallback: number; failed: number }> = {};
  for (const t of traces) {
    const cat = t.category ?? 'unknown';
    const bucket = byCategory[cat] ??= { count: 0, pass: 0, fallback: 0, failed: 0 };
    bucket.count++;
    if (t.pipeline.status === 'passed') bucket.pass++;
    else if (t.pipeline.status.startsWith('fallback')) bucket.fallback++;
    else if (t.pipeline.status === 'failed') bucket.failed++;
  }

  // Per source richness
  const byRichness: Record<string, { count: number; pass: number; fallback: number; failed: number; pass_rate: number }> = {};
  for (const t of traces) {
    const r = t.source_richness;
    const bucket = byRichness[r] ??= { count: 0, pass: 0, fallback: 0, failed: 0, pass_rate: 0 };
    bucket.count++;
    if (t.pipeline.status === 'passed') bucket.pass++;
    else if (t.pipeline.status.startsWith('fallback')) bucket.fallback++;
    else if (t.pipeline.status === 'failed') bucket.failed++;
  }
  for (const b of Object.values(byRichness)) {
    b.pass_rate = b.count > 0 ? b.pass / b.count : 0;
  }

  // Fallback reasons
  const fallbackReasons: Record<string, number> = {};
  for (const t of traces) {
    if (t.pipeline.fallback_reason) {
      fallbackReasons[t.pipeline.fallback_reason] = (fallbackReasons[t.pipeline.fallback_reason] ?? 0) + 1;
    }
  }

  return { total, pass, fallback, failed, byCategory, byRichness, fallbackReasons };
}

function printAnalysis(a: ReturnType<typeof analyze>) {
  console.log('='.repeat(70));
  console.log('P7 LIVE-SAMPLE ANALYSIS (Real MiniMax-M3)');
  console.log('='.repeat(70));
  console.log(`Total events: ${a.total}`);
  console.log(`Pass:         ${a.pass} (${(a.pass / a.total * 100).toFixed(1)}%)`);
  console.log(`Fallback:     ${a.fallback} (${(a.fallback / a.total * 100).toFixed(1)}%)`);
  console.log(`Failed:       ${a.failed} (${(a.failed / a.total * 100).toFixed(1)}%)`);
  console.log('');
  console.log('By source richness:');
  for (const [r, b] of Object.entries(a.byRichness).sort()) {
    const pct = (b.pass_rate * 100).toFixed(1);
    console.log(`  ${r.padEnd(12)} n=${b.count} pass=${b.pass} fallback=${b.fallback} failed=${b.failed} pass_rate=${pct}%`);
  }
  console.log('');
  console.log('By category:');
  for (const [c, b] of Object.entries(a.byCategory).sort((x, y) => y[1].count - x[1].count)) {
    const passRate = b.count > 0 ? (b.pass / b.count * 100).toFixed(0) : '0';
    console.log(`  ${c.padEnd(20)} n=${b.count} pass=${b.pass} (${passRate}%) fallback=${b.fallback} failed=${b.failed}`);
  }
  console.log('');
  console.log('Fallback reasons:');
  for (const [r, c] of Object.entries(a.fallbackReasons).sort((x, y) => y[1] - x[1])) {
    console.log(`  ${r.padEnd(40)} n=${c}`);
  }
}

function main() {
  const traceFile = findLatestTraceFile();
  console.log(`Reading traces from: ${traceFile}`);
  const lines = readFileSync(traceFile, 'utf-8').trim().split('\n');
  const traces: Trace[] = lines.map((l) => JSON.parse(l));
  console.log(`Loaded ${traces.length} traces`);
  console.log('');

  const a = analyze(traces);
  printAnalysis(a);

  // Spara summary
  const summary = { ...a, sample_traces: traces.slice(0, 5) };
  const summaryFile = traceFile.replace('.jsonl', '.summary.json');
  writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  console.log('');
  console.log(`Summary saved to: ${summaryFile}`);

  // Välj 15 exempel för manuell review
  // (5 per source richness, blandade pass/fallback)
  const review: Trace[] = [];
  for (const r of ['RICH', 'MEDIUM', 'POOR', 'NO_SOURCE'] as const) {
    const candidates = traces.filter((t) => t.source_richness === r);
    const passed = candidates.filter((t) => t.pipeline.status === 'passed');
    const fallback = candidates.filter((t) => t.pipeline.status.startsWith('fallback'));
    review.push(...passed.slice(0, 2), ...fallback.slice(0, 2));
  }
  const reviewFile = traceFile.replace('.jsonl', '.review.json');
  writeFileSync(reviewFile, JSON.stringify(review, null, 2));
  console.log(`Review sample (${review.length} events) saved to: ${reviewFile}`);
}

if (process.argv[1] && process.argv[1].endsWith('liveSampleSummary.ts')) {
  main();
}
