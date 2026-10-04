// scripts/extract-artipelag.mjs — Hämta aktuella utställningar från Artipelag
//
// 2026-10-04: Artipelag har ingen JSON-LD Event på individuella utställningssidor,
// utan bara date-range i klartext (t.ex. "10 oktober 2026 - 11 april 2027").
// Vi parsar /pa-gang/utstallning/ för att hitta länkar, sedan varje sida för
// datumintervall och h1-titel. Skapar events med start_date = första datumet,
// kategori 'exhibition'.
//
// Användning:
//   cd /Users/claudgashi/EventPulse && node scripts/extract-artipelag.mjs [--dry-run]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv() {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, 'utf8');
      for (const line of raw.split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (!m) continue;
        if (process.env[m[1]] == null) process.env[m[1]] = m[2];
      }
      return;
    } catch {}
  }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const { createClient } = await import('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DRY_RUN = process.argv.includes('--dry-run');
const SOURCE = 'artipelag';
const VENUE_NAME = 'Artipelag';
const VENUE_LAT = 59.2761; // Artipelag, Gustavsberg
const VENUE_LNG = 18.3403;

const MONTHS = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mar: 3, mars: 3,
  apr: 4, april: 4,
  maj: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  aug: 8, augusti: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function parseSwedishDate(day, monthName, year) {
  const m = MONTHS[monthName.toLowerCase()];
  if (!m) return null;
  return `${year}-${String(m).padStart(2, '0')}-${String(parseInt(day, 10)).padStart(2, '0')}`;
}

async function fetchExhibitionList() {
  const r = await fetch('https://artipelag.se/pa-gang/utstallning/', {
    headers: { 'User-Agent': 'EventPulse-Ingestion/1.0' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for /pa-gang/utstallning/`);
  const html = await r.text();
  // Match exhibition URLs (deduped)
  const seen = new Set();
  const urls = [];
  for (const m of html.matchAll(/href="(https:\/\/artipelag\.se\/pa-gang\/utstallning\/[a-z0-9-]+)\/?/gi)) {
    const url = m[1];
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

async function extractExhibition(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'EventPulse-Ingestion/1.0' } });
  if (!r.ok) return null;
  const html = await r.text();
  // Title
  const t = html.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/);
  const title = t ? t[1].trim().replace(/\s+/g, ' ') : '';
  if (!title) return null;
  // Date range: "10 oktober 2026 - 11 april 2027"
  const dr = html.match(/(\d{1,2})\s+([a-zåäö]+)\s+(\d{4})\s*[-–—]\s*(\d{1,2})\s+([a-zåäö]+)\s+(\d{4})/i);
  if (!dr) return null;
  const startDate = parseSwedishDate(dr[1], dr[2], dr[3]);
  const endDate = parseSwedishDate(dr[4], dr[5], dr[6]);
  if (!startDate || !endDate) return null;
  // Description from og:description
  const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/i);
  const description = ogDesc ? ogDesc[1].trim() : null;
  // Image from og:image
  const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/i);
  const imageUrl = ogImage ? ogImage[1].trim() : null;
  return { title, startDate, endDate, description, imageUrl, url };
}

async function main() {
  const urls = await fetchExhibitionList();
  console.log(`[artipelag] Hittade ${urls.length} utställningar`);
  const exhibitions = [];
  for (const u of urls) {
    const e = await extractExhibition(u);
    if (e) exhibitions.push(e);
    else console.warn(`  skip: ${u}`);
  }
  console.log(`[artipelag] Parsade ${exhibitions.length} utställningar med datum`);

  const now = new Date();
  const future = exhibitions.filter((e) => new Date(e.endDate) > now);
  console.log(`[artipelag] Framtida utställningar: ${future.length}`);

  if (future.length === 0) {
    console.log('Inga framtida utställningar — avbryter.');
    return;
  }

  console.log('\nSample:');
  for (const e of future) {
    console.log(`  ${e.startDate} - ${e.endDate}: ${e.title}`);
  }

  const nowIso = new Date().toISOString();
  const rows = future.map((e) => ({
    title_sv: e.title,
    title_en: e.title,
    description_sv: e.description,
    description_en: e.description,
    start_time: `${e.startDate}T00:00:00+00:00`,
    end_time: `${e.endDate}T23:59:59+00:00`,
    lat: VENUE_LAT,
    lng: VENUE_LNG,
    ticket_url: e.url,
    source: SOURCE,
    image_url: e.imageUrl,
    category_slug: 'exhibition',
    is_free: false,
    link_status: 'live',
    link_last_checked_at: nowIso,
    status: 'published',
    confidence_score: 65,
    freshness_at: nowIso,
  }));

  if (DRY_RUN) {
    console.log(`\n[DRY-RUN] Skulle skriva ${rows.length} rader.`);
    return;
  }

  console.log(`\n[artipelag] Rensar befintliga ${SOURCE}-rader...`);
  const { error: clearErr } = await supabase.from('events').delete().eq('source', SOURCE);
  if (clearErr) console.warn(`  Rensning misslyckades: ${clearErr.message}`);
  else console.log('  Rensning klar.');

  console.log(`\n[artipelag] Skickar ${rows.length} events...`);
  let ok = 0, fail = 0;
  for (const r of rows) {
    const { error } = await supabase.from('events').insert(r);
    if (error) { fail++; if (fail <= 3) console.warn(`  fail: ${error.message.slice(0, 200)}`); }
    else ok++;
  }
  console.log(`\n[artipelag] OK: ${ok}, Fail: ${fail}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });