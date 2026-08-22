import 'dotenv/config';
import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';

const html = readFileSync('.scratch/rendered/storkyrkan-kalender-25s.html', 'utf8');
const $ = cheerio.load(html);

// Look for XHR endpoints in script src patterns
const apiPatterns: string[] = [];
$('script').each((_, el) => {
  const src = $(el).attr('src') || '';
  if (/calendar|kalender|event|aktivitet|api/i.test(src)) apiPatterns.push(src);
});
console.log(`Script src matching calendar/event/api: ${apiPatterns.length}`);
apiPatterns.slice(0, 10).forEach(s => console.log(`  ${s.slice(0, 200)}`));

// Search HTML for any URL patterns containing kalender/event/api
const rx = /https?:\/\/[^\s"'<>]+/g;
const urls = new Set<string>();
let m: RegExpExecArray | null;
while ((m = rx.exec(html)) !== null) {
  const u = m[0];
  if (/kalender|calendar|api|aktivitet|event/i.test(u)) urls.add(u);
}
console.log(`\nURL tokens containing kalender/calendar/api/event in raw HTML: ${urls.size}`);
[...urls].slice(0, 30).forEach(u => console.log(`  ${u.slice(0, 240)}`));

// Look at module scripts — Angular / lazy loading
const moduleScripts = $('script[type="module"]').map((_, el) => $(el).attr('src') || '').get();
console.log(`\nModule scripts: ${moduleScripts.length}`);
moduleScripts.slice(0, 10).forEach(u => console.log(`  ${u.slice(0, 240)}`));
