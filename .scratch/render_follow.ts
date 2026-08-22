import 'dotenv/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const key = process.env.SCRAPINGBEE_API_KEY;
if (!key) throw new Error('SCRAPINGBEE_API_KEY missing');

const OUT_DIR = path.resolve('.scratch/rendered');
mkdirSync(OUT_DIR, { recursive: true });

interface Probe {
  sourceId: string;
  url: string;
  wait: number;
  label: string;
}

const probes: Probe[] = [
  { sourceId: 'medborgarhuset-2', url: 'https://www.medborgarhuset.se/events', wait: 8000, label: 'medborgarhuset-events-8s' },
  { sourceId: 'medborgarhuset-2', url: 'https://medborgarhuset.se/events', wait: 8000, label: 'medborgarhuset-events-no-www-8s' },
  { sourceId: 'storkyrkan-2', url: 'https://www.svenskakyrkan.se/stockholmsdomkyrkoforsamling/kalender', wait: 8000, label: 'storkyrkan-kalender-8s' },
  { sourceId: 'storkyrkan-2', url: 'https://www.svenskakyrkan.se/kalender?type=owner&id=69&locationName=Stockholms+domkyrkof%c3%b6rsamling&webid=1010605', wait: 8000, label: 'storkyrkan-kalender-direct-8s' },
];

for (const p of probes) {
  try {
    console.log(`\n>>> ${p.label}: ${p.url}`);
    const r = await axios.get('https://app.scrapingbee.com/api/v1/', {
      params: {
        api_key: key, url: p.url, render_js: 'true', block_resources: 'true',
        premium_proxy: 'true', country_code: 'se', wait: String(p.wait),
      },
      timeout: 90000, responseType: 'text', validateStatus: (s) => s < 500,
    });
    if (r.status >= 400) { console.log(`  HTTP ${r.status}`); continue; }
    const html = String(r.data || '');
    writeFileSync(path.join(OUT_DIR, p.label + '.html'), html, 'utf8');
    const $ = cheerio.load(html);
    const timeCount = $('time[datetime]').length;
    const jsonld = $('script[type="application/ld+json"]').length;
    const eventLinks = $('a[href*="/event/"]').length;
    const konsLinks = $('a[href*="konsert"]').length;
    const nyhetLinks = $('a[href*="nyhet"]').length;
    console.log(`  bytes=${html.length} <title>=${$('title').text().trim()} <time>=${timeCount} jsonld=${jsonld} /event-links=${eventLinks} konsert=${konsLinks} nyhet=${nyhetLinks}`);
  } catch (e: any) {
    console.log(`  FAILED: ${e?.message ?? e}`);
  }
}
