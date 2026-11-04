#!/usr/bin/env node
/**
 * Launch-gate: kontrollerar app.json / eas.json / de juridiska texterna /
 * kartprovidern mot de krav som Apple ställer för den här inlämningen.
 *
 *   node .cursor/skills/verify-eventpulse-launch/scripts/check-app-config.mjs
 *
 * Exit 0 = alla kontroller gröna. Exit 1 = något har glidit.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || process.cwd());
const results = [];
const check = (label, ok, detail = '') => results.push({ label, ok, detail });

const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, '06-UI/app.json'), 'utf8'));
const easJson = JSON.parse(fs.readFileSync(path.join(ROOT, '06-UI/eas.json'), 'utf8'));
const expo = appJson.expo;

// ── iOS-konfiguration ────────────────────────────────────────────────────────
check('supportsTablet är false (iPhone-only → inga iPad-skärmbilder)',
  expo.ios.supportsTablet === false, `supporterarTablet=${expo.ios.supportsTablet}`);

const pm = expo.ios.privacyManifests || {};
const dataTypes = (pm.NSPrivacyCollectedDataTypes || []).map((t) => t.NSPrivacyCollectedDataType);
check('privacy manifest: tracking false', pm.NSPrivacyTracking === false);
check('privacy manifest: inga tracking-domäner',
  Array.isArray(pm.NSPrivacyTrackingDomains) && pm.NSPrivacyTrackingDomains.length === 0);
for (const type of [
  'NSPrivacyCollectedDataTypeEmailAddress',
  'NSPrivacyCollectedDataTypeUserID',
  'NSPrivacyCollectedDataTypeDeviceID',
  'NSPrivacyCollectedDataTypeProductInteraction',
  'NSPrivacyCollectedDataTypeSearchHistory',
  'NSPrivacyCollectedDataTypeOtherUserContent',
]) {
  check(`privacy manifest: ${type.replace('NSPrivacyCollectedDataType', '')} deklarerad`,
    dataTypes.includes(type));
}
check('privacy manifest: alla datatyper är linked=true, tracking=false',
  (pm.NSPrivacyCollectedDataTypes || []).every((t) => t.NSPrivacyCollectedDataTypeLinked === true && t.NSPrivacyCollectedDataTypeTracking === false));

check('Sign in with Apple-plugin finns', (expo.plugins || []).includes('expo-apple-authentication'));
check('ITSAppUsesNonExemptEncryption=false (inget exportdokument)',
  expo.ios.infoPlist?.ITSAppUsesNonExemptEncryption === false);
check('ATS: NSAllowsArbitraryLoads=false',
  expo.ios.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads === false);

// ── EAS-profil ────────────────────────────────────────────────────────────────
const prodEnv = easJson.build?.production?.env || {};
check('eas production: EXPO_PUBLIC_ENABLE_DEMO_LOGIN=true',
  prodEnv.EXPO_PUBLIC_ENABLE_DEMO_LOGIN === 'true');
check('eas production: EXPO_PUBLIC_DEMO_EMAIL satt',
  !!prodEnv.EXPO_PUBLIC_DEMO_EMAIL);
check('eas production: inget lösenord i git',
  !JSON.stringify(easJson).match(/PASSWORD/i), 'lösenord får inte ligga i eas.json');

// ── Juridiska texter (alla språk som har dem) ────────────────────────────────
const stringFiles = fs.readdirSync(path.join(ROOT, '06-UI/i18n/strings'))
  .filter((f) => f.endsWith('.js'));
for (const file of stringFiles) {
  const content = fs.readFileSync(path.join(ROOT, '06-UI/i18n/strings', file), 'utf8');
  if (!content.includes('legal.privacy.p1.body')) continue; // språk utan juridisk text
  check(`${file}: inga [TODO: ...]-platshållare`, !content.includes('[TODO:'));
  check(`${file}: _legalDraftOnly = '0' (ingen AI-utkastsbanner)`,
    /'_legalDraftOnly':\s*'0'/.test(content));
  check(`${file}: MiniMax angiven som AI-leverantör`, content.includes('MiniMax'));
  check(`${file}: Supabase-region eu-north-1`, content.includes('eu-north-1'));
  check(`${file}: kontaktadress hej@eventpulse.nu`, content.includes('hej@eventpulse.nu'));
  check(`${file}: gammal kontaktadress borta`, !content.includes('privacy@eventpulse.nu'));
  check(`${file}: gammal leverantörslista borta`, !content.includes('OpenAI / Anthropic'));
  check(`${file}: salt-nyckel-formulering borta`, !content.includes('salt-nyckel'));
  check(`${file}: 18 års gräns`, /minst 18 år|at least 18 years|almeno 18 anni/.test(content));
}

// ── Kartprovider ──────────────────────────────────────────────────────────────
// FACT: react-native-maps 1.29.11 exporterar PROVIDER_DEFAULT (= undefined)
// och PROVIDER_GOOGLE ('google'). Det finns INGEN PROVIDER_APPLE — att
// importera den ger undefined via Babel-interop, vilket råkar betyda samma
// sak (undefined provider = plattformens standard = MapKit på iOS,
// decorateMapComponent.ts:139).
//
// Korrekt mål: ingen icke-existerande import, och absolut inte PROVIDER_GOOGLE
// (kräver API-nyckel vi inte shippar + ger Google en tredjepartsroll).
for (const screen of ['MapScreen.js', 'KartaScreen.js']) {
  const content = fs.readFileSync(path.join(ROOT, '06-UI/screens', screen), 'utf8');
  const codeOnly = content
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  check(`${screen}: PROVIDER_APPLE importeras inte (finns inte i react-native-maps)`,
    !codeOnly.includes('PROVIDER_APPLE'));
  check(`${screen}: PROVIDER_GOOGLE används inte`, !codeOnly.includes('PROVIDER_GOOGLE'));
  check(`${screen}: provider sätts till PROVIDER_DEFAULT (= MapKit på iOS)`,
    codeOnly.includes('provider={PROVIDER_DEFAULT}'));
}

// ── Policy i gästläget (Apple §5.1.1(i)) ─────────────────────────────────────
const profile = fs.readFileSync(path.join(ROOT, '06-UI/screens/ProfileScreen.js'), 'utf8');
const legalLinkUses = (profile.match(/<LegalLinks/g) || []).length;
check('Profil: LegalLinks renderas i både gäst- och inloggad gren',
  legalLinkUses >= 2, `LegalLinks förekommer ${legalLinkUses} gånger`);
check('Profil: LegalModal finns i gästgrenen',
  (profile.match(/<LegalModal/g) || []).length >= 4, `${(profile.match(/<LegalModal/g) || []).length} LegalModal-element`);

// ── Resultat ──────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'OK  ' : 'FEL '} ${r.label}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} kontroller gröna.`);
process.exit(failed.length > 0 ? 1 : 0);
