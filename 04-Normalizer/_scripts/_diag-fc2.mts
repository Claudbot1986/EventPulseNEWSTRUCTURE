import { checkFactuality, extractClaims } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/factualityCheck';
import type { EventProfile } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/types';

const profile: EventProfile = {
  event_type: 'music', performers: ['Hooligan Bobs'], genres: ['rock'],
  content: ['låtar'], experience_characteristics: ['live band', 'publikrespons'],
  setting: 'klubb', language: ['sv'], provenance: { event_type: 'category:music' },
};
const event = { title: 'Hooligan Bobs på Debaser', venue_name: 'Debaser', city: 'Stockholm', category_slug: 'music' };

// "Rock-kvällen bjuder på Hooligan Bobs i ett live-framförande."
const draft = { text: 'Rock-kvällen bjuder på Hooligan Bobs i ett live-framförande.', word_count: 0, info_level: 'MEDIUM', meta: { model: 'm', prompt_version: 'v1', generated_at: '' } };

const claims = extractClaims(draft.text);
console.log('Claims:', claims);
const r = checkFactuality({ draft, profile, event });
console.log('Result:', JSON.stringify(r.details, null, 2));
