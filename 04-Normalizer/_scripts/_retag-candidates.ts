/**
 * retag-candidates.ts — Förbered Steg 3.4 re-tagging.
 *
 * Listar events som behöver re-tagging (community eller music som enda
 * kategori) och skriver dem till en markdown-fil i vaultet som ett
 * granskningsunderlag. Gör INGA DB-mutationer.
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/retag-candidates.ts
 *
 * Output:
 *   00-Vault/01-Projects/EventPulse/04-Sources/retag-candidates-2026-09-27.md
 *
 * Nästa steg (Steg 3.4):
 *   1. Granska listan manuellt (eller kör LLM-batch på titel + description)
 *   2. Skapa ett apply-retag.ts som uppdaterar events.category_slug + event_categories
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
}

const PAGE = 1000;
const VAULT_DIR = join(process.cwd(), '00-Vault/01-Projects/EventPulse/04-Sources');

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function fetchRetagCandidates(): Promise<EventRow[]> {
  // Plan Steg 3.4: re-tagging fokuserar på community-högen (1440 events).
  // Musik (2452) utelämnas — kräver Steg 3.5 (artist-tillägg) först.
  const rows: EventRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select('id, title_sv, title_en, description_sv, description_en, category_slug, source, start_time')
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

async function main() {
  await mkdir(VAULT_DIR, { recursive: true });
  const events = await fetchRetagCandidates();
  const today = new Date().toISOString().slice(0, 10);
  const out: string[] = [];
  out.push(`# Re-tag kandidater — ${today}`);
  out.push('');
  out.push(`Totalt: **${events.length}** events med category_slug='community'.`);
  out.push('');
  out.push(`Genererat av \`04-Normalizer/_scripts/retag-candidates.ts\`. Inga DB-mutationer.`);
  out.push('');
  out.push('## Första 50 (stickprov)');
  out.push('');
  out.push('| Titel (sv) | Källa | Start |');
  out.push('|---|---|---|');
  for (const e of events.slice(0, 50)) {
    const t = (e.title_sv ?? e.title_en ?? '—').replace(/\|/g, '¦').slice(0, 60);
    out.push(`| ${t} | ${e.source ?? '—'} | ${e.start_time?.slice(0, 10) ?? '—'} |`);
  }
  out.push('');
  out.push(`## Nästa steg (Steg 3.4)`);
  out.push('');
  out.push('1. Kör LLM-batch (MiniMax-M2.7) på titel + description → föreslå multi-label');
  out.push('2. Granska förslag i batch om 50 (manuell review)');
  out.push('3. Skriv tillbaka via `apply-retag.ts` (uppdaterar events.category_slug + event_categories)');
  out.push('');
  out.push('**OBS:** Musik-genrer (pop-rock/jazz/classical/etc.) är inte redo — kräver Steg 3.5 (artist-tillägg).');
  out.push(`Re-tagging i detta steg begränsas till community-högen (${events.length} st).`);

  const outPath = join(VAULT_DIR, `retag-candidates-${today}.md`);
  await writeFile(outPath, out.join('\n'), 'utf8');
  console.log(`✅ ${events.length} events skrivna till ${outPath}`);
}

main().catch((err) => {
  console.error('[retag-candidates] FATAL:', err.message);
  process.exit(1);
});
