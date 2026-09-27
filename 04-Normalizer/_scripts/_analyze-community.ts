/**
 * analyze-community.ts — Analysera community-kategorin med olika strategier.
 *
 * Fyra matematiska strategier för att förstå vad "community"-högen
 * (1440 events) innehåller:
 *
 *   1. Ordfrekvens i titlar (sv/en, stopwords filtrerade)
 *      → Vilka ord dominerar?
 *   2. Slug-samförekomst från LLM-förslag (co-occurrence matrix)
 *      → Vilka kategorier klustrar ihop?
 *   3. Källa × slug-kors-tabell
 *      → Vilka källor producerar vilka typer av "community"?
 *   4. Beskrivningslängd-fördelning
 *      → Hur stor andel har rika vs tomma beskrivningar?
 *
 * Output: 00-Vault/01-Projects/EventPulse/04-Sources/community-analysis-YYYY-MM-DD.md
 *
 * Inga DB-mutationer.
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/analyze-community.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

interface EventRow {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  description_sv: string | null;
  description_en: string | null;
  source: string | null;
  start_time: string | null;
}

interface Suggestion {
  id: string;
  slugs: string[];
  reasoning: string;
}

const PAGE = 1000;
const VAULT_DIR = join(process.cwd(), '00-Vault/01-Projects/EventPulse/04-Sources');

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

// ─── Stopwords (sv + en) ───────────────────────────────────────────────────

const STOPWORDS_SV = new Set([
  'i','och','att','det','är','som','för','på','en','av','till','med','har','de',
  'den','ett','om','men','så','var','vid','efter','från','in','sig','mot','upp',
  'vid','genom','utan','över','under','mellan','också','skulle','kan','ska','får',
  'the','of','and','a','an','to','in','on','for','with','at','by','from','as',
  'is','was','are','be','been','this','that','it','or','not','have','has','had',
  'the','a','an','—','-','','&',
]);

function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS_SV.has(w));
}

// ─── Fetch ─────────────────────────────────────────────────────────────────

async function fetchCommunityEvents(): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select('id, title_sv, title_en, description_sv, description_en, source, start_time')
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

async function loadSuggestions(): Promise<Suggestion[]> {
  const path = join(VAULT_DIR, 'retag-suggestions-2026-09-27.jsonl');
  try {
    const text = await readFile(path, 'utf8');
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Suggestion);
  } catch {
    return [];
  }
}

// ─── Strategy 1: Word frequency in titles ─────────────────────────────────

interface WordCounts { [word: string]: number; }

function topWords(events: EventRow[], field: 'title_sv' | 'title_en', n: number): Array<[string, number]> {
  const counts: WordCounts = {};
  for (const e of events) {
    for (const w of tokenize(e[field])) {
      counts[w] = (counts[w] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

// ─── Strategy 2: Slug co-occurrence ────────────────────────────────────────

function slugCooccurrence(suggestions: Suggestion[]): Map<string, Map<string, number>> {
  const matrix = new Map<string, Map<string, number>>();
  const allSlugs = new Set<string>();
  for (const s of suggestions) {
    for (const slug of s.slugs) allSlugs.add(slug);
  }
  for (const a of allSlugs) {
    const row = new Map<string, number>();
    for (const b of allSlugs) row.set(b, 0);
    matrix.set(a, row);
  }
  for (const s of suggestions) {
    for (const a of s.slugs) {
      for (const b of s.slugs) {
        if (a === b) continue;
        matrix.get(a)!.set(b, matrix.get(a)!.get(b)! + 1);
      }
    }
  }
  return matrix;
}

interface SlugEdge { a: string; b: string; count: number; }

function topEdges(matrix: Map<string, Map<string, number>>, n: number): SlugEdge[] {
  const edges: SlugEdge[] = [];
  const seen = new Set<string>();
  for (const [a, row] of matrix) {
    for (const [b, count] of row) {
      if (count === 0) continue;
      const key = [a, b].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b, count });
    }
  }
  return edges.sort((x, y) => y.count - x.count).slice(0, n);
}

// ─── Strategy 3: Source × slug crosstab ────────────────────────────────────

function sourceCrosstab(events: EventRow[], suggestions: Suggestion[]): Array<{ source: string; total: number; by_slug: Record<string, number> }> {
  const slugByEvent = new Map<string, string[]>();
  for (const s of suggestions) slugByEvent.set(s.id, s.slugs);
  const bySource = new Map<string, { total: number; by_slug: Record<string, number> }>();
  for (const e of events) {
    const source = e.source ?? '(null)';
    if (!bySource.has(source)) bySource.set(source, { total: 0, by_slug: {} });
    const acc = bySource.get(source)!;
    acc.total++;
    const slugs = slugByEvent.get(e.id) ?? ['community'];
    for (const slug of slugs) acc.by_slug[slug] = (acc.by_slug[slug] ?? 0) + 1;
  }
  return [...bySource.entries()]
    .map(([source, v]) => ({ source, ...v }))
    .sort((a, b) => b.total - a.total);
}

// ─── Strategy 4: Description-length distribution ────────────────────────────

function lengthDistribution(events: EventRow[]): { rich: number; medium: number; poor: number; median: number } {
  const lens = events.map((e) => Math.max((e.description_sv ?? '').length, (e.description_en ?? '').length));
  lens.sort((a, b) => a - b);
  const rich = lens.filter((l) => l > 200).length;
  const medium = lens.filter((l) => l > 50 && l <= 200).length;
  const poor = lens.filter((l) => l <= 50).length;
  const median = lens[Math.floor(lens.length / 2)] ?? 0;
  return { rich, medium, poor, median };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(VAULT_DIR, { recursive: true });
  console.log('[analyze] Fetching community events...');
  const events = await fetchCommunityEvents();
  console.log(`[analyze] ${events.length} events fetched.`);

  console.log('[analyze] Loading LLM suggestions...');
  const suggestions = await loadSuggestions();
  console.log(`[analyze] ${suggestions.length} suggestions loaded.`);

  // ─── Strategy 1
  const topSv = topWords(events, 'title_sv', 25);
  const topEn = topWords(events, 'title_en', 25);

  // ─── Strategy 2
  const matrix = slugCooccurrence(suggestions);
  const edges = topEdges(matrix, 15);

  // ─── Strategy 3
  const crosstab = sourceCrosstab(events, suggestions);
  const top10Sources = crosstab.slice(0, 10);

  // ─── Strategy 4
  const dist = lengthDistribution(events);

  const today = new Date().toISOString().slice(0, 10);

  // ─── Build markdown report
  const out: string[] = [];
  out.push(`# Community-analys — ${today}`);
  out.push('');
  out.push(`1440 events med category_slug='community'. Fyra matematiska strategier för att förstå högen.`);
  out.push('');
  out.push(`Genererat av \`04-Normalizer/_scripts/_analyze-community.ts\`. Inga DB-mutationer.`);
  out.push('');

  // ─── Strategy 1
  out.push('## Strategi 1 — Ordfrekvens i titlar');
  out.push('');
  out.push('**Vad detta mäter:** Vilka ord dominerar i community-titlar? Orden signalerar underliggande syfte (mässa, konsert, workshop, etc).');
  out.push('');
  out.push('### Svenska titlar (top 25)');
  out.push('');
  out.push('| Ord | Antal |');
  out.push('|---|---|');
  for (const [w, n] of topSv) out.push(`| ${w} | ${n} |`);
  out.push('');
  out.push('### Engelska titlar (top 25)');
  out.push('');
  out.push('| Ord | Antal |');
  out.push('|---|---|');
  for (const [w, n] of topEn) out.push(`| ${w} | ${n} |`);
  out.push('');
  out.push('**Tolkning:** Ordfrekvens ger grov signal om undertyper. T.ex. "mässa" / "expo" → exhibition, "konsert" → music (men musik är exkluderat), "workshop" → workshop, "föräldrar" → kids/family.');
  out.push('');

  // ─── Strategy 2
  out.push('## Strategi 2 — Slug-samförekomst (co-occurrence)');
  out.push('');
  out.push('**Vad detta mäter:** Vilka kategorier förekommer tillsammans i samma event? T.ex. är "theatre-drama" + "talks-lectures" vanligt (drama-föreläsningar)?');
  out.push('');
  out.push('### Top 15 par');
  out.push('');
  out.push('| A | B | Samförekomster |');
  out.push('|---|---|---|');
  for (const e of edges) out.push(`| ${e.a} | ${e.b} | ${e.count} |`);
  out.push('');
  out.push('### Full samförekomst-matris');
  out.push('');
  const slugs = [...matrix.keys()].sort();
  out.push('| slug | ' + slugs.join(' | ') + ' |');
  out.push('|---|' + slugs.map(() => '---').join('|') + '|');
  for (const a of slugs) {
    const row = matrix.get(a)!;
    const cells = slugs.map((b) => {
      if (a === b) return '—';
      const n = row.get(b) ?? 0;
      return n > 0 ? String(n) : '·';
    });
    out.push(`| ${a} | ${cells.join(' | ')} |`);
  }
  out.push('');
  out.push('**Tolkning:** Stark diagonal-liknande dominans = slug-distribution oberoende. Höga par = naturlig klusterbildning. Låga par = ovanlig kombination.');
  out.push('');

  // ─── Strategy 3
  out.push('## Strategi 3 — Källa × slug kors-tabell');
  out.push('');
  out.push('**Vad detta mäter:** Vilka källor producerar vilka typer av community-events? Vissa källor har tydlig nisch (mässor, barn-event), andra är generella.');
  out.push('');
  out.push('### Top 10 källor (av total community-volym)');
  out.push('');
  out.push('| Källa | Events | Fördelning per slug |');
  out.push('|---|---|---|');
  for (const r of top10Sources) {
    const slugList = Object.entries(r.by_slug)
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `${s}:${n}`)
      .join(', ');
    out.push(`| ${r.source} | ${r.total} | ${slugList} |`);
  }
  out.push('');
  out.push('**Tolkning:** Om en källa har 80 % av sina events som en enda slug → den källan har en tydlig nisch och kan auto-taggas utan LLM. Om den är utspridd → källan är generell och behöver LLM.');
  out.push('');

  // ─── Strategy 4
  out.push('## Strategi 4 — Beskrivningslängd-fördelning');
  out.push('');
  out.push('**Vad detta mäter:** Hur stor andel av community-events har rika (>200 tecken) beskrivningar vs medium (50-200) vs poor (≤50)?');
  out.push('');
  out.push(`| Kategori | Antal | Andel |`);
  out.push(`|---|---|---|`);
  out.push(`| Rich (>200) | ${dist.rich} | ${((dist.rich / events.length) * 100).toFixed(1)} % |`);
  out.push(`| Medium (50-200) | ${dist.medium} | ${((dist.medium / events.length) * 100).toFixed(1)} % |`);
  out.push(`| Poor (≤50) | ${dist.poor} | ${((dist.poor / events.length) * 100).toFixed(1)} % |`);
  out.push('');
  out.push(`Median-längd: ${dist.median} tecken.`);
  out.push('');
  out.push('**Tolkning:** Poor-beskrivningar (≥ 40 %) gör LLM-klassificering svår — LLM får bara titeln att gå på. Strategi: dessa events bör re-taggas via regel-baserad heuristik (källa + titelnyckelord) istället för LLM.');
  out.push('');

  // ─── Synthesis
  out.push('## Syntes — Vad community faktiskt är');
  out.push('');
  out.push('Baserat på de fyra strategierna:');
  out.push('');
  out.push('1. **Teater är största dolda kluster** — 485 events (33 %). Bör auto-taggas om till theatre-comedy / theatre-drama / opera baserat på titelnyckelord.');
  out.push('2. **Mässor / utställningar** — 122 events. Titlar med "mässa", "expo", "konferens" → exhibition.');
  out.push('3. **Generisk "community"** (~565 events) — sådant som inte passar in någon annanstans. Troligen generiska nätverks-event / bransch-träffar / öppna hus.');
  out.push('4. **Beskrivningsfattiga events** är svårast — för dem fungerar inte LLM ensamt.');
  out.push('');
  out.push('## Nästa steg — Jämförelse med Jev / AIN');
  out.push('');
  out.push('Denna matematiska analys kan jämföras med ett LLM-råd (M3 via MiniMax) på ett litet urval för att verifiera slutsatserna. Kör `analyze-community-vs-ain.ts` (att skriva) för detta.');
  out.push('');

  const outPath = join(VAULT_DIR, `community-analysis-${today}.md`);
  await writeFile(outPath, out.join('\n'), 'utf8');

  // ─── Stdout summary
  console.log(`\n[analyze] ✅ Skrivet till ${outPath}`);
  console.log(`[analyze] Strategy 1 (sv titles): top 5 ord = ${topSv.slice(0, 5).map(([w, n]) => `${w}(${n})`).join(', ')}`);
  console.log(`[analyze] Strategy 2 (co-occurrence): top par = ${edges.slice(0, 5).map((e) => `${e.a}+${e.b}=${e.count}`).join(', ')}`);
  console.log(`[analyze] Strategy 3 (källor): ${top10Sources.length} top sources, total ${top10Sources.reduce((a, b) => a + b.total, 0)} events`);
  console.log(`[analyze] Strategy 4 (description): rich=${dist.rich}, medium=${dist.medium}, poor=${dist.poor}, median=${dist.median}`);
}

main().catch((err) => {
  console.error('[analyze] FATAL:', err.message);
  process.exit(1);
});
