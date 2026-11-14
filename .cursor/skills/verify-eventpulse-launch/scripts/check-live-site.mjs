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
import { inspectPolicyText } from './lib/policy-truth.mjs';

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

// Cloudflare "Email Address Obfuscation" skriver om mailto-länkar till
// /cdn-cgi/l/email-protection#<hex> och lägger den råa adressen i
// data-cfemail="<hex>" (första byte = XOR-nyckel). Utan avkodning tror
// gaten att kontaktadressen saknas i den publicerade policyn.
// Hela <span data-cfemail>…</span> ersätts med den avkodade texten —
// enbart attributvärdet räcker inte, eftersom tag-strippingen tar bort
// attributen tillsammans med taggen.
function decodeCfEmails(html) {
  return html.replace(
    /<span[^>]*data-cfemail="([a-f0-9]+)"[^>]*>[\s\S]*?<\/span>/gi,
    (m, hex) => {
      const key = parseInt(hex.slice(0, 2), 16);
      let out = '';
      for (let i = 2; i < hex.length; i += 2) {
        out += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ key);
      }
      return ` ${out} `;
    },
  );
}

// Åldersgränsen formuleras per språk — "18 år" finns inte på den engelska sidan.
// Personuppgiftsansvarig: Perfectday AB, org.nr 556990-9830 (2026-11-06).
// MiniMax togs BORT från mustContain 2026-11-14: den live-policyn påstod
// att text skickas till MiniMax via en agentchatt som inte finns i build 6.
// Samma sanningar som i appens policy och i privacy-etiketten.
const rules = {
  sv: { mustContain: ['eu-north-1', 'hej@eventpulse.nu', '18 år', 'Perfectday AB', '556990-9830'] },
  en: { mustContain: ['eu-north-1', 'hej@eventpulse.nu', '18 years', 'Perfectday AB', '556990-9830'] },
};
const mustNotContain = ['[TODO', 'utkast', 'OpenAI / Anthropic', 'Tomor Gashi', 'MiniMax', 'event-agent', 'agentchat'];
const results = [];

for (const { url, lang } of urls) {
  let res;
  try {
    res = await fetchText(url);
  } catch (e) {
    results.push({ label: `${lang}: hämtning`, ok: false, detail: String(e.message).slice(0, 80) });
    continue;
  }
  const text = decodeCfEmails(res.body)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const { mustContain } = rules[lang];
  results.push({ label: `${lang}: HTTP 200`, ok: res.status === 200, detail: `HTTP ${res.status}` });
  results.push({ label: `${lang}: sidan är inte en stub (minst 2000 tecken)`, ok: text.length >= 2000, detail: `${text.length} tecken` });
  for (const needle of mustContain) {
    results.push({ label: `${lang}: innehåller "${needle}"`, ok: text.includes(needle) });
  }
  for (const needle of mustNotContain) {
    results.push({ label: `${lang}: saknar "${needle}"`, ok: !text.includes(needle) });
  }
  // POLICY ≈ APP: samma mönster som app-gaten och IPA-gaten använder.
  const policy = inspectPolicyText(text);
  for (const label of policy.forbidden) {
    results.push({ label: `${lang}: policyn innehåller inte "${label}"`, ok: false });
  }
  for (const label of policy.missing) {
    results.push({ label: `${lang}: policyn saknar "${label}"`, ok: false });
  }
  results.push({
    label: `${lang}: policyn stämmer med appen`,
    ok: policy.forbidden.length === 0 && policy.missing.length === 0,
    detail: [...policy.forbidden, ...policy.missing].join('; ') || 'ok',
  });
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'OK  ' : 'FEL '} ${r.label}${r.detail ? `  (${r.detail})` : ''}`);
}
const problems = failed;
console.log(`\n${results.length - problems}/${results.length} kontroller gröna.`);
if (problems > 0) {
  console.log(allowStale
    ? 'Sidan är inte uppdaterad live (--allow-stale: rapporterar bara).'
    : 'Sidan är inte uppdaterad live — deploya site/ innan App Store-inlämning.');
}
process.exit(problems > 0 && !allowStale ? 1 : 0);
