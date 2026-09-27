const url = 'https://thatsup.se/stockholm';
const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
const html = await res.text();

// Look for event-like URL patterns
const links = html.match(/href="[^"]*"/g) ?? [];
const counts: Record<string, number> = {};
for (const l of links) {
  const path = l.match(/href="([^"]*)"/)?.[1] ?? '';
  if (!path || path.startsWith('#') || path.startsWith('http')) continue;
  const seg = path.split('/').filter(Boolean).slice(0, 2).join('/');
  counts[seg] = (counts[seg] ?? 0) + 1;
}

// Top URL segments
console.log('Top URL segments:');
const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [seg, n] of sorted) console.log(`  /${seg}  ${n}`);

// Look for time-related patterns
const timeMatches = html.match(/<time[\s\S]*?<\/time>/g) ?? [];
console.log(`\n<time> tags: ${timeMatches.length}`);

// Look for "Köp biljetter" or similar
const buyMatches = html.match(/(Köp biljetter|Buy ticket|biljetter|book now)/gi) ?? [];
console.log(`Buy/ticket mentions: ${buyMatches.length}`);

// Find specific URL patterns that look like event pages
const eventLinkMatches = html.match(/href="[^"]*\/(event|pågår|kalender)[^"]*"/g) ?? [];
console.log(`\nEvent-pattern URLs: ${eventLinkMatches.length}`);
for (const u of eventLinkMatches.slice(0, 5)) console.log(`  ${u}`);
