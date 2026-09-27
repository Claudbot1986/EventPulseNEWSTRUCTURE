const url = 'https://thatsup.se/blog/thatsupevent/';
const res = await fetch(url, {
  headers: { 'User-Agent': 'Mozilla/5.0' },
  redirect: 'follow',
});
const html = await res.text();
console.log(`Status: ${res.status}, Final: ${res.url}, Length: ${html.length}`);
const articleMatches = html.match(/<article[^>]*>[\s\S]*?<\/article>/g) ?? [];
console.log(`Articles: ${articleMatches.length}`);
const timeTags = html.match(/<time[\s\S]*?<\/time>/g) ?? [];
console.log(`Time tags: ${timeTags.length}`);
const dateMatches = html.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
console.log(`ISO dates: ${dateMatches.length}`);

// Show 1st article inner content
if (articleMatches[1]) {
  console.log('\n--- Article 2 (2000 chars) ---');
  console.log(articleMatches[1].slice(0, 2000));
}
