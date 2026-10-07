/**
 * _recategorize-utforska-retry.ts (v3) — Robust retry på återstående
 * illegala events. Använder samma batch/parallel-mönster som
 * _recategorize-utforska.ts (8 events/batch, 4 parallella workers).
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const UTFORSKA_SLUGS = ['music','opera','theatre-comedy','theatre-drama','dance','circus','exhibition','flea-market','food','wine-tasting','kids','family','film','talks-lectures','workshop','sports','nightlife','community'];
const UTFORSKA_DEFS: Record<string,string> = {
  music: 'Konserter och musikframföranden — alla genrer.',
  opera: 'Opera och operaföreställningar.',
  'theatre-comedy': 'Standup, humorproduktioner.',
  'theatre-drama': 'Teater, drama, musikal-pjäser.',
  dance: 'Scenföreställningar där dans är huvudformen.',
  circus: 'Cirkus och akrobatik.',
  exhibition: 'Konst-, design-, fotoutställningar.',
  'flea-market': 'Loppis, vintage.',
  food: 'Matfestivaler, matprovningar.',
  'wine-tasting': 'Dryckesprovningar.',
  kids: 'Aktiviteter för barn.',
  family: 'Aktiviteter för barn och vuxna tillsammans.',
  film: 'Filmvisning, bio.',
  'talks-lectures': 'Föreläsningar, panelsamtal.',
  workshop: 'Kurser, prova-på.',
  sports: 'Sport, tävling.',
  nightlife: 'Klubbar, barer, dansgolv.',
  community: 'Fallback.',
};

const BATCH_SIZE = 8;
const MAX_PARALLEL = 4;
const MAX_TOKENS = 3500;
const LLM_TIMEOUT_MS = 60_000;
const LLM_MODEL = 'MiniMax-M2.7';
const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
const LOW_CONF_FLOOR = 0.5;

const VAULT_DIR = join(process.cwd(), '00-Vault/01-Projects/EventPulse/04-Sources');

const supabase = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '');

interface EventRow { id: string; title_sv: string|null; title_en: string|null; description_sv: string|null; description_en: string|null; category_slug: string|null; source: string|null; }
interface Suggestion { id: string; old_slug: string|null; new_slug: string; confidence: number; reasoning: string; title_hint: string; }

async function fetchRemaining(): Promise<EventRow[]> {
  const seen = new Set<string>();
  const rows: EventRow[] = [];
  const buckets: Array<{q: any, isNull: boolean}> = [
    {q: supabase.from('events').select('id, title_sv, title_en, description_sv, description_en, category_slug, source, start_time').is('category_slug', null).order('start_time', {ascending: false}), isNull: true},
    {q: supabase.from('events').select('id, title_sv, title_en, description_sv, description_en, category_slug, source, start_time').eq('category_slug', 'theater').order('start_time', {ascending: false}), isNull: false},
    {q: supabase.from('events').select('id, title_sv, title_en, description_sv, description_en, category_slug, source, start_time').eq('category_slug', 'musical-theatre').order('start_time', {ascending: false}), isNull: false},
  ];
  for (const b of buckets) {
    let off = 0;
    while (true) {
      const { data } = await b.q.range(off, off + 999);
      if (!data || !data.length) break;
      for (const r of data as EventRow[]) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        rows.push(r);
      }
      off += data.length;
      if (data.length < 1000) break;
    }
  }
  return rows;
}

function chunk<T>(arr: T[], n: number): T[][] { const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

function buildSystemPrompt(): string {
  const lines = UTFORSKA_SLUGS.map(s => `- ${s}: ${UTFORSKA_DEFS[s] ?? ''}`);
  return `Evenemangsklassificerare för EventPulse (Stockholm). EN kategori per event. Default "community".

VIKTIGT:
* Musikgenrer, musikal, alla live-musikframträdanden → "music".
* "musical-theatre" / musikal-pjäser → "theatre-drama" om pjäsform dominerar, annars "music".
* "theater" (gammal slug) → bästa Utforska-match: "theatre-drama" (allvar) eller "theatre-comedy" (komedi) baserat på innehåll.
* Dansföreställning → "dance".
* Standup/humor → "theatre-comedy".
* Festival/mässa utan tydlig riktning → "community".

DEFINITIONER:
${lines.join('\n')}

TILLÅTNA SLUGS: ${JSON.stringify(UTFORSKA_SLUGS)}

Svara ENDAST JSON-array. Elementformat: {"id": "<uuid>", "category": "<slug>", "confidence": <0.0-1.0>, "reasoning": "<kort>"}`;
}

async function classifyBatch(events: EventRow[]): Promise<Suggestion[]> {
  const eventsForPrompt = events.map(e => ({
    id: e.id, title: e.title_sv ?? e.title_en ?? '',
    description: (e.description_sv ?? e.description_en ?? '').slice(0, 400),
    source: e.source ?? '', venue_hint: 'Stockholm',
  }));
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const resp = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL, temperature: 0.1, max_tokens: MAX_TOKENS,
        messages: [{ role: 'system', content: buildSystemPrompt() }, { role: 'user', content: JSON.stringify(eventsForPrompt) }],
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const body = await resp.json();
    const raw = body?.choices?.[0]?.message?.content ?? '';
    const content = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const match = content.match(/\[[\s\S]*?\]/);
    if (!match) throw new Error(`No JSON: ${content.slice(0, 200)}`);
    const parsed = JSON.parse(match[0]);
    const allowed = new Set(UTFORSKA_SLUGS);
    const byId = new Map(events.map(e => [e.id, e]));
    return (parsed as Array<Record<string,unknown>>)
      .filter(r => r && typeof r.id === 'string' && typeof r.category === 'string')
      .map(r => {
        const id = r.id as string;
        const ev = byId.get(id);
        const proposed = r.category as string;
        const conf = typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0;
        return {
          id, old_slug: ev?.category_slug ?? null,
          new_slug: allowed.has(proposed) && conf >= LOW_CONF_FLOOR ? proposed : 'community',
          confidence: conf,
          reasoning: typeof r.reasoning === 'string' ? (r.reasoning as string).slice(0, 200) : '',
          title_hint: (ev?.title_sv ?? ev?.title_en ?? '').slice(0, 80),
        };
      });
  } finally { clearTimeout(tid); }
}

async function runWithPool<T,R>(items: T[], poolSize: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() { while (true) { const i = next++; if (i >= items.length) return; results[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({length: Math.min(poolSize, items.length)}, () => worker()));
  return results;
}

async function main() {
  const events = await fetchRemaining();
  console.log(`[retry] Återstående events utanför Utforska: ${events.length}`);
  if (events.length === 0) { console.log('[retry] Klart — alla events har Utforska-slug.'); return; }

  const batches = chunk(events, BATCH_SIZE);
  console.log(`[retry] ${batches.length} batcher × ${BATCH_SIZE}  (max ${MAX_PARALLEL} parallella)`);

  let succeeded = 0, failed = 0;
  const all: Suggestion[] = [];
  await runWithPool(batches, MAX_PARALLEL, async (batch, i) => {
    try {
      const s = await classifyBatch(batch);
      all.push(...s);
      succeeded++;
      const avg = s.reduce((a, x) => a + x.confidence, 0) / Math.max(1, s.length);
      console.log(`[retry] batch ${i+1}/${batches.length} OK  ${s.length} svar  medel-conf=${avg.toFixed(2)}`);
    } catch (e) {
      failed++;
      console.error(`[retry] batch ${i+1}/${batches.length} FAIL: ${(e as Error).message.slice(0, 200)}`);
    }
  });

  // Apply
  let updated = 0, skipped = 0;
  const errors: string[] = [];
  for (const s of all) {
    const { data: cur } = await supabase.from('events').select('category_slug').eq('id', s.id).maybeSingle();
    if (!cur) { skipped++; continue; }
    if ((cur.category_slug ?? null) !== s.old_slug) { skipped++; continue; }
    const { error } = await supabase.from('events').update({ category_slug: s.new_slug }).eq('id', s.id);
    if (error) errors.push(`UPDATE ${s.id}: ${error.message}`);
    else updated++;
  }
  console.log(`\n[retry] UPDATE: ${updated}  Skippade: ${skipped}  Errors: ${errors.length}`);

  const dist: Record<string, number> = {};
  for (const s of all) dist[s.new_slug] = (dist[s.new_slug] ?? 0) + 1;
  console.log('\n[retry] Nya slugs:');
  for (const [k, n] of Object.entries(dist).sort((a,b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${n}`);
  }

  // JSONL
  const today = new Date().toISOString().slice(0,10);
  await writeFile(join(VAULT_DIR, `recat-utforska-retry-${today}.jsonl`), all.map(s => JSON.stringify(s)).join('\n') + '\n', 'utf8');
  console.log(`[retry] JSONL: recat-utforska-retry-${today}.jsonl`);
}

main().catch(e => { console.error('[retry] FATAL:', e instanceof Error ? e.message : e); process.exit(1); });