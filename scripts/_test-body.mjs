import { load } from 'cheerio';
import { execFileSync } from 'node:child_process';

const url = 'https://aviciiarena.se/evenemang/musik-show/victor-leksell/';
const html = execFileSync('curl', [
  '-s', '-X', 'POST',
  'https://eventpulse-fetch-worker.eventpulsefetch.workers.dev/fetch',
  '-H', 'Content-Type: application/json',
  '-d', JSON.stringify({ url }),
]).toString();

// Run my body extractor logic
let h = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
h = h.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
h = h.replace(/<p\b[^>]*>/gi, '\n\n');
h = h.replace(/<\/p>/gi, '\n\n');
h = h.replace(/<br\s*\/?>/gi, '\n');
h = h.replace(/\n\n+/g, '\n\n');
h = h.replace(/<\/?(div|section|article|main|header|footer|li|ul|ol|tr)\b[^>]*>/gi, '\n');

// Strip tags
h = h.replace(/<[^>]+>/g, ' ');

// Decode entities
h = h.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
h = h.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  auml: 'ä', ouml: 'ö', uuml: 'ü', aring: 'å', Auml: 'Ä', Ouml: 'Ö',
  Uuml: 'Ü', Aring: 'Å', szlig: 'ß',
  ndash: '–', mdash: '—', euro: '€', pound: '£', yen: '¥',
};
h = h.replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] || ' ');

h = h.replace(/[ \t\r\f\v]+/g, ' ');

const paragraphs = h.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length >= 200);

console.log('Total paragraphs ≥200:', paragraphs.length);
// Find one with auml context
for (const p of paragraphs.slice(0, 3)) {
  console.log('\n---\n', p.slice(0, 400));
}
