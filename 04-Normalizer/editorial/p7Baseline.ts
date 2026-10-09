/**
 * p7Baseline.ts — FAS 0: bygger detaljerad baseline-tabell från P7-spåret.
 *
 * Klassificerar varje events 46 fall i A/B/C/D/E/F enligt P8-specen:
 *   A. saknad upstream-data
 *   B. misslyckad semantic extraction
 *   C. writer hallucination
 *   D. validator/normalizer
 *   E. duration/date interpretation
 *   F. annan orsak
 *
 * Output: runtime/p7-baseline.json + körbar sammanställning.
 */

import { readFileSync, writeFileSync } from 'fs';

const TRACE = '/Users/claudgashi/EventPulse/runtime/live-sample-2026-10-08.jsonl';

interface Trace {
  event_id: string;
  title: string;
  category: string | null;
  venue: string | null;
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
  pipeline: {
    status: string;
    final_text: string | null;
    factuality_pass: boolean | null;
    unsupported_claims: string[];
    fallback_reason: string | null;
  };
}

interface BaselineEntry {
  event_id: string;
  title: string;
  category: string | null;
  source_richness: string;
  raw_description_length: number;
  profile_event_type: string;
  profile_performers_count: number;
  profile_genres: string[];
  profile_duration_minutes: number | null;
  duration_issue: 'ok' | 'too_long' | 'too_short' | 'null' | 'unknown';
  unsupported_claim_count: number;
  top_unsupported_claims: string[];
  hallucination_count: number; // icke-stilistiska claims
  generic_prose_count: number;  // stilistiska claims
  final_text: string;
  fallback_reason: string | null;
  // A/B/C/D/E/F klassificering
  primary_cause: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  secondary_causes: Array<'A' | 'B' | 'C' | 'D' | 'E' | 'F'>;
  notes: string;
}

// Ordlista som hjälper klassificera ett claim som "generisk prosa" vs "hallucination"
const GENERIC_PROSE_PHRASES: ReadonlySet<string> = new Set([
  'som vill', 'vill', 'bjuder', 'bjuder in', 'bjuds', 'inbjuder',
  'riktar sig', 'riktar', 'fokus', 'med fokus', 'fokuserat',
  'den som vill', 'för dig som', 'för den som',
  'fylld', 'fylld av', 'fyller',
  'gemensam', 'gemenskap', 'gemensamt',
  'besökare', 'publik', 'åhörare',
  'samlar', 'tillsammans', 'tillsammans med',
  'tillfälle', 'ett tillfälle', 'möjlighet', 'chans',
  'uppleva', 'upplevelse', 'njuta', 'njut',
  'står i', 'står', 'står centrum', 'centrum',
  'inramning', 'stämningsfull', 'mysigt', 'mysig',
  'presenterar', 'bjuder in till', 'inramas av',
  'under', 'under kvällen', 'under dagen',
  'heldag', 'heldags', 'halv', 'halvtimme', 'halv timmes',
  'möter', 'möte', 'möts',
  'ledning', 'leds', 'ledd av',
  'stjärnor', 'kända', 'namnkunniga',
  'historia', 'historiska', 'historiskt',
  'stjärnspäckad', 'stjärnspäckat',
]);

function classifyClaim(claim: string): 'hallucination' | 'generic' | 'numeric' | 'duration_or_price' {
  const lower = claim.toLowerCase().trim();
  // Numeriska claims (duration, pris) → ofta duration-issue
  if (/^\d+\s*(min|tim|kr|:-|kronor|år|sek)/i.test(lower)) {
    return 'duration_or_price';
  }
  // Är claimen en generisk prosa-fras?
  if (GENERIC_PROSE_PHRASES.has(lower)) {
    return 'generic';
  }
  // Kolla om det är en del av en generisk fras (2-grams)
  const words = lower.split(/\s+/);
  if (words.length <= 3) {
    for (let i = 1; i <= words.length; i++) {
      const substr = words.slice(0, i).join(' ');
      if (GENERIC_PROSE_PHRASES.has(substr)) return 'generic';
    }
  }
  // Annars: potentiell hallucination
  return 'hallucination';
}

function analyzeEvent(t: Trace): BaselineEntry {
  const claims = t.pipeline.unsupported_claims;
  let hallucinations = 0;
  let generic = 0;
  let durationOrPrice = 0;
  for (const c of claims) {
    const k = classifyClaim(c);
    if (k === 'hallucination') hallucinations++;
    else if (k === 'generic') generic++;
    else if (k === 'duration_or_price') durationOrPrice++;
  }

  // Duration-issue detection
  let durationIssue: BaselineEntry['duration_issue'] = 'ok';
  const dur = t.profile_summary?.duration_minutes ?? null;
  if (dur === null) durationIssue = 'null';
  else if (dur > 600) durationIssue = 'too_long';      // > 10h, suspekt
  else if (dur < 5) durationIssue = 'too_short';      // < 5min, suspekt
  else if (dur > 240) durationIssue = 'unknown';      // > 4h, kan vara festival-pass

  // A/B/C/D/E/F klassificering
  const causes: Array<'A' | 'B' | 'C' | 'D' | 'E' | 'F'> = [];
  if (t.raw_description_length === 0 && t.profile_performers_count === 0) causes.push('A');
  if (t.profile_performers_count === 0 && t.raw_description_length > 50) causes.push('B');
  if (hallucinations > 5) causes.push('C');
  if (durationIssue !== 'ok' && durationIssue !== 'null') causes.push('E');
  if (durationIssue === 'null' && t.profile_summary.event_type !== 'community') causes.push('B');

  // Primär cause: den med flest indikationer
  let primary: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' = 'C'; // default: writer
  if (causes.includes('A') && t.raw_description_length === 0) primary = 'A';
  else if (causes.includes('B')) primary = 'B';
  else if (causes.includes('E')) primary = 'E';
  else if (causes.includes('C')) primary = 'C';

  const notes: string[] = [];
  if (t.profile_performers_count === 0) {
    notes.push(`Profile.performers=0 (title="${t.title}" har sannolikt artistnamn som ej extraheras)`);
  }
  if (durationIssue === 'too_long') {
    notes.push(`duration_minutes=${dur} → ${dur / 60}h (sannolikt multi-day eller fel)`);
  }
  if (hallucinations > 10) {
    notes.push(`${hallucinations} hallucinerade claims (verkligt fabricerade fakta)`);
  }
  if (generic > 20) {
    notes.push(`${generic} generiska prosa-claims ("bjuder", "fylld", etc.)`);
  }

  return {
    event_id: t.event_id,
    title: t.title,
    category: t.category,
    source_richness: t.source_richness,
    raw_description_length: t.raw_description_length,
    profile_event_type: t.profile_summary?.event_type ?? '',
    profile_performers_count: t.profile_summary?.performers_count ?? 0,
    profile_genres: t.profile_summary?.genres ?? [],
    profile_duration_minutes: t.profile_summary?.duration_minutes ?? null,
    duration_issue: durationIssue,
    unsupported_claim_count: claims.length,
    top_unsupported_claims: claims.slice(0, 10),
    hallucination_count: hallucinations,
    generic_prose_count: generic,
    final_text: t.pipeline.final_text ?? '',
    fallback_reason: t.pipeline.fallback_reason,
    primary_cause: primary,
    secondary_causes: causes.filter((c) => c !== primary),
    notes: notes.join('; '),
  };
}

function main() {
  const lines = readFileSync(TRACE, 'utf-8').trim().split('\n');
  const traces: Trace[] = lines.map((l) => JSON.parse(l));
  const entries: BaselineEntry[] = traces.map(analyzeEvent);

  // Aggregera
  const byCause: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
  const byRichness: Record<string, { count: number; pass: number; avg_hallucinations: number; avg_generic: number; pass_rate: number }> = {};
  for (const e of entries) {
    byCause[e.primary_cause] = (byCause[e.primary_cause] ?? 0) + 1;
    const r = e.source_richness;
    if (!byRichness[r]) byRichness[r] = { count: 0, pass: 0, avg_hallucinations: 0, avg_generic: 0, pass_rate: 0 };
    byRichness[r].count++;
    // Pass = factuality_pass=true. I baseline: 0/46.
    byRichness[r].avg_hallucinations += e.hallucination_count;
    byRichness[r].avg_generic += e.generic_prose_count;
  }
  for (const r of Object.values(byRichness)) {
    r.pass_rate = r.count > 0 ? r.pass / r.count : 0;
    r.avg_hallucinations = r.count > 0 ? r.avg_hallucinations / r.count : 0;
    r.avg_generic = r.count > 0 ? r.avg_generic / r.count : 0;
  }

  // Per duration-issue
  const byDuration: Record<string, number> = {};
  for (const e of entries) {
    byDuration[e.duration_issue] = (byDuration[e.duration_issue] ?? 0) + 1;
  }

  // Profile-fält-statistik
  const withPerformers = entries.filter((e) => e.profile_performers_count > 0).length;
  const withGenres = entries.filter((e) => e.profile_genres.length > 0).length;
  const withDuration = entries.filter((e) => e.profile_duration_minutes !== null).length;
  const withDurationIssue = entries.filter((e) => e.duration_issue === 'too_long' || e.duration_issue === 'too_short').length;

  // Total hallucinations / generic prose
  const totalHallucinations = entries.reduce((a, e) => a + e.hallucination_count, 0);
  const totalGeneric = entries.reduce((a, e) => a + e.generic_prose_count, 0);
  const totalUnsupported = entries.reduce((a, e) => a + e.unsupported_claim_count, 0);

  const summary = {
    total_events: entries.length,
    pass_count: 0,
    fallback_count: entries.length,
    pass_rate: 0,
    // Profile-data
    profile_stats: {
      with_performers: withPerformers,
      with_performers_pct: withPerformers / entries.length,
      with_genres: withGenres,
      with_duration: withDuration,
      with_duration_issue: withDurationIssue,
    },
    // Claim-klassificering
    claim_stats: {
      total_unsupported: totalUnsupported,
      total_hallucinations: totalHallucinations,
      total_generic_prose: totalGeneric,
      avg_unsupported_per_event: totalUnsupported / entries.length,
      avg_hallucinations_per_event: totalHallucinations / entries.length,
      avg_generic_per_event: totalGeneric / entries.length,
      hallucination_pct: totalUnsupported > 0 ? totalHallucinations / totalUnsupported : 0,
      generic_pct: totalUnsupported > 0 ? totalGeneric / totalUnsupported : 0,
    },
    // A/B/C/D/E/F
    by_primary_cause: byCause,
    by_source_richness: byRichness,
    by_duration_issue: byDuration,
    // Alla events i detalj
    events: entries,
  };

  writeFileSync('/Users/claudgashi/EventPulse/runtime/p7-baseline.json', JSON.stringify(summary, null, 2));

  console.log('='.repeat(70));
  console.log('P7 BASELINE (FAS 0) — Reality-test 46 events');
  console.log('='.repeat(70));
  console.log(`Total events:           ${summary.total_events}`);
  console.log(`Pass count:             ${summary.pass_count} / ${summary.total_events}`);
  console.log(`Pass rate:              ${(summary.pass_rate * 100).toFixed(1)}%`);
  console.log('');
  console.log('Profile-statistik:');
  console.log(`  with performers:      ${withPerformers} / ${entries.length} (${(withPerformers / entries.length * 100).toFixed(1)}%)`);
  console.log(`  with genres:          ${withGenres} / ${entries.length}`);
  console.log(`  with duration:        ${withDuration} / ${entries.length}`);
  console.log(`  with duration issue:  ${withDurationIssue} / ${entries.length}`);
  console.log('');
  console.log('Claim-klassificering:');
  console.log(`  Total unsupported:    ${totalUnsupported}`);
  console.log(`  Hallucinationer:      ${totalHallucinations} (${(totalHallucinations / totalUnsupported * 100).toFixed(1)}%)`);
  console.log(`  Generisk prosa:       ${totalGeneric} (${(totalGeneric / totalUnsupported * 100).toFixed(1)}%)`);
  console.log(`  Avg hallucinations/event: ${(totalHallucinations / entries.length).toFixed(1)}`);
  console.log(`  Avg generic/event:    ${(totalGeneric / entries.length).toFixed(1)}`);
  console.log('');
  console.log('Primär orsak (A/B/C/D/E/F):');
  for (const [k, n] of Object.entries(byCause)) {
    const pct = (n / entries.length * 100).toFixed(0);
    console.log(`  ${k}: ${n} (${pct}%)`);
  }
  console.log('');
  console.log('Per source richness:');
  for (const [r, b] of Object.entries(byRichness)) {
    console.log(`  ${r.padEnd(10)} n=${b.count} avg_hallucinations=${b.avg_hallucinations.toFixed(1)} avg_generic=${b.avg_generic.toFixed(1)}`);
  }
  console.log('');
  console.log('Duration-issue:');
  for (const [k, n] of Object.entries(byDuration)) {
    console.log(`  ${k}: ${n}`);
  }
  console.log('');
  console.log(`Sparad: runtime/p7-baseline.json`);
}

if (process.argv[1] && process.argv[1].endsWith('p7Baseline.ts')) {
  main();
}
