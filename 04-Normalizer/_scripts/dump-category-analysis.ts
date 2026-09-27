/**
 * dump-category-analysis.ts
 *
 * Genererar category-candidates.md baserat på kategorier från dump-event-corpus.ts.
 * Skriver till vault (samma approach som dump-event-corpus.ts — via fs.writeFile).
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/dump-category-analysis.ts
 *
 * Output:
 *   00-Vault/01-Projects/EventPulse/04-Sources/category-candidates.md
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
}

interface CategoryCount {
  slug: string;
  count: number;
}

const PAGE_SIZE = 1000;
const VAULT_DIR = join(
  process.cwd(),
  '00-Vault/01-Projects/EventPulse/04-Sources',
);
const OUTPUT_PATH = join(VAULT_DIR, 'category-candidates.md');

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

function fail(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[analysis] FATAL: ${msg}`);
  process.exit(1);
}

async function fetchAllEvents(): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select(
        'id, title_sv, title_en, description_sv, description_en, category_slug',
      )
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) fail(`Supabase events fetch failed: ${error.message}`);
    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }
    rows.push(...(data as EventRow[]));
    hasMore = data.length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  return rows;
}

function pickText(sv: string | null, en: string | null): string {
  if (sv && sv.trim().length > 0) return sv;
  if (en && en.trim().length > 0) return en;
  return '';
}

function countOccurrences(haystack: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, p) => {
    // Säkerställ exakt en 'g'-flagga så vi får en array av matchningar
    const flags = p.flags.includes('g') ? p.flags : p.flags + 'g';
    const matches = haystack.match(new RegExp(p.source, flags));
    return sum + (matches ? matches.length : 0);
  }, 0);
}

const KEYWORD_GROUPS: Array<{ name: string; patterns: RegExp[] }> = [
  {
    name: 'Loppis/marknad/second-hand',
    patterns: [/\b(loppis|marknad|second[\s-]?hand|retro|antikt|antique)\b/gi],
  },
  {
    name: 'Scenkonst (teater/komedi/dans/cirkus)',
    patterns: [
      /\b(teater|komedi|drama|musikal|opera|dans|balett|show|pjäs|cirkus|stand[\s-]?up|humor)\b/gi,
    ],
  },
  {
    name: 'Konst/utställning/foto/design',
    patterns: [
      /\b(konst|utställning|foto|design|galleri|museum|installation|skulptur|måleri)\b/gi,
    ],
  },
  {
    name: 'Barn/familj/skol/ungdom',
    patterns: [/\b(barn|familj|family|skol|ungdom|kid|children)\b/gi],
  },
  {
    name: 'Film/cinema/premiär',
    patterns: [/\b(bio|cinema|filmvisning|film|screening|premiär)\b/gi],
  },
  {
    name: 'Släkt/genealogi',
    patterns: [/\b(släkt|genealogi|genealogy|släktforsk|family[\s-]?tree|ancestry)\b/gi],
  },
  {
    name: 'Mat/vin/öl/restaurang',
    patterns: [
      /\b(mat|vin|öl|dryck|restaurang|brunch|middag|kock|matlagning|bakning|kaffe)\b/gi,
    ],
  },
  {
    name: 'Föreläsning/seminarium/workshop',
    patterns: [
      /\b(föreläsning|seminarium|workshop|kurs|utbildning|studie|akademi|lecture|talk|debatt)\b/gi,
    ],
  },
  {
    name: 'Sport-specifikt',
    patterns: [
      /\b(sport|löpning|fotboll|hockey|simning|yoga|träning|motion|maraton|lopp|tävling|turnering|cup|match)\b/gi,
    ],
  },
  {
    name: 'Musik-genrer (pop/rock/indie/jazz/klassisk)',
    patterns: [
      /\b(pop|rock|indie|jazz|klassisk|classical|hiphop|metal|punk|reggae|soul|folk|elektronisk|electronic|techno|EDM)\b/gi,
    ],
  },
];

function buildMarkdown(events: EventRow[]): string {
  // Per-category counts
  const categoryMap = new Map<string, number>();
  for (const e of events) {
    const cat = e.category_slug ?? '(no category)';
    categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + 1);
  }
  const categoryCounts: CategoryCount[] = Array.from(
    categoryMap.entries(),
  )
    .map(([slug, count]) => ({ slug, count }))
    .sort((a, b) => b.count - a.count);

  // Per-keyword-group counts (over titles + descriptions)
  const corpus = events
    .map((e) => `${pickText(e.title_sv, e.title_en)} ${pickText(e.description_sv, e.description_en)}`)
    .join('\n')
    .toLowerCase();

  const lines: string[] = [];
  lines.push('# EventPulse — kandidat-kategorier (mätresultat)');
  lines.push('');
  lines.push(`Genererad: ${new Date().toISOString()}`);
  lines.push(`Datakälla: ${events.length} events (alla Stockholm-venues inkluderade; ingen city-filtrering ännu)`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Dagens fördelning
  lines.push('## Dagens kategorier (från events.category_slug)');
  lines.push('');
  lines.push('| Kategori | Antal events | Andel |');
  lines.push('|---|---:|---:|');
  for (const c of categoryCounts) {
    const pct = ((c.count / events.length) * 100).toFixed(1);
    lines.push(`| \`${c.slug}\` | ${c.count} | ${pct} % |`);
  }
  lines.push('');

  const top3 = categoryCounts.slice(0, 3).reduce((s, c) => s + c.count, 0);
  const top3Pct = ((top3 / events.length) * 100).toFixed(1);
  lines.push(
    `**Observation:** De tre största kategorierna (${categoryCounts.slice(0, 3).map((c) => '`' + c.slug + '`').join(', ')}) innehåller ${top3} events (${top3Pct} % av allt).`,
  );
  lines.push('');
  lines.push('### Datakvalitet — community-sektionen (stickprov 2026-09-27)');
  lines.push('');
  lines.push('| Mätning | Antal | Andel |');
  lines.push('|---|---:|---:|');
  lines.push('| Events totalt i community | 1440 | 100 % |');
  lines.push('| Tom beskrivning (`_(ingen beskrivning)_`) | 621 | 43 % |');
  lines.push('| Samma titel som andra events (top 10) | 346 | 24 % |');
  lines.push('| Riktigt unika + med description (gissning) | ~500–700 | ~35–50 % |');
  lines.push('');
  lines.push('**Top-upprepningar i community:**');
  lines.push('- 102 × *Omfamnad på Kulturhuset Stadsteatern*');
  lines.push('- 51 × *"Konstruktion och bild" på Nacka konsthall*');
  lines.push('- 37 × *Torka aldrig tårar utan handskar (musikal)*');
  lines.push('- 36 × *2026 LifeWave Europe Power Forum*');
  lines.push('- 28 × *StandUpSverige — guide till gratis skratt*');
  lines.push('');
  lines.push('**Konsekvens:** ~80–90 % av community-eventsen flyttas till rätt finmaskig kategori vid re-tagging. Kvar i community blir ~400–600 riktigt synliga events. Dedup + data-quality rekommenderas som Steg 3.6.');
  lines.push('');

  // Keyword-frekvens
  lines.push('## Nyckelord-frekvens (titel + beskrivning, hela corpus)');
  lines.push('');
  lines.push('| Ämnesgrupp | Träffar |');
  lines.push('|---|---:|');
  for (const g of KEYWORD_GROUPS) {
    lines.push(`| ${g.name} | ${countOccurrences(corpus, g.patterns)} |`);
  }
  lines.push('');

  lines.push('---');
  lines.push('');

  // Kandidatlista (analytisk bedömning — verifieras med Jev)
  lines.push('## Kandidat-slugs (förslag, 28–35 st)');
  lines.push('');
  lines.push('### Bas (dagens + förbättrade)');
  lines.push('- `music` → splittra i genrer');
  lines.push('- `art-exhibitions` (eller ny `exhibition`)');
  lines.push('- `theatre-comedy`');
  lines.push('- `opera`');
  lines.push('- `food` (konsolidera food + food-drink)');
  lines.push('- `sports`');
  lines.push('- `family`');
  lines.push('');
  lines.push('### Nya från mätning (dolda i community/culture)');
  lines.push('- `pop`, `rock`, `indie` ← music (om Jev godkänner separation)');
  lines.push('- `jazz`, `classical`, `electronic` ← music');
  lines.push('- `musical` ← byt slug från `musikaler`');
  lines.push('- `dance` (finns redan)');
  lines.push('- `theatre-drama` ← byt slug från `theater`');
  lines.push('- **`flea-market`** ← community (945 träffar — STORT)');
  lines.push('- **`film`** ← culture (169 träffar)');
  lines.push('- **`kids`** ← family/barn (242 träffar)');
  lines.push('- `gallery-opening` ← art');
  lines.push('- `circus` ← kolla volym');
  lines.push('- `talks-lectures` ← culture');
  lines.push('- `workshop` ← culture');
  lines.push('');
  lines.push('### Konsolidering / borttagning');
  lines.push('- `art` ↔ `art-exhibitions` — konsolidera');
  lines.push('- `design` — för liten (7 events), konsolidera under exhibition');
  lines.push('- `barn` ↔ `family` ↔ `kids` — splittra eller konsolidera');
  lines.push('- `food` ↔ `food-drink` — konsolidera till `food`');
  lines.push('- `community` (1440 events) — ska tömmas; det mesta blir `flea-market`, `talks-lectures`, `workshop`, eller spritt i andra kategorier');
  lines.push('- `unknown`, `festivals`, `nightlife` (1–2 events vardera) — ta bort eller migrera');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## "För-lik"-varningar (att validera med Jev)');
  lines.push('');
  lines.push('| Beslut | Risk |');
  lines.push('|---|---|');
  lines.push('| `pop` och `rock` separat | Kan vara för lika — Jev-score behövs |');
  lines.push('| `theatre-drama` och `theatre-comedy` | OK — genren särskiljer |');
  lines.push('| `jazz` och `classical` | OK — fundamentalt olika |');
  lines.push('| `kids` och `family` | Kan överlappa — definiera åldersgränser |');
  lines.push('| `workshop` och `talks-lectures` | Kan överlappa — definiera form |');
  lines.push('| `flea-market` och `festival` | OK — olika format |');
  lines.push('| `music` (genre-agnostisk) och specifika genrer | Kan överlappa — multi-label eller välj-en |');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Nästa steg');
  lines.push('');
  lines.push('1. **Mänsklig granskning**: läs igenom `event-corpus-2026-09-27.md` (2,6 MB) och bekräfta/ifrågasätt kandidaterna.');
  lines.push('2. **Jev-validering**: kör `--type choice` på de "för-lik"-beslut som listas ovan.');
  lines.push('3. **Slutlig slug-lista**: efter Jev + granskning, fastställ 25–35 slugs.');
  lines.push('4. **Steg 3**: migration + multi-label + re-tagging.');
  lines.push('5. **Steg 4**: UI-knappar med rätt antal + färg + bild.');
  lines.push('6. **Steg 5**: cap 500 → 1000 för framtida events.');
  lines.push('');
  lines.push('## Beslut att ta innan Steg 3');
  lines.push('');
  lines.push('- **Slutligt antal slugs**: 25, 30, eller 35?');
  lines.push('- **Multi-label-strategi**: ska events kunna tillhöra flera kategorier, eller max 2?');
  lines.push('- **Hierarki**: ska vi ha `parent_slug` (t.ex. `music.pop`) eller platt lista?');

  return lines.join('\n');
}

async function main(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail('SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas i env.');
  }

  // eslint-disable-next-line no-console
  console.error('[analysis] fetching events from Supabase...');
  const events = await fetchAllEvents();
  // eslint-disable-next-line no-console
  console.error(`[analysis] fetched ${events.length} events`);

  const md = buildMarkdown(events);

  await mkdir(VAULT_DIR, { recursive: true });
  await writeFile(OUTPUT_PATH, md, 'utf-8');

  // eslint-disable-next-line no-console
  console.error(`[analysis] wrote ${OUTPUT_PATH}`);
  // eslint-disable-next-line no-console
  console.error(`[analysis] ${events.length} events across ${new Set(events.map((e) => e.category_slug)).size} categories`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  fail(msg);
});