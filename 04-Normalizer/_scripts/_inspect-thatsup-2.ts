const url = 'https://thatsup.se/stockholm/events';
const res = await fetch(url, {
  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
});
const html = await res.text();

// Find all article tags
const articles = html.match(/<article[^>]*>[\s\S]*?<\/article>/g) ?? [];
console.log(`Found ${articles.length} articles`);

// Skip the first (event-list wrapper), look at article 2-4
for (let i = 1; i <= 3; i++) {
  console.log(`\n========== Article ${i} ==========`);
  console.log(articles[i]?.slice(0, 1500));
}
