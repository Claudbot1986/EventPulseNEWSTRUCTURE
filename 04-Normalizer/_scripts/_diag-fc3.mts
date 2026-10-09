import { checkFactuality, extractClaims } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/factualityCheck';
import type { EventProfile } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/types';

const profile: EventProfile = {
  event_type: 'music', performers: ['Hooligan Bobs'], genres: ['rock'],
  content: ['låtar'], experience_characteristics: ['live band', 'publikrespons'],
  setting: 'klubb', language: ['sv'], provenance: { event_type: 'category:music' },
};
const event = { title: 'Hooligan Bobs på Debaser', venue_name: 'Debaser', city: 'Stockholm', category_slug: 'music' };
const draft = { text: 'En magisk kväll med Hooligan Bobs på Debaser.', word_count: 0, info_level: 'MEDIUM', meta: { model: 'm', prompt_version: 'v1', generated_at: '' } };

console.log('Claims:', extractClaims(draft.text));
const r = checkFactuality({ draft, profile, event });
console.log('Result:', JSON.stringify(r, null, 2));
