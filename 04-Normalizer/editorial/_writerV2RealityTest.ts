/**
 * _writerV2RealityTest.ts — kör riktig MiniMax-M3 mot ett par events för att
 * se vad prosa:n blir naturligt och om factuality PASS:ar.
 *
 * FAS 6 Writer V2 reality-check.
 */

import { readFileSync } from 'fs';
import {
  extractEntitiesWithLlmAugment,
} from './entityLlmAugment';
import { buildEventProfile } from './eventUnderstanding';
import {
  writeEditorialDescription,
  MiniMaxM3LlmClient,
} from './editorialWriter';
import { compileWriterInputs, STYLE_GUIDE } from './textualFirewall';
import { checkFactuality } from './factualityCheck';
import type { EventProfile } from './types';

interface LiveEvent {
  event_id: string;
  title: string;
  category: string;
  venue: string | null;
  city: string | null;
}

const events: LiveEvent[] = readFileSync(
  '/Users/claudgashi/EventPulse/runtime/live-sample-2026-10-08.jsonl',
  'utf-8',
)
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

const apiKey = process.env.MINIMAX_API_KEY;
if (!apiKey) {
  console.error('MINIMAX_API_KEY ej satt — kan inte köra riktig M3.');
  process.exit(1);
}

const llm = new MiniMaxM3LlmClient({ apiKey });

const TARGETS = [
  { needle: 'Quidam: Helene Berg', expectedInfo: '6 performers → factuality ska stödja performers' },
  { needle: 'Donovan Woods', expectedInfo: '1 artist → enkel passage' },
  { needle: 'Anton Estby och Henrythefreak', expectedInfo: '2 comedians → humor-stil' },
];

async function main() {
  console.log('═'.repeat(78));
  console.log('  FAS 6 WRITER V2 — Reality-test med riktig MiniMax-M3');
  console.log('═'.repeat(78));

  for (const target of TARGETS) {
    const ev = events.find((e) => e.title.includes(target.needle));
    if (!ev) {
      console.log(`\n⚠  Hittar inte ${target.needle}`);
      continue;
    }

    console.log(`\n── ${ev.title} (cat=${ev.category}) ──`);
    console.log(`    Förväntat: ${target.expectedInfo}`);

    // Bygg Profile från entities (med mock-LLM för HSO och liknande)
    const augmented = await extractEntitiesWithLlmAugment(
      {
        title: ev.title,
        raw_description: null,
        category_slug: ev.category,
        venue_name: ev.venue,
      },
      {
        // Här skulle vi använda riktig M3 i prod. För reality-testet av Writer V2
        // är sync-regel-baserade entities tillräckliga eftersom alla TARGETS
        // har kända performer-mönster.
        async complete() { return '[]'; },
      },
    );

    const profile = buildEventProfile({
      category_slug: ev.category,
      title: ev.title,
      venue_name: ev.venue ?? null,
    }) as EventProfile;

    if (augmented.length > 0) {
      profile.performers = augmented.map((e) => e.name);
      profile.provenance['performers'] = ['entity_extractor:title'];
    }

    console.log(
      `    Profile.performers: [${profile.performers.join(', ')}]`,
    );

    // Skriv prosa med riktig M3
    const inputs = compileWriterInputs({
      profile,
      event: {
        title: ev.title,
        start_time: '2026-10-09T20:00:00+02:00',
        venue_name: ev.venue ?? null,
        city: ev.city ?? 'Stockholm',
        is_free: null,
        language: 'sv',
      },
    });

    let prose = '(ingen prosa)';
    let factuality: ReturnType<typeof checkFactuality> | null = null;
    try {
      const draft = await writeEditorialDescription({ inputs, llm });
      prose = draft.text;

      factuality = checkFactuality({
        draft: { ...draft, info_level: 'MEDIUM' },
        profile,
        source_description: null,
        generated_at: draft.meta.generated_at,
        event: {
          title: ev.title,
          venue_name: ev.venue ?? null,
          city: ev.city ?? 'Stockholm',
          category_slug: ev.category,
        },
      } as Parameters<typeof checkFactuality>[0]);
    } catch (e) {
      prose = `[FEL: ${(e as Error).message}]`;
    }

    console.log(`\n    PROSA: "${prose}"`);
    if (factuality) {
      console.log(
        `    Factuality: pass=${factuality.pass}` +
          ` (supp=${factuality.supported_claims.length},` +
          ` inf=${factuality.inferred_claims?.length ?? 0},` +
          ` unsupp=${factuality.unsupported_claims.length})`,
      );
      if (factuality.unsupported_claims.length > 0) {
        console.log(
          `    Unsupported: [${factuality.unsupported_claims.slice(0, 5).join(', ')}]`,
        );
      }
    }
  }

  console.log('\n' + '═'.repeat(78));
  console.log('  SLUTANALYS');
  console.log('═'.repeat(78));
  console.log('  Om factuality PASS:ar → Writer V2 är klar (prompt-redigering onödig).');
  console.log('  Om factuality FAIL:ar → justera system-prompt att EMPHASIZE Profile-nyckelord.');
  console.log('═'.repeat(78));
}

main().catch((e) => {
  console.error('REALITY-TEST FEL:', e);
  process.exit(1);
});
