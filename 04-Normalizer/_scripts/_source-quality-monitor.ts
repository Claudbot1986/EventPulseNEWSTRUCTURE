/**
 * source-quality-monitor.ts — Vecko-rapport om datakvalitet per källa.
 *
 * Sammanställer metrics per source som hjälper oss upptäcka problem tidigt:
 *   * Total event-volym
 *   * Andel med description (>=50 chars)
 *   * Andel med title > 30 chars (rich titles)
 *   * URL health (HEAD-checks stickprov om 20 per källa)
 *   * Andel fortfarande i 'community' (restpost)
 *   * Andel med category_slug = NULL (bör vara 0)
 *   * Andel med source = NULL (bör vara 0)
 *   * Distinct venue_id (diversitet)
 *
 * Output:
 *   * Stdout-tabell för snabb överblick
 *   * Vault-md med detaljer + rekommendationer
 *
 * Körs veckovis via cron (eller manuellt).
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/source-quality-monitor.ts
 *   tsx --env-file=.env 04-Normalizer/_scripts/source-quality-monitor.ts --full  # utförligare URL-test
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

interface EventRow {
  id: string;
  source: string | null;
  category_slug: string | null;
  title_sv: string | null;
  title_en: string | null;
  description_sv: string | null;
  description_en: string | null;
  ticket_url: string | null;
  venue_id: string | null;
}

interface SourceMetrics {
  source: string;
  total: number;
  with_desc: number;
  rich_title: number;
  in_community: number;
  null_source: number;
  null_category: number;
  distinct_venues: number;
  url_sample: string[];
  health?: { ok: number; redirect: number; broken: number; error: number };
}

const PAGE = 1000;
const VAULT_DIR = join(process.cwd(), '00-Vault/01-Projects/EventPulse/04-Sources');
const URL_CHECK_SAMPLE = 20;
const URL_TIMEOUT_MS = 8000;

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function loadAllEvents(): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select('id, source, category_slug, title_sv, title_en, description_sv, description_en, ticket_url, venue_id')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetch error: ${error.message}`);
    if (data && data.length > 0) {
      rows.push(...(data as EventRow[]));
      offset += data.length;
      hasMore = data.length === PAGE;
    } else hasMore = false;
  }
  return rows;
}

function computeMetrics(events: EventRow[]): SourceMetrics[] {
  const bySource = new Map<string, EventRow[]>();
  for (const e of events) {
    const s = e.source ?? '(null)';
    if (!bySource.has(s)) bySource.set(s, []);
    bySource.get(s)!.push(e);
  }

  return [...bySource.entries()].map(([source, evts]) => {
    let withDesc = 0, richTitle = 0, inCommunity = 0, nullSource = 0, nullCategory = 0;
    const venues = new Set<string | null>();
    const urlSample: string[] = [];
    for (const e of evts) {
      const dlen = Math.max((e.description_sv ?? '').length, (e.description_en ?? '').length);
      if (dlen >= 50) withDesc++;
      const tlen = Math.max((e.title_sv ?? '').length, (e.title_en ?? '').length);
      if (tlen > 30) richTitle++;
      if (e.category_slug === 'community') inCommunity++;
      if (e.source === null) nullSource++;
      if (e.category_slug === null) nullCategory++;
      if (e.venue_id) venues.add(e.venue_id);
      if (urlSample.length < URL_CHECK_SAMPLE && e.ticket_url) urlSample.push(e.ticket_url);
    }
    return {
      source,
      total: evts.length,
      with_desc: withDesc,
      rich_title: richTitle,
      in_community: inCommunity,
      null_source: nullSource,
      null_category: nullCategory,
      distinct_venues: venues.size,
      url_sample: urlSample,
    };
  }).sort((a, b) => b.total - a.total);
}

async function checkUrls(samples: string[]): Promise<{ ok: number; redirect: number; broken: number; error: number }> {
  let ok = 0, redirect = 0, broken = 0, error = 0;
  await Promise.all(samples.map(async (url) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), URL_TIMEOUT_MS);
      const r = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'manual' });
      clearTimeout(t);
      if (r.status >= 200 && r.status < 300) ok++;
      else if (r.status >= 300 && r.status < 400) redirect++;
      else broken++;
    } catch {
      error++;
    }
  }));
  return { ok, redirect, broken, error };
}

function recommend(m: SourceMetrics): string[] {
  const recs: string[] = [];
  const pct = (n: number) => (n / m.total) * 100;

  if (m.null_source > 0) {
    recs.push(`🔴 ${m.null_source} events med source=NULL → pipeline-bugg`);
  }
  if (m.null_category > 0) {
    recs.push(`🔴 ${m.null_category} events med category=NULL → måste sättas`);
  }
  if (pct(m.with_desc) < 30 && m.total > 5) {
    recs.push(`🟠 ${pct(m.with_desc).toFixed(0)} % har description → adapter eller källa saknar description`);
  }
  if (pct(m.in_community) > 50 && m.total > 10) {
    recs.push(`🟡 ${pct(m.in_community).toFixed(0)} % är fortfarande 'community' → kör LLM-batch`);
  }
  if (m.health && m.health.broken > 0) {
    recs.push(`🟠 ${m.health.broken} URL:er är 4xx/5xx → källa kan ha problem`);
  }
  if (m.distinct_venues === 1 && m.total > 5) {
    recs.push(`ℹ️ Alla events har samma venue → kan auto-taggas med venue_id`);
  }
  return recs;
}

async function main() {
  const full = process.argv.includes('--full');
  console.log('[source-quality] Loading events...');
  const events = await loadAllEvents();
  console.log(`[source-quality] ${events.length} events laddade.`);

  console.log('[source-quality] Computing per-source metrics...');
  const metrics = computeMetrics(events);

  if (full) {
    console.log(`[source-quality] URL-hälsotest av top 10 källor (${URL_CHECK_SAMPLE} URLs vardera)...`);
    for (const m of metrics.slice(0, 10)) {
      if (m.url_sample.length > 0) {
        m.health = await checkUrls(m.url_sample);
      }
    }
  }

  // Stdout-tabell
  console.log('\n=== Källa-rapport ===\n');
  console.log('Source                          Events  %Desc  %RichTitle  %Comm  NullSrc  Rek');
  console.log('─'.repeat(95));
  for (const m of metrics.slice(0, 30)) {
    const pctDesc = ((m.with_desc / m.total) * 100).toFixed(0).padStart(3);
    const pctRich = ((m.rich_title / m.total) * 100).toFixed(0).padStart(3);
    const pctComm = ((m.in_community / m.total) * 100).toFixed(0).padStart(3);
    const nullSrc = String(m.null_source).padStart(3);
    const recs = recommend(m);
    const recStr = recs.length === 0 ? '✓' : `${recs.length} varningar`;
    console.log(`${m.source.padEnd(30)}  ${String(m.total).padStart(6)}  ${pctDesc}%  ${pctRich}%      ${pctComm}%  ${nullSrc}   ${recStr}`);
  }
  if (metrics.length > 30) console.log(`... och ${metrics.length - 30} till`);

  // Vault-rapport
  await mkdir(VAULT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outPath = join(VAULT_DIR, `source-quality-${today}.md`);
  const lines: string[] = [];
  lines.push(`# Source quality report — ${today}`);
  lines.push('');
  lines.push(`* Totalt events: ${events.length}`);
  lines.push(`* Källor: ${metrics.length}`);
  lines.push(`* URL-hälsotest: ${full ? 'JA' : 'NEJ (kör med --full)'}`);
  lines.push('');
  lines.push('## Top 30 källor');
  lines.push('');
  lines.push('| Källa | Events | %Desc | %RichTitle | %Comm | NullSrc | Rekommendationer |');
  lines.push('|---|---:|---:|---:|---:|---:|---|');
  for (const m of metrics.slice(0, 30)) {
    const pctDesc = ((m.with_desc / m.total) * 100).toFixed(0) + ' %';
    const pctRich = ((m.rich_title / m.total) * 100).toFixed(0) + ' %';
    const pctComm = ((m.in_community / m.total) * 100).toFixed(0) + ' %';
    const recs = recommend(m);
    const recStr = recs.length === 0 ? '✓' : recs.join('<br/>');
    lines.push(`| ${m.source} | ${m.total} | ${pctDesc} | ${pctRich} | ${pctComm} | ${m.null_source} | ${recStr} |`);
  }
  lines.push('');
  if (full) {
    lines.push('## URL-hälsa (top 10)');
    lines.push('');
    lines.push('| Källa | OK | 3xx | 4xx/5xx | ERR |');
    lines.push('|---|---:|---:|---:|---:|');
    for (const m of metrics.slice(0, 10)) {
      if (m.health) {
        lines.push(`| ${m.source} | ${m.health.ok} | ${m.health.redirect} | ${m.health.broken} | ${m.health.error} |`);
      }
    }
    lines.push('');
  }
  lines.push('## Problemkällor som behöver åtgärd');
  lines.push('');
  let anyRecs = false;
  for (const m of metrics) {
    const recs = recommend(m);
    if (recs.length > 0) {
      anyRecs = true;
      lines.push(`### ${m.source} (${m.total} events)`);
      lines.push('');
      for (const r of recs) lines.push(`* ${r}`);
      lines.push('');
    }
  }
  if (!anyRecs) lines.push('Inga källor behöver åtgärd just nu.');

  await writeFile(outPath, lines.join('\n'), 'utf8');
  console.log(`\n[source-quality] ✅ Rapport skriven: ${outPath}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[source-quality] FATAL:', msg);
  process.exit(1);
});
