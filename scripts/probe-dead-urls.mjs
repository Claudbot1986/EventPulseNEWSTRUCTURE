#!/usr/bin/env node
/**
 * probe-dead-urls.mjs — hitta AKTIVA källor vars URL är död.
 *
 * Bakgrund (2026-10-24). folkets-hus pekade på www.folketshus.se, som
 * 301:ar till en domän-parkeringssida på mw.se ("Marknadsledare på
 * domännamn MW.se"). Källan svarade 200 med parkingssidan i stället för
 * att dö — och då ser ingen gate att den är död.
 *
 * Detta är en MÄTNING: den skriver ingenting till runtime eller databas,
 * den rör inga källor. Den klassificerar varje aktiv källa i en av:
 *
 *   ok       — svarar 200 på rätt väg
 *   gone     — 404/410 (sidan finns inte)
 *   dns      — domänen löser inte upp
 *   parked   — redirect till en parkerings-/marknadsförsäljningssida
 *   blocked  — 401/403/406/429 (bot-vägg, INTE död — får inte begravas)
 *   error    — övrigt fel
 *
 * Användning:
 *   node scripts/probe-dead-urls.mjs [--out runtime/dead-url-report.json]
 *
 * Hastighetsbegränsning: 2 s mellan anrop mot samma värd (samma policy
 * som fetchTools.ts) så att svepet inte själv utlöser 429.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SOURCES_DIR = path.join(ROOT, 'sources');
const HOST_MIN_GAP_MS = 2000;
const REQUEST_TIMEOUT_MS = 20000;

const outArgIndex = process.argv.indexOf('--out');
const OUT_FILE =
  outArgIndex >= 0 && process.argv[outArgIndex + 1]
    ? path.resolve(ROOT, process.argv[outArgIndex + 1])
    : path.join(ROOT, 'runtime', 'dead-url-report.json');

/** Tecken som avslöjar en parkerings-/marknadsförsäljningssida. */
const PARKING_MARKERS = [
  'marknadsledare',
  'domännamn till salu',
  'parked domain',
  'this domain is for sale',
  'domain parking',
  'afternic',
  'sedo.com',
  'dan.com/buy-domain',
  'godaddy.com/domainsearch',
  'buy this domain',
  'parked free space',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Läs en källfil. Två format finns i sources/:
 *   - radavgränsad (en JSON-rad per post) — 179 filer
 *   - pretty-printed (ett JSON-objekt över flera rader) — 6 filer
 * `updateSourceUrl()` skriver pretty-printed, så båda måste hanteras.
 * Samma ordning som sourceRegistry.ts: hela filen först, sedan rad för rad.
 */
function readSourceFile(file) {
  try {
    const content = readFileSync(file, 'utf8').trim();
    if (!content) return null;

    try {
      const whole = JSON.parse(content);
      if (whole && whole.url) return whole;
    } catch {
      /* inte pretty-printed — prova radvis */
    }

    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      if (parsed && parsed.url) return parsed;
    }
  } catch {
    /* ignoras — mätningen ska aldrig krascha på trasig fil */
  }
  return null;
}

const hostLastRequestAt = new Map();

async function withHostSpacing(url, fn) {
  let host;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    host = url.toLowerCase();
  }
  const last = hostLastRequestAt.get(host);
  if (last !== undefined) {
    const elapsed = Date.now() - last;
    if (elapsed < HOST_MIN_GAP_MS) await sleep(HOST_MIN_GAP_MS - elapsed);
  }
  try {
    return await fn();
  } finally {
    hostLastRequestAt.set(host, Date.now());
  }
}

function looksParked(text, finalUrl) {
  const lower = text.toLowerCase();
  const marker = PARKING_MARKERS.find((m) => lower.includes(m));
  if (marker) return marker;
  // mw.se och liknande marknadsförmedlingsdomäner
  try {
    const host = new URL(finalUrl).host.toLowerCase();
    if (host === 'mw.se' || host.endsWith('.mw.se')) return 'mw.se-parkering';
  } catch {
    /* ignoreras */
  }
  return null;
}

async function probeOne(source) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await withHostSpacing(source.url, () =>
      fetch(source.url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml',
        },
      }),
    );
    const status = res.status;
    const finalUrl = res.url || source.url;
    const contentType = res.headers.get('content-type') ?? '';
    let body = '';
    if (contentType.includes('text')) body = await res.text();

    if (status === 404 || status === 410) {
      return { ...source, classification: 'gone', status, finalUrl, ms: Date.now() - started };
    }
    if ([401, 403, 406, 429].includes(status)) {
      return {
        ...source,
        classification: 'blocked',
        status,
        finalUrl,
        ms: Date.now() - started,
        note: 'bot-vägg — INTE död, ska inte begravas',
      };
    }
    if (status >= 500) {
      return { ...source, classification: 'error', status, finalUrl, ms: Date.now() - started };
    }
    if (status >= 300 && status < 400) {
      return { ...source, classification: 'error', status, finalUrl, ms: Date.now() - started };
    }

    const parked = looksParked(body.slice(0, 60000), finalUrl);
    if (parked) {
      return {
        ...source,
        classification: 'parked',
        status,
        finalUrl,
        marker: parked,
        ms: Date.now() - started,
      };
    }
    return { ...source, classification: 'ok', status, finalUrl, ms: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let classification = 'error';
    if (/ENOTFOUND|EAI_AGAIN/i.test(message)) classification = 'dns';
    else if (/abort/i.test(message) || /timeout/i.test(message)) classification = 'timeout';
    return {
      ...source,
      classification,
      status: 0,
      finalUrl: source.url,
      error: message,
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

const files = readdirSync(SOURCES_DIR).filter((f) => f.endsWith('.jsonl'));
const sources = [];
for (const file of files) {
  const source = readSourceFile(path.join(SOURCES_DIR, file));
  if (!source) continue;
  sources.push({
    sourceId: source.id ?? file.replace(/\.jsonl$/, ''),
    url: source.url,
    name: source.name ?? '',
    file,
  });
}

console.log(`probe-dead-urls: ${sources.length} aktiva källor`);
const results = [];
for (const source of sources) {
  const result = await probeOne(source);
  results.push(result);
  if (result.classification !== 'ok') {
    console.log(
      `  ${result.classification.toUpperCase().padEnd(8)} ${result.sourceId.padEnd(34)} ` +
        `http=${result.status} ${result.finalUrl ?? ''}`,
    );
  }
}

const counts = {};
for (const r of results) counts[r.classification] = (counts[r.classification] ?? 0) + 1;

const report = {
  generatedAt: new Date().toISOString(),
  counts,
  nonOk: results.filter((r) => r.classification !== 'ok'),
  all: results,
};
writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
console.log('\nSammanfattning:', JSON.stringify(counts));
console.log(`Rapport: ${OUT_FILE}`);
