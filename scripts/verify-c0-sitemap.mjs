#!/usr/bin/env node
/**
 * verify-c0-sitemap.mjs — bevis för C0:s sitemap-expansion och
 * nästa-kandidat-fallbacken i C-gatens HTML-väg.
 *
 * Bakgrund (2026-10-24). C0 rankar kandidatsidor på "event density" och
 * testar sedan BARA vinnaren. två fel gjorde att massvis av källor dog:
 *
 *   1. **.xml-filer vann densitetslopet.** En sitemap-INDEX (/sitemap.xml)
 *      innehåller <loc> till sub-sitemap-FILER (/event-sitemap.xml). Varje
 *      <lastmod> i XML:en räknades som ett "datum", så .xml-filen fick
 *      50–250× högre density än en riktig HTML-sida → den vann → C1 svarade
 *      "no <main>" → källan dog.
 *
 *      Bevis från riktiga körningar: 112 av 112 C-gate-traces med .xml som
 *      effectiveUrl slutade i C1_NO_MAIN_ARTICLE. NOLL av dem lyckades.
 *
 *   2. **Bara vinnaren testades.** C0 hade redan rankat och mätt flera
 *      kandidater, men bara den bästa kördes vidare. När vinnaren gav 0
 *      events dog källan — trots att nästa kandidat hade events.
 *
 * Gates:
 *   c1 — positiv kontroll (live): den FÄRDA koden expanderar en riktig
 *        sitemap-index till riktiga sidor, och indexet innehöll .xml-rader
 *        (annars vore testet vakuum).
 *   c2 — negativ kontroll (live): FÖRE-fixens logik på samma sajter ger
 *        .xml-rader som kandidater → c1 kan faila, och mäter fixen.
 *   c3 — live-körningsbevis: de tre senaste batcharna har 0 xml-vinnare och
 *        ger events; nästa-kandidat-källor har ALLA events > 0 (fallbacken
 *        kan aldrig sänka eventantalet).
 *
 * Anropas som `node scripts/verify-c0-sitemap.mjs <c1|c2|c3>`.
 * Skriver ut `cN: <status> pass` på stdout vid PASS, annars `cN: FAIL …`
 * på stderr + exit 1. Utskriften matchas av GATES.md:s `EXPECT:`.
 */

import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const arg = process.argv[2];

const DEEP = path.join(ROOT, '02-Ingestion/C-htmlGate/tools/scrapingBeeDeep.ts');
const REPORTS = path.join(ROOT, '02-Ingestion/C-htmlGate/reports');

/**
 * Riktiga sajter som i batch-214 förlorade mot en .xml-vinnare.
 * De är valda ur en RIKTIG körning — inte påhittade.
 */
const SITES = [
  { id: 'wwwmodernamuseetse', url: 'https://www.modernamuseet.se/' },
  { id: 'wwwscalateaternse', url: 'https://www.scalateatern.se/' },
  { id: 'wwwpostmuseumse', url: 'https://www.postmuseum.se/' },
  { id: 'wwwchinateaternse', url: 'https://www.chinateatern.se/' },
];

function ok(msg) { console.log(msg); }
function fail(msg) { console.error(msg); process.exit(1); }

/**
 * Kör ett utdrag mot scrapingBeeDeep.ts med tsx och returnera JSON-resultatet.
 * Utdraget får anropa de exporterade funktionerna.
 */
function runDeep(code) {
  const probe = `
import { fetchSitemapEntries, fetchAllSitemaps } from ${JSON.stringify(DEEP)};
${code}
`;
  const probePath = path.join(path.dirname(DEEP), `.gate-c0-probe-${process.pid}.ts`);
  writeFileSync(probePath, probe, 'utf8');
  try {
    const res = spawnSync('npx', ['tsx', probePath], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    if (res.status !== 0) {
      return { error: `tsx-probe avslutade med ${res.status}: ${(res.stderr || '').trim().slice(0, 500)}` };
    }
    const line = (res.stdout || '').split('###RESULT###')[1];
    if (!line) return { error: `proben skrev ingen resultatrad: ${(res.stdout || '').trim().slice(0, 300)}` };
    return { data: JSON.parse(line.trim()) };
  } catch (e) {
    return { error: `tsx-probe kastade: ${e?.message ?? e}` };
  } finally {
    rmSync(probePath, { force: true });
  }
}

/** .xml-liknande URL = samma sak C0:s filter använder. */
function isXmlLike(u) {
  try {
    const p = new URL(u).pathname.toLowerCase();
    return p.endsWith('.xml') || p.endsWith('.xml.gz');
  } catch {
    return false;
  }
}

// ── C1: positiv kontroll — indexet expanderas till riktiga sidor ──────────

if (arg === 'c1') {
  const r = runDeep(`
const sites = ${JSON.stringify(SITES)};
const out = [];
for (const s of sites) {
  try {
    const res = await fetchSitemapEntries(s.url);
    out.push({
      id: s.id,
      entries: res.entries.length,
      xmlInEntries: res.entries.filter((e) => e.isSitemapFile).length,
      sitemapFiles: res.sitemapFiles.length,
      withLastmod: res.entries.filter((e) => e.lastmod).length,
      sample: res.entries.slice(0, 3).map((e) => e.loc),
    });
  } catch (e) {
    out.push({ id: s.id, error: String(e?.message ?? e) });
  }
}
console.log('###RESULT###' + JSON.stringify(out));
`);
  if (r.error) fail(`c1: ${r.error}`);

  const problems = [];
  let sitesWithIndex = 0;
  let totalEntries = 0;
  for (const s of r.data) {
    if (s.error) { problems.push(`${s.id}: ${s.error}`); continue; }
    if (s.entries === 0) { problems.push(`${s.id}: ingen poster efter expansion`); continue; }
    if (s.xmlInEntries > 0) {
      problems.push(`${s.id}: ${s.xmlInEntries} .xml-rader lästa som sidor — filtret fungerar inte`);
    }
    if (s.sitemapFiles === 0) {
      problems.push(`${s.id}: ingen sitemap-fil hittades`);
    } else {
      sitesWithIndex++;
    }
    totalEntries += s.entries;
  }
  // Vakuumkontroll: minst en sajt måste ha haft en .xml-rad i sitt index.
  // Utan det mäter c1 ingenting.
  const preXmlRows = runDeep(`
const sites = ${JSON.stringify(SITES)};
const out = [];
for (const s of sites) {
  try {
    const res = await fetchAllSitemaps(s.url);
    out.push({ id: s.id, urls: res.urls.length, xmlRows: res.urls.filter((u) => {
      try { const p = new URL(u).pathname.toLowerCase(); return p.endsWith('.xml') || p.endsWith('.xml.gz'); } catch { return false; }
    }).length });
  } catch (e) { out.push({ id: s.id, error: String(e?.message ?? e) }); }
}
console.log('###RESULT###' + JSON.stringify(out));
`);
  if (preXmlRows.error) fail(`c1: ${preXmlRows.error}`);
  const xmlIndexRows = preXmlRows.data.reduce((s, x) => s + (x.xmlRows ?? 0), 0);
  if (xmlIndexRows === 0) {
    fail('c1: ingen sajt hade en .xml-rad i sitt sitemap-index — testet är vakuum, mät en sajt som faktiskt använder sitemap-index');
  }
  if (problems.length) {
    fail(`c1: sitemap-expansionen fungerar inte:\n  ${problems.join('\n  ')}`);
  }
  ok(`c1: ${sitesWithIndex}/${SITES.length} sajter expanderade indexet till ${totalEntries} sidor, 0 .xml som sidor (indexet hade ${xmlIndexRows} .xml-rader) pass`);
}

// ── C2: negativ kontroll — före-fixens logik ger .xml-vinnare ─────────────

if (arg === 'c2') {
  const r = runDeep(`
const sites = ${JSON.stringify(SITES)};
const out = [];
for (const s of sites) {
  try {
    const res = await fetchAllSitemaps(s.url);
    const xmlRows = res.urls.filter((u) => {
      try { const p = new URL(u).pathname.toLowerCase(); return p.endsWith('.xml') || p.endsWith('.xml.gz'); } catch { return false; }
    });
    out.push({ id: s.id, urls: res.urls.length, xmlRows: xmlRows.length, sample: xmlRows.slice(0, 2) });
  } catch (e) { out.push({ id: s.id, error: String(e?.message ?? e) }); }
}
console.log('###RESULT###' + JSON.stringify(out));
`);
  if (r.error) fail(`c2: ${r.error}`);
  const withXml = r.data.filter((s) => !s.error && s.xmlRows > 0);
  const totalXml = r.data.reduce((s, x) => s + (x.xmlRows ?? 0), 0);
  if (totalXml === 0) {
    fail('c2: före-fixens logik gav 0 .xml-rader — negativa kontrollen kan inte faila, fixen mäts inte');
  }
  ok(`c2: utan expansionen ger ${withXml.length}/${SITES.length} sajter ${totalXml} .xml-kandidater (t.ex. ${withXml[0]?.sample?.[0] ?? '?'}) — gaten kan faila pass`);
}

// ── C3: live-körningsbevis från batch-traces ──────────────────────────────

if (arg === 'c3') {
  if (!existsSync(REPORTS)) fail('c3: batch-rapportkatalogen saknas');
  const batches = readdirSync(REPORTS)
    .filter((d) => d.startsWith('batch-'))
    .sort((a, b) => parseInt(a.slice(6), 10) - parseInt(b.slice(6), 10));
  const withTraces = batches.filter((b) => existsSync(path.join(REPORTS, b, 'batch-traces.jsonl')));
  if (withTraces.length < 4) fail('c3: för få batchar med traces att jämföra');

  const read = (b) => readFileSync(path.join(REPORTS, b, 'batch-traces.jsonl'), 'utf8')
    .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

  const recent = withTraces.slice(-3);
  const older = withTraces.slice(0, -3);

  let recentXmlWinners = 0;
  let recentEvents = 0;
  let nextCandidate = 0;
  let nextCandidateZero = 0;
  for (const b of recent) {
    for (const t of read(b)) {
      const ev = t.eventsFound ?? 0;
      recentEvents += ev;
      if (isXmlLike(t.effectiveUrl || '')) recentXmlWinners++;
      if (/next-candidate/.test(t.effectiveUrlReason || '')) {
        nextCandidate++;
        if (ev === 0) nextCandidateZero++;
      }
    }
  }

  // Historisk negativ kontroll: före-fixens batchar hade .xml-vinnare som
  // ALLA gav 0 events. Det är beviset på att .xml-vinnaren var död väg.
  let olderXml = 0;
  let olderXmlWithEvents = 0;
  for (const b of older) {
    for (const t of read(b)) {
      if (isXmlLike(t.effectiveUrl || '')) {
        olderXml++;
        if ((t.eventsFound ?? 0) > 0) olderXmlWithEvents++;
      }
    }
  }

  if (olderXml === 0) {
    fail('c3: ingen historisk batch hade en .xml-vinnare — jämförelsen mäter ingenting');
  }
  if (recentXmlWinners > 0) {
    fail(`c3: ${recentXmlWinners} .xml-vinnare i de senaste batcharna (${recent.join(', ')}) — sitemap-expansionen fungerar inte`);
  }
  if (recentEvents <= 0) {
    fail(`c3: de senaste batcharna gav 0 events totalt (${recent.join(', ')})`);
  }
  if (nextCandidate === 0) {
    fail('c3: ingen nästa-kandidat-källa i de senaste batcharna — fallbacken mäts inte');
  }
  if (nextCandidateZero > 0) {
    fail(`c3: ${nextCandidateZero} nästa-kandidat-källor har 0 events — fallbacken sänkte eventantalet`);
  }
  ok(`c3: senaste batcharna ${recent.join(', ')}: 0 .xml-vinnare, ${recentEvents} events, ${nextCandidate} nästa-kandidat-källor (alla med events > 0); historiskt ${olderXml} .xml-vinnare med ${olderXmlWithEvents} events pass`);
}

if (!['c1', 'c2', 'c3'].includes(arg)) {
  fail('usage: node scripts/verify-c0-sitemap.mjs <c1|c2|c3>');
}
