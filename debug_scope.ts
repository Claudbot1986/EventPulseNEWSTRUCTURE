
import { readFileSync } from 'fs';
import * as cheerio from 'cheerio';

const html = readFileSync('/tmp/schack.html', 'utf-8');
const $ = cheerio.load(html);

// Check if schack.se has main/article
console.log('has main:', $('main').length);
console.log('has article:', $('article').length);

// What is the scope text for date scanning?
const scopeText = $('main, article, [role="main"], .content, .event-content, .kalender, .event-list').text() || '';
console.log('Scope text length:', scopeText.length);

// How many links in scope?
console.log('Links in scope:', $('main a[href], article a[href]').length);

// Check what the actual scope contains
const scopeHtml = $('main, article, [role="main"], .content, .event-content, .kalender, .event-list').html() || '';
console.log('Scope HTML length:', scopeHtml.length);

// Check timeTagCount in entire page
console.log('timeTagCount (entire page):', $('time[datetime]').length);

// Check if scope finds JSON-LD scripts
console.log('JSON-LD scripts in scope:', $('main script[type="application/ld+json"], article script[type="application/ld+json"]').length);
