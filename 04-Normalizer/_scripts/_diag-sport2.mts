import { checkFactuality, extractClaims } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/factualityCheck';
import { buildEventProfile, type EventUnderstandingInput } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/eventUnderstanding';

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

const profile = buildEventProfile(event);
const text = 'Ishockeymatch mellan Djurgården och Hammarby på Avicii Arena.';
const r = checkFactuality({ draft: { text }, profile, event: { title: event.title ?? undefined, venue_name: event.venue_name ?? null, city: event.city ?? null, category_slug: event.category_slug } });
console.log('Unsupported:', r.unsupported_claims);
console.log('Inferred:', r.inferred_claims);
console.log('Profile.genres:', profile.genres);
console.log('Profile.experience_characteristics:', profile.experience_characteristics);
console.log('Profile.content:', profile.content);
