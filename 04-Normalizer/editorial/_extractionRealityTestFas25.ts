/**
 * _extractionRealityTestFas25.ts
 *
 * Reality-test som jämför extraktion före/efter FAS 2.5.
 *
 * Mäter mot runtime/live-sample-2026-10-08.jsonl (46 events):
 *   - Recall: hur många av de 12 events-med-förväntade-artister som
 *     nu fångas?
 *   - Precision: hur många FP-entiteter kommer nu?
 *   - Negativ (Chicago/Hamlet/ABBA) fortfarande robusta?
 *
 * Verifierar att de nya mönstren INTE skapar regressioner på de
 * 23 befintliga negativa testerna (som vitest redan verifierar).
 */

import { readFileSync } from 'fs';
import { extractEntities } from './entityExtractor';

interface LiveEvent {
  event_id: string;
  title: string;
  category: string;
  venue: string | null;
  city: string | null;
}

const path = '/Users/claudgashi/EventPulse/runtime/live-sample-2026-10-08.jsonl';
const lines = readFileSync(path, 'utf-8').trim().split('\n');
const events: LiveEvent[] = lines.map(line => JSON.parse(line));

// Känt facit från P8-rapport (manuellt annoterat)
// Map: title-substring → expected entities med role
// Roller vi accepterar som "rätt" performer-roll för jämförelse
const PERFORMER_ROLES = new Set([
  'artist', 'ensemble', 'performer', 'comedian',
  'band', 'dj', 'conductor', 'soloist',
]);
const EXPECTED: Record<string, Array<{ name: string; role: string }>> = {
  'Anton Estby och Henrythefreak': [
    { name: 'Anton Estby', role: 'comedian' },
    { name: 'Henrythefreak', role: 'comedian' },
  ],
  'AIK - BIK Karlskoga': [
    { name: 'AIK', role: 'team' },
    { name: 'BIK Karlskoga', role: 'team' },
  ],
  'Musik till åminnelse': [
    { name: 'Radiokören', role: 'ensemble' },
    { name: 'Peter Dijkstra', role: 'artist' },
  ],
  'Quidam: Helene Berg': [
    { name: 'Helene Berg', role: 'artist' },
    { name: 'Paul Pignon', role: 'artist' },
    { name: 'Ida Lundén', role: 'artist' },
    { name: 'Thomas Bjelkeborn', role: 'artist' },
    { name: 'Eva Lindal', role: 'artist' },
    { name: 'Philippe Moenne-Loccoz', role: 'artist' },
  ],
  'Norra Brunn: Måns Möller': [
    { name: 'Måns Möller', role: 'comedian' },
    { name: 'Tobias Erehed', role: 'comedian' },
    { name: 'Dominik Henzel', role: 'comedian' },
  ],
  'Donovan Woods': [
    { name: 'Donovan Woods', role: 'artist' },
  ],
  'Lars Jansson / Erik Söderlind Quartet': [
    { name: 'Lars Jansson', role: 'artist' },
    { name: 'Erik Söderlind Quartet', role: 'ensemble' },
  ],
  'Praktikpresentation: Skånes Dansteater': [
    { name: 'Skånes Dansteater', role: 'ensemble' },
    { name: 'Escarleth Romo Pozo', role: 'artist' },
  ],
};

// Förväntade icke-performer (negativa): Chicago → work (eller absent)
const NEGATIVE_TITLES = ['Chicago - the Musical', 'Hamlet', 'Antikrist', 'Fejk', 'Big in Japan'];

console.log('═'.repeat(72));
console.log('  P8 FAS 2.5 EXTRACTION REALITY-TEST');
console.log('═'.repeat(72));

let totalExpected = 0;
let totalCorrect = 0;
let totalFalsePositives = 0;
let totalMissed = 0;
const matchesToShow: Array<{ title: string; status: string; entities: string[] }> = [];

for (const expected of Object.entries(EXPECTED)) {
  const [needle, expectedEntities] = expected;
  const ev = events.find(e => e.title.includes(needle));
  if (!ev) continue;

  totalExpected += expectedEntities.length;

  const extracted = extractEntities({
    title: ev.title,
    raw_description: null,
    category_slug: ev.category,
    venue_name: ev.venue ?? null,
  });

  const extractedNames = extracted.map(e => e.name);

  // Räkna korrekt extraherade (namnet finns, role passar).
  // Vi accepterar alla "performance"-roller som sinsemellan utbytbara
  // (comedian/artist/performer/ensemble — alla = "uppträdande person").
  let correct = 0;
  for (const exp of expectedEntities) {
    const found = extracted.find(e => e.name === exp.name);
    if (found && (
      found.role === exp.role ||
      (PERFORMER_ROLES.has(exp.role) && PERFORMER_ROLES.has(found.role))
    )) {
      correct++;
    }
  }
  totalCorrect += correct;

  const missed = expectedEntities.length - correct;
  totalMissed += missed;

  // Räkna FPs: extraherade som INTE finns i expected
  const fps = extracted.filter(e =>
    !expectedEntities.some(exp => exp.name === e.name)
  );
  totalFalsePositives += fps.length;

  matchesToShow.push({
    title: ev.title.slice(0, 60),
    status: `${correct}/${expectedEntities.length} korrekt${missed > 0 ? `, ${missed} missade` : ''}${fps.length > 0 ? `, ${fps.length} FP` : ''}`,
    entities: extractedNames,
  });
}

console.log(`\nTotalt events i live-sample:    ${events.length}`);
console.log(`Events med förväntade entiteter: ${Object.keys(EXPECTED).length}`);
console.log(`Förväntade entiteter totalt:     ${totalExpected}`);
console.log(`Korrekt extraherade:             ${totalCorrect}`);
console.log(`Missade entiteter:               ${totalMissed}`);
console.log(`False-positive entiteter:        ${totalFalsePositives}\n`);

const recall = totalCorrect / totalExpected;
const precision = totalCorrect / (totalCorrect + totalFalsePositives);
console.log(`Recall:    ${(recall * 100).toFixed(1)}%`);
console.log(`Precision: ${(precision * 100).toFixed(1)}%\n`);

console.log('─'.repeat(72));
console.log('Detaljer per event:');
console.log('─'.repeat(72));
for (const m of matchesToShow) {
  console.log(`  • ${m.title}`);
  console.log(`    ${m.status}`);
  if (m.entities.length > 0) {
    console.log(`    → [${m.entities.join(', ')}]`);
  }
}

console.log('\n─'.repeat(72));
console.log('Negativa tester (FP-skydd):');
console.log('─'.repeat(72));
for (const needle of NEGATIVE_TITLES) {
  const ev = events.find(e => e.title.includes(needle));
  if (!ev) continue;
  const extracted = extractEntities({
    title: ev.title,
    raw_description: null,
    category_slug: ev.category,
    venue_name: ev.venue ?? null,
  });
  const artistOrPerformers = extracted.filter(e => ['artist', 'performer', 'comedian'].includes(e.role));
  const works = extracted.filter(e => e.role === 'work');
  console.log(`  • "${ev.title.slice(0, 50)}"`);
  console.log(`    performers/artists: ${artistOrPerformers.length}, works: ${works.length}`);
  if (artistOrPerformers.length > 0 && !needle.includes('Quidam')) {
    console.log(`    ⚠ ${artistOrPerformers.length} artist-liknande: ${artistOrPerformers.map(e => e.name).join(', ')}`);
  }
}

console.log('\n' + '═'.repeat(72));
console.log('  JÄMFÖRELSE MOT FAS 2 (2026-10-08)');
console.log('═'.repeat(72));
console.log('  FAS 2:    recall 25 %, precision ~68 %');
console.log(`  FAS 2.5:  recall ${(recall * 100).toFixed(1)} %, precision ${(precision * 100).toFixed(1)} %\n`);

export {};
