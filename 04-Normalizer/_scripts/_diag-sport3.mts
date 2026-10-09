import { runEditorialPipeline } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/index';
import { MockLlmClient } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/editorialWriter';
import type { EventUnderstandingInput } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/eventUnderstanding';

const event: EventUnderstandingInput = {
  category_slug: 'sports',
  venue_type: 'arena',
  venue_name: 'Avicii Arena',
  city: 'Stockholm',
  start_time: '2026-10-20T19:00:00+02:00',
  end_time: '2026-10-20T21:30:00+02:00',
  price_min_sek: 350,
  is_free: false,
  language: 'sv',
  source: 'avicii',
  title: 'Djurgården — Hammarby',
  performers: ['Djurgården', 'Hammarby'],
};

const llm = new MockLlmClient('Ishockeymatch mellan Djurgården och Hammarby på Avicii Arena.');
const r = await runEditorialPipeline({ event, sourceDescription: null, llm });
console.log('Status:', r.status);
console.log('Factuality pass:', r.factuality?.pass);
console.log('Independence pass:', r.independence?.pass);
console.log('Unsupported:', r.factuality?.unsupported_claims);
console.log('Inferred:', r.factuality?.inferred_claims);
