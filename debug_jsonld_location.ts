
import { readFileSync } from 'fs';
import * as cheerio from 'cheerio';

const html = readFileSync('/tmp/schack.html', 'utf-8');
const $ = cheerio.load(html);

// Where are the JSON-LD scripts?
console.log('=== JSON-LD Script Locations ===');
$('script[type="application/ld+json"]').each((i, el) => {
  const parent = $(el).parent();
  const parentTag = parent.get(0)?.name || 'unknown';
  const grandparent = parent.parent();
  const grandparentTag = grandparent.get(0)?.name || 'unknown';
  const content = $(el).html() || '';
  const preview = content.substring(0, 100);
  console.log(`Script ${i+1}:`);
  console.log(`  Parent tag: ${parentTag}`);
  console.log(`  Grandparent tag: ${grandparentTag}`);
  console.log(`  Content preview: ${preview}`);
  console.log();
});

// Also check for JSON-LD in head
console.log('=== Head JSON-LD Scripts ===');
$('head script[type="application/ld+json"]').each((i, el) => {
  const content = $(el).html() || '';
  try {
    const data = JSON.parse(content);
    console.log(`Head script ${i+1}:`, JSON.stringify(data).substring(0, 100));
  } catch {
    console.log(`Head script ${i+1}: parse error`);
  }
});
