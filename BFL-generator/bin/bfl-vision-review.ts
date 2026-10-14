#!/usr/bin/env tsx
/**
 * bin/bfl-vision-review.ts
 *
 * Skickar en bild till MiniMax M3 vision och skriver ut M3:ns beskrivning.
 * Används för att granska stämplade testbilder utan att läsa dem med Read.
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

const imagePath = process.argv[2];
if (!imagePath) {
  console.error('Usage: tsx bin/bfl-vision-review.ts <path-to-image>');
  process.exit(2);
}

const imageBytes = readFileSync(imagePath);
const dataUrl = `data:image/png;base64,${imageBytes.toString('base64')}`;

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
      content: [
        { type: 'text', text: 'Beskriv denna bild i detalj. Vad finns i den? Var är eventuella stämplar placerade? Vilken färg, storlek, opacitet har de? Är stämpeln tydligt synlig mot bakgrunden?' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
    temperature: 0.1,
    max_tokens: 500,
  }),
});

const status = res.status;
const text = await res.text();
console.log(`Status: ${status}`);
try {
  const data = JSON.parse(text);
  const content = data.choices?.[0]?.message?.content;
  console.log('\n--- M3 vision-beskrivning ---');
  console.log(content || '(tomt svar)');
} catch {
  console.log('Rå body (första 1000 tecken):');
  console.log(text.slice(0, 1000));
}
