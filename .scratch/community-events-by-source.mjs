/**
 * community-events-by-source.mjs — Inspektera 1440 community-events.
 *
 * Hämtar alla events med category_slug='community', grupperar per källa,
 * tar 3 stickprov per källa, och skriver en markdown-rapport till vault.
 *
 * Användning:
 *   node --env-file=.env .scratch/community-events-by-source.mjs
 *
 * Output:
 *   00-Vault/01-Projects/EventPulse/04-Sources/community-events-by-source-YYYY-MM-DD.md
 *
 * Skriver UTÖVER markdown till stdout för direkt inspektering.
 */

import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PAGE = 1000;
const SAMPLES_PER_SOURCE = 3;
const TODAY = new Date().toISOString().slice(0, 10);
const VAULT_DIR = join(process.cwd(), '00-Vault/01-Projects/EventPulse/04-Sources');

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

// ─── Hämta alla community-events ─────────────────────────────────────────

async function fetchCommunityEvents() {
  const rows = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select(`
        id, title_sv, title_en, description_sv, description_en,
        source, source_id, ticket_url, image_url,
        venue_id, lat, lng,
        start_time, end_time,
        is_free, price_min_sek, price_max_sek,
        category_slug, dedup_hash, status, updated_at
      `)
      .eq('category_slug', 'community')
      .order('start_time', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetch error: ${error.message}`);
    if (data && data.length > 0) {
      rows.push(...data);
      offset += data.length;
      hasMore = data.length === PAGE;
    } else {
      hasMore = false;
    }
  }
  return rows;
}

// ─── Hämta venue-namn för uppslagning ────────────────────────────────────

async function fetchVenuesMap() {
  const map = new Map();
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('venues')
      .select('id, name')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`venues fetch error: ${error.message}`);
    if (data && data.length > 0) {
      for (const v of data) map.set(v.id, v.name);
      offset += data.length;
      hasMore = data.length === PAGE;
    } else {
      hasMore = false;
    }
  }
  return map;
}

// ─── Hämta LLM-förslag från senaste v2-filen ────────────────────────────

async function loadLLMSuggestions() {
  const candidates = [
    `retag-suggestions-v2-${TODAY}.jsonl`,
    `retag-suggestions-v2-2026-09-27.jsonl`,
    `retag-suggestions-2026-09-27.jsonl`,
  ];
  for (const name of candidates) {
    try {
      const text = await readFile(join(VAULT_DIR, name), 'utf8');
      const out = new Map();
      for (const line of text.split('\n').filter(Boolean)) {
        try {
          const obj = JSON.parse(line);
          out.set(obj.id, obj);
        } catch {}
      }
      if (out.size > 0) {
        console.error(`[info] Laddade ${out.size} LLM-förslag från ${name}`);
        return out;
      }
    } catch {}
  }
  return new Map();
}

// ─── Hjälpare ────────────────────────────────────────────────────────────

function extractDomain(url) {
  if (!url) return null;
  try { return new URL(url).hostname; } catch { return null; }
}

function homepageGuess(ticketUrl) {
  if (!ticketUrl) return null;
  try {
    const u = new URL(ticketUrl);
    // Vanligt: /events/, /e/, /sv-SE/event/, etc. — gå till root.
    return `${u.protocol}//${u.hostname}/`;
  } catch { return null; }
}

function truncate(s, n) {
  if (!s) return null;
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function pipeSafe(s) {
  if (!s) return '—';
  return s.replace(/\|/g, '¦').replace(/\n/g, ' ');
}

function chooseSamples(events, n) {
  // Sprid över tiden — ta första, mittersta, sista per source (om möjligt).
  const sorted = [...events].sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''));
  if (sorted.length <= n) return sorted;
  const out = [];
  const indices = new Set();
  indices.add(0);
  indices.add(Math.floor(sorted.length / 2));
  indices.add(sorted.length - 1);
  for (const i of [...indices].slice(0, n).sort((a, b) => a - b)) {
    out.push(sorted[i]);
  }
  // Fyll på om för få
  while (out.length < n && out.length < sorted.length) {
    const next = sorted[out.length * 3];
    if (!out.includes(next)) out.push(next);
    else break;
  }
  return out;
}

// ─── Huvudfunktion ──────────────────────────────────────────────────────

async function main() {
  console.error('[info] Hämtar community-events…');
  const events = await fetchCommunityEvents();
  console.error(`[info] ${events.length} events totalt`);

  console.error('[info] Hämtar venue-namn…');
  const venues = await fetchVenuesMap();
  console.error(`[info] ${venues.size} venues i kartan`);

  console.error('[info] Laddar LLM-förslag…');
  const llm = await loadLLMSuggestions();

  // Gruppera per source
  const bySource = new Map();
  for (const e of events) {
    const src = e.source ?? '(null)';
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(e);
  }

  // Sortera sources efter antal events fallande
  const sourcesSorted = [...bySource.entries()]
    .map(([source, evts]) => ({ source, events: evts }))
    .sort((a, b) => b.events.length - a.events.length);

  console.error(`[info] ${sourcesSorted.length} unika källor`);

  // ─── Bygg markdown ──────────────────────────────────────────────────

  const lines = [];
  lines.push(`# Community-events per källa — ${TODAY}`);
  lines.push('');
  lines.push(`Totalt **${events.length} events** med \`category_slug='community'\`, fördelade på **${sourcesSorted.length} källor**.`);
  lines.push('');
  lines.push(`Genererat av \`.scratch/community-events-by-source.mjs\`. 3 stickprov per källa (första / mittersta / sista i tidsordning).`);
  lines.push('');
  lines.push(`## Fördelning per källa`);
  lines.push('');
  lines.push(`| Källa | Events | Första ticket-domän |`);
  lines.push(`|---|---|---|`);
  for (const { source, events: evts } of sourcesSorted) {
    const sample = evts.find((e) => e.ticket_url) ?? evts[0];
    const dom = extractDomain(sample?.ticket_url) ?? '—';
    lines.push(`| ${pipeSafe(source)} | ${evts.length} | ${dom} |`);
  }
  lines.push('');
  lines.push(`## Detaljer per källa`);
  lines.push('');

  for (const { source, events: evts } of sourcesSorted) {
    const sample0 = evts.find((e) => e.ticket_url) ?? evts[0];
    const homepage = homepageGuess(sample0?.ticket_url);

    lines.push(`### \`${source}\` — ${evts.length} events`);
    lines.push('');
    if (homepage) {
      lines.push(`- Gissad startsida: <${homepage}>`);
    } else {
      lines.push(`- Gissad startsida: — (inga ticket_urls)`);
    }
    lines.push(`- Stickprovets tidsfönster: ${evts[evts.length - 1]?.start_time?.slice(0, 10) ?? '?'} → ${evts[0]?.start_time?.slice(0, 10) ?? '?'}`);
    const llmHits = evts.filter((e) => llm.has(e.id)).length;
    if (llmHits > 0) {
      lines.push(`- LLM har förslag för ${llmHits}/${evts.length} av dessa`);
    } else {
      lines.push(`- LLM har INGA förslag (varken v1 eller v2 körde på denna källa)`);
    }
    lines.push('');

    const samples = chooseSamples(evts, SAMPLES_PER_SOURCE);
    for (const [idx, ev] of samples.entries()) {
      const venue = venues.get(ev.venue_id) ?? '(ingen venue)';
      const llmSug = llm.get(ev.id);
      const llmStr = llmSug ? `${llmSug.slugs.join(' + ')} — ${llmSug.reasoning?.slice(0, 80) ?? ''}` : '(LLM säger: community / inget förslag)';
      lines.push(`#### Stickprov ${idx + 1} — start ${ev.start_time?.slice(0, 10) ?? '?'}`);
      lines.push('');
      lines.push(`- **id**: \`${ev.id}\``);
      lines.push(`- **venue**: ${pipeSafe(venue)}`);
      lines.push(`- **title_sv**: ${pipeSafe(ev.title_sv)}`);
      lines.push(`- **title_en**: ${pipeSafe(ev.title_en)}`);
      lines.push(`- **description_sv** (${(ev.description_sv ?? '').length} tecken): ${pipeSafe(truncate(ev.description_sv, 300))}`);
      lines.push(`- **description_en** (${(ev.description_en ?? '').length} tecken): ${pipeSafe(truncate(ev.description_en, 300))}`);
      lines.push(`- **start_time**: ${ev.start_time ?? '—'} → ${ev.end_time ?? '—'}`);
      lines.push(`- **is_free**: ${ev.is_free === true ? 'ja' : ev.is_free === false ? 'nej' : '?'}`);
      if (ev.price_min_sek != null || ev.price_max_sek != null) {
        lines.push(`- **price**: ${ev.price_min_sek ?? '?'}–${ev.price_max_sek ?? '?'} SEK`);
      }
      lines.push(`- **ticket_url**: ${ev.ticket_url ? `<${ev.ticket_url}>` : '—'}`);
      lines.push(`- **image_url**: ${ev.image_url ? `<${ev.image_url}>` : '—'}`);
      lines.push(`- **lat/lng**: ${ev.lat ?? '?'}, ${ev.lng ?? '?'}`);
      lines.push(`- **category_slug** (nu): ${ev.category_slug ?? '—'}`);
      lines.push(`- **LLM-förslag**: ${llmStr}`);
      lines.push(`- **dedup_hash**: \`${(ev.dedup_hash ?? '').slice(0, 16)}…\``);
      lines.push(`- **updated_at**: ${ev.updated_at ?? '—'}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  // ─── Skriv fil ─────────────────────────────────────────────────────
  await mkdir(VAULT_DIR, { recursive: true });
  const outPath = join(VAULT_DIR, `community-events-by-source-${TODAY}.md`);
  const md = lines.join('\n');
  await writeFile(outPath, md, 'utf8');
  console.error(`[done] Skrev ${outPath}`);
  console.error(`[done] ${events.length} events, ${sourcesSorted.length} källor, ${lines.length} rader markdown`);

  // ─── Skriv ut till stdout för direkt granskning (första 50 rader) ─────
  console.log(md.split('\n').slice(0, 50).join('\n'));
}

main().catch((err) => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});