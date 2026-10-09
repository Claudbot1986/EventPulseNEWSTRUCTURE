import { checkIndependence } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/independenceCheck';

const source = `Hooligan Bobs spelar på Debaser den 14 november.
Support: The Strokes. Genre: rock. Biljett från 200 kr. Konsertlokal med bar.`;
const draft = `Hooligan Bobs intar Debaser för en rockkonsert. Med support från The Strokes och 200 kr i entré blir kvällen ett måste för den lokala rockscenen.`;

const r = checkIndependence({
  draft: { text: draft, word_count: 0, info_level: 'MEDIUM', meta: { model: 'm', prompt_version: 'v1', generated_at: '' } },
  sourceDescription: source,
  profile: {
    event_type: 'music', performers: ['Hooligan Bobs', 'The Strokes'], genres: ['rock'],
    content: [], experience_characteristics: [], language: ['sv'], provenance: {},
  },
  event: { title: 'Hooligan Bobs', venue_name: 'Debaser' },
});
console.log('Test 3 result:', JSON.stringify(r, null, 2));
