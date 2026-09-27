/**
 * _gaveup-stats.ts — analys av gaveup-events-2026-09-27.csv
 * Robust CSV-parser (hanterar citationstecken med inbäddade citationstecken)
 * + orsaks-statistik per rad.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && inQuotes && line[i + 1] === '"') {
      cur += '"'; i++; // escaped quote
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

interface Row {
  id: string;
  source: string;
  title: string;
  venue: string;
  desc_len: number;
  reasoning: string;
}

const fp = path.resolve(__dirname, '../../00-Vault/01-Projects/EventPulse/04-Sources/gaveup-events-2026-09-27.csv');
const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
const rows: Row[] = lines.slice(1).map(l => {
  const c = parseCsvLine(l);
  return {
    id: c[0], source: c[1], title: c[2], venue: c[3],
    desc_len: parseInt(c[4] ?? '0', 10),
    reasoning: c[5] ?? '',
  };
});

console.log(`Parsed ${rows.length} rows\n`);

// Source × cause matrix
const causeCounts: Record<string, number> = {
  music_no_genre: 0,
  business_network: 0,
  bokmässa: 0,
  arbeidsliv: 0,
  kort_beskrivning: 0,
  helg_konsert: 0,
  ovrigt: 0,
};

function classify(r: Row): string {
  const t = (r.title + ' ' + r.reasoning).toLowerCase();
  if (t.includes('konsert') && r.source === 'sthlmlist') return 'helg_konsert';
  if (t.includes('nätverk') || t.includes('business') || t.includes('microsoft') || t.includes('employer') || t.includes('hack') || t.includes('stockholm biggest')) return 'business_network';
  if (t.includes('bok') && (r.title.includes('bok') || t.includes('litteratur'))) return 'bokmässa';
  if (t.includes('konsert') || t.includes('musik') || t.includes('music')) return 'music_no_genre';
  if (r.desc_len <= 20) return 'kort_beskrivning';
  return 'ovrigt';
}

for (const r of rows) {
  const c = classify(r);
  causeCounts[c] = (causeCounts[c] ?? 0) + 1;
}
console.log('Cause tally:');
for (const [k, v] of Object.entries(causeCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(20)} ${v}`);
}

// Description length buckets
const buckets = { '0 (tom)': 0, '1-50': 0, '51-100': 0, '101-200': 0, '201+': 0 };
for (const r of rows) {
  if (r.desc_len === 0) buckets['0 (tom)']++;
  else if (r.desc_len <= 50) buckets['1-50']++;
  else if (r.desc_len <= 100) buckets['51-100']++;
  else if (r.desc_len <= 200) buckets['101-200']++;
  else buckets['201+']++;
}
console.log('\nDescription-length buckets:');
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(12)} ${v}`);

// Source matrix — bara de 5 största
const sourceCounts: Record<string, number> = {};
for (const r of rows) sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + 1;
console.log('\nTop 8 källor:');
for (const [k, v] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${k.padEnd(35)} ${v}`);
}

// Sample av sthlmlist-only (för handgranskning)
console.log('\n=== sthlmlist sample (10) ===');
for (const r of rows.filter(r => r.source === 'sthlmlist').slice(0, 10)) {
  console.log(`  desc=${r.desc_len.toString().padStart(4)} | ${r.title.padEnd(50)} | ${r.reasoning.slice(0, 70)}`);
}

// Sample av eventbrite-categories
console.log('\n=== eventbrite-* sample (10) ===');
for (const r of rows.filter(r => r.source.startsWith('eventbrite')).slice(0, 10)) {
  console.log(`  ${r.source.padEnd(35)} | ${r.title.slice(0, 60)} | ${r.reasoning.slice(0, 60)}`);
}

// Sample av tomma beskrivningar
console.log('\n=== desc_len === 0, sample (10) ===');
for (const r of rows.filter(r => r.desc_len === 0).slice(0, 10)) {
  console.log(`  ${r.source.padEnd(30)} | ${r.title.slice(0, 70)}`);
}
