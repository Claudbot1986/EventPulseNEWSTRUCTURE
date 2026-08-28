import 'dotenv/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { writeFileSync } from 'fs';

const key = process.env.SCRAPINGBEE_API_KEY;
if (!key) throw new Error('SCRAPINGBEE_API_KEY missing');

const probes = [
  { label: 'storkyrkan-kalender-15s', url: 'https://www.svenskakyrkan.se/kalender?type=owner&id=69&locationName=Stockholms+domkyrkof%c3%b6rsamling&webid=1010605', wait: 15000 },
  { label: 'storkyrkan-kalender-25s', url: 'https://www.svenskakyrkan.se/kalender?type=owner&id=69&locationName=Stockholms+domkyrkof%c3%b6rsamling&webid=1010605', wait: 25000 },
];

for (const p of probes) {
  try {
    console.log(`\n>>> ${p.label} (wait=${p.wait}ms)`);
    const r = await axios.get('https://app.scrapingbee.com/api/v1/', {
      params: {
        api_key: key, url: p.url, render_js: 'true', block_resources: 'true',
        premium_proxy: 'true', country_code: 'se', wait: String(p.wait),
      },
      timeout: 120000, responseType: 'text', validateStatus: (s) => s < 500,
    });
    if (r.status >= 400) { console.log(`  HTTP ${r.status}`); continue; }
    const html = String(r.data || '');
    writeFileSync(`.scratch/rendered/${p.label}.html`, html, 'utf8');
    const $ = cheerio.load(html);
    const timeCount = $('time[datetime]').length;
    const eventAnchors = $('a[href*="/aktivitet"]').length + $('a[href*="/event/"]').length + $('a[href*="/kalender/"]').length;
    const placeholder = $('.placeholder-title, .placeholder-description-text').length;
    const realTitle = $('.calendar-item, .calendar-row, .event-item, [class*="event-"]').length;
    const calContents = $('.calendar-content').text().replace(/\s+/g, ' ').slice(0, 300);
    console.log(`  bytes=${html.length} <time>=${timeCount} eventAnchors=${eventAnchors} placeholders-left=${placeholder} realContentMarkers=${realTitle}`);
    console.log(`  calendar-content first chars: "${calContents}"`);
  } catch (e: any) {
    console.log(`  FAILED: ${e?.message ?? e}`);
  }
}
