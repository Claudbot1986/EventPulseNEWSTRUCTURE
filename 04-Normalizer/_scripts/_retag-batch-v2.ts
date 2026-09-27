/**
 * retag-batch.ts — Steg 3.4: LLM-driven re-tagging av community-events.
 *
 * Delar in 1440 community-events i 100 parallella batcher och anropar
 * MiniMax-M2.7 (OpenRouter-kompatibel endpoint) för att föreslå
 * multi-label slugs per event. Resultatet skrivs till vault som JSONL
 * för manuell review.
 *
 * Gör INGA DB-mutationer — output är endast förslag som människa
 * granskar innan apply-retag.ts skriver tillbaka.
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/retag-batch.ts [--dry-run]
 *
 * Output:
 *   00-Vault/01-Projects/EventPulse/04-Sources/retag-suggestions-YYYY-MM-DD.jsonl
 *
 * Konstanter (varför dessa):
 *   * 100 batcher × ~14 events = 1440 (exakt en batch per event-rad)
 *   * MiniMax-kontot klarar 100 parallella chat-anrop utan 429 (per memory
 *     2026-09-21: 100 parallella OK, ~780k TPM-tryck ok).
 *   * max_tokens=4096 räcker för 14 events × ~3 slugs × ~80 tecken
 *     vardera (safety margin 2×).
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

interface EventRow {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  description_sv: string | null;
  description_en: string | null;
  category_slug: string | null;
  source: string | null;
  start_time: string | null;
  ticket_url: string | null;
  venue_id: string | null;
}

interface Suggestion {
  id: string;
  slugs: string[];
  reasoning: string;
}

// ─── Konfiguration ─────────────────────────────────────────────────────────

const NUM_BATCHES = 100;
const MAX_TOKENS = 4096;
const LLM_TIMEOUT_MS = 30_000; // 30s/batch (M2.7 thinking + JSON output)
const LLM_MODEL = 'MiniMax-M2.7';
const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';

const PAGE = 1000;
const VAULT_DIR = join(process.cwd(), '00-Vault/01-Projects/EventPulse/04-Sources');

// 18 slugs (v2) — inkluderar musical + classical som saknades i v1.
// Övriga musik-genrer (pop-rock/jazz/electronic/hip-hop/metal/world-folk)
// kräver fortfarande Steg 3.5 artist-tillägg.
const ALLOWED_SLUGS = [
  'opera', 'theatre-comedy', 'theatre-drama', 'dance', 'circus',
  'musical', 'classical',  // NYA i v2 — fångar Chicago-musikal + Berwaldhallen/Radiokören
  'exhibition',
  'flea-market', 'food', 'wine-tasting',
  'kids', 'family',
  'film',
  'talks-lectures', 'workshop',
  'sports',
  'community', // fallback
];

const SYSTEM_PROMPT = `Du är en evenemangsklassificerare för Stockholm. Du får en JSON-array med evenemang och ska föreslå multi-label slugs från listan nedan.

REGLER:
* Multi-label: ett event kan tillhöra 1-3 slugs om det passar.
* Om inget passar bra, returnera ["community"].
* Svara ENDAST med en JSON-array (inga andra ord, ingen markdown).
* Varje element: {"id": "<uuid>", "slugs": [...], "reasoning": "<kort motivering, max 100 tecken sv>"}.

NYA SIGNALER (v2) — använd dessa utöver titel + description:
* URL: om URL innehåller "/konserter/", "/teater/", "/dans/", "/barn/", "/utstallning/" → använd som stark hint.
* Källa: berwaldhallen → nästan alltid classical. kulturhusetstadsteatern → theatre-drama/comedy. fasching/debaser → music (genre ej möjlig utan artist-tillägg).
* Venue: om namnet antyder "Berwaldhallen", "Operan", "Oscarsteatern", "Kulturhuset" → använd som hint.

VIKTIGA NYCKELORD:
* "musikal" / "musical" i titel → musical
* "konsert" + "orkester" / "symfoni" / "filharmo" / dirigentnamn → classical
* "recital" / "kammarmusik" → classical

TILLÅTNA SLUGS:
${JSON.stringify(ALLOWED_SLUGS)}

JSON-svaret måste vara giltigt — inga trailing commas, inga kommentarer.`;

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

// ─── Helpers ───────────────────────────────────────────────────────────────

async function fetchCommunityEvents(): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select('id, title_sv, title_en, description_sv, description_en, category_slug, source, start_time, ticket_url, venue_id')
      .eq('category_slug', 'community')
      .order('start_time', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetch error: ${error.message}`);
    if (data && data.length > 0) {
      rows.push(...(data as EventRow[]));
      offset += data.length;
      hasMore = data.length === PAGE;
    } else {
      hasMore = false;
    }
  }
  return rows;
}

function chunk<T>(items: T[], n: number): T[][] {
  // Dela jämnt: första (items.length % n) batcher får +1 item.
  // Ex: 1440 items / 100 = 14 remainder 40 → 40 batcher × 15 + 60 batcher × 14.
  const out: T[][] = [];
  const base = Math.floor(items.length / n);
  const extra = items.length % n;
  let offset = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (i < extra ? 1 : 0);
    if (size === 0) break;
    out.push(items.slice(offset, offset + size));
    offset += size;
  }
  return out;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

interface MinimaxChatResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

async function classifyBatch(events: EventRow[], apiKey: string): Promise<Suggestion[]> {
  const userMsg = JSON.stringify({
    events: events.map((e) => ({
      id: e.id,
      title_sv: e.title_sv,
      title_en: e.title_en,
      description_sv: (e.description_sv ?? '').slice(0, 500),
      description_en: (e.description_en ?? '').slice(0, 500),
      source: e.source,
      ticket_url: e.ticket_url,
      venue_id: e.venue_id,
    })),
  });

  const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`minimax HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const json = (await response.json()) as MinimaxChatResponse;
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('minimax: no content in response');
  }

  // Strip <think>...</think> blocks (M2.7 reasoning)
  const stripped = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Extract JSON array from the response (LLMs sometimes wrap in markdown)
  const match = stripped.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error(`minimax: no JSON array in response: ${stripped.slice(0, 200)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    throw new Error(`minimax: invalid JSON: ${(e as Error).message} — body: ${match[0].slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('minimax: parsed value is not an array');
  }

  // Validate suggestions against ALLOWED_SLUGS; unknown slugs → community
  const validIds = new Set(events.map((e) => e.id));
  const suggestions: Suggestion[] = [];
  for (const item of parsed) {
    const obj = item as Record<string, unknown>;
    if (typeof obj.id !== 'string' || !validIds.has(obj.id)) continue;
    const rawSlugs = Array.isArray(obj.slugs) ? (obj.slugs as unknown[]).filter((s): s is string => typeof s === 'string') : [];
    const slugs = rawSlugs.filter((s) => ALLOWED_SLUGS.includes(s));
    if (slugs.length === 0) slugs.push('community');
    suggestions.push({
      id: obj.id,
      slugs,
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning.slice(0, 200) : '',
    });
  }

  // Backfill: events without a suggestion get community fallback
  const seen = new Set(suggestions.map((s) => s.id));
  for (const e of events) {
    if (!seen.has(e.id)) {
      suggestions.push({ id: e.id, slugs: ['community'], reasoning: 'no-suggestion-from-llm' });
    }
  }
  return suggestions;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await mkdir(VAULT_DIR, { recursive: true });

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey && !dryRun) {
    throw new Error('MINIMAX_API_KEY not set in .env');
  }

  console.log('[retag-batch] Fetching community events from DB...');
  const events = await fetchCommunityEvents();
  console.log(`[retag-batch] ${events.length} events fetched.`);

  const batches = chunk(events, NUM_BATCHES);
  console.log(`[retag-batch] Split into ${batches.length} batches (avg ${(events.length / batches.length).toFixed(1)} events/batch).`);

  if (dryRun) {
    console.log('[retag-batch] --dry-run: skipping LLM calls. Would send', batches.length, 'parallel requests.');
    return;
  }

  const startedAt = Date.now();
  console.log(`[retag-batch] Firing ${batches.length} parallel MiniMax-M2.7 requests...`);

  const allSuggestions = await runWithConcurrency(batches, NUM_BATCHES, async (b, i) => {
    try {
      const result = await classifyBatch(b, apiKey!);
      console.log(`  batch ${i + 1}/${batches.length} OK (${result.length} suggestions)`);
      return result;
    } catch (err) {
      console.error(`  batch ${i + 1}/${batches.length} ERR: ${(err as Error).message}`);
      // Fallback: alla events i batchen → community
      return b.map((e) => ({ id: e.id, slugs: ['community'], reasoning: `batch-error: ${(err as Error).message.slice(0, 100)}` }));
    }
  });

  const flat = allSuggestions.flat();
  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  const today = new Date().toISOString().slice(0, 10);
  const outPath = join(VAULT_DIR, `retag-suggestions-v2-${today}.jsonl`);
  await writeFile(outPath, flat.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8');

  const dist: Record<string, number> = {};
  for (const s of flat) {
    for (const slug of s.slugs) {
      dist[slug] = (dist[slug] ?? 0) + 1;
    }
  }
  const distSorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);

  console.log(`\n[retag-batch] ✅ ${flat.length} förslag på ${durationSec}s`);
  console.log(`[retag-batch] Skrivet till: ${outPath}`);
  console.log(`[retag-batch] Fördelning:`);
  for (const [slug, n] of distSorted) {
    console.log(`  ${slug.padEnd(18)} ${n}`);
  }
  console.log(`\n[retag-batch] Nästa steg: granska förslag i batch om 50, kör sedan apply-retag.ts`);
}

main().catch((err) => {
  console.error('[retag-batch] FATAL:', err.message);
  process.exit(1);
});
