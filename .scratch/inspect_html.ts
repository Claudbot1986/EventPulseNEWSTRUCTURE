import 'dotenv/config';
import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';

const files = [
  '.scratch/rendered/medborgarhuset-events-8s.html',
  '.scratch/rendered/storkyrkan-kalender-direct-8s.html',
];

for (const f of files) {
  const html = readFileSync(f, 'utf8');
  const $ = cheerio.load(html);
  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`  ${f}  (${html.length} bytes)`);
  console.log(`══════════════════════════════════════════════════════`);

  console.log(`\n<html> tag:`, $.html('html').slice(0, 200));
  console.log(`\n<body> opening + first 800 chars:\n`, $('body').html()?.slice(0, 800));

  // Look for any element with date-like attribute or text
  const dateRx = /\d{1,2}\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)/i;
  const matches = new Set<string>();
  $('*').each((_, el) => {
    if (el.type !== 'tag') return;
    const $el = $(el);
    const txt = $el.text();
    if (dateRx.test(txt) && txt.length < 250) {
      const cls = ($el.attr('class') || '').slice(0, 60);
      const tag = el.tagName;
      matches.add(`${tag}.${cls.split(' ').slice(0, 3).join(' .')} => "${txt.replace(/\s+/g, ' ').slice(0, 120)}"`);
    }
  });
  if (matches.size) {
    console.log(`\nElements with month-name text:`);
    [...matches].slice(0, 20).forEach(m => console.log(`  ${m}`));
  }

  // Look for data-* attributes that suggest events
  const dataAttrs = new Map<string, number>();
  $('[data-event-id], [data-event], [data-event-id], [data-category], [data-start], [data-end]').each((_, el) => {
    if (el.type !== 'tag') return;
    const $el = $(el);
    for (const a of Object.keys(el.attribs ?? {})) {
      if (/^data-/.test(a)) dataAttrs.set(a, (dataAttrs.get(a) || 0) + 1);
    }
    console.log(`  [data] <${el.tagName} class="${($el.attr('class') || '').slice(0, 50)}">`, el.attribs);
  });

  // Common ContentStudio / EPiServer patterns for Swedish church sites
  const cands = $('[class*="eventItem"], [class*="event-item"], [class*="calendarItem"], [class*="calendar-item"], .event, .eventlist, [class*="eventList"], [class*="event-list"]');
  console.log(`\nPre-class event-card selector matches: ${cands.length}`);

  // For medborgarhuset case — look for app shell
  const root = $('[id="root"], [id="__next"], [id="app"], main, [role="main"]');
  if (root.length) {
    console.log(`\nApp shell / main element:`, root.first().prop('tagName'), `id=${root.first().attr('id') || ''} class="${(root.first().attr('class') || '').slice(0, 80)}"`);
    console.log(`  inner text length: ${root.first().text().length}`);
    console.log(`  first 600 chars of inner: ${root.first().text().replace(/\s+/g, ' ').slice(0, 600)}`);
  }
}
