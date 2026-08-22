import 'dotenv/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

interface Target {
  sourceId: string;
  urls: string[];
}

const targets: Target[] = [
  {
    sourceId: 'medborgarhuset-2',
    urls: [
      'https://www.medborgarhuset.se/events',
      'https://www.medborgarhuset.se',
    ],
  },
  {
    sourceId: 'storkyrkan-2',
    urls: [
      'https://www.svenskakyrkan.se/stockholmsdomkyrkoforsamling',
      'https://www.storkyrkan.se',
    ],
  },
];

const key = process.env.SCRAPINGBEE_API_KEY;
if (!key) throw new Error('SCRAPINGBEE_API_KEY missing');

const OUT_DIR = path.resolve('.scratch/rendered');
mkdirSync(OUT_DIR, { recursive: true });

async function render(url: string): Promise<string> {
  const r = await axios.get('https://app.scrapingbee.com/api/v1/', {
    params: {
      api_key: key,
      url,
      render_js: 'true',
      block_resources: 'true',
      premium_proxy: 'true',
      country_code: 'se',
      wait: '3500',
    },
    timeout: 60000,
    responseType: 'text',
    validateStatus: (s) => s < 500,
  });
  if (r.status >= 400) throw new Error(`HTTP ${r.status} for ${url}`);
  return String(r.data || '');
}

function summarizeDom(html: string, label: string) {
  const $ = cheerio.load(html);
  const events: Array<{ tag: string; cls?: string; href?: string; text: string; datetime?: string }> = [];

  // Common card containers and event-like classes
  const CONTAINERS = [
    'article', '[class*="event"]', '[class*="kalender"]', '[class*="evenemang"]',
    '[class*="card"]', '[class*="item"]', '[class*="post"]', '[class*="row"]',
    'li[class]', 'div[class*="program"]', 'div[class*="show"]',
  ];

  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`  ${label}`);
  console.log(`══════════════════════════════════════════════════════`);
  console.log(`HTML length: ${html.length} bytes`);
  const title = $('title').text().trim();
  console.log(`<title>: ${title}`);

  // Time anchors — strong event signal
  const timeCount = $('time[datetime]').length;
  console.log(`<time[datetime]> count: ${timeCount}`);

  // Find all <time datetime=...> with their closest card parent
  const foundCards = new Map<string, { count: number; sample: string }>();
  $('time[datetime]').each((_, el) => {
    const $t = $(el);
    const dt = $t.attr('datetime') || '';
    if (!dt) return;
    const $card = $t.closest('article, li, [class*="event"], [class*="card"], [class*="item"], [class*="row"], [class*="program"], [class*="kalender"], [class*="show"], [class*="evenemang"], [class*="post"]');
    if (!$card.length) return;
    const key = $card.attr('class') || $card.prop('tagName') || 'unknown';
    const text = $card.text().replace(/\s+/g, ' ').slice(0, 240);
    const entry = foundCards.get(key) || { count: 0, sample: '' };
    entry.count++;
    if (!entry.sample) entry.sample = text;
    foundCards.set(key, entry);
  });

  if (foundCards.size) {
    console.log('\nClosest containers around <time> elements:');
    [...foundCards.entries()].sort((a, b) => b[1].count - a[1].count).forEach(([k, v]) => {
      console.log(`  [${v.count}] .${k.split(' ').filter(Boolean).slice(0, 3).join(' .')}`);
      console.log(`      "${v.sample.slice(0, 160)}"`);
    });
  }

  // List anchor links with date-like href or containing dates in text
  const linkSample: string[] = [];
  $('a[href]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    const text = $a.text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 4) return;
    if (/event|kalender|evenemang|aktivitet|nyhet|concert|konsert|visning|gudstjänst|consert/i.test(href + ' ' + text)) {
      if (linkSample.length < 12) linkSample.push(`  - [${text.slice(0,80)}] -> ${href.slice(0,120)}`);
    }
  });
  if (linkSample.length) {
    console.log('\nLinks containing event-related tokens:');
    linkSample.forEach(l => console.log(l));
  }

  // JSON-LD check
  const jsonldCount = $('script[type="application/ld+json"]').length;
  console.log(`\nJSON-LD scripts: ${jsonldCount}`);
  $('script[type="application/ld+json"]').each((_, el) => {
    const c = $(el).html() || '';
    try {
      const data = JSON.parse(c);
      const types: string[] = [];
      const walk = (o: any) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(walk); return; }
        if (o['@type']) types.push(String(o['@type']));
        for (const k of Object.keys(o)) walk(o[k]);
      };
      walk(data);
      console.log(`  @type set: ${[...new Set(types)].slice(0, 12).join(', ')}`);
    } catch { /* skip */ }
  });
}

for (const t of targets) {
  for (const url of t.urls) {
    try {
      console.log(`\n>>> Rendering ${t.sourceId} :: ${url}`);
      const html = await render(url);
      const safeName = `${t.sourceId}__${url.replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}.html`;
      writeFileSync(path.join(OUT_DIR, safeName), html, 'utf8');
      console.log(`    saved ${html.length} bytes to .scratch/rendered/${safeName}`);
      summarizeDom(html, `${t.sourceId} :: ${url}`);
    } catch (e: any) {
      console.log(`  FAILED ${url}: ${e?.message ?? e}`);
    }
  }
}
