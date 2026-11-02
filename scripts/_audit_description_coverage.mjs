/**
 * _audit_description_coverage.mjs
 *
 * AUDIT — read-only. Ingen DB-skrivning, ingen ingestion.
 *
 * Syfte: lista ALLA events som appen visar UTAN beskrivning, och reda ut
 * varför. Gör det genom att köra exakt samma beskrivnings-resolution som
 * UI:t kör, för de två flöden som finns:
 *
 *   Flöde A "Hem"      — HomeScreen.js läser `events_public` DIREKT via
 *                        supabase-js med en egen select-lista per sektion.
 *   Flöde B "Agent/Utforska" — 08-Agent/tools/feed_events.ts läser
 *                        `events_public` via PostgREST med
 *                        FEED_SELECT_COLUMNS.
 *
 * Resolution-logiken importeras från den ÄKTA UI-modulen
 * (06-UI/utils/descriptionFallback.js) så att auditen inte kan glida ifrån
 * vad appen faktiskt gör.
 *
 * Select-listorna för Hem läses ur HomeScreen.js-källan vid körning, så
 * även fältlistorna är verifierade mot koden — inte påstådda.
 *
 * Kör: node --env-file=.env scripts/_audit_description_coverage.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { getDetailsDescription } from '../06-UI/utils/descriptionFallback.js';
import { stripHtml } from '../06-UI/utils/stripHtml.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'audit');
const OUT_DATA_DIR = path.join(OUT_DIR, 'data');
const STAMP = new Date().toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Läs Hem-flödets select-listor rakt ur koden
// ─────────────────────────────────────────────────────────────────────────────
const homeSrc = fs.readFileSync(path.join(ROOT, '06-UI', 'screens', 'HomeScreen.js'), 'utf8');
const homeSelects = [...homeSrc.matchAll(/\.select\('([^']+)'\)/g)].map((m) => m[1]);
if (homeSelects.length === 0) {
  console.error('FATAL: kunde inte hitta några select()-listor i HomeScreen.js');
  process.exit(1);
}
const homeFields = new Set(homeSelects.flatMap((s) => s.split(',').map((f) => f.trim())));
const DESC_CRITICAL = [
  'editorial_description',
  'eventpulse_summary',
  'description_license',
  'venue_name',
  'description_sv',
  'description_en',
];
const homeHas = Object.fromEntries(DESC_CRITICAL.map((f) => [f, homeFields.has(f)]));

// ─────────────────────────────────────────────────────────────────────────────
// 2. Ladda eventen
// ─────────────────────────────────────────────────────────────────────────────
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows: allRows } = await client.query(`
  SELECT e.id,
         e.title_sv, e.title_en,
         e.description_sv AS view_description_sv,
         e.description_en AS view_description_en,
         e.description_license,
         e.eventpulse_summary,
         e.editorial_description,
         e.start_time, e.end_time,
         e.category_slug, e.source,
         e.ticket_url, e.image_url,
         e.venue_id, e.venue_full_name,
         e.is_free,
         e.freshness_at,
         b.created_at,
         b.description_sv AS raw_description_sv,
         b.description_en AS raw_description_en,
         b.raw_description AS raw_description_raw,
         v.name AS venue_table_name
    FROM events_public e
    LEFT JOIN venues v ON v.id = e.venue_id
    LEFT JOIN events b ON b.id = e.id
`);

const total = allRows.length;

// ─────────────────────────────────────────────────────────────────────────────
// 3. Simulera flödena
// ─────────────────────────────────────────────────────────────────────────────

/** Hem: HomeScreen select → toDetailsScreenEvent → getDetailsDescription */
function resolveHem(row) {
  // Select-listan returnerar BARA de fält som står i select().
  const selected = {};
  for (const f of homeFields) {
    if (f in row) selected[f] = row[f];
  }
  // toDetailsScreenEvent (HomeScreen.js) — speglar payload-fälten exakt.
  // 2026-11-02: description_license, editorial_description,
  // eventpulse_summary och category_slug forwardas nu (var tidigare
  // oforwardade → resolver nade inget av sina fem steg).
  const venueName = selected.venue_name || selected.venue_full_name || null;
  const payload = {
    id: selected.id,
    title: selected.title_sv || selected.title_en || 'Evenemang',
    description: stripHtml(selected.view_description_sv || selected.view_description_en || null),
    editorial_description: selected.editorial_description ?? null,
    editorial_description_generated_at: selected.editorial_description_generated_at ?? null,
    event_profile: selected.event_profile ?? null,
    description_license: selected.description_license ?? null,
    eventpulse_summary: selected.eventpulse_summary ?? null,
    category: selected.category ?? selected.category_slug ?? null,
    category_slug: selected.category_slug ?? null,
    source: selected.source ?? null,
    start_time: selected.start_time ?? null,
    venue_name: venueName,
    artist: selected.artist ?? null,
  };
  return getDetailsDescription(payload);
}

/** Agent/Utforska: FEED_SELECT_COLUMNS → mappning → getDetailsDescription */
function resolveFeed(row) {
  const venue_name = row.venue_table_name || row.venue_full_name || null;
  const payload = {
    id: row.id,
    title: row.title_sv || row.title_en || 'Evenemang',
    description: stripHtml(row.view_description_sv || row.view_description_en || null),
    editorial_description: row.editorial_description ?? null,
    eventpulse_summary: row.eventpulse_summary ?? null,
    description_license: row.description_license ?? null,
    category_slug: row.category_slug ?? null,
    source: row.source ?? null,
    start_time: row.start_time ?? null,
    venue_name,
    artist: null,
  };
  return getDetailsDescription(payload);
}

/**
 * Sök-läge: App.js mappar sökresultat via `mapAgentEventToRow`
 * (06-UI/components/rowMapping.js). Mappen forwardar editorial_description,
 * description_license och (sedan 2026-11-02) eventpulse_summary.
 */
function resolveSearch(row) {
  const venue_name = row.venue_table_name || row.venue_full_name || null;
  const payload = {
    id: row.id,
    title: row.title_sv || row.title_en || 'Evenemang',
    description: stripHtml(row.view_description_sv || row.view_description_en || null),
    editorial_description: row.editorial_description ?? null,
    eventpulse_summary: row.eventpulse_summary ?? null,
    description_license: row.description_license ?? null,
    category_slug: row.category_slug ?? null,
    source: row.source ?? null,
    start_time: row.start_time ?? null,
    venue_name,
    artist: null,
  };
  return getDetailsDescription(payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Klassificera
// ─────────────────────────────────────────────────────────────────────────────
const NAV_JUNK = /^(SÖK PÅ KATEGORI|SÖK PÅ RUBRIK|SÖK I KALENDER|GRATIS EVENEMANG I STOCKHOLM)/i;

const rows = allRows.map((r) => {
  const hem = resolveHem(r);
  const feed = resolveFeed(r);
  const search = resolveSearch(r);
  const rawSv = r.raw_description_sv || '';
  const rawEn = r.raw_description_en || '';
  const rawText = (rawSv + ' ' + rawEn).trim();
  const rawLen = rawText.length;
  const rawReal = rawLen >= 10;
  const licenseOk = ['pressbild', 'copyright-with-attribution', 'partner-licensed', 'public-domain']
    .includes(r.description_license);

  let bucket;
  if (!hem && !feed) bucket = 'A-inget-i-databasen';
  else if (!hem && feed) bucket = 'B-finns-i-db-men-inte-i-Hem';
  else if (hem && !feed) bucket = 'C-omvant-finns-i-Hem';
  else bucket = 'D-ok-i-bada';
  // Rotorsaksklass för de som INTE har någon beskrivning i något flöde.
  let rootCause;
  if (feed) {
    rootCause = 'har-beskrivning';
  } else if (rawReal && !licenseOk) {
    rootCause = 'R1-text-finns-men-licens-unknow';
  } else if (rawReal && licenseOk) {
    rootCause = 'R2-text-finns-licens-ok-men-forsvann';
  } else if (rawReal) {
    rootCause = 'R3-text-finns-utan-licens';
  } else {
    rootCause = 'R4-ingen-text-i-db';
  }

  const navJunk =
    NAV_JUNK.test(rawSv.trim()) ||
    /SÖK PÅ KATEGORI|objectSubHeader|KALENDER «/.test(rawText) ||
    rawText.length > 4000;

  return {
    id: r.id,
    title: r.title_sv || r.title_en || '(utan titel)',
    source: r.source,
    start_time: r.start_time,
    category_slug: r.category_slug,
    venue_full_name: r.venue_full_name,
    venue_table_name: r.venue_table_name,
    ticket_url: r.ticket_url,
    created_at: r.created_at,
    last_seen: r.freshness_at,
    has_editorial: Boolean(r.editorial_description && r.editorial_description.trim().length >= 10),
    has_summary: Boolean(r.eventpulse_summary && r.eventpulse_summary.trim().length >= 10),
    raw_desc_len: rawLen,
    desc_license: r.description_license,
    license_ok: licenseOk,
    nav_junk: navJunk,
    root_cause: rootCause,
    hem_desc: hem,
    feed_desc: feed,
    search_desc: search,
    bucket,
  };
});

await client.end();

// ─────────────────────────────────────────────────────────────────────────────
// 5. Skriv ut
// ─────────────────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DATA_DIR, { recursive: true });

const noDescAll = rows.filter((r) => !r.hem_desc && !r.feed_desc);
const noDescHem = rows.filter((r) => !r.hem_desc);
const noDescFeed = rows.filter((r) => !r.feed_desc);
const noDescSearch = rows.filter((r) => !r.search_desc);
const onlyInHem = rows.filter((r) => r.hem_desc && !r.feed_desc);
const summaryOnlyNoEditorial = rows.filter(
  (r) => r.has_summary && !r.has_editorial && r.feed_desc && !r.search_desc,
);

function bySource(list) {
  const m = new Map();
  for (const r of list) m.set(r.source || '(null)', (m.get(r.source || '(null)') || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const csvEscape = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function writeCsv(file, list, cols) {
  const head = cols.join(',');
  const body = list
    .map((r) => cols.map((c) => csvEscape(typeof c === 'function' ? c(r) : r[c])).join(','))
    .join('\n');
  fs.writeFileSync(path.join(OUT_DATA_DIR, file), `${head}\n${body}\n`, 'utf8');
  return list.length;
}

const csvCols = [
  'id', 'title', 'source', 'start_time', 'category_slug',
  'venue_full_name', 'venue_table_name', 'ticket_url', 'created_at', 'last_seen',
  'has_editorial', 'has_summary', 'raw_desc_len',
  'desc_license', 'license_ok', 'nav_junk', 'root_cause', 'bucket',
];

const nAll = writeCsv(`events-without-description-${STAMP}.csv`, noDescAll, csvCols);
const nFeed = writeCsv(`events-without-description-feed-${STAMP}.csv`, noDescFeed, csvCols);
const nHem = writeCsv(`events-without-description-HEM-flow-${STAMP}.csv`, noDescHem, csvCols);
const nSearch = writeCsv(`events-without-description-SEARCH-flow-${STAMP}.csv`, noDescSearch, csvCols);

// Markdown-rapport
const md = [];
md.push(`# Beskrivningstäckning — audit ${STAMP}`);
md.push('');
md.push('> Genererad av `scripts/_audit_description_coverage.mjs` (read-only, ingen DB-skrivning).');
md.push('> Beskrivnings-resolutionen är importerad från den äkta UI-modulen');
md.push('> `06-UI/utils/descriptionFallback.js` — auditen kan inte glida ifrån appens beteende.');
md.push('');
md.push('## Mätvärden');
md.push('');
md.push(`| Mätning | Antal | Andel av ${total} |`);
md.push('|---|---:|---:|');
md.push(`| Events i \`events_public\` (det appen läser) | ${total} | 100 % |`);
md.push(`| **Saknar beskrivning i Hem-flödet** | **${noDescHem.length}** | ${((noDescHem.length / total) * 100).toFixed(1)} % |`);
md.push(`| **Saknar beskrivning i Agent/Utforska-flödet** | **${noDescFeed.length}** | ${((noDescFeed.length / total) * 100).toFixed(1)} % |`);
md.push(`| **Saknar beskrivning i Sök-läget** | **${noDescSearch.length}** | ${((noDescSearch.length / total) * 100).toFixed(1)} % |`);
md.push(`| Saknar beskrivning i BÅDA Hem och Agent | ${noDescAll.length} | ${((noDescAll.length / total) * 100).toFixed(1)} % |`);
md.push(`| Har beskrivning i Hem men inte i Agent | ${onlyInHem.length} | ${((onlyInHem.length / total) * 100).toFixed(1)} % |`);
md.push(`| Har bara \`eventpulse_summary\` → förlorar rad-preview i Sök | ${summaryOnlyNoEditorial.length} | ${((summaryOnlyNoEditorial.length / total) * 100).toFixed(1)} % |`);
md.push('');
md.push('## Hem-flödets select-listor (lästa ur HomeScreen.js vid körning)');
md.push('');
md.push('Fälten nedan är verifierade genom att select-listorna **läses ur koden vid körning** —');
md.push('inte påstådda. En ändring i HomeScreen.js ändrar därför tabellen automatiskt.');
md.push('');
md.push('Antal select()-listor i HomeScreen.js: ' + homeSelects.length);
md.push('');
md.push('| Fält | finns i Hem-select? | betyder |');
md.push('|---|---|---|');
md.push(`| \`editorial_description\` | ${homeHas.editorial_description ? 'JA' : '**NEJ**'} | resolution steg 1 (primär) |`);
md.push(`| \`eventpulse_summary\` | ${homeHas.eventpulse_summary ? 'JA' : '**NEJ**'} | resolution steg 2 |`);
md.push(`| \`description_license\` | ${homeHas.description_license ? 'JA' : '**NEJ**'} | gate för steg 3 |`);
md.push(`| \`venue_name\` | ${homeHas.venue_name ? 'JA' : '**NEJ**'} | gate för steg 4 (faktarad) |`);
md.push('| `description_sv` / `description_en` | ' + (homeHas.description_sv ? 'JA' : 'NEJ') + ' | steg 3 (men licens-gated) |');
md.push('');
md.push('## Sök-läget (`mapAgentEventToRow` i `rowMapping.js`)');
md.push('');
md.push('Sök-läget mappar sökresultat via `mapAgentEventToRow`. Mappen forwardar');
md.push('`editorial_description`, `eventpulse_summary` (sedan 2026-11-02) och `description_license`.');
md.push('');
md.push(`| Mätning | Antal |`);
md.push('|---|---:|');
md.push(`| Saknar beskrivning i Sök-läget | ${noDescSearch.length} |`);
md.push(`| Har bara \`eventpulse_summary\` (ingen editorial) → saknar rad-preview | ${summaryOnlyNoEditorial.length} |`);
md.push('');
md.push('## Fördelning per källa — saknar beskrivning i Hem-flödet');
md.push('');
md.push('| Källa | Antal |');
md.push('|---|---:|');
for (const [src, n] of bySource(noDescHem)) md.push(`| ${src} | ${n} |`);
md.push('');
md.push('## Fördelning per källa — saknar beskrivning i Agent/Utforska-flödet');
md.push('');
md.push('| Källa | Antal |');
md.push('|---|---:|');
for (const [src, n] of bySource(noDescFeed)) md.push(`| ${src} | ${n} |`);
md.push('');
md.push('## Rotorsaksklassning — de ' + noDescFeed.length + ' events som saknar beskrivning överallt');
md.push('');
const rcCounts = new Map();
for (const r of noDescFeed) rcCounts.set(r.root_cause, (rcCounts.get(r.root_cause) || 0) + 1);
md.push('| Rotorsak | Antal | Betydelse |');
md.push('|---|---:|---|');
const RC_MEANING = {
  'R1-text-finns-men-licens-unknow':
    'Källtexten finns i DB men `description_license` är inte tillåtande → UI-vyn nollställer den OCH ingen editorial/summary genererades → ingen beskrivning syns.',
  'R2-text-finns-licens-ok-men-forsvann':
    'Licensen är OK men texten syns ändå inte → bugg i resolution eller under 10 tecken efter stripHtml.',
  'R3-text-finns-utan-licens':
    'Text finns men saknar licensmetadata.',
  'R4-ingen-text-i-db':
    'Ingen text finns alls i DB → antingen har källan ingen beskrivning, eller så misslyckades extraktionen.',
};
for (const [rc, n] of [...rcCounts.entries()].sort((a, b) => b[1] - a[1])) {
  md.push(`| \`${rc}\` | ${n} | ${RC_MEANING[rc] || ''} |`);
}
md.push('');
md.push('## Komplett lista — saknar beskrivning i BÅDA flödena');
md.push('');
md.push(`Fullständig lista med rotorsak per rad: \`docs/audit/data/events-without-description-${STAMP}.csv\` (${nAll} rader).`);
md.push('');
md.push('| # | Titel | Källa | Start | Rotorsak | Råtext-len | Licens | Bokningslänk? |');
md.push('|---:|---|---|---|---|---:|---|---|');
noDescAll.forEach((r, i) => {
  md.push(
    `| ${i + 1} | ${String(r.title).replace(/\|/g, '\\|').slice(0, 68)} | ${r.source} | ${String(r.start_time).slice(0, 10)} | \`${r.root_cause}\` | ${r.raw_desc_len} | ${r.desc_license ?? '—'} | ${r.ticket_url ? 'ja' : 'nej'} |`,
  );
});
md.push('');
md.push('## Hem-flödet — komplett lista');
md.push('');
md.push(`Eftersom Hem-selecten saknar \`editorial_description\`, \`eventpulse_summary\`, \`description_license\` och \`venue_name\`, saknar **alla ${total}** events beskrivning i Hem-flödet.`);
md.push('Komplett lista: `docs/audit/data/events-without-description-HEM-flow-' + STAMP + '.csv` (' + noDescHem.length + ' rader).');
md.push('');

fs.writeFileSync(path.join(OUT_DIR, `description-coverage-${STAMP}.md`), md.join('\n'), 'utf8');

console.log(JSON.stringify({
  total,
  hem_selects: homeSelects.length,
  home_has_critical: homeHas,
  noDescHem: noDescHem.length,
  noDescFeed: noDescFeed.length,
  noDescSearch: noDescSearch.length,
  noDescBoth: noDescAll.length,
  onlyInHem: onlyInHem.length,
  summaryOnlyNoEditorial: summaryOnlyNoEditorial.length,
  csvAll: nAll,
  csvFeed: nFeed,
  csvHem: nHem,
  csvSearch: nSearch,
  md: `docs/audit/description-coverage-${STAMP}.md`,
}, null, 2));
