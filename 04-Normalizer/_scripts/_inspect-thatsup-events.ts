const url = 'https://thatsup.se/stockholm/events';
const res = await fetch(url, {
  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
});
const html = await res.text();

// Look for event-specific markers
const eventMatches = html.match(/(event-id|data-event|class="event-card|eventCard)/g);
console.log('Event markers:', eventMatches?.length ?? 0);

// Check for time tags with datetime
const timeMatches = html.match(/<time[^>]*datetime[^>]*>[^<]*<\/time>/g);
console.log('Time tags:', timeMatches?.length ?? 0);

// Look for article classes
const articleClassMatches = html.match(/<article[^>]*class="[^"]*"/g);
console.log('\nUnique article classes:');
const classes = new Set<string>();
for (const m of articleClassMatches ?? []) {
  const cls = m.match(/class="([^"]*)"/)?.[1];
  if (cls) classes.add(cls);
}
for (const c of [...classes].slice(0, 10)) console.log(`  ${c}`);

// Look for date in URL pattern (date-filter style)
const dateFilterMatches = html.match(/\/stockholm\/events\/\d{2}-[a-z]+-\d{2}/g);
console.log('\nDate-filtered event URLs:', dateFilterMatches?.length ?? 0);

// Show what's in the date filter area
const navSection = html.match(/page-subnav-new[\s\S]*?<\/nav>/);
if (navSection) {
  console.log('\n--- nav section (first 1500 chars) ---');
  console.log(navSection[0].slice(0, 1500));
}
