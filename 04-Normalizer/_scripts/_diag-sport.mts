import { checkFactuality, extractClaims } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/factualityCheck';
import { buildEventProfile } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/eventUnderstanding';

const event = {
  category_slug: 'sports', venue_type: 'arena', venue_name: 'Avicii Arena', city: 'Stockholm',
  start_time: '2026-10-20T19:00:00+02:00', end_time: '2026-10-20T21:30:00+02:00',
  price_min_sek: 350, is_free: false, language: 'sv', source: 'avicii',
  title: 'Djurgården — Hammarby',
};

const profile = buildEventProfile(event);
const text = 'Ishockeymatch mellan Djurgården och Hammarby på Avicii Arena.';
const claims = extractClaims(text);
const r = checkFactuality({ draft: { text }, profile, event });
console.log('Unsupported:', r.unsupported_claims);
