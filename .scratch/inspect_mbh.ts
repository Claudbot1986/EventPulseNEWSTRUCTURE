import 'dotenv/config';
import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';

const html = readFileSync('.scratch/rendered/medborgarhuset-events-8s.html', 'utf8');
const $ = cheerio.load(html);

// Count articles under section.upcoming-events
const articles = $('section.upcoming-events article');
console.log(`section.upcoming-events article count: ${articles.length}`);

// Print first 3 articles in detail
articles.slice(0, 3).each((i, art) => {
  const $a = $(art);
  console.log(`\n--- Article ${i} ---`);
  console.log($a.html()?.replace(/\s+/g, ' ').slice(0, 1500));
});

// Test the proposed selectors
const containerSel = 'section.upcoming-events article';
const titleSel = 'h1 a';
const dateSel = 'h2.title-case';
const linkSel = 'h1 a[href]';

$(containerSel).each((i, el) => {
  const $el = $(el);
  const title = $el.find(titleSel).first().text().trim();
  const date = $el.find(dateSel).first().text().trim();
  const link = $el.find(linkSel).first().attr('href');
  console.log(`\n  ${i + 1}. title="${title.slice(0,60)}"`);
  console.log(`     date="${date.slice(0,60)}"`);
  console.log(`     link="${link}"`);
});

// Test the universal-extractor-style selectors
console.log(`\n[time[datetime]]:`, $('time[datetime]').length);
console.log(`[class*="event"]`, $('[class*="event"]').length);
console.log(`[class*="kalender"]`, $('[class*="kalender"]').length);
console.log(`[class*="evenemang"]`, $('[class*="evenemang"]').length);
console.log(`article`, $('article').length);
console.log(`h2.title-case`, $('h2.title-case').length);
