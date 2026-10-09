/**
 * _fas6InteractiveDemo.ts — FAS 11 UI (dev-only, 2026-10-09).
 *
 * Syfte: interaktiv terminal-UI för hands-on-testning av FAS 6 Writer V2
 *        med live M3 + nya gazetteer-integrationen. INTE prod-UI —
 *        endast för utvecklarens ögon under iteration.
 *
 * Vad det visar per event:
 *   1. Profile (performers, performer_metadata, info_level)
 *   2. M3-genererad prosa
 *   3. Factuality-check (pass/fail + supported/unsupported claims)
 *   4. Vilka performer-metadata som faktiskt användes
 *
 * Användning:
 *   set -a && source .env && set +a
 *   npx tsx 04-Normalizer/editorial/_fas6InteractiveDemo.ts
 *   npx tsx 04-Normalizer/editorial/_fas6InteractiveDemo.ts --only=Quidam
 *
 * Säkerhet:
 *   - Skriver inget till DB
 *   - Skriver inget till filsystem förutom stdout
 *   - M3-anrop är readonly
 *   - Rate-limited: max 1 event/3s för att inte slå M3 rate-limit
 */
import { extractEntities } from './entityExtractor';
import { buildEventProfile, profileInfoLevel } from './eventUnderstanding';
import { checkFactuality } from './factualityCheck';
import { writeEditorialDescription } from './editorialWriter';
import { lookupArtist } from './gazetteerCache';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
const LLM_MODEL = 'MiniMax-M3';
const LLM_TIMEOUT_MS = 8000;

/**
 * Self-contained M3 fetch (samma mönster som entityLlmAugment.ts).
 */
async function callMinimax(userMsg: string, systemPrompt: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return '';
  const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 600,
      temperature: 0.6,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!response.ok) return '';
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return '';
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

interface LiveEvent {
  event_id: string;
  title: string;
  category: string;
  venue: string | null;
  city: string | null;
  start_time: string;
  source_richness?: string;
}

function loadLiveSample(): LiveEvent[] {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const path = resolve(__dirname, '../../runtime/live-sample-2026-10-08.jsonl');
  const raw = readFileSync(path, 'utf-8');
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LiveEvent);
}

// Fokusera på events med kända artister (samma som reality-test)
const FOCUS_TITLES = [
  'Quidam',
  'Donovan Woods',
  'Anton Estby',
  'Musik till åminnelse',
  'Norra Brunn',
  'Lars Jansson',
  'Praktikpresentation',
  'Sven Ingvars',
  'AIK - BIK Karlskoga',
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const onlyFilter = onlyArg ? onlyArg.slice('--only='.length) : null;

  const allEvents = loadLiveSample();
  const events = onlyFilter
    ? allEvents.filter((e) => e.title.includes(onlyFilter))
    : allEvents.filter((e) => FOCUS_TITLES.some((t) => e.title.includes(t)));

  if (events.length === 0) {
    console.log(`❌ Inga events matchar "${onlyFilter}"`);
    return;
  }

  console.log('═'.repeat(78));
  console.log('  FAS 11 UI — FAS 6 Writer V2 interaktiv demo');
  console.log(`  ${events.length} event(s) — riktig MiniMax-M3 + gazetteer-integration`);
  console.log('═'.repeat(78));

  for (const [idx, ev] of events.entries()) {
    console.log(`\n[${idx + 1}/${events.length}] ${ev.title}`);
    console.log(`  venue: ${ev.venue ?? '?'} | city: ${ev.city ?? '?'} | start: ${ev.start_time}`);

    // 1. extractEntities
    const entities = extractEntities({
      title: ev.title,
      raw_description: null,
      category_slug: ev.category,
      venue_name: ev.venue,
    });
    const PERFORMER_ROLES = new Set([
      'artist', 'ensemble', 'band', 'performer', 'comedian',
      'conductor', 'soloist', 'speaker', 'dj', 'team',
    ]);
    const performers = entities
      .filter((e) => PERFORMER_ROLES.has(e.role))
      .map((e) => e.name);

    console.log(`  📋 Extracted: ${performers.length} performers → ${JSON.stringify(performers)}`);

    // 2. buildEventProfile (med gazetteer)
    const profile = buildEventProfile({
      title: ev.title,
      raw_description: null,
      category_slug: ev.category,
      venue_name: ev.venue,
      city: ev.city,
      source: 'fas11-demo',
      performers,
    });

    const il = profileInfoLevel(profile);
    console.log(`  📊 info_level: ${il}`);
    if (profile.performer_metadata) {
      const hits = Object.entries(profile.performer_metadata);
      console.log(`  🌍 Gazetteer-hits: ${hits.length}/${performers.length}`);
      for (const [name, meta] of hits) {
        const parts: string[] = [];
        if (meta.country) parts.push(`land=${meta.country}`);
        if (meta.type) parts.push(`typ=${meta.type}`);
        if (meta.genres?.length) parts.push(`genrer=${meta.genres.slice(0, 3).join('/')}`);
        console.log(`     · ${name}: ${parts.join(', ')}`);
      }
    }

    // 3. M3-genererad prosa via writeEditorialDescription
    const llm = {
      async generate(args: { systemPrompt: string; userPrompt: string }): Promise<string> {
        return await callMinimax(args.userPrompt, args.systemPrompt);
      },
    };

    const draft = await writeEditorialDescription({
      inputs: {
        profile,
        event: {
          title: ev.title,
          start_time: ev.start_time,
          venue_name: ev.venue,
          city: ev.city,
        },
        style_guide: 'Saklig, neutral, citerar artistnamn exakt.',
      },
      llm,
      model: 'MiniMax-M3',
    });

    console.log(`\n  📝 PROSA (${draft.word_count} ord):`);
    console.log(`     "${draft.text}"`);

    // 4. Factuality
    const fact = checkFactuality({
      draft,
      profile,
      event: { title: ev.title, venue_name: ev.venue, city: ev.city, start_time: ev.start_time },
    });
    const verdict = fact.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`\n  🔍 Factuality: ${verdict}`);
    console.log(`     supported=${fact.supported_claims.length} inferred=${fact.inferred_claims?.length ?? 0} unsupported=${fact.unsupported_claims.length}`);
    if (fact.unsupported_claims.length > 0) {
      console.log(`     unsupported: ${JSON.stringify(fact.unsupported_claims.slice(0, 8))}`);
    }

    // Rate-limit: 3s mellan M3-anrop
    if (idx < events.length - 1) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  console.log('\n' + '═'.repeat(78));
  console.log('  KLAR — alla events testade.');
  console.log('═'.repeat(78));
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
