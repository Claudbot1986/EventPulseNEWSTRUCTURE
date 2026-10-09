/**
 * _extractionRealityTestLiveM3.ts
 *
 * Kör hybrid pipeline (rules + MiniMax-M3) mot ALLA 46 events i
 * runtime/live-sample-2026-10-08.jsonl och loggar ärlig statistik.
 *
 * INTE för regression — detta är en engångs-körning som visar hur
 * väl LLM-lagret faktiskt presterar i prod.
 *
 * Resultat sparas i runtime/m3-live-sample-results.jsonl för analys.
 */

import { readFileSync, writeFileSync } from 'fs';
import { extractEntitiesWithLlmAugment } from './entityLlmAugment';

interface LiveEvent {
  event_id: string;
  title: string;
  category: string;
  venue: string | null;
  city: string | null;
}

const path = '/Users/claudgashi/EventPulse/runtime/live-sample-2026-10-08.jsonl';
const lines = readFileSync(path, 'utf-8').trim().split('\n');
const events: LiveEvent[] = lines.map(line => JSON.parse(line));

const OUTPUT_PATH = '/Users/claudgashi/EventPulse/runtime/m3-live-sample-results.jsonl';

interface RunResult {
  event_id: string;
  title: string;
  category: string;
  entities: Array<{ name: string; role: string; confidence: string; method: string }>;
  llm_called: boolean;
  elapsed_ms: number;
  ok: boolean;
  error?: string;
}

async function main() {
  console.log('═'.repeat(72));
  console.log('  P8 FAS 3 — RIKTIG MiniMax-M3 Reality-Test (alla 46 events)');
  console.log('═'.repeat(72));

  const results: RunResult[] = [];
  const summary = {
    total: events.length,
    sync_only: 0,
    llm_augmented: 0,
    sync0_llm0: 0,
    sync0_llm1plus: 0,
    errors: 0,
  };
  const startAll = Date.now();

  for (const ev of events) {
    const t0 = Date.now();
    try {
      const entities = await extractEntitiesWithLlmAugment({
        title: ev.title,
        raw_description: null,
        category_slug: ev.category,
        venue_name: ev.venue,
      });
      const elapsed = Date.now() - t0;

      const llmCalled = entities.some((e) => e.evidence.method === 'llm_fallback:minimax-m3');
      if (entities.length > 0 && llmCalled) summary.llm_augmented++;
      else if (entities.length > 0 && !llmCalled) summary.sync_only++;
      else if (entities.length === 0) summary.sync0_llm0++;

      results.push({
        event_id: ev.event_id,
        title: ev.title,
        category: ev.category,
        entities: entities.map((e) => ({
          name: e.name,
          role: e.role,
          confidence: e.confidence,
          method: e.evidence.method,
        })),
        llm_called: llmCalled,
        elapsed_ms: elapsed,
        ok: true,
      });

      // Logga progress var 10:e event
      if ((results.length % 10) === 0) {
        console.log(`  [${results.length}/${events.length}] klar. Senaste: ${ev.title.slice(0, 50)}`);
      }
    } catch (e: unknown) {
      results.push({
        event_id: ev.event_id,
        title: ev.title,
        category: ev.category,
        entities: [],
        llm_called: false,
        elapsed_ms: Date.now() - t0,
        ok: false,
        error: (e as Error)?.message ?? String(e),
      });
      summary.errors++;
      console.error(`  ✗ ${ev.title.slice(0, 50)}: ${(e as Error).message}`);
    }
  }

  // Räkna hur många events där regler var 0 men LLM hjälpte
  for (const r of results) {
    if (r.entities.length > 0 && r.llm_called) summary.sync0_llm1plus++;
  }

  const totalElapsed = Date.now() - startAll;
  writeFileSync(OUTPUT_PATH, results.map((r) => JSON.stringify(r)).join('\n') + '\n');

  console.log('\n' + '═'.repeat(72));
  console.log('  RESULTAT');
  console.log('═'.repeat(72));
  console.log(`  Totalt events:        ${summary.total}`);
  console.log(`  Sync-regler räckte:   ${summary.sync_only}`);
  console.log(`  LLM hjälpte:          ${summary.llm_augmented}`);
  console.log(`  Inga entities hittade alls: ${summary.sync0_llm0}`);
  console.log(`  varav LLM räddade:    ${summary.sync0_llm1plus}`);
  console.log(`  Errors:               ${summary.errors}`);
  console.log(`  Total tid:            ${(totalElapsed / 1000).toFixed(1)}s (snitt ${(totalElapsed / events.length).toFixed(0)} ms/event)`);

  // Visa edge cases — events med 0 entities efter hybrid
  console.log('\n  Events med 0 entities (hybrid-resultat):');
  for (const r of results.filter((x) => x.entities.length === 0)) {
    console.log(`    • ${r.title.slice(0, 60)}  (cat=${r.category})`);
  }

  // Visa LLM-sparade events
  console.log('\n  Events där LLM räddade (regler 0 → LLM ≥1):');
  for (const r of results.filter((x) => x.llm_called && x.entities.length > 0)) {
    console.log(`    • ${r.title.slice(0, 50)}`);
    for (const e of r.entities) {
      console.log(`       → [${e.name}] (${e.role}, ${e.confidence}, via ${e.method})`);
    }
  }

  console.log(`\n  Detaljerad JSON sparad: ${OUTPUT_PATH}`);
}

main().catch((e) => {
  console.error('Top-level error:', e);
  process.exit(1);
});
