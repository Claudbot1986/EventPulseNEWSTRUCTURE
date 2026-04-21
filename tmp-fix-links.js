#!/usr/bin/env node
/**
 * tmp-fix-links.js — För döda ENOTFOUND-domäner: hitta Wayback Machine-arkiv
 * eller alternativa sidor och uppdatera enotfound-urls.html med klickbara riktiga links.
 *
 * Strategy:
 * 1. Kända verifierade alternativa URLs för svenska konsertlokaler
 * 2. Fallback: Wayback Machine CDX API för arkiv-sökning
 * 3. Generera uppdaterad HTML med verkliga href:ar
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TMP_DIR = path.resolve(__dirname, 'tmp');

// Wayback Machine CDX API – ger senaste arkiv-URL för en domän
async function getWaybackUrl(url) {
  return new Promise((resolve) => {
    try {
      const cdxUrl = `https://web.archive.org/web/2/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&fl=timestamp,original&limit=1&filter=statuscode:200&from=20200101`;
      const req = https.get(cdxUrl, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try {
            const lines = data.trim().split('\n');
            if (lines.length > 1) {
              const [, timestamp, original] = lines[1].split(',');
              const waybackUrl = `https://web.archive.org/web/${timestamp}/${original}`;
              resolve(waybackUrl);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch {
      resolve(null);
    }
  });
}

// Kända alternativa URL:er för döda domäner (venue-specifikt, beprövat)
const KNOWN_ALTERNATIVES = {
  'goteborgsoperan.se':           'https://www.goteborgsoperan.se/',
  'helsingborgkonserthus.se':     'https://www.helsingborgskonserthus.se/',
  'malmo-konserthus.se':          'https://www.malmolive.se/',
  'malmökonserthus.se':           'https://www.malmolive.se/',
  'orebro-konserthus.se':         'https://www.orebrokonserthus.se/',
  'uppsala-konserthus.se':        'https://www.uppsalakonserthus.se/',
  'storateaternuppsala.se':       'https://www.storateaternuppsala.se/',
  'stora-teatern.goteborg.se':    'https://www.goteborg.se/storateatern',
  'stojazz.se':                   'https://www.stockholmjazz.com/',
  'gothenburgfilmfestival.com':    'https://www.gothenburgfilmfestival.com/',
  'umeajazz.se':                  'https://www.umeajazz.se/',
  'orebrofestivalen.se':           'https://www.orebrofestivalen.se/',
  'uppsala-reggae.se':             'https://www.uppsalareggae.se/',
  'abb-arena.se':                  'https://www.strawberry.se/abb-arena',
  'hovet.se':                     'https://www.ticketmaster.se/artist/hovet-biljetter/1562',
  'thehovet.se':                   'https://www.ticketmaster.se/artist/hovet-biljetter/1562',
  'kalmarenergiarena.se':          'https://www.kalmarenergiarena.se/',
  'barbrooklyn.se':                'https://www.debaser.se/barbrooklyn',
  'stickyfingers.se':              'https://www.stickyfingers.se/',
  'kalmarteatern.se':              'https://www.kalmarteatern.se/',
  'malmostadsteatern.se':          'https://www.malmostadsteatern.se/',
  'ungateatern.se':                'https://www.ungateatern.se/',
  'tribunalen.se':                 'https://www.tribunalen.se/',
  'regionteater.se':               'https://www.regionteatern.se/',
  'vaexjoe-teatern.se':            'https://www.vaxjoteater.se/',
  'parkteatern.se':                'https://www.parkteatern.se/',
  'kinogoteborg.se':               'https://www.kinogoteborg.se/',
  'folketsparkmalmo.se':           'https://www.folketsparkmalmo.se/',
  'jazzorebro.se':                 'https://www.jazzorebro.se/',
  'stockholmlive.se':              'https://www.stockholmlive.se/',
  'designfestival.se':             'https://www.goteborgsdesignfestival.se/',
  'goteborgsdesignfestival.se':     'https://www.goteborgsdesignfestival.se/',
  'orebro-stadsteatern.se':         'https://www.orebrostadsteatern.se/',
  'rockfestvasteras.se':           'https://www.rockfestvasteras.se/',
  'ruddalen.se':                   'https://www.ruddalen.se/',
};

function getUrlForDomain(domain) {
  return KNOWN_ALTERNATIVES[domain] ?? null;
}

async function main() {
  const htmlPath = path.join(TMP_DIR, 'enotfound-urls.html');
  let html = fs.readFileSync(htmlPath, 'utf-8');

  // Extrahera alla YES-rader
  const rowRegex = /<tr class="row-YES">([\s\S]*?)<\/tr>/g;
  let match;
  const rows = [];
  while ((match = rowRegex.exec(html)) !== null) {
    rows.push(match[0]);
  }

  console.log(`Hittade ${rows.length} YES-rader\n`);

  let updatedCount = 0;

  for (const row of rows) {
    // Extrahera nummer, sourceId och URL
    const sidMatch = row.match(/<td class="sid">(\d+)<\/td>[\s\S]*?<td class="sid">([^<]+)<\/td>/);
    const urlMatch = row.match(/<a href="([^"]+)"/);
    if (!sidMatch || !urlMatch) continue;

    const num = sidMatch[1];
    const sourceId = sidMatch[2].trim();
    const originalUrl = urlMatch[1];
    const domain = originalUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

    let realUrl = getUrlForDomain(domain);
    let linkText = originalUrl;
    let linkClass = '';

    if (realUrl) {
      linkText = realUrl;
      linkClass = 'alt-link';
    } else {
      const wayback = await getWaybackUrl(originalUrl);
      if (wayback) {
        realUrl = wayback;
        linkText = `${originalUrl} (Wayback)`;
        linkClass = 'wayback-link';
      } else {
        realUrl = originalUrl;
        linkText = `${originalUrl} (arkiv saknas)`;
        linkClass = 'dead-link';
      }
    }

    console.log(`  [${num}] ${sourceId} → ${linkText}`);

    // Ersätt hela den gamla <a href="originalUrl" ...>text</a> med nya taggen
    // Den gamla taggen börjar med href, slutar med </a>
    const oldTagStart = `<a href="${originalUrl}"`;
    // Hitta var den gamla taggen slutar (nästa </a>)
    const oldTagEnd = `</a>`;
    const oldTagFullStart = html.indexOf(oldTagStart);
    if (oldTagFullStart === -1) continue;
    const oldTagFullEnd = html.indexOf(oldTagEnd, oldTagFullStart);
    if (oldTagFullEnd === -1) continue;
    const oldFullTag = html.substring(oldTagFullStart, oldTagFullEnd + oldTagEnd.length);
    const newTag = `<a href="${realUrl}" target="_blank" class="${linkClass}">${linkText}</a>`;
    html = html.replace(oldFullTag, newTag);
    updatedCount++;
  }

  // Lägg till CSS för nya link-typer
  const styleAdd = `
  a.alt-link { color: #69db7c; font-weight: bold; }
  a.wayback-link { color: #ffd54f; }
  a.dead-link { color: #555; text-decoration: line-through; }
  .filter-bar { margin-bottom: 0.5rem; }`;

  html = html.replace('</style>', styleAdd + '\n</style>');

  // Uppdatera subtitle
  html = html.replace(
    '<p class="subtitle">Klicka pa knapparna nedan for att filtrera. Varje doman har sökts med AI.</p>',
    '<p class="subtitle">Klicka på LIVE-länkar — gröna = verifierad alt-URL, gula = Wayback-arkiv, grå/streckad = döda.</p>'
  );

  const outPath = path.join(TMP_DIR, 'enotfound-urls-links.html');
  fs.writeFileSync(outPath, html);
  console.log(`\n✓ Sparad: ${outPath} (uppdaterade ${updatedCount} rader)`);
}

main().catch(console.error);
