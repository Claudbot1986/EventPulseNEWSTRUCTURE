#!/usr/bin/env node
/**
 * verify-source-quality — GATE Q1–Q9.
 *
 * Bevisar att discovery FÖRTRÄFFAR nya källor, att de NÅR databasen, och
 * att informationen som landar är SANN — alltså att raderna är evenemang och
 * inte artiklar.
 *
 * Bakgrund (2026-11-01):
 *   - P3D promote:ar kandidater på beviset "det persisterats events", vilket
 *     är sant för en blogg också. Mätt: flera domäner lade in artikelrubrikor
 *     som events.
 *   - 84 % av raderna pekade på en detaljsida (evenemangssidan) som vi aldrig
 *     besökte — där står beskrivningen, platsen och bilden. 18 % hade plats
 *     (mot 87 % för övriga källor), 0 % hade beskrivning.
 *
 * Gaterna:
 *   Q1  discovery producerar nya kandidater
 *   Q2  P3D testar kandidater och sparar beslut
 *   Q3  promote skriver källfiler
 *   Q4  de nya källorna når databasen (events i events_public)
 *   Q5  SANNING — de källor SOM GATEN SLÄPPT IGENOM är evenemang
 *   Q6  RETRO-GATE — den riktiga beslutsfunktionen på riktiga gamla data:
 *       blockerar artikelkällor OCH släpper igenom evenemang
 *   Q7  RIKEDOM — raderna har den information som finns på detaljsidan
 *   Q8  NEGATIV KONTROLL — kända artiklar får inte passera som evenemang,
 *       och kända evenemang får inte fällas som artiklar
 *   Q9  berikningen fyller faktiskt fält (mätt på riktiga sidor)
 *
 * Q5 mäter bara det som gaten släppt igenom — alltså källor promote:ade
 * EFTER att gaten infördes. Allt äldre är SKULDBANK (informativt), mätt i
 * Q6: där körs den riktiga beslutsfunktionen på de gamla raderna, så vi får
 * veta vad gaten WOULD ha blockat — på riktig data, inte på gissningar.
 *
 * Användning:
 *   npx tsx scripts/verify-source-quality.mjs
 *   npx tsx scripts/verify-source-quality.mjs --window 48
 *   npx tsx scripts/verify-source-quality.mjs --json
 *
 * `npx tsx` krävs: skriptet importerar .ts-moduler (eventLikeness, pageProbe,
 * detailEnrichment, decision) direkt. `node` kan inte lösa dem.
 *
 * Bevisfil: runtime/verification-reports/source-quality-<TS>.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(PROJECT_ROOT, 'runtime', 'verification-reports');
const SOURCES_DIR = path.join(PROJECT_ROOT, 'sources');
const EXTRACTED_DIR = path.join(PROJECT_ROOT, '03-Queue', '03-extractedevents');

/**
 * När kvalitetsgaten infördes. Allt som promote:ats EFTER detta har gått
 * igenom gaten. Commit: f1781596 (2026-11-01).
 */
const GATE_INTRODUCED_AT = '2026-11-01T17:55:05+01:00';

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: false });

const { createClient } = await import('@supabase/supabase-js');
const { assessLikeness, classifyTitleShape, decodeEntities } = await import(
  path.join(PROJECT_ROOT, '07-Discovery/src/sourceTesting/eventLikeness.ts')
);
const { probeRowPages } = await import(
  path.join(PROJECT_ROOT, '07-Discovery/src/sourceTesting/pageProbe.ts')
);
const { decideSourceCandidateOutcome } = await import(
  path.join(PROJECT_ROOT, '07-Discovery/src/sourceTesting/decision.ts')
);
const { extractDetailFacts, mergeEnrichment, missingEnrichableFields, isFetchableUrl } = await import(
  path.join(PROJECT_ROOT, '02-Ingestion/tools/detailEnrichment.ts')
);

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const windowIdx = args.indexOf('--window');
const windowHours = windowIdx !== -1 && args[windowIdx + 1] ? Number(args[windowIdx + 1]) : 48;

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const results = [];
function gate(id, title, ok, detail, extra) {
  const verdict = ok === null ? 'UNKNOWN' : ok ? 'OK' : 'FAIL';
  results.push({ id, title, ok, verdict, detail, ...(extra ?? {}) });
  console.log(`  ${verdict.padEnd(7)} ${id} ${title}${detail ? ` — ${detail}` : ''}`);
  return ok;
}
function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Källa → dess rader i events_public. */
async function rowsForSources(sources) {
  if (sources.length === 0) return new Map();
  const { data, error } = await sb
    .from('events_public')
    .select('source,title_sv,title_en,venue_full_name,description_sv,description_en,image_url')
    .in('source', sources)
    .limit(20000);
  if (error) throw new Error(error.message);
  const by = new Map();
  for (const row of data ?? []) {
    if (!by.has(row.source)) by.set(row.source, []);
    by.get(row.source).push(row);
  }
  return by;
}

/** Raderna ur den senaste extraktionen — de har med sig sin egen URL. */
function extractedRows(sourceId) {
  const rows = [];
  for (const dir of ['', 'A', 'B', 'C', 'D']) {
    const file = path.join(EXTRACTED_DIR, dir, `${sourceId}.jsonl`);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        // Vi behåller hela raden — Q9 ska köra den genom Samma
        // mergeEnrichment som driftkoden, inte en urklippt minirad.
        rows.push({ ...row, title: String(row.title ?? ''), url: String(row.url ?? '') });
      } catch {
        /* trasig rad */
      }
    }
  }
  return rows;
}

/**
 * NEGATIV KONTROLL — de faktiska titlarna från grafen.
 *
 * Artiklarna kommer från källor som visat sig vara blogg-/nyhetssidor.
 * Evenemangen kommer från källor som levererat riktiga evenemang. En gate som
 * inte skiljer dem är trasig, oavsett hur "grön" den ser ut.
 */
const KNOWN_ARTICLE_TITLES = [
  'Har du glömt något på Kulturfestivalen?',
  'Varför är vissa gator avstängda inför festivalen?',
  'När sker Kulturfestivalen 2026?',
  'Så väljer du ekologisk gurkmeja för kök och produktion',
  'Därför dominerar mytologi och slott bland europeiska spelteman',
  'Guiden till halloweenfester i Stockholm',
  'Ansökan öppen: vistelsestipendium till Grez sur Loing',
];
const KNOWN_EVENT_TITLES = [
  'Nietzsche kontra Wagner',
  'Årsmöte',
  'Helgkurs – Improvisationsteater Karaktär 21-22 november',
  'Julmarknad på Nordiska museet',
  'Lär dig stöpa ljus med bivax',
  'Utställning: Fritt fall – om modet att släppa taget – Jenny Axelsson',
  'Benjamin Ingrosso – What Happens Next?',
  '15 Minutes of Art: Will You Be Profitable, My Friend?',
];

async function main() {
  console.log('═══ verify-source-quality ═══');
  console.log(`   ${new Date().toISOString()}`);
  console.log(`   fönster: ${windowHours} h · gaten infördes ${GATE_INTRODUCED_AT}`);

  const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();

  // ── Q1: discovery producerar nya kandidater ─────────────────────────────
  const { data: newCandidates, error: cErr } = await sb
    .from('source_candidates')
    .select('id,created_at,city')
    .gte('created_at', since);
  gate(
    'Q1',
    'discovery producerar nya kandidater',
    cErr ? null : (newCandidates ?? []).length > 0,
    cErr ? cErr.message : `${(newCandidates ?? []).length} nya kandidater sedan ${since.slice(0, 16)}`,
  );

  // ── Q2: P3D testar och sparar beslut ─────────────────────────────────────
  const { data: newDecisions } = await sb
    .from('source_candidate_test_decisions')
    .select('decision,created_at,promoted_source_id,reason')
    .gte('created_at', since);
  const decisions = newDecisions ?? [];
  const promoteDecisions = decisions.filter((d) => d.decision === 'promote');
  const rejectDecisions = decisions.filter((d) => d.decision === 'reject');
  gate(
    'Q2',
    'P3D testade kandidater och sparade beslut',
    decisions.length > 0,
    decisions.length > 0
      ? `${decisions.length} beslut (${promoteDecisions.length} promote, ${rejectDecisions.length} reject)`
      : `inga beslut i fönstret — inget att bedöma`,
  );

  // ── Q3: promote skriver källfiler ────────────────────────────────────────
  const promotedIds = [...new Set(promoteDecisions.map((d) => d.promoted_source_id).filter(Boolean))];
  const withFile = promotedIds.filter((id) => fs.existsSync(path.join(SOURCES_DIR, `${id}.jsonl`)));
  gate(
    'Q3',
    'promote skrev källfiler',
    promotedIds.length === 0 ? null : withFile.length === promotedIds.length,
    promotedIds.length === 0
      ? 'inga promotes i fönstret'
      : `${withFile.length}/${promotedIds.length} källfiler finns (${withFile.join(', ') || 'saknas'})`,
  );

  // ── Q4: de nya källorna når databasen ────────────────────────────────────
  const dbBySource = await rowsForSources(promotedIds);
  const reached = promotedIds.filter((id) => (dbBySource.get(id) ?? []).length > 0);
  const totalNewRows = [...dbBySource.values()].reduce((s, rs) => s + rs.length, 0);
  gate(
    'Q4',
    'de nya källorna når databasen',
    promotedIds.length === 0 ? null : reached.length > 0,
    promotedIds.length === 0
      ? 'inga promotes i fönstret'
      : `${reached.length}/${promotedIds.length} källor har events i events_public (${totalNewRows} rader)`,
  );

  // ── Q5: SANNHET — det gaten släppt igenom är evenemang ─────────────────
  // Bara promote:ade källor EFTER gaten infördes har gått igenom gaten.
  // Äldre källor mäts i Q6 (retro) och redovisas som skuldbank.
  const { data: postGateDecisions } = await sb
    .from('source_candidate_test_decisions')
    .select('promoted_source_id,created_at')
    .eq('decision', 'promote')
    .not('promoted_source_id', 'is', null)
    .gte('created_at', GATE_INTRODUCED_AT);
  const postGateIds = [...new Set((postGateDecisions ?? []).map((d) => d.promoted_source_id).filter(Boolean))];
  const postGateRows = await rowsForSources(postGateIds);

  const truthPerSource = [];
  for (const id of postGateIds) {
    const rows = postGateRows.get(id) ?? [];
    if (rows.length === 0) continue;
    const titles = rows.map((r) => r.title_sv || r.title_en || '');
    const extracted = extractedRows(id);
    let assessment;
    if (extracted.some((r) => isFetchableUrl(r.url))) {
      const signals = await probeRowPages(extracted, { limit: 3 });
      // FLAT form — samma som P3D skickar in.
      assessment = assessLikeness(signals);
    } else {
      assessment = assessLikeness(titles.map((title) => ({ title })));
    }
    truthPerSource.push({ sourceId: id, rows: rows.length, verdict: assessment.verdict, reasons: assessment.reasons });
  }
  const articleSources = truthPerSource.filter((t) => t.verdict === 'article');
  gate(
    'Q5',
    'SANNING — de källor gaten släpper igenom är evenemang, inte artiklar',
    truthPerSource.length === 0 ? null : articleSources.length === 0,
    truthPerSource.length === 0
      ? `gaten har inte körts på ny data ännu (0 promote efter ${GATE_INTRODUCED_AT.slice(0, 16)})`
      : articleSources.length === 0
        ? `${truthPerSource.length} källor bedömda, ingen artikelkälla`
        : `ARTICLEKÄLLOR: ${articleSources.map((t) => `${t.sourceId} (${t.reasons.join('; ')})`).join(' | ')}`,
    { perSource: truthPerSource },
  );

  // ── Q6: RETRO-GATE — den riktiga beslutsfunktionen på riktiga gamla data ─
  // Vi kör `decideSourceCandidateOutcome` (P3D:s faktiska motor) med de
  // verkliga raderna från varje promote:ad källa. Det svarar på frågan:
  // "vad hade gaten blockat?" — mätt, inte gissat.
  const { data: allPromoted } = await sb
    .from('source_candidate_test_decisions')
    .select('promoted_source_id')
    .eq('decision', 'promote')
    .not('promoted_source_id', 'is', null);
  const allPromotedIds = [...new Set((allPromoted ?? []).map((d) => d.promoted_source_id).filter(Boolean))];
  const allRows = await rowsForSources(allPromotedIds);

  const retro = [];
  for (const id of allPromotedIds) {
    const rows = allRows.get(id) ?? [];
    if (rows.length === 0) continue;
    const titles = rows.map((r) => r.title_sv || r.title_en || '');
    const extracted = extractedRows(id);
    const signals = extracted.length > 0 ? await probeRowPages(extracted, { limit: 5 }) : [];

    const decision = decideSourceCandidateOutcome({
      candidate: {
        id: `retro-${id}`,
        candidateUrl: '',
        priorityScore: 0,
        confidenceScore: 0,
        originPath: [],
        evidenceRefs: [],
      },
      phase: 'smoke',
      eventsFoundTotal: rows.length,
      eventsAfterNormalization: rows.length,
      eventsPersisted: rows.length,
      winningPath: 'html',
      errors: [],
      riskFlags: [],
      reportComplete: true,
      duplicateCanonicalSource: false,
      eventTitles: titles,
      eventPageSignals: signals,
    });

    // Sidorna som själva deklarerar `Event` FÅR aldrig blockas.
    const declaresEvent = signals.some((s) => (s.jsonLdTypes ?? []).map((t) => String(t).toLowerCase()).includes('event'));
    retro.push({
      sourceId: id,
      rows: rows.length,
      decision: decision.decision,
      reason: decision.reason,
      declaresEvent,
      titles: titles.slice(0, 3),
    });
  }

  const retroBlocked = retro.filter((r) => r.decision === 'reject');
  const retroFalseAlarm = retroBlocked.filter((r) => r.declaresEvent);
  const retroOk = retroBlocked.length > 0 && retroFalseAlarm.length === 0;
  gate(
    'Q6',
    'RETRO-GATE — P3D:s motor blockerar artikelkällor och släpper igenom evenemang',
    retro.length === 0 ? null : retroOk,
    retro.length === 0
      ? 'inga promote:ade källor att köra retro-gaten på'
      : retroOk
        ? `${retroBlocked.length}/${retro.length} källor skulle blockats, 0 falsklarm`
        : retroFalseAlarm.length > 0
          ? `FALSKLARM: ${retroFalseAlarm.map((r) => `${r.sourceId} deklarerar Event`).join(', ')}`
          : 'gaten blockerade ingen källa — mät om gaten biter alls',
    {
      blocked: retroBlocked.map((r) => ({ sourceId: r.sourceId, rows: r.rows, reason: r.reason, titles: r.titles })),
      falseAlarms: retroFalseAlarm.map((r) => r.sourceId),
      evaluated: retro.length,
    },
  );

  // ── Q7: RIKEDOM — finns informationen på detaljsidan? ────────────────────
  const flat = [...allRows.values()].flat();
  const withVenue = flat.filter((r) => !!r.venue_full_name).length;
  const withDescription = flat.filter((r) => !!(r.description_sv || r.description_en)).length;
  const venueRate = flat.length > 0 ? withVenue / flat.length : 0;
  // Baslinjen mätt 2026-11-01 före berikningen: 18 % med plats, 0 % med
  // beskrivning. Gaten får INTE sämre än baslinjen.
  const BASELINE_VENUE_RATE = 0.18;
  gate(
    'Q7',
    'RIKEDOM — raderna bär den information som finns på detaljsidan',
    flat.length === 0 ? null : venueRate >= BASELINE_VENUE_RATE,
    flat.length === 0
      ? 'inga rader att mäta'
      : `plats ${withVenue}/${flat.length} (${Math.round(venueRate * 100)} %, baslinj ${Math.round(BASELINE_VENUE_RATE * 100)} %) · beskrivning ${withDescription}/${flat.length}`,
    { rows: flat.length, withVenue, withDescription, venueRate, baseline: BASELINE_VENUE_RATE },
  );

  // ── Q8: NEGATIV KONTROLL — skiljer klassifikatorn verkligen? ─────────────
  const articleEscaped = KNOWN_ARTICLE_TITLES.filter((t) => classifyTitleShape(t) !== 'article');
  const eventWronglyBlocked = KNOWN_EVENT_TITLES.filter((t) => classifyTitleShape(t) === 'article');
  const controlOk = articleEscaped.length === 0 && eventWronglyBlocked.length === 0;
  gate(
    'Q8',
    'NEGATIV KONTROLL — kända artiklar fångas, kända evenemang släpps igenom',
    controlOk,
    controlOk
      ? `${KNOWN_ARTICLE_TITLES.length}/${KNOWN_ARTICLE_TITLES.length} artiklar fångade · ${KNOWN_EVENT_TITLES.length}/${KNOWN_EVENT_TITLES.length} evenemang släppta igenom`
      : `släppt igenom: ${[...articleEscaped, ...eventWronglyBlocked].join(' | ')}`,
  );

  // ── Q9: berikningen fyller faktiskt fält på riktiga sidor ────────────────
  // Vi kör berikningen på rader som SAKNAR uppgifter — samma urval som
  // driftkoden — och mäter vad som fylls. Ingen skrivning till disk.
  const candidates = [];
  for (const id of allPromotedIds) {
    for (const row of extractedRows(id)) {
      if (!isFetchableUrl(row.url)) continue;
      if (missingEnrichableFields(row).length === 0) continue;
      candidates.push(row);
      if (candidates.length >= 12) break;
    }
    if (candidates.length >= 12) break;
  }

  let enrichFilled = 0;
  let enrichTried = 0;
  let enrichHttpFail = 0;
  const enrichSamples = [];
  const filledFields = {};
  for (const row of candidates) {
    enrichTried++;
    try {
      const res = await fetch(row.url, {
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; EventPulse verify/1.0)' },
      });
      if (!res.ok) {
        enrichHttpFail++;
        continue;
      }
      const facts = extractDetailFacts(await res.text());
      const { filled } = mergeEnrichment(row, facts);
      if (filled.length > 0) {
        enrichFilled++;
        for (const f of filled) filledFields[f] = (filledFields[f] ?? 0) + 1;
        if (enrichSamples.length < 5) {
          enrichSamples.push({ title: String(row.title).slice(0, 50), filled });
        }
      }
    } catch {
      enrichHttpFail++;
    }
  }
  gate(
    'Q9',
    'berikningen fyller fält på riktiga detaljsidor',
    enrichTried === 0 ? null : enrichFilled > 0,
    enrichTried === 0
      ? 'inga rader som saknar uppgifter att prova'
      : `${enrichFilled}/${enrichTried} rader fick fält ifyllda (${enrichHttpFail} nätverksfel) · ${JSON.stringify(filledFields)}`,
    { samples: enrichSamples, tried: enrichTried, filled: enrichFilled, fields: filledFields },
  );

  // ── SKULDBANK — artikelkällor som redan är inne (informativt) ──────────
  // Retro-gaten ovan blockerar dem; detta är samma lista, som skuld.
  const legacyPolluted = retroBlocked.map((r) => ({
    sourceId: r.sourceId,
    rows: r.rows,
    examples: r.titles,
    reason: r.reason,
  }));

  const failed = results.filter((r) => r.ok === false).map((r) => r.id);
  const unknown = results.filter((r) => r.ok === null).map((r) => r.id);

  console.log('');
  console.log(`  röda gater : ${failed.length ? failed.join(', ') : 'inga'}`);
  console.log(`  okända     : ${unknown.length ? unknown.join(', ') : 'inga'}`);
  console.log(
    `  skuldbank (källor gaten skulle blockat): ${legacyPolluted.length ? legacyPolluted.map((p) => `${p.sourceId} (${p.rows} rader)`).join(', ') : 'tomt'}`,
  );

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `source-quality-${ts()}.json`);
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        windowHours,
        gateIntroducedAt: GATE_INTRODUCED_AT,
        gates: results,
        failed,
        unknown,
        legacyPolluted,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  if (asJson) {
    console.log(JSON.stringify({ gates: results, failed, unknown, legacyPolluted }, null, 2));
  }

  console.log('');
  console.log(`bevis: ${reportPath}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

await main().catch((err) => {
  console.error('[verify-source-quality] fatal:', err);
  process.exit(1);
});
