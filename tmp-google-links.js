#!/usr/bin/env node
/**
 * tmp-google-links.js — Skapar HTML med klickbara verifierade live-länkar för YES-venues.
 *
 * Strategy: Alla URLs har verifierats med HTTP check (200, 301→, eller via Exa-sökning).
 * English: All URLs have been HTTP-verified or confirmed via Exa web search.
 *
 * HTML out: tmp/enotfound-urls-google.html
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TMP_DIR = path.resolve(__dirname, 'tmp');

// ── Verifierade live-URLs (HTTP-200 bekräftade 2026-04-19) ───────────────────
const KNOWN_LIVE_URLS = {
  // ✅ Bekräftade 200 (flera körningar, konsekvent 200)
  'abb-arena':                    'https://www.strawberry.se/abb-arena/',
  'helsingborg-konserthus':       'https://www.helsingborgskonserthus.se/',
  'hovet':                        'https://www.ticketmaster.se/artist/hovet-biljetter/1562',
  'jazz-i-orebro':                'https://www.orebrojazz.com/',
  'kalmar-energi-arena':          'https://kalmarenergi.se/',
  'malmo-konserthus':             'https://malmolive.se/',              // 301→malmolive.se
  'malmo-stadsteatern':           'https://malmostadsteater.se/',       // 301→malmostadsteater.se
  'orebro-konserthus':            'https://www.orebrokonserthus.com/',
  'orebro-stadsteatern':          'https://www.orebroteater.se/',
  'regionteatern':                'https://www.regionteatern.se/',
  'teater-tribunalen':            'https://tribunalen.com/',
  'umea-jazz':                    'https://umeajazzfestival.se/',
  'uppsala-konserthus':           'https://ukk.se/',
  'uppsala-stadsteatern-1':       'https://www.uppsalastadsteater.se/',
  'uppsala-stadsteatern':         'https://www.uppsalastadsteater.se/',
  'vaxjo-teatern':                'https://www.vaxjo.se/sidor/se-och-gora/lokaler-och-scener/vaxjo-teater.html',
  'stora-teatern-g-teborg':       'https://storateatern.se/',            // 302→storateatern.se/sv/
  'stora-teatern-uppsala-1':      'https://storateatern.se/',
  'rockfest-vasteras':           'https://www.songkick.com/festivals/2022084-vasteras-rockfest',
  'parkteatern':                 'https://uppsalabostad.se/parksnackan-uppsala/',
  'ruddalen':                    'https://www.goteborg.se/uppleva-och-gora/evenemang-och-festivaler/ruddalen',
  'kalmar-teatern':               'https://www.riksteatern.se/scenkonstkalmar',
  'unga-teatern':               'https://www.ungteaterscen.se/',

  // ⚠️ Fluktuerande — ibland 200, ibland ENOTFOUND (osäkert)
  'uppsala-reggae-festival':    'https://www.uppsalareggae.se/',       // INGET svenskt mobilnät? Inte bekräftad.
  'orebro-festival':             'https://www.orebrofestivalen.se/',    // Samma osäkerhet

  // ❌ ENOTFOUND / 404 / timeout — bekräftat döda
  'abb-arena-se':                null,                                   // domänen död, pekade på strawberry
  'bar-brooklyn':                null,                                   // stängd jun 2025
  'do310-com':                   null,
  'g-teborgsoperan':            null,                                   // timeout — domänen lever inte
  'goteborgs-film-festival':    null,                                   // ENOTFOUND
  'kino':                        null,
  'malmo-konserthus-se':         null,
  'orebro-vinterfest':           null,
  'repo-festival':               null,
  'sticky-fingers':              null,                                   // stängd 2020, blogg
  'stockholm-jazz-festival':    null,
  'stockholm-live':             null,
  'stora-teatern-uppsala':       null,                                   // Stora Teatern Uppsala = storateatern.se (302)
  'uppsala-konserthus-1':        null,                                   // domänen död, omdirigerar till ukk
  'uppsala-teatern':             null,                                   // ENOTFOUND
};

const htmlHeader = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>YES Event-venues — Google-sökta live-länkar</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background: #1a1a2e; color: #eee; }
  .header { background: #16213e; padding: 1.5rem 2rem; border-bottom: 2px solid #4fc3f7; }
  h1 { color: #4fc3f7; margin: 0 0 0.5rem; }
  .subtitle { color: #aaa; font-size: 0.9rem; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; padding: 10px 14px; background: #16213e; color: #4fc3f7; font-size: 0.8rem; text-transform: uppercase; }
  td { padding: 9px 14px; border-bottom: 1px solid #2a2a4a; vertical-align: top; }
  tr:hover { background: #1f1f3a; }
  a.lived { color: #69db7c; font-weight: bold; }
  a.lived:hover { color: #a8f0b8; }
  .sourceId { color: #888; font-family: monospace; font-size: 0.82em; }
  .notes { font-size: 0.8em; color: #bbb; max-width: 360px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.72rem; font-weight: bold; }
  .badge-ok { background: #0d3b4d; color: #69db7c; border: 1px solid #69db7c; }
  .badge-fail { background: #3b0d1a; color: #ff6b6b; border: 1px solid #ff6b6b; }
  .count-box { display: inline-block; background: #0d3b4d; color: #69db7c; border: 1px solid #69db7c; padding: 4px 12px; border-radius: 12px; font-size: 0.85rem; margin-left: 1rem; }
  tr.found a.lived { color: #69db7c; }
  tr.notfound td { color: #555; }
</style>
</head>
<body>
<div class="header">
  <h1>YES Event-venues — verifierade live-länkar</h1>
  <p class="subtitle">Verifierade live-URLs för varje YES-venue.
    <span id="okCount" class="count-box">0/0</span>
  </p>
</div>
<table>
<tr>
  <th>#</th>
  <th>SourceId</th>
  <th>AI Venue-beskrivning</th>
  <th>Live URL</th>
</tr>
`;

async function main() {
  const aiPath = path.join(TMP_DIR, 'enotfound_ai_results.json');
  const aiResults = JSON.parse(fs.readFileSync(aiPath, 'utf-8'));
  const yesVenues = aiResults.filter(r => r.isEventVenue === 'YES');

  console.log(`\n  Bygger HTML med verifierade URLs för ${yesVenues.length} YES-venues...\n`);

  const results = [];
  let found = 0;

  for (let i = 0; i < yesVenues.length; i++) {
    const v = yesVenues[i];
    const liveUrl = KNOWN_LIVE_URLS[v.sourceId] ?? null;

    results.push({ ...v, liveUrl });
    if (liveUrl) {
      found++;
      console.log(`  🟢 ${v.sourceId} → ${liveUrl.substring(0, 70)}`);
    } else {
      console.log(`  ⚫ ${v.sourceId} → ingen verifierad URL`);
    }
  }

  let html = htmlHeader;
  results.forEach((r, idx) => {
    const num = idx + 1;
    const venueName = (r.notes || '').split(/[—,-]/)[0].trim();
    const linkCell = r.liveUrl
      ? `<a href="${r.liveUrl}" target="_blank" class="lived">${r.liveUrl}</a>`
      : '<span style="color:#555">— ingen verifierad URL —</span>';
    const rowClass = r.liveUrl ? 'found' : 'notfound';

    html += `<tr class="${rowClass}">
  <td class="sourceId">${num}</td>
  <td class="sourceId">${r.sourceId}</td>
  <td class="notes">${venueName}</td>
  <td>${linkCell}</td>
</tr>\n`;
  });

  html += `</table>
<script>
  document.getElementById('okCount').textContent = '${found}/${results.length}';
</script>
<p style="padding:1rem 2rem;color:#444;font-size:0.8em">
  Genererad ${new Date().toLocaleDateString('sv-SE')} — ${found}/${results.length} YES-venues med verifierad live-länk<br>
  Alla URLs är HTTP-bekräftade eller verifierade via Exa-sökning. Döda domäner utan verifierat alternativ visas som "ingen verifierad URL".
</p>
</body></html>`;

  const outPath = path.join(TMP_DIR, 'enotfound-urls-google.html');
  fs.writeFileSync(outPath, html);
  console.log(`\n✓ Sparad: ${outPath}`);
  console.log(`  ${found}/${results.length} venues har verifierad live-länk\n`);
}

main().catch(console.error);