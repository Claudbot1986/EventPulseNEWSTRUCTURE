#!/usr/bin/env node
/**
 * measure-aggregate-cards.mjs — mäter "phantom-rader" i universal-extraktorn.
 *
 * PROBLEMFORM (mätt 2026-10-25 på 3arena.se):
 *   Extraktorn betraktar VARJE element som matchar en kort-selector som ett
 *   eventkort. Det omfattar även AGGREGAT: `<section class="cards-events">`
 *   och `<section class="carousel-events">` matchar `[class*="event"]`.
 *   Ett aggregat innehåller flera eventskort, så titel, datum och url kommer
 *   från TRE olika barnkort. Resultatet blir rader som inte existerar:
 *
 *     titel "Kommande evenemang"  datum Hammarbys  url Hammarby
 *     titel "Sverige–Skottland"    datum Hammarbys  url Sverige–Skottland
 *
 * ORAKEL (oberoende av extraktorns kod):
 *   En rad är en phantom om dess TITEL eller dess DATUM inte går att hitta
 *   inuti DOM-elementet som innehåller radens url-länk. Det elementet hittas
 *   oberoende: närmaste förfader till länken som innehåller en rubrik
 *   (h1–h4 eller [class*="title"]). En riktig rad har både titel och datum
 *   i samma kort; en phantom har dem i olika kort.
 *
 *   Oraklet är medvetet inte "titeln finns någonstans i HTML" — det var
 *   för svagt: både "Kommande evenemang" och "Sverige–Skottland" finns
 *   på sidan, just inte i kortet som länken pekar på.
 *
 * ANVÄNDNING:
 *   node scripts/measure-aggregate-cards.mjs                 # alla mål-domäner
 *   node scripts/measure-aggregate-cards.mjs --json
 *   node scripts/measure-aggregate-cards.mjs --only 3arena,dansenshus
 *   node scripts/measure-aggregate-cards.mjs --extractor <sökväg>   # A/B-mätning
 *
 * Exit 0 = mätningen klar (raderna är data, inte fel). Användaren av
 * skriptet bestämmer om phantom-antalet är acceptabelt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ─── Måldomäner ─────────────────────────────────────────────────────────────
// Orelaterade domäner: ingen av dem är i samma "leverantörsfamilj" som
// någon annan (arena, kulturhus, teater, museum, universitet, kyrka,
// festival, scen). 2026-10-25 — Generalization Protection Rule kräver
// bevis på 2–3+ orelaterade domäner innan en regel får implementeras.

const TARGETS = [
  { id: '3arena', file: '3arena.jsonl' },
  { id: 'dansenshus', file: 'dansenshus.jsonl' },
  { id: 'oscarsteatern', file: 'oscarsteatern.jsonl' },
  { id: 'berwaldhallen', file: 'berwaldhallen.jsonl' },
  { id: 'skansen', file: 'skansen.jsonl' },
  { id: 'vasa-museum', file: 'vasa-museum.jsonl' },
  { id: 'nationalmuseum', file: 'nationalmuseum.jsonl' },
  { id: 'fotografiska', file: 'fotografiska.jsonl' },
  { id: 'rival', file: 'rival.jsonl' },
  { id: 'zita', file: 'zita.jsonl' },
  { id: 'fallan', file: 'fallan.jsonl' },
  { id: 'kth-2', file: 'kth-2.jsonl' },
  { id: 'konserthuset-2', file: 'konserthuset-2.jsonl' },
  { id: 'pingstkyrkan', file: 'pingstkyrkan.jsonl' },
  { id: 'teatern', file: 'teatern.jsonl' },
];

const MONTHS = [
  'januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december',
];
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** Idag i UTC — samma referens som extraktorns "närmaste framtida förekomst". */
const TODAY_ISO = new Date().toISOString().slice(0, 10);

function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/&shy;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Är månadsnamnet med i texten? Månadsnamn får följas av siffror ("29 oktober185"). */
function monthMentioned(text, day, mi) {
  for (const name of [MONTHS[mi], MONTH_ABBR[mi]]) {
    const rx = new RegExp(`\\b${day}\\s+${name}(?![a-zA-ZåäöÅÄÖ])`);
    if (rx.test(text)) return true;
  }
  return false;
}

/**
 * Närmaste framtida förekomst av dag/månad — extraktorns dokumenterade
 * regel för årslösa datum. Beräknas här oberoende av extraktorns kod.
 */
function nearestFuture(day, mi, todayIso) {
  const year = Number(todayIso.slice(0, 4));
  const pad = (n) => String(n).padStart(2, '0');
  const thisYear = `${year}-${pad(mi + 1)}-${pad(day)}`;
  if (thisYear >= todayIso) return thisYear;
  return `${year + 1}-${pad(mi + 1)}-${pad(day)}`;
}

/** Finns datumet (eller ett av dess ändpunkter) i texten? */
function dateAppearsIn(text, iso, todayIso) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [, y, mo, d] = m;
  const mi = Number(mo) - 1;
  if (mi < 0 || mi > 11) return false;
  // Datumet står utskrivet (eller i ett attribut) → rakt av.
  if (text.includes(iso)) return true;
  const day = String(Number(d));
  if (!monthMentioned(text, day, mi)) return false;
  // Året står i kortet.
  if (new RegExp(`\\b${y}\\b`).test(text)) return true;
  // Årslöst datum → extraktorn räknar fram närmaste framtida förekomst.
  return iso === nearestFuture(Number(d), mi, todayIso);
}

/**
 * Klass-token som betyder "rubrik".
 *
 * "subtitle" är INTE en rubrik — det är en underrubrik. `[class*="title"]`
 * matchar "subtitle" (delsträng), och det är precis där extraktorn har
 * hämtat titelbitar ifrån. Oracle'n får inte räkna underrubriker som
 * rubriker, annars mäter den sin egen felform.
 */
function isTitleToken(token) {
  if (!/title/i.test(token)) return false;
  return !/subtitle/i.test(token);
}

/** Rubriktexterna i ett element (h1–h6 + titelklasser). */
function headingTexts($, $el) {
  const texts = [];
  $el.find('h1, h2, h3, h4, h5, h6').each((_, e) => {
    texts.push($(e).text().trim().replace(/\s+/g, ' '));
  });
  $el.find('*').each((_, e) => {
    const cls = $(e).attr('class') || '';
    if (cls.split(/\s+/).some(isTitleToken)) {
      texts.push($(e).text().trim().replace(/\s+/g, ' '));
    }
  });
  return texts.filter((t) => t.length > 0);
}

/**
 * Närmaste förfader till länken som innehåller en rubrik.
 *
 * LÄNKEN SJÄLV är inte ett kort — en länk som bara omsluter en
 * underrubrik skulle annars bli "kortet", och kortet har då ingen datumtext.
 */
function cardContainer($, $a) {
  let $el = $a.parent();
  while ($el.length && $el[0] && $el[0].tagName !== 'body' && $el[0].tagName !== 'html') {
    if ($el.find('h1, h2, h3, h4, h5, h6').length > 0) return $el;
    const hasTitleClass = $el.find('*').toArray().some((e) =>
      ($(e).attr('class') || '').split(/\s+/).some(isTitleToken));
    if (hasTitleClass) return $el;
    $el = $el.parent();
  }
  return null;
}

/**
 * Är titeln en AVSLUTNING av kortets rubriktext?
 *
 * Då är titeln en BIT (t.ex. underrubriken "— Next Generation 14–16 år" i
 * "Streetstar Dance School Challenge 2026 — Next Generation 14–16 år"), inte
 * evenemangets namn.
 */
function titleIsFragment(headings, title) {
  const t = String(title ?? '').trim();
  if (!t) return false;
  return headings.some((h) => h.length > t.length && h.trimEnd().endsWith(t));
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function sourceUrl(id) {
  const file = path.join(ROOT, 'sources', `${id}.jsonl`);
  if (!fs.existsSync(file)) return null;
  try {
    const src = JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0]);
    return src?.url ?? null;
  } catch {
    return null;
  }
}

/** Kvargravna källor mäts inte — de ska inte ge events. */
function isQuarantined(id) {
  const file = path.join(ROOT, 'sources', `${id}.jsonl`);
  if (!fs.existsSync(file)) return false;
  try {
    const src = JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0]);
    return !!src?.quarantineReason;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const all = args.includes('--all');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? new Set((args[onlyIdx + 1] ?? '').split(',').filter(Boolean)) : null;
  const extractorIdx = args.indexOf('--extractor');
  const extractorPath = extractorIdx >= 0
    ? path.resolve(ROOT, args[extractorIdx + 1] ?? '')
    : path.join(ROOT, '02-Ingestion', 'F-eventExtraction', 'universal-extractor.ts');

  const { extractEvents } = await import(extractorPath);

  // --all: mät ALLA aktiva källor i registret (kvargravaror hoppas över).
  const targets = all
    ? fs.readdirSync(path.join(ROOT, 'sources'))
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ id: f.replace(/\.jsonl$/, ''), file: f }))
        .filter((t) => !isQuarantined(t.id))
    : TARGETS;

  const results = [];
  for (const target of targets) {
    if (only && !only.has(target.id)) continue;
    const url = sourceUrl(target.id);
    if (!url) {
      results.push({ id: target.id, status: 'no-source-url', events: 0, phantoms: 0 });
      continue;
    }
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      results.push({ id: target.id, status: `fetch-failed: ${e.message}`, url, events: 0, phantoms: 0 });
      continue;
    }

    const $ = cheerio.load(html);
    const extracted = extractEvents(html, target.id, url);
    const events = extracted.events ?? [];

    const phantomRows = [];
    const fragmentRows = [];
    for (const ev of events) {
      const evUrl = String(ev.url ?? '').trim();
      const title = normalize(ev.title);
      const signals = Array.isArray(ev.confidence?.signals) ? ev.confidence.signals : [];
      const method = signals.includes('html-swedish-relative-date') ? 'C3'
        : signals.includes('html-time-anchor') ? 'C2'
        : signals.includes('html-rich-card') ? 'C1'
        : 'annan';
      if (!evUrl) continue; // rader utan url kan inte lokaliseras — hoppas över
      const $a = $('a[href]').filter((_, el) => {
        try {
          return new URL($(el).attr('href'), url).toString().replace(/\/$/, '') === evUrl.replace(/\/$/, '');
        } catch {
          return false;
        }
      }).first();
      if (!$a.length) continue; // länken hittades inte i HTML — kan inte bedömas
      const $card = cardContainer($, $a);
      if (!$card) continue;
      const cardText = normalize($card.text());
      const cardAttrs = normalize(
        $card.find('time[datetime]').map((_, e) => $(e).attr('datetime') ?? '').get().join(' ') +
        ' ' +
        $card.find('[data-date],[data-start],[data-event-date]').map((_, e) => $(e).attr('data-date') ?? $(e).attr('data-start') ?? '').get().join(' '),
      );
      const haystack = `${cardText} ${cardAttrs}`;

      const titleOk = title.length > 0 && haystack.includes(title);
      const dateOk = dateAppearsIn(haystack, ev.date, TODAY_ISO);
      if (!titleOk || !dateOk) {
        phantomRows.push({
          method,
          title: ev.title,
          date: ev.date,
          url: ev.url,
          missing: [!titleOk ? 'titel' : null, !dateOk ? 'datum' : null].filter(Boolean).join('+'),
        });
      }

      // Titel-BIT: titeln är en avslutning av kortets rubriktext.
      const headings = headingTexts($, $card);
      if (titleIsFragment(headings, ev.title)) {
        fragmentRows.push({
          method,
          title: ev.title,
          date: ev.date,
          url: ev.url,
          cardHeading: headings.find((h) => h.trimEnd().endsWith(String(ev.title).trim())) ?? '',
        });
      }
    }

    results.push({
      id: target.id,
      status: 'ok',
      url,
      bytes: html.length,
      events: events.length,
      phantoms: phantomRows.length,
      phantomRows,
      fragments: fragmentRows.length,
      fragmentRows,
    });
  }

  const totals = {
    domains: results.filter((r) => r.status === 'ok').length,
    events: results.reduce((s, r) => s + r.events, 0),
    phantoms: results.reduce((s, r) => s + r.phantoms, 0),
    fragments: results.reduce((s, r) => s + (r.fragments ?? 0), 0),
  };

  if (asJson) {
    console.log(JSON.stringify({ totals, results }, null, 2));
    return;
  }
  console.log(`domäner mätta: ${totals.domains}`);
  console.log(`events totalt: ${totals.events}`);
  console.log(`phantom-rader:  ${totals.phantoms}`);
  console.log(`titel-bitar:    ${totals.fragments}\n`);
  for (const r of results) {
    if (r.status !== 'ok') {
      console.log(`  ${r.id.padEnd(24)} ${r.status}`);
      continue;
    }
    const mark = r.phantoms > 0 ? 'PHANTOM' : 'ok     ';
    const byMethod = {};
    for (const p of r.phantomRows) byMethod[p.method] = (byMethod[p.method] ?? 0) + 1;
    const methodStr = Object.entries(byMethod).map(([m, n]) => `${m}=${n}`).join(' ');
    const frag = r.fragments ?? 0;
    console.log(`  ${r.id.padEnd(24)} ${mark} events=${String(r.events).padEnd(4)} phantoms=${r.phantoms} bit=${frag} ${methodStr}`);
    for (const p of r.phantomRows.slice(0, 4)) {
      console.log(`      - [${p.method}] "${String(p.title).slice(0, 40)}" ${p.date} saknar=${p.missing}`);
    }
    for (const f of (r.fragmentRows ?? []).slice(0, 3)) {
      console.log(`      ~ BIT [${f.method}] "${String(f.title).slice(0, 40)}" av "${String(f.cardHeading).slice(0, 60)}"`);
    }
  }
}

main().catch((e) => {
  console.error('measure-aggregate-cards: FAIL', e?.message ?? e);
  process.exit(1);
});
