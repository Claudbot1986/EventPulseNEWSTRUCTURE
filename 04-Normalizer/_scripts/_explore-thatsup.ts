const urls = [
  'https://thatsup.se/stockholm',
  'https://thatsup.se/stockholm/events',
  'https://thatsup.se/stockholm/calendar',
  'https://thatsup.se/stockholm/kalender',
];
for (const url of urls) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow',
  });
  const html = await res.text();
  console.log(`${res.status} ${url.replace('https://thatsup.se', '')} → ${res.url.replace('https://thatsup.se', '')} (${html.length}b)`);
}
