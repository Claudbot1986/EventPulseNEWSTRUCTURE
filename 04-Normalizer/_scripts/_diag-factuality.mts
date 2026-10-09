import { extractClaims, checkFactuality } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/factualityCheck';
import type { EventProfile, EditorialDraft } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/types';

const draft = (text: string): EditorialDraft => ({
  text, word_count: text.split(/\s+/).length, info_level: 'LOW',
  meta: { model: 'minimax-M3', prompt_version: 'editorial-writer/v1', generated_at: '2026-10-08' },
});

const profileFARVEBLIND: EventProfile = {
  event_type: 'music', performers: ['FARVEBLIND'], genres: [],
  content: ['låtar', 'framförande'],
  experience_characteristics: ['live band', 'ljudvolym', 'publikrespons'],
  setting: 'klubb / scen', language: ['sv'], provenance: { event_type: 'category:music' },
};

const profileMuuto: EventProfile = {
  event_type: 'community', performers: ['Muuto 20Y Anniversary', 'Svenssons'], genres: [],
  content: ['lokalt program'], experience_characteristics: ['lokalt'],
  setting: 'lokal', language: ['sv'], provenance: { event_type: 'category:community' },
};

const texts = {
  FARVEBLIND: 'En kväll med FARVEBLIND på Hus 7, med fokus på community och samhörighet. Evenemanget riktar sig till den lokala scenen i Stockholm och bjuder in till en avslappnad träff med artisten i centrum. Ett tillfälle för den som vill upptäcka ny musik i en intim och publiknära miljö.',
  Muuto: 'Muuto 20Y Anniversary och Svenssons bjuder in till ett öppet kvällsprogram i Stockholm med lokalt förankrat innehåll. Evenemanget vänder sig till en lokal publik och bjuder på varierad medverkan under två timmar.',
};

console.log('═════ FARVEBLIND ═════');
console.log('Extracted claims:', extractClaims(texts.FARVEBLIND));
console.log('Check:', JSON.stringify(checkFactuality({ draft: draft(texts.FARVEBLIND), profile: profileFARVEBLIND, event: { title: 'FARVEBLIND @ Hus 7', venue_name: 'Hus 7', city: 'Stockholm' } }), null, 2));

console.log('\n═════ MUUTO ═════');
console.log('Extracted claims:', extractClaims(texts.Muuto));
console.log('Check:', JSON.stringify(checkFactuality({ draft: draft(texts.Muuto), profile: profileMuuto, event: { title: 'Muuto 20Y Anniversary x Svenssons', venue_name: 'Svenssons', city: 'Stockholm' } }), null, 2));
