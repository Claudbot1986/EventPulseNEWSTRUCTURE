/**
 * dump-event-corpus.ts
 *
 * Engångs-script för Steg 1 av planen
 * "Stratifierade kategorier + Utforska-knappar" (2026-09-27).
 *
 * Syfte: läsa alla Stockholm-events från Supabase och skriva titel +
 * beskrivning (utom datum/tid) till en md-fil i vaulten, så vi kan läsa
 * igenom och identifiera naturliga kategorier för stratifiering.
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/dump-event-corpus.ts
 *
 * Output:
 *   00-Vault/01-Projects/EventPulse/04-Sources/event-corpus-2026-09-27.md
 *   (vault, inte git — enligt vault-protokollet)
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
  venue_id: string | null;
}

interface VenueRow {
  id: string;
  city: string | null;
}

const PAGE_SIZE = 1000;
const VAULT_DIR = join(
  process.cwd(),
  '00-Vault/01-Projects/EventPulse/04-Sources',
);
const OUTPUT_PATH = join(VAULT_DIR, 'event-corpus-2026-09-27.md');

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

function fail(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[dump] FATAL: ${msg}`);
  process.exit(1);
}

function pickText(sv: string | null, en: string | null): string {
  if (sv && sv.trim().length > 0) return sv;
  if (en && en.trim().length > 0) return en;
  return '';
}

function escapeMd(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}

function isStockholmEvent(
  event: EventRow,
  venueCityById: Map<string, string>,
): boolean {
  if (event.venue_id) {
    const city = venueCityById.get(event.venue_id);
    if (city) return city.toLowerCase().includes('stockholm');
    // events med venue_id men utan city i DB → inkludera ändå
    return true;
  }
  // events utan venue_id → inkludera (kan vara online/oklassificerade)
  return true;
}

async function fetchAllEvents(): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select(
        'id, title_sv, title_en, description_sv, description_en, category_slug, source, venue_id',
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

async function fetchVenueCityMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('venues')
      .select('id, city')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) fail(`Supabase venues fetch failed: ${error.message}`);
    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }
    for (const v of data as VenueRow[]) {
      if (v.city) map.set(v.id, v.city);
    }
    hasMore = data.length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  return map;
}

function buildMarkdown(
  events: EventRow[],
  venueCityById: Map<string, string>,
): { md: string; stockholmCount: number; categories: string[] } {
  const stockholm = events.filter((e) => isStockholmEvent(e, venueCityById));

  const byCategory = new Map<string, EventRow[]>();
  for (const e of stockholm) {
    const cat = e.category_slug ?? '(no category)';
    const bucket = byCategory.get(cat);
    if (bucket) bucket.push(e);
    else byCategory.set(cat, [e]);
  }

  const sortedCats = Array.from(byCategory.keys()).sort();

  const lines: string[] = [];
  lines.push('# EventPulse — event-corpus (Stockholm)');
  lines.push('');
  lines.push(`Genererad: ${new Date().toISOString()}`);
  lines.push(`Totalt antal events: ${stockholm.length}`);
  lines.push(`Antal unika kategorier: ${sortedCats.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(
    'Varje event visas som titel + beskrivning (första icke-null mellan sv/en).',
  );
  lines.push(
    'Datum, tid, venue, pris och andra fält är utelämnade — fokus är textinnehållet.',
  );
  lines.push('');
  lines.push('Använd detta corpus för att identifiera naturliga underkategorier.');
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const cat of sortedCats) {
    const evs = byCategory.get(cat) ?? [];
    lines.push(`## Kategori: \`${cat}\` (${evs.length} events)`);
    lines.push('');
    for (const e of evs) {
      const title = pickText(e.title_sv, e.title_en);
      const desc = pickText(e.description_sv, e.description_en);
      lines.push(`### ${escapeMd(title) || '(no title)'}`);
      lines.push('');
      if (desc) {
        lines.push(escapeMd(desc));
      } else {
        lines.push('_(ingen beskrivning)_');
      }
      lines.push('');
      lines.push(
        `<sub>event: \`${e.id}\` · source: \`${e.source ?? '?'}\` · category: \`${e.category_slug ?? 'null'}\`</sub>`,
      );
      lines.push('');
    }
  }

  return { md: lines.join('\n'), stockholmCount: stockholm.length, categories: sortedCats };
}

async function main(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail(
      'SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas i env. Kör via --env-file=.env eller exportera manuellt.',
    );
  }

  // eslint-disable-next-line no-console
  console.error('[dump] fetching events from Supabase...');
  const events = await fetchAllEvents();
  // eslint-disable-next-line no-console
  console.error(`[dump] fetched ${events.length} events total`);

  // eslint-disable-next-line no-console
  console.error('[dump] fetching venue → city map...');
  const venueCity = await fetchVenueCityMap();
  // eslint-disable-next-line no-console
  console.error(`[dump] venue map size: ${venueCity.size}`);

  const { md, stockholmCount, categories } = buildMarkdown(events, venueCity);

  await mkdir(VAULT_DIR, { recursive: true });
  await writeFile(OUTPUT_PATH, md, 'utf-8');

  // eslint-disable-next-line no-console
  console.error('');
  // eslint-disable-next-line no-console
  console.error(`[dump] wrote ${OUTPUT_PATH}`);
  // eslint-disable-next-line no-console
  console.error(
    `[dump] ${stockholmCount} Stockholm events across ${categories.length} categories`,
  );
  // eslint-disable-next-line no-console
  console.error('[dump] categories:');
  for (const c of categories) {
    // eslint-disable-next-line no-console
    console.error(`  - ${c}`);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  fail(msg);
});