import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { glob } from 'fs';

const files = readdirSync('sources').filter(f => f.endsWith('.jsonl') && !f.startsWith('_'));
const sources = [];
for (const f of files) {
  try {
    const lines = readFileSync(join('sources', f), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const d = JSON.parse(line);
      if (d.url && !d.url.includes('biljettshop.se/sv/') && !sources.some(s => s.slug === d.id)) {
        sources.push({
          slug: d.id,
          url: d.url,
          queue: d.currentQueue || '',
          filename: f,
        });
        break;
      }
    }
  } catch {}
}

console.log(`Total unique sources: ${sources.length}`);

// Pad fetch sources in parallel
async function checkOne(src) {
  const findings = {
    slug: src.slug,
    url: src.url,
    queue: src.queue,
    urlPattern: [],
    htmlHints: [],
    fetchStatus: 'N/A',
    eventCount: 0,
    htmlSize: 0,
  };

  // URL pattern detection
  if (/[?&]page=\d+/i.test(src.url)) findings.urlPattern.push('page=N in URL');
  if (/\/\d+\/?$/.test(src.url)) findings.urlPattern.push('ends in /N/');
  if (/[?&]p=\d+/i.test(src.url)) findings.urlPattern.push('?p=N in URL');
  if (/start_date=|from_date=|after=|before=/i.test(src.url)) findings.urlPattern.push('date-filter param');

  try {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), 8000);
    const r = await fetch(src.url, {
      headers: { 'User-Agent': 'EventPulse-Bot/1.0', 'Accept': 'text/html' },
      signal: c.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    findings.fetchStatus = r.status;
    if (r.ok) {
      const body = await r.text();
      findings.htmlSize = body.length;
      const slice = body.slice(0, 100000);
      if (/rel=["']next["']/i.test(slice)) findings.htmlHints.push('rel=next');
      if (/href=["'][^"']*\?page=2/.test(slice)) findings.htmlHints.push('?page=2 link');
      if (/class=["'][^"']*pagination/.test(slice)) findings.htmlHints.push('pagination class');
      if (/aria-label=["'][^"']*[Pp]age/.test(slice)) findings.htmlHints.push('aria-page');
      if (/load[-_ ]more|view[-_ ]more/i.test(slice)) findings.htmlHints.push('load-more');
      if (/infinite[-_ ]scroll/i.test(slice)) findings.htmlHints.push('infinite-scroll');
      if (/data-page|data-pagination/i.test(slice)) findings.htmlHints.push('data-page attr');
      findings.eventCount = (slice.match(/"@type"\s*:\s*"Event"/g) || []).length;
    }
  } catch (e) {
    findings.fetchStatus = e.name || 'err';
  }

  return findings;
}

const results = [];
const CHUNK = 20;
for (let i = 0; i < sources.length; i += CHUNK) {
  const chunk = sources.slice(i, i + CHUNK);
  const chunkResults = await Promise.all(chunk.map(checkOne));
  results.push(...chunkResults);
  process.stdout.write(`  ${results.length}/${sources.length}\r`);
}

console.log();
console.log('=== SUMMARY ===');
console.log(`Total checked: ${results.length}`);
console.log(`With URL pagination pattern: ${results.filter(r => r.urlPattern.length).length}`);
console.log(`With HTML pagination hints: ${results.filter(r => r.htmlHints.length).length}`);
console.log(`Any pagination indicator: ${results.filter(r => r.urlPattern.length || r.htmlHints.length).length}`);
console.log(`No pagination detected (likely single-page): ${results.filter(r => !r.urlPattern.length && !r.htmlHints.length).length}`);
console.log(`Fetch failed/timed-out: ${results.filter(r => !String(r.fetchStatus).startsWith('2')).length}`);

// Output sources WITH pagination
console.log();
console.log('=== SOURCES WITH DETECTED PAGINATION ===');
const withPag = results.filter(r => r.urlPattern.length || r.htmlHints.length);
for (const r of withPag.sort((a, b) => b.eventCount - a.eventCount)) {
  console.log(`  ${r.slug.padEnd(45)}  events=${String(r.eventCount).padStart(4)}  status=${r.fetchStatus}  ${[...r.urlPattern, ...r.htmlHints].join(', ')}`);
}