import 'dotenv/config';
import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';

const html = readFileSync('.scratch/rendered/medborgarhuset-events-8s.html', 'utf8');
const $ = cheerio.load(html);

const links = $('a[href*="/event/"]');
console.log(`Total /event/ links: ${links.length}`);

// Find each event link's parent section
links.slice(0, 24).each((i, a) => {
  const $a = $(a);
  const text = $a.text().replace(/\s+/g, ' ').trim().slice(0, 60);
  // Find closest section ancestor
  const $section = $a.closest('section, [class*="section"]');
  const secCls = $section.attr('class') || '';
  const secTag = $section.prop('tagName') || '';
  const closestArticle = $a.closest('article');
  console.log(`  ${i + 1}. <${secTag} class="${secCls.slice(0,40)}"> ${closestArticle.length ? 'ARTICLE' : 'no-article'} text="${text}"`);
});

// All sections
console.log(`\nAll <section> elements:`);
$('section').each((_, el) => {
  const $el = $(el);
  console.log(`  <section class="${($el.attr('class') || '').slice(0, 80)}">  children=${$el.children().length} innerLen=${$el.text().length}`);
});
