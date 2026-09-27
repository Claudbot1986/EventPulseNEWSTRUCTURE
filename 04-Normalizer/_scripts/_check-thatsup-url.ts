// HEAD + small HTML check on thatsup.se/stockholm/events/ to understand structure
const url = 'https://thatsup.se/stockholm/events/';
const res = await fetch(url, {
  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  redirect: 'follow',
});
console.log('Status:', res.status);
console.log('Final URL:', res.url);
console.log('Content-Type:', res.headers.get('content-type'));
const html = await res.text();
console.log('Length:', html.length);

// Look for JSON-LD
const ldCount = (html.match(/<script[^>]*application\/ld\+json/g) ?? []).length;
console.log('JSON-LD scripts:', ldCount);

// Look for event markers
const eventMarkers = ['<article', 'data-testid="event"', 'class="event', 'class=\'event', '/event/'];
for (const m of eventMarkers) {
  const c = (html.match(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
  console.log(`  "${m}": ${c}`);
}

// First 500 chars
console.log('\n--- First 500 chars ---');
console.log(html.slice(0, 500));

// First JSON-LD if any
const ldMatch = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/);
if (ldMatch) {
  console.log('\n--- JSON-LD ---');
  console.log(ldMatch[1].slice(0, 1000));
}
