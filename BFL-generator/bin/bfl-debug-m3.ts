#!/usr/bin/env tsx
/**
 * bin/bfl-debug-m3.ts
 *
 * Skickar ETT M3-anrop och skriver ut hela råa svaret för inspektion.
 */

import { readFileSync, existsSync } from 'node:fs';

const envPath = '/Users/claudgashi/EventPulse/.env';
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const apiKey = process.env.MINIMAX_API_KEY;
if (!apiKey) { console.error('no key'); process.exit(1); }

const description = 'Cirkusföreställning med magiker, akrobater och jonglörer på Cirkus i Stockholm. Familjevänlig show.';

const res = await fetch('https://api.minimax.io/v1/text/chatcompletion_v2', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'MiniMax-M3',
    messages: [{
      role: 'user',
      content: `Ge 1-3 korta KLUSTER-TAGGAR (svenska, lowercase) för detta evenemang. Svara BARA med en JSON-array.\n\nBeskrivning: """${description}"""`,
    }],
    temperature: 0.2,
    max_tokens: 60,
  }),
});

console.log('Status:', res.status);
const text = await res.text();
console.log('Body (första 2000 tecken):');
console.log(text.slice(0, 2000));
