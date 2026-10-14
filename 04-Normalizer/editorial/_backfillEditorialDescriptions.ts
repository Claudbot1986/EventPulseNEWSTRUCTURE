/**
 * _backfillEditorialDescriptions.ts — FAS 3.2 / 2026-10-13.
 *
 * Batch-jobb som populerar `editorial_description` för events som redan har
 * `event_profile`.
 *
 * Arkitektur (säkerhetskritisk):
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ INPUT TILL M3 (aldrig source_text):                                 │
 *   │   1. event_profile.profile (curated JSON + MusicBrainz CC0 +       │
 *   │      Wikidata CC0 — öppen data, aldrig scraper-text)                 │
 *   │   2. Strukturerade fält: title, venue_full_name, venue_city,        │
 *   │      start_time, is_free, price_min_sek                            │
 *   │                                                                     │
 *   │ ALLTSÅ EJ: raw_description, description_sv/en, scraped_copy,        │
 *   │ html_source, original_title.                                        │
 *   │                                                                     │
 *   │ EFTER M3 (POST-hoc verifiering, source når M3 = aldrig):           │
 *   │   1. checkFactuality() — varje claim i M3-texten måste vara spårbart│
 *   │      i Profile. Annars → regenerera med feedback, eller fallback.   │
 *   │   2. checkIndependence() — similarity mot raw_description.          │
 *   │      OM M3-texten är FÖR LIK source_description → regenerera.       │
 *   │      source_description används BARA som referens för jämförelse,   │
 *   │      INTE som input till M3.                                        │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Pipeline (använder runEditorialPipeline som har all logik):
 *
 *   1. Hämta events där event_profile finns MEN editorial_description är null
 *   2. Parsa Profile från event_profile.profile
 *   3. Bygg EditorialPipelineInput (Profile + structured event)
 *   4. runEditorialPipeline() kör:
 *        - dataQualityCheck
 *        - writeEditorialDescription (MiniMax M3, WriterSafeInputs UTAN source)
 *        - checkFactuality (regenerera vid fail)
 *        - checkIndependence (mot raw_description som referens)
 *        - fallback FACT/MINIMAL om M3 inte klarar kvalitetsgrindarna
 *   5. Spara final_text + meta (model, status, attempts)
 *
 * Concurrency: 4 (M3 tillåter 4-8 parallella anrop).
 *
 * Användning:
 *   set -a && source .env && set +a
 *   npx tsx 04-Normalizer/editorial/_backfillEditorialDescriptions.ts
 *   npx tsx ... --category=music
 *   npx tsx ... --limit=100
 *   npx tsx ... --concurrency=4
 *   npx tsx ... --dry-run
 *   npx tsx ... --strict          # misslyckas om status ≠ passed/fallback
 */
import { createClient } from '@supabase/supabase-js';
import {
  MiniMaxM3LlmClient,
  type LlmClient,
} from './editorialWriter';
import {
  runEditorialPipeline,
  type EditorialPipelineInput,
  type EditorialPipelineResult,
} from './index';
import type { EventProfile } from './types';

interface DbEvent {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  category_slug: string | null;
  venue_full_name: string | null;
  venue_city: string | null;
  start_time: string | null;
  is_free: boolean | null;
  price_min_sek: number | null;
  language: string | null;
  raw_description: string | null;
  event_profile: { profile: EventProfile; version: number; generated_at: string } | null;
}

interface BackfillStats {
  total: number;
  byStatus: Record<string, number>;
  errors: string[];
  factualityPassed: number;
  independencePassed: number;
  fallbackUsed: number;
  latencyMs: { sum: number; n: number; max: number };
}

async function fetchEventsToDescribe(
  supabase: ReturnType<typeof createClient>,
  args: { limit?: number; category?: string; excludeCategories?: string[] },
): Promise<DbEvent[]> {
  const now = new Date().toISOString();
  const PAGE = 1000;
  const target = args.limit ?? Number.MAX_SAFE_INTEGER;
  const all: DbEvent[] = [];

  for (let from = 0; all.length < target; from += PAGE) {
    let q = supabase
      .from('events')
      .select(`
        id, title_sv, title_en, category_slug, venue_full_name, venue_city,
        start_time, is_free, price_min_sek, raw_description,
        event_profile
      `)
      .gt('start_time', now)
      .not('event_profile', 'is', null)
      .is('editorial_description', null)
      .order('start_time', { ascending: true })
      .range(from, from + PAGE - 1);
    if (args.category) q = q.eq('category_slug', args.category);
    const { data, error } = await q;
    if (error) throw new Error(`fetch events: ${error.message}`);
    if (!data || data.length === 0) break;
    // [FAS 5.2 2026-10-14] Filtrera bort exkluderade kategorier i kod
    // (PostgREST neq-filter vore bättre men PostgREST saknar native NOT IN)
    let filtered = data as DbEvent[];
    if (args.excludeCategories?.length) {
      filtered = filtered.filter(e => !args.excludeCategories!.includes(e.category_slug ?? ''));
    }
    all.push(...filtered);
    if (data.length < PAGE) break;
    if (all.length >= target) break;
  }
  return all.slice(0, target === Number.MAX_SAFE_INTEGER ? all.length : target);
}

/**
 * Kör runEditorialPipeline för ett event. sourceDescription (raw_description)
 * skickas BARA med som referens för independence-check, ALDRIG som input till M3
 * (runEditorialPipeline har textualFirewall som strippar det från M3-input).
 */
async function describeOne(
  supabase: ReturnType<typeof createClient>,
  llm: LlmClient,
  ev: DbEvent,
  args: { strict: boolean; dryRun: boolean },
): Promise<{ result: EditorialPipelineResult; updated: boolean; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  if (!ev.event_profile || !ev.start_time) {
    return {
      result: null as unknown as EditorialPipelineResult,
      updated: false,
      latencyMs: 0,
      error: 'no_profile_or_start_time',
    };
  }
  const title = ev.title_sv || ev.title_en || '';
  if (!title) return { result: null as unknown as EditorialPipelineResult, updated: false, latencyMs: 0, error: 'no_title' };

  try {
    const input: EditorialPipelineInput = {
      // M3 ser BARA Profile + strukturerade fält. RunEditorialPipeline lägger
      // till source_description på independence-check EFTER (inte till M3).
      event: {
        title,
        category_slug: ev.category_slug,
        venue_name: ev.venue_full_name,
        city: ev.venue_city,
        start_time: ev.start_time,
        is_free: ev.is_free ?? false,
        price_min_sek: ev.price_min_sek,
        language: null, // kolumnen finns inte i DB — språk härleds via categories
        performers: Object.keys(ev.event_profile.profile.performer_metadata ?? {}),
        source: 'eventpulse-backfill',
      },
      // sourceDescription BARA som POST-hoc-referens för independence-check.
      // Aldrig som input till M3 (textualFirewall belagd).
      sourceDescription: ev.raw_description,
      llm,
      seed: ev.id.slice(0, 8),
    };

    const result = await runEditorialPipeline(input);
    const latencyMs = Date.now() - t0;
    const finalText = result.final_text;
    const accept = !args.strict || result.status === 'passed' ||
                   result.status === 'fallback_fact' || result.status === 'fallback_minimal';

    if (!finalText || !accept) {
      return { result, updated: false, latencyMs, error: `status=${result.status}` };
    }

    if (!args.dryRun) {
      const { error } = await supabase
        .from('events')
        .update({
          editorial_description: finalText,
          editorial_model: result.draft.meta.model,
          editorial_prompt_version: result.draft.meta.prompt_version,
          editorial_description_generated_at: result.draft.meta.generated_at,
          editorial_info_level: result.draft.info_level,
        })
        .eq('id', ev.id);
      if (error) return { result, updated: false, latencyMs, error: `db: ${error.message}` };
    }
    return { result, updated: true, latencyMs };
  } catch (err) {
    return {
      result: null as unknown as EditorialPipelineResult,
      updated: false,
      latencyMs: Date.now() - t0,
      error: (err as Error).message,
    };
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const strict = args.includes('--strict');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.slice('--limit='.length), 10) : undefined;
  const catArg = args.find((a) => a.startsWith('--category='));
  const category = catArg ? catArg.slice('--category='.length) : undefined;
  const concArg = args.find((a) => a.startsWith('--concurrency='));
  const concurrency = concArg ? parseInt(concArg.slice('--concurrency='.length), 10) : 4;
  const noNli = args.includes('--no-nli');
  // [FAS 5.2 2026-10-14] Användaren bad att skippa musik (redan 35% editorial).
  // Default exkluderar alla musik-kategorier såvida inte --category= används.
  const defaultExclude = !category
    ? ['music', 'rock', 'pop', 'jazz', 'electronic', 'hip-hop', 'classical', 'musical-theatre']
    : [];
  const excludeArg = args.find((a) => a.startsWith('--exclude-category='));
  const exclude = excludeArg
    ? excludeArg.slice('--exclude-category='.length).split(',').map(s => s.trim())
    : defaultExclude;

  console.log('═'.repeat(78));
  console.log('  BACKFILL editorial_description — M3 + factuality + independence');
  console.log(`  Mode: ${dryRun ? 'DRY-RUN' : 'PROD'} ${strict ? '(STRICT)' : ''}`);
  console.log(`  Limit: ${limit ?? 'alla'} | Category: ${category ?? 'alla'} | Exclude: ${exclude.join(',') || 'none'}`);
  console.log(`  Concurrency: ${concurrency} | NLI-judge: ${noNli ? 'AV' : 'PÅ'}`);
  console.log('═'.repeat(78));

  if (!process.env.MINIMAX_API_KEY) {
    console.error('MINIMAX_API_KEY ej satt. Avbryter.');
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const events = await fetchEventsToDescribe(supabase, { limit, category, excludeCategories: exclude });
  console.log(`\nHittade ${events.length} events att bearbeta.\n`);
  if (events.length === 0) { console.log('Inga events. Klar.'); return; }

  const llm = new MiniMaxM3LlmClient({ apiKey: process.env.MINIMAX_API_KEY! });
  const stats: BackfillStats = {
    total: events.length,
    byStatus: {},
    errors: [],
    factualityPassed: 0,
    independencePassed: 0,
    fallbackUsed: 0,
    latencyMs: { sum: 0, n: 0, max: 0 },
  };

  const start = Date.now();
  let i = 0;

  await runWithConcurrency(events, concurrency, async (ev) => {
    const myIdx = ++i;
    const r = await describeOne(supabase, llm, ev, { strict, dryRun });

    // Debug-logg per event (första 5)
    if (myIdx <= 5 || myIdx % 50 === 0) {
      const status = r.result?.status ?? 'no_result';
      const reason = r.result?.factuality?.unsupported_claims ?? r.result?.independence?.matched_phrases ?? null;
      console.log(`\n  [${myIdx}/${events.length}] ${ev.title_sv?.slice(0, 30) ?? '?'} status=${status} updated=${r.updated} err=${r.error ?? '-'}`);
      if (r.updated && r.result?.final_text) console.log(`     → "${r.result.final_text.slice(0, 120)}"`);
      if (reason) console.log(`     → unsupported/matched: ${JSON.stringify(reason).slice(0, 200)}`);
    }

    if (r.error) {
      stats.errors.push(`${ev.id.slice(0, 8)}: ${r.error}`);
    }
    if (r.updated) {
      stats.latencyMs.sum += r.latencyMs;
      stats.latencyMs.n++;
      stats.latencyMs.max = Math.max(stats.latencyMs.max, r.latencyMs);
    }
    if (r.result) {
      const status = r.result.status;
      stats.byStatus[status] = (stats.byStatus[status] ?? 0) + 1;
      if (r.result.factuality?.pass) stats.factualityPassed++;
      if (r.result.independence?.pass) stats.independencePassed++;
      if (status === 'fallback_fact' || status === 'fallback_minimal') stats.fallbackUsed++;
    }

    // Progress var 50:e
    if (myIdx % 50 === 0 || myIdx === events.length) {
      const elapsed = (Date.now() - start) / 1000;
      const rate = (myIdx / elapsed) * 60;
      process.stdout.write(
        `\r  [${myIdx}/${events.length}] ${Math.round(rate)} events/min, ${stats.latencyMs.n} done ` +
        `(M3-pass=${stats.byStatus.passed ?? 0}, fact=${stats.factualityPassed}, indep=${stats.independencePassed}, fb=${stats.fallbackUsed})`,
      );
    }
  });

  const elapsed = (Date.now() - start) / 1000;
  const avgLatency = stats.latencyMs.n > 0 ? Math.round(stats.latencyMs.sum / stats.latencyMs.n) : 0;

  console.log('\n\n' + '═'.repeat(78));
  console.log(`  SLUTRESULTAT (${Math.round(elapsed)}s, medel ${avgLatency}ms/event)`);
  console.log('═'.repeat(78));
  console.log(`  Totalt events: ${stats.total}`);
  console.log('\n  Status-fördelning:');
  for (const [status, n] of Object.entries(stats.byStatus)) {
    const pct = Math.round((n / stats.total) * 100);
    console.log(`    ${status.padEnd(20)} ${n} (${pct}%)`);
  }
  console.log(`\n  Factuality pass:  ${stats.factualityPassed} (${Math.round((stats.factualityPassed / stats.total) * 100)}%)`);
  console.log(`  Independence pass: ${stats.independencePassed} (${Math.round((stats.independencePassed / stats.total) * 100)}%)`);
  console.log(`  Fallback-beskrivning: ${stats.fallbackUsed} (då M3 misslyckades)`);

  if (stats.errors.length > 0) {
    console.log(`\n  Första felen (${stats.errors.length} totalt):`);
    for (const e of stats.errors.slice(0, 5)) console.log(`    ${e}`);
  }

  if (dryRun) console.log('\n⚠️  DRY-RUN: inga ändringar sparade.');
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
