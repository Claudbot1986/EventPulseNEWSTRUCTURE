/**
 * _smoke-utforska.ts — Manuell smoke-test på 10 handplockade NULL-events
 * med rika beskrivningar (kör M2.7 direkt på ett fast ID-set).
 *
 *  Användning: tsx --env-file=.env 04-Normalizer/_scripts/_smoke-utforska.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TARGET_IDS = [
  '8113aaf7-117b-4888-ab2c-864dc11da6b4', // praktikpresentation dans
  '6f1a74a3-610d-4278-90e4-8a66e031d4b7', // OKTOBERFIST party
  '26d07cc4-f5c5-4d33-a20b-f8e05b7cd503', // Romeo & Julia dans
  'e9bd6a31-3100-4deb-8968-fba0e468de43', // Elina Pirinen dans/teater
  'be4baa8c-baec-4a30-a30f-7dd1392f6cb1', // Lars von Trier opera
  'd2987fcb-db99-4c61-b3bc-f755fa0518da', // Kammarjazz trio
  '8dfabadc-36e7-4bc5-a42d-43e199806569', // Dad Harmony a cappella
  'c58b4c4c-58da-4d32-a2b6-97da3b3dac74', // Stina Nyberg Chest dans
  '957cf35c-62fd-4cf4-8dfb-96151f7b93ca', // Manfred Mann rock
  '0e2ca853-c82a-421d-859b-257836cf9e65', // Stina Nyberg Chest dans dup
];

const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
const LLM_MODEL = 'MiniMax-M2.7';

const UTFORSKA_DEFS: Record<string, string> = {
  music: 'Konserter och musikframföranden — alla genrer (rock, pop, jazz, klassiskt, elektroniskt, hip-hop m.fl.) så länge live-musikframförande är huvudaktiviteten. Exkludera ren DJ-kväll utan live-band.',
  opera: 'Opera och operaföreställningar där operasång och sceniskt berättande är huvudformen.',
  'theatre-comedy': 'Scenföreställningar där humor är huvudsyftet — standup, humorproduktioner.',
  'theatre-drama': 'Teater och dramatiska pjäser. Inkluderar seriös teater, drama, musikal (sång + dans + pjäsform). Exkludera ren komedi.',
  dance: 'Scenföreställningar där dans är huvudformen.',
  circus: 'Cirkus och akrobatik.',
  exhibition: 'Konst-, design- och fotoutställningar.',
  'flea-market': 'Loppis, vintage- och second hand-marknad.',
  food: 'Matfestivaler, matprovningar och matupplevelser.',
  'wine-tasting': 'Vin-, öl-, whisky- och spritprovningar.',
  kids: 'Aktiviteter för barn.',
  family: 'Aktiviteter för barn och vuxna tillsammans.',
  film: 'Filmvisning, bio, filmfestivaler.',
  'talks-lectures': 'Föreläsningar, panelsamtal, publika samtal.',
  workshop: 'Kurser, workshops, prova-på.',
  sports: 'Sport, tävling, motionsaktivitet.',
  nightlife: 'Klubbar, barer, nattliv, DJ-kvällar utan live-band, dansgolv som huvudfokus.',
  community: 'Lokalt/samhällsinriktat event utan tydlig specifik kategori. Använd som FALLBACK.',
};

const supabase = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '');

async function main() {
  const { data, error } = await supabase
    .from('events')
    .select('id, title_sv, title_en, description_sv, description_en, category_slug, source')
    .in('id', TARGET_IDS);
  if (error) throw error;
  console.log(`[smoke] Hämtade ${data?.length} events`);

  const eventsForPrompt = data.map((e: any) => ({
    id: e.id,
    title: e.title_sv ?? e.title_en ?? '',
    description: (e.description_sv ?? e.description_en ?? '').slice(0, 500),
    source: e.source ?? '',
    venue_hint: 'Stockholm',
  }));

  const sysLines = Object.entries(UTFORSKA_DEFS).map(([k, v]) => `- ${k}: ${v}`);
  const sysPrompt = `Du är evenemangsklassificerare för EventPulse (Stockholm). Du får en JSON-array med evenemang och ska klassificera varje.

REGLER:
* EN kategori per event (single-label).
* Om inget passar bra, returnera "community".
* Svara ENDAST med en JSON-array.
* Elementformat: {"id": "<uuid>", "category": "<slug>", "confidence": <0.0-1.0>, "reasoning": "<kort på svenska, max 80 tecken>"}.

VIKTIGT:
* Musikgenrer (rock, pop, jazz, klassiskt, elektroniskt, hip-hop, musikal) → "music" om live-musikframförande är huvudformen.
* "Musikal" (musical-theatre) → "theatre-drama" om pjäsform dominerar, annars "music".
* Standup/humor → "theatre-comedy".
* Dansföreställning → "dance".
* Fest/klubb/queerparty med DJ → "nightlife".
* Om beskrivningen är tom/kort och du är osäker → "community" med låg confidence.

DEFINITIONER (18 Utforska-slugs):
${sysLines.join('\n')}

TILLÅTNA SLUGS: ${JSON.stringify(Object.keys(UTFORSKA_DEFS))}`;

  const resp = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.1,
      max_tokens: 6000,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: JSON.stringify(eventsForPrompt) },
      ],
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${t.slice(0, 300)}`);
  }
  const body = await resp.json();
  const rawContent = body?.choices?.[0]?.message?.content ?? '';
  // M2.7 bäddar in resonemang i <think>...</think> — strippa bort
  const content = rawContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  console.log('[smoke] RAW content first 800 chars:');
  console.log(content.slice(0, 800));
  console.log('---');
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`No JSON array. Raw: ${content.slice(0, 300)}`);
  const parsed = JSON.parse(match[0]);
  console.log('\n=== M2.7 OUTPUT ===');
  for (const r of parsed) {
    const ev = (data ?? []).find((e: any) => e.id === r.id);
    const title = (ev?.title_sv ?? ev?.title_en ?? '').slice(0, 60);
    console.log(`\n[${r.id.slice(0,8)}] ${title}`);
    console.log(`  → ${r.category}  (conf ${r.confidence})`);
    console.log(`  reasoning: ${r.reasoning}`);
  }
  const outPath = join(process.cwd(), '00-Vault/01-Projects/EventPulse/04-Sources/smoke-utforska-2026-10-06.json');
  await writeFile(outPath, JSON.stringify(parsed, null, 2));
  console.log(`\n[smoke] Saved to ${outPath}`);
}

main().catch((err: unknown) => {
  console.error('[smoke] FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});