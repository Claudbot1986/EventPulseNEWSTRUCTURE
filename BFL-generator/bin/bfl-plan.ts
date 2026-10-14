#!/usr/bin/env tsx
/**
 * bin/bfl-plan.ts
 *
 * Plan-läge: hämta rå_description för events i en kategori, klustra dem, räkna ut behov.
 *
 * Inga BFL-anrop görs. Skriver bara:
 *   - tmp/plan_<category>.json (maskinläsbar plan)
 *   - Skriver ut en sammanfattning i terminalen (mänskligt läsbar)
 *
 * Default: --dry-run. M3 anropas om MINIMAX_API_KEY finns i env, annars mock-läge.
 *
 * CLI:
 *   tsx bin/bfl-plan.ts --category=<slug> [--count=N] [--event=<uuid>] [--cluster=<slug>]
 *
 * Källa till events-listan:
 *   - Om SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY finns: hämta från events-tabellen.
 *   - Annars: mock-läge med 3 exempel-events (för att testa utan backend).
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { quota } from '../lib/quota.js';
import { clusterBatch, type ClusterInput, type ClusterResult } from '../lib/cluster.js';

interface PlanInput {
  category: string;
  count?: number;
  event?: string;
  cluster?: string;
}

interface PlanOutput {
  category: string;
  generated_at: string;
  events_total: number;
  library_now: number;
  target: number;
  need: number;
  filters: { count?: number; event?: string; cluster?: string };
  events: Array<{
    event_id: string;
    raw_description_excerpt: string;
    tags: string[];
    cluster_source: ClusterResult['source'];
  }>;
  cluster_summary: Record<string, number>;
  estimated_cost_usd: number;
}

function parseArgs(argv: string[]): PlanInput {
  const args: PlanInput = { category: '' };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--category=')) args.category = arg.slice('--category='.length);
    else if (arg.startsWith('--count=')) args.count = parseInt(arg.slice('--count='.length), 10);
    else if (arg.startsWith('--event=')) args.event = arg.slice('--event='.length);
    else if (arg.startsWith('--cluster=')) args.cluster = arg.slice('--cluster='.length);
  }
  if (!args.category) {
    console.error('Användning: tsx bin/bfl-plan.ts --category=<slug> [--count=N] [--event=<uuid>] [--cluster=<slug>]');
    process.exit(2);
  }
  return args;
}

interface EventRow {
  id: string;
  category_slug: string;
  raw_description: string | null;
}

/**
 * Hämtar events från Supabase om creds finns, annars mock-data.
 */
async function fetchEvents(category: string, eventFilter?: string): Promise<EventRow[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn('[plan] SUPABASE_URL/KEY saknas → mock-läge (3 exempel-events)');
    return mockEvents(category, eventFilter);
  }

  let query = `${url}/rest/v1/events?category_slug=eq.${encodeURIComponent(category)}&select=id,category_slug,raw_description&limit=1000`;
  if (eventFilter) query += `&id=eq.${encodeURIComponent(eventFilter)}`;

  const res = await fetch(query, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  if (!res.ok) {
    console.warn(`[plan] Supabase-anrop misslyckades: HTTP ${res.status} → mock-läge`);
    return mockEvents(category, eventFilter);
  }

  return res.json() as Promise<EventRow[]>;
}

/**
 * Library-räkning från Supabase (eller mock).
 */
async function fetchLibraryCount(category: string): Promise<number> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return 0;

  const res = await fetch(
    `${url}/rest/v1/image_library?category_slug=eq.${encodeURIComponent(category)}&select=id`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) return 0;
  const rows = (await res.json()) as unknown[];
  return rows.length;
}

function mockEvents(category: string, eventFilter?: string): EventRow[] {
  const samples: EventRow[] = [
    {
      id: 'mock-001',
      category_slug: category,
      raw_description: 'Hårdrockskväll med lokala band och elgitarr. Mörk scen med röda spotlights.',
    },
    {
      id: 'mock-002',
      category_slug: category,
      raw_description: 'Pianokonsert med klassisk symfoniorkester. Konserthusets stora sal.',
    },
    {
      id: 'mock-003',
      category_slug: category,
      raw_description: 'Standup-kväll med tre komiker. Intim scen, bar i bakgrunden.',
    },
  ];
  return eventFilter ? samples.filter(e => e.id === eventFilter) : samples;
}

function excerpt(s: string, n = 80): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > n ? t.slice(0, n) + '…' : t;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const events = await fetchEvents(args.category, args.event);
  const library = await fetchLibraryCount(args.category);

  const { target, need, reason } = quota({ events: events.length, library });

  // Klustring
  const inputs: ClusterInput[] = events
    .filter(e => e.raw_description)
    .map(e => ({
      event_id: e.id,
      raw_description: e.raw_description,
      category_slug: e.category_slug,
    }));

  const clusters = inputs.length > 0 ? await clusterBatch(inputs, { concurrency: 5 }) : [];

  // Filtrering baserat på --cluster
  let filteredClusters = clusters;
  if (args.cluster) {
    const needle = args.cluster.toLowerCase();
    filteredClusters = clusters.filter(c =>
      c.tags.some(t => t.toLowerCase().includes(needle)),
    );
  }

  // Filtrering baserat på --count (begränsa antal events i plan)
  let effectiveEvents = events;
  let effectiveClusters = filteredClusters;
  if (args.count !== undefined) {
    effectiveEvents = events.slice(0, args.count);
    effectiveClusters = filteredClusters.slice(0, args.count);
  }

  // Sammanställ cluster-summary
  const clusterSummary: Record<string, number> = {};
  for (const c of clusters) {
    for (const t of c.tags) {
      clusterSummary[t] = (clusterSummary[t] || 0) + 1;
    }
  }

  // Uppskattat antal prompts: 1 prompt per event (1 variant), eller need om mindre.
  const promptsToCreate = args.count !== undefined
    ? Math.min(args.count, need, effectiveEvents.length)
    : Math.min(need, effectiveEvents.length);

  const plan: PlanOutput = {
    category: args.category,
    generated_at: new Date().toISOString(),
    events_total: events.length,
    library_now: library,
    target,
    need,
    filters: { count: args.count, event: args.event, cluster: args.cluster },
    events: effectiveEvents.map(e => {
      const cluster = effectiveClusters.find(c => c.event_id === e.id);
      return {
        event_id: e.id,
        raw_description_excerpt: excerpt(e.raw_description || ''),
        tags: cluster?.tags || [],
        cluster_source: cluster?.source || 'empty',
      };
    }),
    cluster_summary: clusterSummary,
    estimated_cost_usd: promptsToCreate * 0.04, // BFL Flux Pro 1.1 pris/bild
  };

  // Skriv plan.json
  const tmpDir = join(process.cwd(), 'tmp');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const outPath = join(tmpDir, `plan_${args.category}.json`);
  writeFileSync(outPath, JSON.stringify(plan, null, 2), 'utf8');

  // Print mänskligt läsbar sammanfattning
  console.log('\n=== BFL-plan för kategori: ' + args.category + ' ===\n');
  console.log(`Events totalt:        ${plan.events_total}`);
  console.log(`Bilder i biblioteket: ${plan.library_now}`);
  console.log(`Mål (target):         ${plan.target}  (anledning: ${reason})`);
  console.log(`Behöver genereras:    ${plan.need}`);
  if (args.count !== undefined) console.log(`Begränsat till:       ${args.count}`);
  if (args.cluster) console.log(`Kluster-filter:       ${args.cluster}`);
  console.log(`Uppskattad kostnad:   $${plan.estimated_cost_usd.toFixed(2)} USD`);
  console.log(`\nKluster-fördelning:`);
  const sortedClusters = Object.entries(clusterSummary).sort((a, b) => b[1] - a[1]);
  if (sortedClusters.length === 0) {
    console.log('  (inga taggar genererade — M3 antingen ej anropad eller alla beskrivningar var tomma)');
  } else {
    for (const [tag, count] of sortedClusters.slice(0, 10)) {
      console.log(`  ${tag.padEnd(20)} ${count}`);
    }
  }
  console.log(`\nEvents i plan: ${effectiveEvents.length}`);
  console.log(`Plan skriven: ${outPath}`);
  console.log(`\n⚠️  Detta är dry-run. Lägg till --apply på bfl-generate.mjs för att faktiskt bränna BFL-kredit.`);
}

main().catch(err => {
  console.error('[plan] fel:', err instanceof Error ? err.message : err);
  process.exit(1);
});