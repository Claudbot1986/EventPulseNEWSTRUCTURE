import 'dotenv/config';
import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';

const html = readFileSync('.scratch/rendered/storkyrkan-kalender-direct-8s.html', 'utf8');
const $ = cheerio.load(html);

console.log(`Total HTML length: ${html.length} bytes`);
console.log(`<h1> count: ${$('h1').length}, <h2>: ${$('h2').length}, <h3>: ${$('h3').length}`);

$('h1, h2, h3').slice(0, 10).each((_, el) => {
  console.log(`  <${el.tagName}> "${$(el).text().trim().slice(0, 120)}"`);
});

console.log(`\n<main> inner:`);
console.log($('main').html()?.replace(/\s+/g, ' ').slice(0, 1500));

console.log(`\nFrames / iframes:`);
$('iframe, [src*="kalender"]').each((_, el) => {
  const $el = $(el);
  console.log(`  <${el.tagName}> src=${($el.attr('src') || '').slice(0, 200)}`);
});

// Look for any data- attributes on body children
const dataAttrs = $('[data-event-id], [data-event], [data-id], [data-start], [data-end], [data-time]');
console.log(`\n[data-event/start/id] count: ${dataAttrs.length}`);
dataAttrs.slice(0, 5).each((_, el) => {
  console.log(`  <${el.tagName} class="${($(el).attr('class') || '').slice(0,80)}"> attrs=${JSON.stringify(el.attribs).slice(0,200)} text="${$(el).text().replace(/\s+/g,' ').slice(0,80)}"`);
});

// Show actual article/event-like children under main
const children = $('main > *, #innehall > *');
console.log(`\nmain children count: ${children.length}`);
children.slice(0, 20).each((_, el) => {
  if (el.type !== 'tag') return;
  const $el = $(el);
  const tag = el.tagName;
  const cls = ($el.attr('class') || '').slice(0, 80);
  const id = $el.attr('id') || '';
  const text = $el.text().replace(/\s+/g, ' ').slice(0, 200);
  console.log(`  <${tag} id="${id}" class="${cls}"> "${text}"`);
});

// Look for Stockholms domkyrkoförsamling event references in noscript or hidden
console.log(`\nwindow.calendar scripts:`);
$('script').each((_, el) => {
  const c = (el.children[0] as any)?.data || $(el).html() || '';
  if (/calendar|event|kalender|aktivitet/i.test(c)) {
    console.log(`  script len=${c.length} preview=${c.slice(0, 300).replace(/\s+/g, ' ')}`);
  }
});
