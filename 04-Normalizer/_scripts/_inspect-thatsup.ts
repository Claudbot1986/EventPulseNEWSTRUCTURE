const url = 'https://thatsup.se/stockholm/events';
const res = await fetch(url, {
  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
});
const html = await res.text();

// Find first article
const articleMatch = html.match(/<article[^>]*>[\s\S]*?<\/article>/);
if (articleMatch) {
  console.log('--- First <article> tag ---');
  console.log(articleMatch[0].slice(0, 2000));
}
