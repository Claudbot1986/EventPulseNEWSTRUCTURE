/**
 * verify-cgate-root-fallback.mjs — bevis för C-gatens två fixar.
 *
 * Fix D  (2026-10-24): en källa är framgång bara om den producerar rader
 *       med ANVÄNDBART DATUM. Tidigare räknades varje extraherad rad som
 *       event, så en källa med 8 datumlösa rader rapporterade "8 events"
 *       medan importen kastade alla 8.
 *
 * Fix R′ (2026-10-24): C0-vinnaren ersätter källans deklarerade URL, så
 *       fel vinnare dödar källan. Nu testas källans EGEN URL som sista
 *       fallback-kandidat.
 *
 * Varje gate är ett "predikat" som returnerar en lista av brott (tom lista
 * = godkänt). `--gate=self-test` kör samma predikat mot medvetet trasiga
 * fixture-data och kräver att de FALLERAR — en gate som aldrig kan
 * misslyckas bevisar ingenting.
 *
 * Kör:
 *   node --import tsx scripts/verify-cgate-root-fallback.mjs --gate=<namn>
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Hjälpfunktioner
// ---------------------------------------------------------------------------

function violationsOf(list) {
  return list.length === 0 ? null : list.join('; ');
}

function assertNoViolations(breaks, gate) {
  const text = violationsOf(breaks);
  if (text) throw new Error(text);
}

async function loadModule(relPath) {
  return import(path.join(REPO, relPath));
}

async function loadDotenv() {
  const envPath = path.join(REPO, '.env');
  if (!existsSync(envPath)) return;
  const dotenv = await import('dotenv');
  dotenv.config({ path: envPath, override: true });
}

// ---------------------------------------------------------------------------
// Predikat 1 — framgång kräver sparbart datum
// ---------------------------------------------------------------------------

/**
 * @param {(ev: any, nowMs?: number) => boolean} hasUsableDate
 * @param {(ev: any, nowMs?: number) => string} eventStartTime
 * @param {(result: any, url: string, round: number, c0Winner: boolean) => void} determineOutcome
 * @returns {string[]} brott
 */
export function checkDatedSuccessRule(hasUsableDate, eventStartTime, determineOutcome) {
  const NOON = new Date(2026, 9, 24, 12, 0, 0, 0).getTime();
  const breaks = [];

  // Ett framtida datum är användbart, ett förflutet och ett datumlöst är inte.
  if (!hasUsableDate({ date: '2026-11-20' }, NOON)) breaks.push('framtida datum avvisades');
  if (hasUsableDate({ date: '2026-10-01' }, NOON)) breaks.push('förflutet datum accepterades');
  if (hasUsableDate({ title: 'ingen datum' }, NOON)) breaks.push('datumlös rad accepterades');

  // Stämpeln byggs av samma fält som importen läser.
  if (eventStartTime({ date: '2026-11-20', time: '19:00' }) !== '2026-11-20T19:00:00.000Z') {
    breaks.push('starttid från date+time avviker');
  }

  // determineOutcome: rader utan sparbart datum får INTE bli extract_success.
  const makeResult = (extract, c1 = {}) => ({
    sourceId: 'verify',
    sourceUrl: 'https://example.se',
    outcomeType: 'fail',
    routeSuggestion: 'manual-review',
    evidence: '',
    success: false,
    exitReason: 'ALL_ROUNDS_EXHAUSTED',
    exitReasonDetail: '',
    winningStage: 'C3',
    c0: { winnerUrl: 'https://example.se' },
    c1: { verdict: 'strong', likelyJsRendered: false, fetchable: true, fetchError: null, ...c1 },
    c2: { verdict: 'promising', score: 10 },
    c3: { universalEventsFound: 0, universalMethodsUsed: [], universalMethodBreakdown: {} },
    extract,
  });

  const undated = makeResult({ eventsFound: 8, datedEventsFound: 0, duration: 1, htmlSize: 100 });
  determineOutcome(undated, 'https://example.se', 1, true);
  if (undated.outcomeType === 'extract_success' || undated.success) {
    breaks.push('rader utan sparbart datum rapporterades som extract_success');
  }
  if (undated.exitReason !== 'EXTRACTION_ZERO_NO_USABLE_DATE') {
    breaks.push(`fel exitReason för datumlösa rader: ${undated.exitReason}`);
  }
  if (undated.routeSuggestion !== 'manual-review') {
    breaks.push(`fel routeSuggestion för datumlösa rader: ${undated.routeSuggestion}`);
  }

  const dated = makeResult({ eventsFound: 8, datedEventsFound: 3, duration: 1, htmlSize: 100 });
  determineOutcome(dated, 'https://example.se', 1, true);
  if (dated.outcomeType !== 'extract_success' || !dated.success) {
    breaks.push(`3 sparbara datum gav inte extract_success (${dated.outcomeType})`);
  }

  // En JS-renderad sida ska fortfarande gå till D-gaten, även utan datum.
  const jsRendered = makeResult(
    { eventsFound: 4, datedEventsFound: 0, duration: 1, htmlSize: 100 },
    { likelyJsRendered: true },
  );
  determineOutcome(jsRendered, 'https://example.se', 1, false);
  if (jsRendered.routeSuggestion !== 'D') {
    breaks.push(`JS-renderad källa routades till ${jsRendered.routeSuggestion} i stället för D`);
  }

  return breaks;
}

// ---------------------------------------------------------------------------
// Predikat 2 — källans egen URL är sist i fallback-listan
// ---------------------------------------------------------------------------

export function checkDeclaredUrlCandidate(buildFallbackCandidates) {
  const breaks = [];

  const list = buildFallbackCandidates(
    [
      { url: 'https://a.se/2', eventDensityScore: 5 },
      { url: 'https://a.se/3', eventDensityScore: 3 },
    ],
    'https://a.se/1',
    'https://a.se',
    3,
  );

  const last = list[list.length - 1];
  if (!last || last.url !== 'https://a.se') {
    breaks.push('deklarerad URL saknas sist i listan');
  } else if (last.reason !== 'declared-url') {
    breaks.push(`deklarerad URL har reason "${last.reason}" i stället för "declared-url"`);
  }

  const c0Urls = list.slice(0, -1).map((c) => c.url);
  if (c0Urls.join('|') !== 'https://a.se/2|https://a.se/3') {
    breaks.push(`C0-kandidaterna kommer inte först i C0:s ordning: ${c0Urls.join('|')}`);
  }

  // Redan testad URL ska inte dupliceras.
  const dup = buildFallbackCandidates([], 'https://a.se', 'https://a.se', 3);
  if (dup.length !== 0) breaks.push('redan testad deklarerad URL duplicerades');

  // Utan deklarerad URL ska ingen finnas.
  const none = buildFallbackCandidates([{ url: 'https://a.se/2', eventDensityScore: 1 }], 'https://a.se/1', null, 3);
  if (none.length !== 1 || none[0].url !== 'https://a.se/2') {
    breaks.push('utan deklarerad URL ändrades C0-listan');
  }

  return breaks;
}

// ---------------------------------------------------------------------------
// Predikat 3 — gaten och importen delar samma datumregel (ingen drift)
// ---------------------------------------------------------------------------

export function checkImportSharesRule() {
  const breaks = [];
  const importerPath = path.join(REPO, '03-Queue/importToEventPulse.ts');
  const src = readFileSync(importerPath, 'utf8');

  if (!/from\s+'\.\.\/02-Ingestion\/F-eventExtraction\/usableEvents'/.test(src)) {
    breaks.push('importToEventPulse.ts importerar inte eventStartTime från usableEvents');
  }
  if (/function\s+toIsoStartTime\s*\(/.test(src)) {
    breaks.push('importToEventPulse.ts har fortfarande en egen toIsoStartTime (regeln kan glida isär)');
  }
  return breaks;
}

// ---------------------------------------------------------------------------
// Predikat 4 — de två räddade källorna har rader i databasen
// ---------------------------------------------------------------------------

export const FALLBACK_SOURCES = ['engelbrekt', 'storkyrkan-2'];

export async function checkLiveDb(sb, isEventPast) {
  const breaks = [];
  const nowMs = Date.now();

  for (const slug of FALLBACK_SOURCES) {
    const { data, error } = await sb
      .from('events')
      .select('id, title_sv, title_en, start_time, source')
      .eq('source', slug);
    if (error) {
      breaks.push(`${slug}: DB-fel ${error.message}`);
      continue;
    }
    const rows = data ?? [];
    if (rows.length === 0) {
      breaks.push(`${slug}: 0 rader i databasen`);
      continue;
    }
    // Samma datumregel som importen använder (heldags-event gäller hela dagen).
    const alive = rows.filter((r) => r.start_time && !isEventPast(r.start_time, nowMs));
    if (alive.length === 0) {
      breaks.push(`${slug}: ${rows.length} rader men ingen med sparbart datum`);
    }
    const undated = rows.filter((r) => !r.start_time);
    if (undated.length > 0) {
      breaks.push(`${slug}: ${undated.length} rader saknar start_time`);
    }
    const untitled = rows.filter((r) => !(r.title_sv || r.title_en));
    if (untitled.length > 0) {
      breaks.push(`${slug}: ${untitled.length} rader saknar titel`);
    }
  }
  return breaks;
}

// ---------------------------------------------------------------------------
// Predikat 5 — de räddade raderna är events, inte navigations-skräp
// ---------------------------------------------------------------------------

export function checkNoJunkTitles(rows, isNavigationTitle) {
  const breaks = [];
  for (const row of rows) {
    const title = row.title_sv || row.title_en || '';
    if (isNavigationTitle(title)) {
      breaks.push(`navigations-titel "${title}" hamnade i databasen (rad ${row.id})`);
    }
    if (title.trim().length < 3) {
      breaks.push(`för kort titel "${title}" (rad ${row.id})`);
    }
  }
  return breaks;
}

// ---------------------------------------------------------------------------
// Predikat 6 — utdatafilen innehåller bara sparbara rader
// ---------------------------------------------------------------------------

export function checkExtractedArtifactRows(rows, hasUsableDate, nowMs) {
  const breaks = [];
  if (rows.length === 0) {
    breaks.push('utdatafilen är tom');
    return breaks;
  }
  const unusable = rows.filter((r) => !hasUsableDate(r, nowMs));
  if (unusable.length > 0) {
    breaks.push(`${unusable.length} rader i utdatafilen saknar sparbart datum`);
  }
  return breaks;
}

// ---------------------------------------------------------------------------
// Gate-körning
// ---------------------------------------------------------------------------

async function runGate(name) {
  switch (name) {
    case 'dated-success': {
      const { hasUsableDate, eventStartTime } = await loadModule('02-Ingestion/F-eventExtraction/usableEvents.ts');
      const { determineOutcome } = await loadModule('02-Ingestion/C-htmlGate/run-dynamic-pool.ts');
      assertNoViolations(
        checkDatedSuccessRule(hasUsableDate, eventStartTime, determineOutcome),
        'dated-success',
      );
      return 'datumvakten delad mellan gaten och importen, och determineOutcome kräver sparbart datum';
    }

    case 'declared-url': {
      const { buildFallbackCandidates } = await loadModule('02-Ingestion/C-htmlGate/candidateFallback.ts');
      assertNoViolations(checkDeclaredUrlCandidate(buildFallbackCandidates), 'declared-url');
      return 'källans egen URL testas som sista fallback-kandidat';
    }

    case 'import-shares-rule': {
      assertNoViolations(checkImportSharesRule(), 'import-shares-rule');
      return 'importen använder samma starttid-definition som gaten';
    }

    case 'live-db': {
      await loadDotenv();
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas i .env');
      }
      const { createClient } = await import('@supabase/supabase-js');
      const { isEventPast } = await loadModule('03-Queue/eventFreshness.ts');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      assertNoViolations(await checkLiveDb(sb, isEventPast), 'live-db');
      return `${FALLBACK_SOURCES.join(' + ')} har sparbara datum i databasen`;
    }

    case 'no-junk': {
      await loadDotenv();
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas i .env');
      }
      const { createClient } = await import('@supabase/supabase-js');
      const { isNavigationTitle } = await loadModule('02-Ingestion/F-eventExtraction/navigationTitles.ts');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const rows = [];
      for (const slug of FALLBACK_SOURCES) {
        const { data, error } = await sb.from('events').select('id, title_sv, title_en, source').eq('source', slug);
        if (error) throw new Error(`${slug}: DB-fel ${error.message}`);
        rows.push(...(data ?? []));
      }
      assertNoViolations(checkNoJunkTitles(rows, isNavigationTitle), 'no-junk');
      return `${rows.length} rader utan navigations-skräp`;
    }

    case 'extracted-artifact': {
      const nowMs = Date.now();
      const { hasUsableDate } = await loadModule('02-Ingestion/F-eventExtraction/usableEvents.ts');
      const breaks = [];
      let checked = 0;
      for (const slug of FALLBACK_SOURCES) {
        const file = path.join(REPO, '03-Queue/03-extractedevents/C', `${slug}.jsonl`);
        if (!existsSync(file)) {
          breaks.push(`${slug}: saknar utdatafil ${file}`);
          continue;
        }
        const rows = readFileSync(file, 'utf8')
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l));
        const fileBreaks = checkExtractedArtifactRows(rows, hasUsableDate, nowMs);
        if (fileBreaks.length > 0) breaks.push(`${slug}: ${fileBreaks.join('; ')}`);
        checked += rows.length;
      }
      assertNoViolations(breaks, 'extracted-artifact');
      return `${checked} rader i utdatafilerna är alla sparbara`;
    }

    case 'live-cgate': {
      // Riktig körning: requeue → C-gate → utdatafil. Ingen fixture.
      const { spawnSync } = await import('node:child_process');
      const nowMs = Date.now();
      const { hasUsableDate } = await loadModule('02-Ingestion/F-eventExtraction/usableEvents.ts');
      const sources = FALLBACK_SOURCES.join(',');

      const requeue = spawnSync(
        'npx',
        ['tsx', '02-Ingestion/tools/requeue-sources.ts', '--sources', sources, '--reason', 'verify-cgate-root-fallback'],
        { cwd: REPO, encoding: 'utf8' },
      );
      if (requeue.status !== 0) {
        throw new Error(`requeue misslyckades (exit ${requeue.status}): ${(requeue.stderr || requeue.stdout || '').slice(-800)}`);
      }

      const gate = spawnSync(
        'npx',
        ['tsx', '02-Ingestion/C-htmlGate/run-dynamic-pool.ts', '--sources', sources, '--workers', '1', '--max-rounds', '1', '--no-c4'],
        { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
      );
      if (gate.status !== 0) {
        throw new Error(`C-gaten avslutades med exit ${gate.status}: ${(gate.stderr || gate.stdout || '').slice(-1500)}`);
      }

      const breaks = [];
      let checked = 0;
      for (const slug of FALLBACK_SOURCES) {
        const file = path.join(REPO, '03-Queue/03-extractedevents/C', `${slug}.jsonl`);
        if (!existsSync(file)) {
          breaks.push(`${slug}: saknar utdatafil`);
          continue;
        }
        const rows = readFileSync(file, 'utf8')
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l));
        const fileBreaks = checkExtractedArtifactRows(rows, hasUsableDate, nowMs);
        if (fileBreaks.length > 0) breaks.push(`${slug}: ${fileBreaks.join('; ')}`);
        checked += rows.length;
      }
      assertNoViolations(breaks, 'live-cgate');
      return `C-gaten körde live och skrev ${checked} sparbara rader`;
    }

    case 'self-test': {
      // Negativ kontroll: samma predikat mot medvetet trasiga data MÅSTE
      // rapportera brott. Annars bevisar gate-check att ingenting.
      const { hasUsableDate, eventStartTime } = await loadModule('02-Ingestion/F-eventExtraction/usableEvents.ts');
      const { determineOutcome } = await loadModule('02-Ingestion/C-htmlGate/run-dynamic-pool.ts');
      const { buildFallbackCandidates } = await loadModule('02-Ingestion/C-htmlGate/candidateFallback.ts');

      const brokenDate = checkDatedSuccessRule(
        () => true, // datumvakten godkänner allt → måste fällas
        eventStartTime,
        determineOutcome,
      );
      if (!brokenDate || brokenDate.length === 0) {
        throw new Error('self-test: predikatet för datumvakten fällde inte trasig indata');
      }

      const brokenOutcome = checkDatedSuccessRule(
        hasUsableDate,
        eventStartTime,
        () => { /* determineOutcome gör ingenting → inget fel upptäcks */ },
      );
      if (!brokenOutcome || brokenOutcome.length === 0) {
        throw new Error('self-test: predikatet fällde inte en determineOutcome som inte sätter utfall');
      }

      const brokenCandidate = checkDeclaredUrlCandidate(
        () => [{ url: 'https://fel.se', reason: 'fel' }],
      );
      if (!brokenCandidate || brokenCandidate.length === 0) {
        throw new Error('self-test: predikatet för deklarerad URL fällde inte trasig kandidatordning');
      }

      return 'negativ kontroll: predikaten fäller trasig indata';
    }

    default:
      throw new Error(
        `okänd gate "${name}". Tillgängliga: dated-success, declared-url, import-shares-rule, live-db, no-junk, extracted-artifact, self-test`,
      );
  }
}

const args = process.argv.slice(2);
const gateArg = args.find((a) => a.startsWith('--gate='));
const gate = gateArg ? gateArg.slice('--gate='.length) : null;

if (!gate) {
  console.error('Användning: node --import tsx scripts/verify-cgate-root-fallback.mjs --gate=<namn>');
  process.exit(2);
}

try {
  const message = await runGate(gate);
  console.log(`GATE_OK:${gate} — ${message}`);
} catch (err) {
  console.error(`GATE_FAIL:${gate} — ${err.message}`);
  process.exit(1);
}
