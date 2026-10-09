import { checkFactuality, extractClaims } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/factualityCheck';
import { buildEventProfile, type EventUnderstandingInput } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/eventUnderstanding';

const event: EventUnderstandingInput = {
  category_slug: 'family',
  venue_type: 'park',
  venue_name: 'Tantolunden',
  city: 'Stockholm',
  start_time: '2026-10-19T11:00:00+02:00',
  end_time: '2026-10-19T14:00:00+02:00',
  is_free: true,
  language: 'sv',
  source: 'stockholmsstad',
  title: 'Höstmarknad i Tantolunden',
};

const profile = buildEventProfile(event);
const text = 'Höstmarknad för hela familjen i Tantolunden. Fri entré och program för både barn och vuxna.';
const claims = extractClaims(text);
console.log('Claims:', claims);
const r = checkFactuality({ draft: { text }, profile, event: { ...event, category_slug: event.category_slug } });
console.log('Unsupported:', r.unsupported_claims);
console.log('Inferred:', r.inferred_claims);
console.log('Supported:', r.supported_claims);
