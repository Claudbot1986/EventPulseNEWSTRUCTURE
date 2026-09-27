/**
 * analyze-link-health.ts
 *
 * Djupanalys av 404 / broken-link-situationen i EventPulse.
 *
 * Bakgrund (2026-09-27): användaren misstänker att många events har döda
 * länkar (404 / 5xx / DNS-fel). Vi har redan infrastruktur på plats:
 *   - 05-Supabase/migrations/20260926-0003-link-health.sql
 *     → kolumner link_status + link_last_checked_at på events
 *     → events_public filtrerar bort rader med link_status='broken'
 *   - 05-Supabase/migrations/20260926-0004-link-health-hybrid.sql
 *     → kolumner consecutive_broken_count + first_broken_at
 *     → view-filter "Hybrid B": cf>=2 ⇒ hela källan döljs
 *   - 09-ScrapingSupervisor/check_link_health.ts (körs dagligen 04:30)
 *     → HEAD-check 1 representativ event per källa och dag
 *     → concurrency 10, ~200 HEAD-anrop, timeout 5 s
 *   - 09-ScrapingSupervisor/tools/quarantine_trigger.ts
 *     → källor som korsar cf>=2 skickas till manual-review-kön
 *
 * Detta script svarar på frågorna:
 *   1. Hur stor andel av events har ticket_url överhuvudtaget?
 *   2. Hur många är NULL/ok/broken?
 *   3. Hur många är dolda pga Hybrid B (cf>=2 ⇒ hela källan borta)?
 *   4. Vilka TOP-källor har flest broken?
 *   5. Hur ofta checkas varje källa? Hur stor andel är ALDRIG kollad?
 *   6. Hur gammal är senaste broken-check per källa?
 *   7. Vilka specifika events har broken? (stickprov)
 *
 * Output: stdout — presenteras i klartext till användaren.
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/analyze-link-health.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const PAGE = 1000;

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

function fail(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[link-health] FATAL: ${msg}`);
  process.exit(1);
}

interface Row {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  source: string | null;
  ticket_url: string | null;
  link_status: string | null;
  link_last_checked_at: string | null;
  consecutive_broken_count: number | null;
  first_broken_at: string | null;
  start_time: string | null;
}

async function fetchAll(): Promise<Row[]> {
  const rows: Row[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select(
        'id, title_sv, title_en, source, ticket_url, link_status, link_last_checked_at, consecutive_broken_count, first_broken_at, start_time',
      )
      .range(offset, offset + PAGE - 1);
    if (error) fail(`Supabase fetch failed: ${error.message}`);
    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }
    rows.push(...(data as Row[]));
    hasMore = data.length === PAGE;
    offset += PAGE;
  }
  return rows;
}

function pickTitle(r: Row): string {
  const t = r.title_sv ?? r.title_en ?? '(no title)';
  return t.length > 60 ? t.slice(0, 57) + '...' : t;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / (1000 * 60 * 60 * 24));
}

async function main(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail('SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas i env.');
  }

  // eslint-disable-next-line no-console
  console.error('[link-health] fetching all events...');
  const rows = await fetchAll();
  // eslint-disable-next-line no-console
  console.error(`[link-health] fetched ${rows.length} events`);

  // ── 1. ticket_url-fördelning ────────────────────────────────────────────
  const withUrl = rows.filter((r) => r.ticket_url && r.ticket_url.trim().length > 0);
  const withoutUrl = rows.filter((r) => !r.ticket_url || r.ticket_url.trim().length === 0);

  // ── 2. link_status-fördelning (bara events med ticket_url) ──────────────
  const byStatus = {
    null: 0,
    ok: 0,
    broken: 0,
  };
  for (const r of withUrl) {
    if (r.link_status === 'ok') byStatus.ok++;
    else if (r.link_status === 'broken') byStatus.broken++;
    else byStatus.null++;
  }

  // ── 3. Hybrid B (cf>=2 ⇒ hela källan döljs) ──────────────────────────────
  const cfSources = new Map<string, number>();
  for (const r of rows) {
    if ((r.consecutive_broken_count ?? 0) >= 2 && r.source) {
      cfSources.set(r.source, (cfSources.get(r.source) ?? 0) + 1);
    }
  }
  const hiddenSources = Array.from(cfSources.entries())
    .sort((a, b) => b[1] - a[1]);

  // Events vars källa är i hiddenSources ⇒ dolda i UI
  const hiddenByCf2 = rows.filter((r) => r.source && cfSources.has(r.source));

  // ── 4. TOP-källor med broken (per event) ────────────────────────────────
  const brokenBySource = new Map<string, number>();
  for (const r of withUrl) {
    if (r.link_status === 'broken' && r.source) {
      brokenBySource.set(r.source, (brokenBySource.get(r.source) ?? 0) + 1);
    }
  }
  const topBrokenSources = Array.from(brokenBySource.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  // ── 5. Aldrig kontrollerad ──────────────────────────────────────────────
  const neverChecked = withUrl.filter((r) => r.link_last_checked_at === null);
  const checked = withUrl.filter((r) => r.link_last_checked_at !== null);

  // Senaste kontroll ålder (bland de som faktiskt kollats)
  const checkedDays = checked
    .map((r) => daysSince(r.link_last_checked_at))
    .filter((d): d is number => d !== null);
  const avgDays =
    checkedDays.length > 0
      ? Math.round(checkedDays.reduce((a, b) => a + b, 0) / checkedDays.length)
      : 0;
  const maxDays = checkedDays.length > 0 ? Math.max(...checkedDays) : 0;
  const minDays = checkedDays.length > 0 ? Math.min(...checkedDays) : 0;

  // Andel av "withUrl" som är null/ok/broken/never-checked
  const neverCheckedPct = ((neverChecked.length / withUrl.length) * 100).toFixed(1);
  const brokenPct = ((byStatus.broken / withUrl.length) * 100).toFixed(1);
  const okPct = ((byStatus.ok / withUrl.length) * 100).toFixed(1);
  const nullPct = ((byStatus.null / withUrl.length) * 100).toFixed(1);

  // ── 6. Hur gammal är senaste broken-check per källa? ────────────────────
  const brokenBySourceAge = new Map<
    string,
    { count: number; oldestCheck: number | null; newestCheck: number | null }
  >();
  for (const r of withUrl) {
    if (r.link_status === 'broken' && r.source) {
      const e = brokenBySourceAge.get(r.source) ?? {
        count: 0,
        oldestCheck: null,
        newestCheck: null,
      };
      e.count++;
      const age = daysSince(r.link_last_checked_at);
      if (age !== null) {
        if (e.oldestCheck === null || age > e.oldestCheck) e.oldestCheck = age;
        if (e.newestCheck === null || age < e.newestCheck) e.newestCheck = age;
      }
      brokenBySourceAge.set(r.source, e);
    }
  }

  // ── 7. Stickprov: 10 broken events ──────────────────────────────────────
  const brokenEvents = withUrl.filter((r) => r.link_status === 'broken');
  const brokenSample = brokenEvents.slice(0, 10);

  // ── Rapportera ──────────────────────────────────────────────────────────

  // eslint-disable-next-line no-console
  console.error('');
  // eslint-disable-next-line no-console
  console.error('═══════════════════════════════════════════════════════════');
  // eslint-disable-next-line no-console
  console.error('  404 / LINK-HÄLSO-ANALYS — EventPulse 2026-09-27');
  // eslint-disable-next-line no-console
  console.error('═══════════════════════════════════════════════════════════');
  // eslint-disable-next-line no-console
  console.error('');

  // eslint-disable-next-line no-console
  console.error(`Totalt antal events:                ${rows.length}`);
  // eslint-disable-next-line no-console
  console.error(`Events med ticket_url:              ${withUrl.length} (${((withUrl.length / rows.length) * 100).toFixed(1)} %)`);
  // eslint-disable-next-line no-console
  console.error(`Events utan ticket_url:             ${withoutUrl.length} (${((withoutUrl.length / rows.length) * 100).toFixed(1)} %)`);
  // eslint-disable-next-line no-console
  console.error('');
  // eslint-disable-next-line no-console
  console.error(`Bland events med ticket_url:`);
  // eslint-disable-next-line no-console
  console.error(`  link_status = NULL (aldrig kollad):   ${byStatus.null} (${nullPct} %)`);
  // eslint-disable-next-line no-console
  console.error(`  link_status = 'ok':                   ${byStatus.ok} (${okPct} %)`);
  // eslint-disable-next-line no-console
  console.error(`  link_status = 'broken':               ${byStatus.broken} (${brokenPct} %)`);
  // eslint-disable-next-line no-console
  console.error('');

  // eslint-disable-next-line no-console
  console.error(`Aldrig kontrollerad (av withUrl):   ${neverChecked.length} (${neverCheckedPct} %)`);
  // eslint-disable-next-line no-console
  console.error(`Senast kollad — ålder (dagar):`);
  // eslint-disable-next-line no-console
  console.error(`  medel:  ${avgDays}`);
  // eslint-disable-next-line no-console
  console.error(`  min:    ${minDays}`);
  // eslint-disable-next-line no-console
  console.error(`  max:    ${maxDays}`);
  // eslint-disable-next-line no-console
  console.error('');

  // eslint-disable-next-line no-console
  console.error(`Hybrid B (consecutive_broken_count >= 2 ⇒ hela källan döljs i UI):`);
  // eslint-disable-next-line no-console
  console.error(`  Antal drabbade källor:              ${hiddenSources.length}`);
  // eslint-disable-next-line no-console
  console.error(`  Antal events vars källa är dold:    ${hiddenByCf2.length}`);
  // eslint-disable-next-line no-console
  console.error(`  TOP 10 dolda källor (efter antal events i källan):`);
  for (const [src, n] of hiddenSources.slice(0, 10)) {
    // eslint-disable-next-line no-console
    console.error(`    ${String(n).padStart(4)} events — ${src}`);
  }
  // eslint-disable-next-line no-console
  console.error('');

  // eslint-disable-next-line no-console
  console.error('TOP 15 källor med flest broken events (cf okänd):');
  for (const [src, n] of topBrokenSources) {
    const age = brokenBySourceAge.get(src);
    const ageStr =
      age?.newestCheck !== null && age?.newestCheck !== undefined
        ? `senast kollad ${age.newestCheck}d sedan`
        : 'aldrig kollad';
    // eslint-disable-next-line no-console
    console.error(`  ${String(n).padStart(4)} broken — ${src}  (${ageStr})`);
  }
  // eslint-disable-next-line no-console
  console.error('');

  // eslint-disable-next-line no-console
  console.error('Stickprov — 10 första broken events:');
  for (const r of brokenSample) {
    const age = daysSince(r.link_last_checked_at);
    // eslint-disable-next-line no-console
    console.error(
      `  [${r.source}] ${pickTitle(r)}  cf=${r.consecutive_broken_count ?? 0}  senast=${age ?? '?'}d`,
    );
    if (r.ticket_url) {
      // eslint-disable-next-line no-console
      console.error(`     url: ${r.ticket_url.slice(0, 100)}`);
    }
  }
  // eslint-disable-next-line no-console
  console.error('');

  // ── Slutsatser / observationer ─────────────────────────────────────────
  // eslint-disable-next-line no-console
  console.error('═══════════════════════════════════════════════════════════');
  // eslint-disable-next-line no-console
  console.error('  VAD DETTA INNEBÄR');
  // eslint-disable-next-line no-console
  console.error('═══════════════════════════════════════════════════════════');
  // eslint-disable-next-line no-console
  console.error('');
  // eslint-disable-next-line no-console
  console.error(`1. ${brokenEvents.length} events har aktivt BROKEN-länk just nu.`);
  // eslint-disable-next-line no-console
  console.error(`   Dessa är REDAN dolda i events_public (UI). Men de ligger kvar i events-tabellen.`);
  // eslint-disable-next-line no-console
  console.error('');
  // eslint-disable-next-line no-console
  console.error(`2. ${hiddenByCf2.length} events är dolda i UI pga Hybrid B (cf>=2 på minst en event i källan).`);
  // eslint-disable-next-line no-console
  console.error(`   Dessa tillhör ${hiddenSources.length} källor som är i "karantän".`);
  // eslint-disable-next-line no-console
  console.error('');
  // eslint-disable-next-line no-console
  console.error(`3. ${neverChecked.length} events har ALDRIG blivit HEAD-checkade.`);
  // eslint-disable-next-line no-console
  console.error(`   Dessa är fortfarande SYNLIGA i UI (NULL-status).`);
  // eslint-disable-next-line no-console
  console.error(`   Användaren upplever att "många är 404" — sannolikt en kombination av:`);
  // eslint-disable-next-line no-console
  console.error(`     a) Aldrig-kontrollerade events som visar trasiga URL:er vid klick,`);
  // eslint-disable-next-line no-console
  console.error(`     b) Hybrid-B-karantän som plötsligt tog bort många events från UI utan förvarning,`);
  // eslint-disable-next-line no-console
  console.error(`     c) 30+ dagars cykel — en källa kan ha 30 events där bara 1 kollas/dag.`);
  // eslint-disable-next-line no-console
  console.error('');
  // eslint-disable-next-line no-console
  console.error(`4. Medellängd senaste kontroll: ${avgDays} dagar. Max: ${maxDays} dagar.`);
  // eslint-disable-next-line no-console
  console.error(`   Med 200+ aktiva källor och 1 HEAD/källa/dag tar det ~30-200 dagar att cykla igenom alla events per källa.`);
  // eslint-disable-next-line no-console
  console.error('');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  fail(msg);
});
