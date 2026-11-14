/**
 * Gemensamma sanningar om policyn — delad av de tre launch-gates.
 *
 * ROTORS AK: tills 2026-11-14 krävde check-app-config, check-ipa och
 * check-live-site att "MiniMax" FANNs i policyn (check-app-config.mjs:68,
 * check-ipa.mjs:91, check-live-site.mjs:52-53). Det låste fast en falsk
 * uppgift: build 6 har ingen agentchatt och skickar ingen text till MiniMax
 * (06-UI/index.js registrerar AppShell, inte App-agent.js; enda vägen till
 * llmRouter.composeReply är POST /agent/chat, som appen aldrig anropar).
 * Därför stod privacy-etiketten ("Data Shared with third parties: Nej")
 * i konflikt med den publicerade policyn — ett direkt avslagsrisk-moment
 * för App Review (Apple §5.1.1(i)).
 *
 * Policyn ska beskriva det som appen FAKTISKT gör. Detta är den delade
 * definitionen av "det", så att alla tre gates säger samma sak.
 */

/**
 * Plocka ut värdet av alla 'legal.*'-strängar ur en i18n-fil.
 * Hanterar både "key': 'value'," på samma rad och "key':\n  'value',".
 */
export function extractLegalStrings(content) {
  const re = /'(legal\.[^']+)':\s*(?:'((?:[^'\\]|\\.)*)'|\n\s*'((?:[^'\\]|\\.)*)')/g;
  const out = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    const raw = m[2] !== undefined ? m[2] : (m[3] || '');
    out.push(raw.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
  }
  return out.join('\n');
}

/** Påståenden som INTE får finnas i en publicerad policy för build 6. */
export const FORBIDDEN_POLICY_PATTERNS = [
  { re: /MiniMax/, label: 'MiniMax som AI-leverantör' },
  { re: /event-agent/i, label: 'påstådd event-agent' },
  { re: /agentchat|agent chat|chat dell[\u2019']agente|chat with the app/i, label: 'påstådd agentchatt' },
  { re: /konversation(er)? du har med appens|conversations you have with the app|conversazioni con l[\u2019']agente/i, label: 'påstådda konversationer med agenten' },
  { re: /smakprofil|taste profile|profil[io] di gusti|saved taste/i, label: 'påstådd sparad smakprofil' },
  { re: /baserat p[åa] (deras|din) egen smak|based on (their|your) own taste|in base ai (tuoi )?gusti/i, label: 'personalisering efter smak' },
  { re: /AI-agent|AI agent|agente eventi che|event agent/i, label: 'påstådd AI-agent' },
];

/** Det policyn SKA säga, så att läsaren förstår vad som faktiskt händer. */
export const REQUIRED_POLICY_PATTERNS = [
  { re: /s[öo]ktext|search text|testo (di ricerca|cercato)/i, label: 'söktext hanteras mot vår egen server' },
  { re: /utan AI|n[åa]gon AI-modell|without AI|any AI model|senza IA|alcun modello di IA/i, label: 'söktext skickas inte till en AI-modell' },
];

/**
 * Bevismarkörer per språk för byte-sök i den KOMPIILERADE bunten.
 *
 * Bunten lagras i Hermes och sökningen är case-känslig på bytes — medan
 * regex-gates ovan är case-okänsliga. "Söktext" (stora S, svenska substantiv)
 * och "någon AI-modell" finns alltså i bunten medan "söktext"/"utan AI" inte
 * gör det. IPA-gaten söker därför efter de faktiska formuleringarna.
 */
export const POLICY_EVIDENCE_MARKERS = {
  sv: ['Söktext', 'AI-modell'],
  en: ['search text', 'AI model'],
  it: ['Testo di ricerca', 'modello di IA'],
};

/** Kör mönstren mot en text. Returnerar {forbidden:[], missing:[]}. */
export function inspectPolicyText(text) {
  return {
    forbidden: FORBIDDEN_POLICY_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label),
    missing: REQUIRED_POLICY_PATTERNS.filter((p) => !p.re.test(text)).map((p) => p.label),
  };
}
