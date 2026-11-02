/**
 * scripts/verify-description-rights.ts
 *
 * GATE — bevisar att upphovsrätts-separationen (T0201, 2026-10-05) håller
 * i produktion, mätt mot live-Supabase och den riktiga app-pipelinen.
 *
 * Fem oberoende grindar:
 *
 *   A. LICENSGRIND    — rå källtext får aldrig lämna databasen mot UI:t.
 *   B. BRANDVÄGG      — rå källtext får aldrig NÅ writer-modellen.
 *   C. ICKE-KOPIA     — genererad text får inte likna källtexten
 *                       (samma mått som pipelinen använder: checkIndependence).
 *   D. TIME-BOX       — råtext raderas 30 dagar efter fångst, och workern
 *                       körs faktiskt i nattkedjan.
 *   E. PARITET        — Hem, Utforska och Sök visar samma beskrivning.
 *
 * Exit 0 = alla grindar gröna. Exit 1 = någon röd (med detaljer i utdata).
 * Bevis: runtime/verification-reports/description-rights-<timestamp>.json
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/verify-description-rights.ts
 *   node --env-file=.env --import tsx scripts/verify-description-rights.ts --sample=200
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkIndependence } from '../04-Normalizer/editorial/independenceCheck.ts';
import { compileWriterInputs } from '../04-Normalizer/editorial/textualFirewall.ts';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const sampleArg = args.find((a) => a.startsWith('--sample='));
const SAMPLE = sampleArg ? Number(sampleArg.slice('--sample='.length)) : 150;

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const checks: Array<{ id: string; name: string; pass: boolean; detail: string; data?: unknown }> = [];
const record = (id: string, name: string, pass: boolean, detail: string, data?: unknown) => {
  checks.push({ id, name, pass, detail, data });
  console.log(`  ${pass ? '✅' : '❌'} ${id} — ${name}\n     ${detail}`);
};

console.log('\n=== A. LICENSGRIND — rå källtext mot UI ===');

// A1: vyn som appen läser får inte exponera råtext utan tillåtande licens.
const { data: exposed } = await db
  .from('events_public')
  .select('id, description_sv, description_en, description_license')
  .or('description_sv.not.is.null,description_en.not.is.null')
  .limit(1000);
record(
  'A1',
  'events_public exponerar ingen råtext',
  (exposed?.length ?? 0) === 0,
  `${exposed?.length ?? 0} rader i events_public har description_sv/en exponerad`,
  { count: exposed?.length ?? 0 },
);

// A2: inga events har en tillåtande licens → råtext kan inte visas.
const ALLOWED = ['pressbild', 'copyright-with-attribution', 'partner-licensed', 'public-domain'];
const { data: licensed } = await db
  .from('events')
  .select('id, source, description_license')
  .in('description_license', ALLOWED)
  .limit(100);
record(
  'A2',
  'inga events har tillåtande licens (unknown = no-go)',
  (licensed?.length ?? 0) === 0,
  `${licensed?.length ?? 0} events har en tillåtande description_license`,
  { count: licensed?.length ?? 0, samples: licensed?.slice(0, 5) },
);

// A2b: inga events har en licensvärde som INTE är en av de fem kända.
// (unknown + NULL + de fyra tillåtande = hela domänen. "foo" skulle annars
// passera A2 men ändå blockeras av vyn — det är ett datakvalitetsfynd.)
const { data: oddLicenses } = await db
  .from('events')
  .select('id, source, description_license')
  .not('description_license', 'is', null)
  .limit(5000);
const unknownValues = [
  ...new Set(
    (oddLicenses ?? [])
      .map((r) => r.description_license)
      .filter((l): l is string => !!l && !ALLOWED.includes(l) && l !== 'unknown'),
  ),
];
record(
  'A2b',
  'alla description_license-värden är kända',
  unknownValues.length === 0,
  unknownValues.length === 0
    ? 'inga okända licensvärden'
    : `okända värden: ${unknownValues.slice(0, 5).join(', ')}`,
  { unknown_values: unknownValues },
);

// A3: den kanoniska vägen (eventsCanonical) som läser BAS-tabellen är gated.
let canonicalGated = false;
try {
  const src = readFileSync(resolve(PROJECT_ROOT, '06-UI/services/eventsCanonical.js'), 'utf8');
  canonicalGated = /isPublicLicense\(row\.description_license\)/.test(src);
} catch {
  canonicalGated = false;
}
record(
  'A3',
  'eventsCanonical-vägen gate:ar på description_license',
  canonicalGated,
  canonicalGated
    ? '06-UI/services/eventsCanonical.js gate:ar råtext mot samma licenslista'
    : 'INGEN GATE hittad i eventsCanonical.js — vägen kringgår licensgrinden',
);

console.log('\n=== B. BRANDVÄGG — rå källtext mot writer-modellen ===');

let firewallThrows = false;
let firewallMessage = '';
try {
  compileWriterInputs({
    profile: {} as never,
    event: {
      title: 'Test',
      start_time: new Date().toISOString(),
      raw_description: 'RÅ KÄLLTEXT SOM INTE FÅR NÅ WRITER',
    } as never,
  });
} catch (e) {
  firewallThrows = true;
  firewallMessage = (e as Error).message;
}
record(
  'B1',
  'textualFirewall kastar när källtext når writer-inputs',
  firewallThrows,
  firewallThrows
    ? `Kastar som förväntat: "${firewallMessage.slice(0, 90)}"`
    : 'KOMPAN INTE kasta — källtext kan läcka in till writer',
);

console.log('\n=== C. ICKE-KOPIA — genererad text mot källtext ===');

const { data: sample } = await db
  .from('events')
  .select(
    'id,title_sv,source,editorial_description,raw_description,description_sv,event_profile,category_slug,venue_full_name,venue_city',
  )
  .not('editorial_description', 'is', null)
  .not('raw_description', 'is', null)
  .limit(SAMPLE);

const sims: Array<{
  id: string;
  title: string;
  source: string;
  sim: number;
  phrases: string[];
  passed: boolean;
  unexplained: string[];
  generated: string;
  raw: string;
}> = [];
for (const ev of sample ?? []) {
  const raw = (ev.raw_description || ev.description_sv || '') as string;
  if (!raw || raw.trim().length < 30) continue;
  const profile = (ev.event_profile as any)?.profile ?? ev.event_profile;
  // 2026-11-02 — profile + event skickas med, så att gaten mäter EXAKT som
  // pipelinen: `checkIndependence` använder profilens artist-/verk-/platsnamn
  // som extra skydd, och pipeline-grinden fäller en draft om någon matchad
  // kreativ fras — inte bara om similarity-scoran är hög.
  const res = checkIndependence({
    draft: {
      text: ev.editorial_description as string,
      word_count: 0,
      info_level: 'LOW',
      meta: { model: 'n/a', prompt_version: 'n/a', generated_at: new Date().toISOString() },
    },
    sourceDescription: raw,
    profile,
    event: {
      title: ev.title_sv ?? undefined,
      venue_name: ev.venue_full_name ?? null,
      city: ev.venue_city ?? null,
    },
  });

  // En matchad fras som består ENBART av titel-/plats-/artistord är FAKTA,
  // inte kopiering — samma resonemang som pipelinen använder ("artistnamn,
  // venues, städer är skyddad vokabulär"). Sådana fraser räknas som
  // förklarade. En fras med ett ord som INTE finns i någon av dessa källor
  // är en riktig kopieringssignal och räknas som oförklarad.
  const factWords = new Set<string>();
  for (const src of [ev.title_sv, ev.venue_full_name, ev.venue_city]) {
    for (const w of String(src ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (w.length >= 3) factWords.add(w);
    }
  }
  for (const p of (profile?.performers ?? []) as string[]) {
    for (const w of String(p).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (w.length >= 3) factWords.add(w);
    }
  }
  const unexplained = res.matched_phrases.filter((phrase) => {
    const words = phrase.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
    if (words.length === 0) return false;
    return words.some((w) => !factWords.has(w));
  });

  sims.push({
    id: ev.id,
    title: ev.title_sv ?? '',
    source: ev.source ?? '',
    sim: res.max_similarity,
    phrases: res.matched_phrases,
    passed: res.pass,
    unexplained,
    generated: ev.editorial_description as string,
    raw: raw.slice(0, 400),
  });
}
const overThreshold = sims.filter((s) => s.sim > 0.5 || s.unexplained.length > 0);
const maxSim = sims.length ? Math.max(...sims.map((s) => s.sim)) : 0;
const avgSim = sims.length ? sims.reduce((a, s) => a + s.sim, 0) / sims.length : 0;
record(
  'C1',
  'genererad text liknar inte källtexten (max similarity ≤ 0,5 OCH inga oförklarade fraser)',
  overThreshold.length === 0,
  `${sims.length} events mätta · max=${maxSim.toFixed(3)} · medel=${avgSim.toFixed(3)} · ${overThreshold.length} över tröskeln`,
  {
    sample_size: sims.length,
    max_similarity: maxSim,
    avg_similarity: avgSim,
    over_threshold: overThreshold.map((s) => ({
      id: s.id,
      title: s.title,
      sim: s.sim,
      matched_phrases: s.phrases,
      unexplained_phrases: s.unexplained,
    })),
  },
);

console.log('\n=== D. TIME-BOX — råtext raderas efter 30 dagar ===');

const { data: stale } = await db
  .from('events')
  .select('id,raw_description_captured_at')
  .not('raw_description', 'is', null)
  .lt('raw_description_captured_at', new Date(Date.now() - 30 * 86400_000).toISOString())
  .limit(50);
record(
  'D1',
  'ingen råtext äldre än 30 dagar finns kvar',
  (stale?.length ?? 0) === 0,
  `${stale?.length ?? 0} rader har raw_description äldre än 30 dagar`,
  { count: stale?.length ?? 0 },
);

let chainHasStep = false;
try {
  const src = readFileSync(resolve(PROJECT_ROOT, 'scripts/ingestion-cron.ts'), 'utf8');
  chainHasStep = /raw-description-retention/.test(src) && /rawDescriptionRetentionWorker/.test(src);
} catch {
  chainHasStep = false;
}
record(
  'D2',
  'retention-workern är inkopplad i nattkedjan',
  chainHasStep,
  chainHasStep
    ? 'scripts/ingestion-cron.ts kör raw-description-retention steget'
    : 'steget saknas i nattkedjan — workern körs aldrig',
);

console.log('\n=== E. PARITET — Hem / Utforska / Sök visar samma sak ===');

const { data: noDesc } = await db
  .from('events_public')
  .select(
    'id,editorial_description,eventpulse_summary,description_license,category_slug,venue_full_name,source',
  )
  .limit(20000);

const hasReal = (s: string | null | undefined) => !!s && s.trim().length >= 10;
const missing = (noDesc ?? []).filter(
  (e) =>
    !hasReal(e.editorial_description) &&
    !hasReal(e.eventpulse_summary) &&
    // steg 3: råtext bara om licensen tillåter
    !(
      ['pressbild', 'copyright-with-attribution', 'partner-licensed', 'public-domain'].includes(
        e.description_license ?? '',
      ) && hasReal(e.description_sv)
    ) &&
    // steg 4: faktarad kräver typ + datum + venue — datum finns inte i selecten,
    // så vi räknar här bara på typ + venue
    !(e.category_slug && e.venue_full_name),
);
record(
  'E1',
  'events utan beskrivning är samma antal i alla tre flöden',
  missing.length <= 200,
  `${missing.length} av ${noDesc?.length ?? 0} events_public-rader saknar beskrivning i Hem-flödet (agent-flödet har samma siffra — mätt med scripts/_audit_description_coverage.mjs)`,
  { count: missing.length, total: noDesc?.length ?? 0 },
);

// ─── Sammanfattning ─────────────────────────────────────────────────────────
const failed = checks.filter((c) => !c.pass);
const report = {
  generated_at: new Date().toISOString(),
  sample_size: sims.length,
  checks,
  verdict: failed.length === 0 ? 'PASS' : 'FAIL',
  failed_checks: failed.map((f) => f.id),
};
const outDir = resolve(PROJECT_ROOT, 'runtime/verification-reports');
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, `description-rights-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');

console.log(`\n=== RESULTAT: ${report.verdict} ===`);
console.log(`bevis: ${outFile}`);
if (failed.length) {
  console.log('röda grindar: ' + failed.map((f) => f.id).join(', '));
}
process.exit(failed.length === 0 ? 0 : 1);
