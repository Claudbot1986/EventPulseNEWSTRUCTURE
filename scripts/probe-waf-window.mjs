#!/usr/bin/env node
/**
 * probe-waf-window.mjs — mäter WAF:ens takt- och tidsfönster.
 *
 * Bakgrund (2026-10-24). Sju sajter svarar 429 när C-gaten anropar dem.
 * För att välja rätt backoff och rätt spacing måste vi veta:
 *   1. Hur många anrop inom ett fönster triggar 429?
 *   2. Hur länge varar 429-fönstret?
 *   3. Finns det ett Retry-After-header att följa?
 *
 * Verktyget mäter mot riktiga sajter med riktiga HTTP-anrop och skriver
 * ingenting till produktionen — det är ett mätverktyg, inte en del av
 * kedjan.
 *
 * Användning:
 *   node scripts/probe-waf-window.mjs                     # standardvärd
 *   node scripts/probe-waf-window.mjs --gap 1000          # 1 s mellan anrop
 *   node scripts/probe-waf-window.mjs --count 30 --gap 500
 */

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : dflt;
};

const GAP_MS = opt('gap', 1500);
const COUNT = opt('count', 20);
const URLS = argv.filter((a) => a.startsWith('http'));

const TARGETS = URLS.length > 0 ? URLS : [
  'https://www.blekholmen.se/',
  'https://www.galeasen.se/',
  'https://www.filborna.se/',
];

const UA = 'EventPulse/1.0 (event-ingestion)';

console.log(`mäter ${COUNT} anrop mot ${TARGETS.length} värd(ar), gap ${GAP_MS} ms\n`);

const results = [];
let first429 = null;
let recovered = null;

for (let i = 0; i < COUNT; i++) {
  const url = TARGETS[i % TARGETS.length];
  const host = new URL(url).host;
  const t0 = Date.now();
  let status = 0;
  let retryAfter = null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' },
      redirect: 'follow',
    });
    status = res.status;
    retryAfter = res.headers.get('retry-after');
    await res.text();
  } catch (err) {
    status = -1;
  }
  const dt = Date.now() - t0;
  results.push({ i, host, status, retryAfter, dt });
  const line = `${String(i).padStart(3)} ${host.padEnd(24)} ${String(status).padStart(4)}  ${String(dt).padStart(6)} ms${retryAfter ? `  retry-after=${retryAfter}` : ''}`;
  console.log(line);

  if (status === 429 && first429 === null) first429 = { i, at: Date.now() };
  if (first429 !== null && recovered === null && status !== 429 && status > 0) {
    recovered = { i, at: Date.now() };
  }

  if (i < COUNT - 1) await new Promise((r) => setTimeout(r, GAP_MS));
}

const ok = results.filter((r) => r.status === 200).length;
const throttled = results.filter((r) => r.status === 429).length;
const other = results.filter((r) => r.status !== 200 && r.status !== 429).length;

console.log('\n─── SAMMANFATTNING ───');
console.log(`200: ${ok}   429: ${throttled}   övrigt: ${other}`);
if (first429) {
  console.log(`första 429 vid anrop #${first429.i} (${first429.i} anrop efter start)`);
  if (recovered) {
    console.log(`återhämtning efter 429 vid anrop #${recovered.i} → fönstret varade ~${recovered.i - first429.i} anrop (~${Math.round((recovered.at - first429.at) / 1000)} s väggtid)`);
  } else {
    console.log('återhämtning observerades inte inom mätfönstret');
  }
  const ras = results.find((r) => r.retryAfter);
  console.log(`Retry-After-header: ${ras ? `JA (${ras.retryAfter})` : 'nej'}`);
} else {
  console.log('ingen 429 i detta fönster — tröskeln nåddes inte');
}
