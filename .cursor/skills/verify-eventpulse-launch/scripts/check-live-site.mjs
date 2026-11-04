#!/usr/bin/env node
/**
 * Webbpolicy-gate: kontrollerar den LIVE policy-sidan (och den engelska).
 *
 *   node .cursor/skills/verify-eventpulse-launch/scripts/check-live-site.mjs
 *
 * Skicka in flaggan --allow-stale för att bara rapportera (exit 0 även om
 * sidan är gammal) — används när du vet att en deploy är på väg.
 */
import https from 'node:https';

const allowStale = process.argv.includes('--allow-stale');
const urls = [
  { url: 'https://eventpulse.nu/privacy/', lang: 'sv' },
  { url: 'https://eventpulse.nu/en/privacy/', lang: 'en' },
];

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'eventpulse-launch-gate/1.0' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

const mustContain = ['MiniMax', 'eu-north-1', 'hej@eventpulse.nu', '18 år'];
const mustNotContain = ['[TODO', 'utkast', 'OpenAI / Anthropic'];
const results = [];

for (const { url, lang } of urls) {
  let res;
  try {
    res = await fetchText(url);
  } catch (e) {
    results.push({ label: `${lang}: hämtning`, ok: false, detail: String(e.message).slice(0, 80) });
    continue;
  }
  const text = res.body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  results.push({ label: `${lang}: HTTP 200`, ok: res.status === 200, detail: `HTTP ${res.status}` });
  results.push({ label: `${lang}: sidan är inte en stub (minst 2000 tecken)`, ok: text.length >= 2000, detail: `${text.length} tecken` });
  for (const needle of mustContain) {
    results.push({ label: `${lang}: innehåller "${needle}"`, ok: text.includes(needle) });
  }
  for (const needle of mustNotContain) {
    results.push({ label: `${lang}: saknar "${needle}"`, ok: !text.includes(needle) });
  }
}

let failed = 0;
for (const r of results) {
  const ok = r.ok || (allowStale && r.label.includes('HTTP 200') === false ? false : r.ok);
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FEL '} ${r.label}${r.detail ? `  (${r.detail})` : ''}`);
}
const problems = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - problems}/${results.length} kontroller gröna.`);
if (problems > 0) {
  console.log(allowStale
    ? 'Sidan är inte uppdaterad live (--allow-stale: rapporterar bara).'
    : 'Sidan är inte uppdaterad live — deploya site/ innan App Store-inlämning.');
}
process.exit(problems > 0 && !allowStale ? 1 : 0);
