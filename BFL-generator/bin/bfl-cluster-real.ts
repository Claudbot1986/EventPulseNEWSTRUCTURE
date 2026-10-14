#!/usr/bin/env tsx
/**
 * bin/bfl-cluster-real.ts
 *
 * Kör riktig klustring: hämtar raw_description för events i en kategori
 * från Supabase, skickar varje beskrivning till MiniMax-M3, sammanställer
 * kluster-taggar med frekvens.
 *
 * Säkerhet:
 *   - MINIMAX_API_KEY läses från env (finns i /Users/claudgashi/EventPulse/.env).
 *   - API-nyckel loggas ALDRIG.
 *   - Resultat skrivs till tmp/cluster_<category>.json (gitignored).
 *   - Skriver mänskligt läsbar sammanfattning till stdout.
 *
 * CLI:
 *   tsx bin/bfl-cluster-real.ts --category=<slug> [--limit=N]
 *
 * Kräver .env med MINIMAX_API_KEY + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

import { readFileSync } from 'node:fs';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Ladda .env manuellt (ingen dotenv-dependency).
const envPath = '/Users/claudgashi/EventPulse/.env';
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2];
    }
  }
}

interface ClusterInput {
  event_id: string;
  raw_description: string | null;
  category_slug: string;
}

interface ClusterResult {
  event_id: string;
  tags: string[];
  source: 'mock' | 'minimax' | 'empty';
}

const PROMPT = (category: string, description: string): string => `Du hjälper till att tagga evenemang i Stockholm för bildgenerering.

Kategori: ${category}
Beskrivning: """${description}"""

Ge 1-3 korta KLUSTER-TAGGAR (svenska, lowercase, 1-2 ord vardera) som beskriver evenemangets visuella innehåll — t.ex. "hårdrock", "pop", "jazz", "symfoniorkester", "monolog", "fars", "utställning", "workshop", "löpning", "fotboll", "standup", "matlagning", "cirkus", "magiker", "performance", "familjeföreställning", etc.

Taggarna ska baseras på FAKTISKT INNEHÅLL i beskrivningen — läs den och välj vad som passar. Om beskrivningen inte ger visuell signal, returnera [].

Svara BARA med en JSON-array. Inget annat. Exempel: ["hårdrock","elgitarr"]`;

async function callMinimax(description: string, category: string): Promise<string[]> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MINIMAX_API_KEY saknas');

  // M3 anropas direkt mot api.minimax.io (enligt memory: project_minimax_image_tools.md
  // + project_editorial_llm_minimax.md). OpenRouter-routen gav 401.
  const res = await fetch('https://api.minimax.io/v1/text/chatcompletion_v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: PROMPT(category, description) }],
      temperature: 0.2,
      max_tokens: 256,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    const safe = text.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***').slice(0, 200);
    throw new Error(`HTTP ${res.status}: ${safe}`);
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return [];

  // M3 kan trunkera JSON i mitten (max_tokens-träff). Hantera ofullständig array
  // genom att stänga strängen + ev. citattecken + lägga till ].
  let jsonText = content;
  const arrMatch = jsonText.match(/\[[\s\S]*/);
  if (!arrMatch) return [];
  let candidate = arrMatch[0];
  // Trim trailing partial string: om slutar mitt i ett citat, stäng.
  const opens = (candidate.match(/"/g) || []).length;
  if (opens % 2 === 1) candidate += '"';
  // Trim trailing comma/space.
  candidate = candidate.replace(/[\s,]+$/, '');
  // Stäng array.
  if (!candidate.endsWith(']')) candidate += ']';
  try {
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is string => typeof t === 'string')
      .map(t => t.toLowerCase().trim())
      .filter(t => t.length > 0 && t.length < 30)
      .slice(0, 3);
  } catch {
    return [];
  }
}

async function clusterOne(input: ClusterInput): Promise<ClusterResult> {
  if (!input.raw_description || !input.raw_description.trim()) {
    return { event_id: input.event_id, tags: [], source: 'empty' };
  }
  try {
    const tags = await callMinimax(input.raw_description, input.category_slug);
    return { event_id: input.event_id, tags, source: 'minimax' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'okänt';
    console.warn(`[cluster] ${input.event_id}: ${msg}`);
    return { event_id: input.event_id, tags: [], source: 'empty' };
  }
}

interface EventRow {
  id: string;
  category_slug: string;
  raw_description: string | null;
}

async function fetchEvents(category: string, limit: number): Promise<EventRow[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL/KEY saknas');

  // Supabase PostgREST default max rows = 1000. Paginerar med offset/limit.
  const PAGE_SIZE = 1000;
  const allRows: EventRow[] = [];
  let offset = 0;
  while (allRows.length < limit) {
    const remaining = limit - allRows.length;
    const pageSize = Math.min(PAGE_SIZE, remaining);
    const query = `${url}/rest/v1/events?category_slug=eq.${encodeURIComponent(category)}&select=id,category_slug,raw_description&raw_description=not.is.null&order=raw_description_captured_at.desc&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(query, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const rows = (await res.json()) as EventRow[];
    if (rows.length === 0) break; // slut på data
    allRows.push(...rows);
    if (rows.length < pageSize) break; // sista sidan
    offset += pageSize;
  }
  return allRows;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let category = '';
  let limit = 50;
  let concurrency = 5;

  for (const arg of args) {
    if (arg.startsWith('--category=')) category = arg.slice('--category='.length);
    else if (arg.startsWith('--limit=')) limit = parseInt(arg.slice('--limit='.length), 10);
    else if (arg.startsWith('--concurrency=')) concurrency = parseInt(arg.slice('--concurrency='.length), 10);
  }

  if (!category) {
    console.error('Användning: tsx bin/bfl-cluster-real.ts --category=<slug> [--limit=N] [--concurrency=N]');
    process.exit(2);
  }

  console.log(`[cluster] Hämtar events för kategori="${category}" (limit=${limit})...`);
  const events = await fetchEvents(category, limit);
  console.log(`[cluster] Hämtade ${events.length} events med raw_description.`);

  if (events.length === 0) {
    console.log('[cluster] Inga events med raw_description. Avbryter.');
    return;
  }

  // Klustra parallellt.
  const inputs: ClusterInput[] = events.map(e => ({
    event_id: e.id,
    raw_description: e.raw_description,
    category_slug: e.category_slug,
  }));

  const results: ClusterResult[] = new Array(inputs.length);
  let cursor = 0;
  let done = 0;
  async function worker(): Promise<void> {
    while (cursor < inputs.length) {
      const idx = cursor++;
      results[idx] = await clusterOne(inputs[idx]);
      done++;
      if (done % 10 === 0 || done === inputs.length) {
        process.stdout.write(`\r[cluster] ${done}/${inputs.length} events klustrade`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()));
  console.log();

  // Sammanställ.
  const tagFreq: Record<string, number> = {};
  const eventTagMap: Record<string, string[]> = {};
  let minimaxCount = 0;
  let emptyCount = 0;
  for (const r of results) {
    eventTagMap[r.event_id] = r.tags;
    if (r.source === 'minimax') minimaxCount++;
    if (r.source === 'empty') emptyCount++;
    for (const t of r.tags) {
      tagFreq[t] = (tagFreq[t] || 0) + 1;
    }
  }

  const sortedTags = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]);

  const tmpDir = join(process.cwd(), 'tmp');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const outJson = join(tmpDir, `cluster_${category}.json`);
  writeFileSync(outJson, JSON.stringify({
    category,
    total_events: events.length,
    minimax_tagged: minimaxCount,
    empty: emptyCount,
    tag_frequency: Object.fromEntries(sortedTags),
    events: results.map(r => ({ event_id: r.event_id, tags: r.tags, source: r.source })),
    generated_at: new Date().toISOString(),
  }, null, 2), 'utf8');

  console.log(`\n=== RIKTIG klustring: ${category} ===\n`);
  console.log(`Events hämtade:      ${events.length}`);
  console.log(`Events med M3-tags:  ${minimaxCount}`);
  console.log(`Events utan tags:    ${emptyCount} (tom beskrivning eller M3-fel)`);
  console.log(`Unika kluster:       ${sortedTags.length}`);
  console.log(`\nKluster-frekvens (topp 25):`);
  for (const [tag, count] of sortedTags.slice(0, 25)) {
    const bar = '█'.repeat(Math.min(20, count));
    console.log(`  ${tag.padEnd(22)} ${String(count).padStart(4)}  ${bar}`);
  }
  if (sortedTags.length > 25) {
    console.log(`  ... och ${sortedTags.length - 25} till`);
  }
  console.log(`\nFullständig data: ${outJson}`);
}

main().catch(err => {
  console.error('[cluster] fel:', err instanceof Error ? err.message : err);
  process.exit(1);
});