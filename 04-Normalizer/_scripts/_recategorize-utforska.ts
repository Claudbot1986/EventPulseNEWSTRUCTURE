/**
 * _recategorize-utforska.ts — Tvinga events.category_slug ∈ Utforska:s 18 slugs.
 *
 * Bakgrund (2026-10-06):
 *   DB hade 26 distinkta kategorier + 1862 NULL (13891 events med start_time >= nu).
 *   Utforska-sektionen (`06-UI/App.js:143-162`) använder exakt 18 slugs.
 *   Användaren vill att DB och Utforska ska matcha — inga andra kategorier.
 *
 *   Denna skill: MiniMax-M2.7 väljer EN av de 18 för varje event baserat på
 *   titel + beskrivning + source. Vi mappning inte "theater"→"theatre-comedy"
 *   via regel — vi LÅTER M2.7 gissa utifrån innehåll.
 *
 * Pipeline:
 *   1. Hämta alla events där category_slug IS NULL
 *      ELLER category_slug NOT IN (Utforska:s 18 slugs)
 *   2. Skicka batchar om BATCH_SIZE till MiniMax-M2.7 med strikt Enum-prompt
 *   3. Spara JSONL audit till vault (kan rollbackas)
 *   4. Om --apply: UPDATE events.category_slug för varje förslag
 *
 * Lägen:
 *   (default)     Kör MiniMax M2.7, skriv JSONL, gör INGEN DB-mutation.
 *   --dry-run     Samma som default — namnet bekräftar bara avsikten.
 *   --apply       Skriv tillbaka till DB efter JSONL-skrivning.
 *   --limit=N     Bearbeta endast N första events (för smoke test innan full körning).
 *
 * Säkerhet:
 *   * JSONL backup skrivs ALLTID innan --apply.
 *   * Backup innehåller id + gamla slug + nya slug + confidence + reasoning.
 *   * Vid --apply: bara events vars nuvarande slug matchar JSONL-posten uppdateras
 *     (skydd mot samtidiga writes från annan process).
 *   * Säkerhetsnät: om M2.7 returnerar conf < LOW_CONF_FLOOR → tvinga 'community'.
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/_recategorize-utforska.ts --limit=10
 *   tsx --env-file=.env 04-Normalizer/_scripts/_recategorize-utforska.ts --apply
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// ─── Konfiguration ─────────────────────────────────────────────────────────

/** Utforska:s 18 kanonska slugs — exakt det som visas i 06-UI/App.js:143-162. */
export const UTFORSKA_SLUGS = Object.freeze([
  'music',
  'opera',
  'theatre-comedy',
  'theatre-drama',
  'dance',
  'circus',
  'exhibition',
  'flea-market',
  'food',
  'wine-tasting',
  'kids',
  'family',
  'film',
  'talks-lectures',
  'workshop',
  'sports',
  'nightlife',
  'community',
] as const);

/** Kategoridefinitioner för LLM-promten — bygger på categoryDefinitions.ts men
 *  tillämpat på Utforska:s 18 (vi släpper rock/pop/jazz/electronic/hip-hop/classical
 *  och musikal-theatre som M2.7 ska mappa in i music eller theatre-drama baserat
 *  på innehåll, och lägger till nightlife). */
const UTFORSKA_DEFS: Record<string, string> = {
  music: 'Konserter och musikframföranden — alla genrer (rock, pop, jazz, klassiskt, elektroniskt, hip-hop m.fl.) så länge live-musikframförande är huvudaktiviteten. Exkludera ren DJ-kväll utan live-band.',
  opera: 'Opera och operaföreställningar där operasång och sceniskt berättande är huvudformen. Inkluderar konsertant opera. Exkludera musikal och vanlig klassisk konsert.',
  'theatre-comedy': 'Scenföreställningar där humor är huvudsyftet. Inkluderar standup, humorproduktioner, improvisationskomedi och komiska teaterföreställningar.',
  'theatre-drama': 'Teater och sceniska pjäser där dramatik/berättande är huvudformen. Inkluderar seriös teater, drama, musikal (sång + dans + pjäsform) och talteater. Exkludera ren komedi.',
  dance: 'Scenföreställningar där dans är huvudformen. Inkluderar modern dans, balett, streetdance och koreograferade dansföreställningar. Exkludera sociala dansevent och musikal.',
  circus: 'Cirkus och akrobatik — cirkuskonst, nycirkus, jonglering, akrobatik.',
  exhibition: 'Konst-, design- och fotoutställningar — vernissage, galleri, museum.',
  'flea-market': 'Loppis, vintage- och second hand-marknad.',
  food: 'Matfestivaler, matprovningar och matupplevelser.',
  'wine-tasting': 'Vin-, öl-, whisky- och spritprovningar.',
  kids: 'Aktiviteter skapade huvudsakligen för barn — barnteater, barnaktivitet, sagostund.',
  family: 'Aktiviteter för barn och vuxna tillsammans.',
  film: 'Filmvisning, bio, filmfestivaler — huvudpresenter i lokaler med filmvisning.',
  'talks-lectures': 'Föreläsningar, panelsamtal, författarsamtal, publika samtal — huvudsakligen lyssna/lära.',
  workshop: 'Kurser, workshops, prova-på — deltagaren skapar/utför själv.',
  sports: 'Sport, tävling, motionsaktivitet — matcher, turneringar, lopp.',
  nightlife: 'Klubbar, barer, nattliv, DJ-kvällar utan live-band, dansgolv som huvudfokus.',
  community: 'Lokalt/samhällsinriktat event utan tydlig specifik kategori. Använd som FALLBACK — bara om inget annat passar.',
};

const BATCH_SIZE = 14;
const MAX_PARALLEL = 8;
const MAX_TOKENS = 6144;
const LLM_TIMEOUT_MS = 45_000;
const LLM_MODEL = 'MiniMax-M2.7';
const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
const LOW_CONF_FLOOR = 0.5; // under detta → tvinga 'community'

const PAGE = 1000;
const VAULT_DIR = join(process.cwd(), '00-Vault/01-Projects/EventPulse/04-Sources');

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

// ─── Typer ─────────────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  description_sv: string | null;
  description_en: string | null;
  category_slug: string | null;
  source: string | null;
  start_time: string | null;
}

interface Suggestion {
  id: string;
  old_slug: string | null;
  new_slug: string;
  confidence: number;
  reasoning: string;
  title_hint: string;
}

interface UpdatePlan {
  id: string;
  old_slug: string | null;
  new_slug: string;
  confidence: number;
  reasoning: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function maxDescLen(e: EventRow): number {
  return Math.max((e.description_sv ?? '').length, (e.description_en ?? '').length);
}

/** Hämta events där slug INTE är i Utforska-listan (inkluderar NULL). */
async function fetchNonUtforskaEvents(limit?: number): Promise<EventRow[]> {
  const allowed = new Set<string>(UTFORSKA_SLUGS);
  const rows: EventRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    let q = supabase
      .from('events')
      .select('id, title_sv, title_en, description_sv, description_en, category_slug, source, start_time')
      .order('start_time', { ascending: false })
      .range(offset, offset + PAGE - 1);
    // Supabase PostgREST saknar "NOT IN" direkt på nullbara kolumner, så vi tar
    // NULL först och filtrerar resten i kod.
    const { data, error } = await q.is('category_slug', null);
    if (error) throw new Error(`fetch NULL error: ${error.message}`);
    if (data && data.length > 0) {
      for (const r of data as EventRow[]) rows.push(r);
      offset += data.length;
      hasMore = data.length === PAGE;
    } else {
      hasMore = false;
    }
    if (limit && rows.length >= limit) {
      rows.length = limit;
      break;
    }
  }

  // Andra fas: hämta icke-NULL icke-Utforska, sidnumrerat.
  // VIKTIGT: PostgREST's NOT IN() inkluderar NULL-rader (NULL är inte i listan),
  // så vi MÅSTE filtrera bort NULL i klienten för att undvika dubbletter.
  const seenIds = new Set(rows.map((r) => r.id));
  if (!limit || rows.length < limit) {
    offset = 0;
    hasMore = true;
    while (hasMore) {
      let q = supabase
        .from('events')
        .select('id, title_sv, title_en, description_sv, description_en, category_slug, source, start_time')
        .not('category_slug', 'in', `(${Array.from(allowed).map((s) => `"${s}"`).join(',')})`)
        .order('start_time', { ascending: false })
        .range(offset, offset + PAGE - 1);
      const { data, error } = await q;
      if (error) throw new Error(`fetch non-utforska error: ${error.message}`);
      if (data && data.length > 0) {
        for (const r of data as EventRow[]) {
          if (r.category_slug == null) continue; // hoppa NULL — redan hämtade
          if (!allowed.has(r.category_slug)) {
            if (!seenIds.has(r.id)) {
              seenIds.add(r.id);
              rows.push(r);
            }
          }
          if (limit && rows.length >= limit) break;
        }
        offset += data.length;
        hasMore = data.length === PAGE;
      } else {
        hasMore = false;
      }
      if (limit && rows.length >= limit) break;
    }
    if (limit) rows.length = Math.min(rows.length, limit);
  }
  return rows;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function buildSystemPrompt(): string {
  const lines = UTFORSKA_SLUGS.map((s) => `- ${s}: ${UTFORSKA_DEFS[s] ?? '(ingen definition)'}`);
  return `Du är evenemangsklassificerare för EventPulse (Stockholm). Du får en JSON-array med evenemang och ska klassificera varje enligt definitionerna nedan.

REGLER:
* EN kategori per event (single-label — välj den mest specifika som passar).
* Om inget passar bra, returnera "community".
* Svara ENDAST med en JSON-array. Inga andra ord, ingen markdown.
* Elementformat: {"id": "<uuid>", "category": "<slug>", "confidence": <0.0-1.0>, "reasoning": "<kort motivering på svenska, max 80 tecken>"}.

VIKTIGT — Inkluderar/Exkludera:
* Läs HELA definitionen innan du väljer. "Exkludera" är lika viktigt som inkluderar-listan.
* Musikgenrer (rock, pop, jazz, klassiskt, elektroniskt, hip-hop, musikal) → alla till "music" om live-musikframförande är huvudformen.
* "Musikal" (musical-theatre) → välj "theatre-drama" om pjäsform dominerar, annars "music".
* Standup / humor → "theatre-comedy".
* Festival utenlands tydlig inriktning → "community".
* Om beskrivningen är tom/kort och du är osäker → "community" med låg confidence (< 0.5).

DEFINITIONER (18 Utforska-slugs — du FÅR ENDAST välja bland dessa):

${lines.join('\n')}

TILLÅTNA SLUGS (hård enum):
${JSON.stringify([...UTFORSKA_SLUGS])}`;
}

async function classifyBatch(events: EventRow[]): Promise<Suggestion[]> {
  const eventsForPrompt = events.map((e) => ({
    id: e.id,
    title: e.title_sv ?? e.title_en ?? '',
    description: (e.description_sv ?? e.description_en ?? '').slice(0, 500),
    source: e.source ?? '',
    venue_hint: 'Stockholm',
  }));

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const resp = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.1,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: JSON.stringify(eventsForPrompt) },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`minimax HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    const body = await resp.json();
    const rawContent = body?.choices?.[0]?.message?.content ?? '';
    // M2.7 bäddar in resonemang i <think>…</think>. Plocka sedan ut första
    // [ ... ] (tål både ren JSON och ```json-fenced JSON).
    const content = rawContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const match = content.match(/\[[\s\S]*?\]/);
    if (!match) throw new Error(`minimax: no JSON array in response: ${content.slice(0, 200)}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch (e) {
      throw new Error(`minimax: invalid JSON: ${(e as Error).message} — body: ${match[0].slice(0, 200)}`);
    }
    if (!Array.isArray(parsed)) throw new Error('minimax: parsed value is not an array');
    const allowed = new Set<string>(UTFORSKA_SLUGS);
    const byId = new Map(events.map((e) => [e.id, e]));
    return (parsed as Array<Record<string, unknown>>)
      .filter((r) => r && typeof r.id === 'string' && typeof r.category === 'string')
      .map((r): Suggestion => {
        const id = r.id as string;
        const ev = byId.get(id);
        const proposed = r.category as string;
        const conf = typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence as number)) : 0;
        // Säkerhetsnät: om ej tillåten slug eller för låg conf → 'community'
        const newSlug = allowed.has(proposed) && conf >= LOW_CONF_FLOOR ? proposed : 'community';
        return {
          id,
          old_slug: ev?.category_slug ?? null,
          new_slug: newSlug,
          confidence: conf,
          reasoning: typeof r.reasoning === 'string' ? (r.reasoning as string).slice(0, 200) : '',
          title_hint: (ev?.title_sv ?? ev?.title_en ?? '').slice(0, 80),
        };
      });
  } finally {
    clearTimeout(tid);
  }
}

async function runWithPool<T, R>(items: T[], poolSize: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(poolSize, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function distribution(s: Suggestion[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of s) out[x.new_slug] = (out[x.new_slug] ?? 0) + 1;
  return out;
}

async function applyUpdates(plan: UpdatePlan[]): Promise<{ updated: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;
  let skipped = 0;

  for (const p of plan) {
    // Säkerhetskoll: hämta aktuell slug, jämför med plan.medvetet (förhindra race condition)
    const { data: cur } = await supabase
      .from('events')
      .select('id, category_slug')
      .eq('id', p.id)
      .maybeSingle();
    if (!cur) {
      skipped++;
      continue;
    }
    const actualOld = cur.category_slug ?? null;
    if (actualOld !== p.old_slug) {
      // Någon annan har redan ändrat — skippa (idempotens-skydd)
      skipped++;
      continue;
    }
    const { error } = await supabase
      .from('events')
      .update({ category_slug: p.new_slug })
      .eq('id', p.id);
    if (error) errors.push(`UPDATE ${p.id}: ${error.message}`);
    else updated++;
  }
  return { updated, skipped, errors };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1] ?? '0', 10) : undefined;

  console.log(`[recat-utforska] Modell: ${LLM_MODEL}  Apply: ${apply}  Limit: ${limit ?? '(none)'}`);
  console.log(`[recat-utforska] Tillåtna slugs: ${UTFORSKA_SLUGS.length} st`);
  console.log('[recat-utforska] Hämtar events utanför Utforska…');

  const events = await fetchNonUtforskaEvents(limit);
  console.log(`[recat-utforska] Hämtade ${events.length} events`);

  if (events.length === 0) {
    console.log('[recat-utforska] Inget att göra.');
    return;
  }

  // Fördelning av gamla slugs (audit)
  const oldDist: Record<string, number> = {};
  for (const e of events) {
    const k = e.category_slug ?? '__NULL__';
    oldDist[k] = (oldDist[k] ?? 0) + 1;
  }
  console.log('[recat-utforska] Gamla slugs (fördelning):');
  for (const [k, n] of Object.entries(oldDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} ${n}`);
  }

  const batches = chunk(events, BATCH_SIZE);
  console.log(`[recat-utforska] ${batches.length} batcher × ${BATCH_SIZE} events (max ${MAX_PARALLEL} parallella)`);

  let succeeded = 0;
  let failed = 0;
  const allSuggestions: Suggestion[] = [];

  await runWithPool(batches, MAX_PARALLEL, async (batch, i) => {
    try {
      const suggestions = await classifyBatch(batch);
      allSuggestions.push(...suggestions);
      succeeded++;
      const avgConf = suggestions.reduce((a, s) => a + s.confidence, 0) / Math.max(1, suggestions.length);
      console.log(`[recat-utforska] batch ${i + 1}/${batches.length} OK  ${suggestions.length} svar  medel-conf=${avgConf.toFixed(2)}`);
    } catch (err) {
      failed++;
      console.error(`[recat-utforska] batch ${i + 1}/${batches.length} FAIL: ${(err as Error).message.slice(0, 200)}`);
    }
  });

  if (allSuggestions.length === 0) {
    console.log('[recat-utforska] Inga svar — avbryter.');
    return;
  }

  // Audit: räkna events som inte fick svar (gap mellan batch-input och -output)
  const suggestedIds = new Set(allSuggestions.map((s) => s.id));
  const missing = events.filter((e) => !suggestedIds.has(e.id));
  if (missing.length > 0) {
    console.warn(`[recat-utforska] ⚠ ${missing.length} events fick inget svar (M2.7 batch-fel):`);
    for (const m of missing.slice(0, 5)) {
      console.warn(`  - ${m.id}  slug=${m.category_slug}  title=${(m.title_sv ?? m.title_en ?? '').slice(0, 60)}`);
    }
    if (missing.length > 5) console.warn(`  ... +${missing.length - 5} till`);
  }

  // Skriv JSONL backup ALLTID (även utan --apply) → audit-spår
  await mkdir(VAULT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outPath = join(VAULT_DIR, `recat-utforska-${today}.jsonl`);
  const lines = allSuggestions.map((s) => JSON.stringify(s));
  await writeFile(outPath, lines.join('\n') + '\n', 'utf8');
  console.log(`[recat-utforska] ✓ JSONL backup: ${outPath}  (${allSuggestions.length} rader)`);

  // Visa fördelning
  console.log('\n[recat-utforska] Nya slugs (fördelning):');
  for (const [cat, n] of Object.entries(distribution(allSuggestions)).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(20)} ${n}`);
  }

  const lowConf = allSuggestions.filter((s) => s.confidence < LOW_CONF_FLOOR).length;
  console.log(`\n[recat-utforska] Confidence < ${LOW_CONF_FLOOR} (→ tvingas 'community'): ${lowConf}`);

  if (!apply) {
    console.log('\n[recat-utforska] DRY-RUN — inga DB-mutationer. Kör med --apply för att skriva.');
    return;
  }

  // Apply
  console.log('\n[recat-utforska] ── APPLY MODE (DB-mutationer) ──');
  const plan: UpdatePlan[] = allSuggestions.map((s) => ({
    id: s.id,
    old_slug: s.old_slug,
    new_slug: s.new_slug,
    confidence: s.confidence,
    reasoning: s.reasoning,
  }));
  const result = await applyUpdates(plan);
  console.log(`[recat-utforska] UPDATE events.category_slug: ${result.updated}`);
  console.log(`[recat-utforska] Skippade (race / raderade): ${result.skipped}`);
  console.log(`[recat-utforska] Errors: ${result.errors.length}`);
  for (const e of result.errors.slice(0, 5)) console.log(`  - ${e}`);

  // Run-log
  const logPath = join(VAULT_DIR, `recat-utforska-run-${today}.md`);
  const summary = {
    date: today,
    model: LLM_MODEL,
    limit: limit ?? null,
    total_input: events.length,
    total_suggestions: allSuggestions.length,
    missing_count: missing.length,
    succeeded_batches: succeeded,
    failed_batches: failed,
    low_conf_forced_community: lowConf,
    apply: {
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.length,
    },
    old_distribution: oldDist,
    new_distribution: distribution(allSuggestions),
  };
  await writeFile(logPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  console.log(`[recat-utforska] ✓ Run-log: ${logPath}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[recat-utforska] FATAL:', msg);
  process.exit(1);
});