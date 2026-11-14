#!/usr/bin/env node
/**
 * IPA-gate: verifierar den FAKTISKA byggartefakten (inte repot).
 *
 *   node .cursor/skills/verify-eventpulse-launch/scripts/check-ipa.mjs <url|path.ipa>
 *
 * Kontrollerar:
 *   1. PrivacyInfo.xcprivacy finns i app-target med rätt deklarationer
 *   2. UIDeviceFamily == [1] (iPhone-only)
 *   3. aps-environment == production + Sign in with Apple-entitlement
 *   4. JS-bundlen innehåller de nya juridiska texterna och saknar de gamla
 *
 * VIKTIGT: Hermes lagrar strängar som innehåller icke-ASCII som UTF-16.
 * Ett vanligt grep på "MiniMax" hittar då ingenting — sök i båda encodings.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { POLICY_EVIDENCE_MARKERS } from './lib/policy-truth.mjs';

const target = process.argv[2];
if (!target) {
  console.error('Användning: check-ipa.mjs <artifact-url|path.ipa>');
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-ipa-'));
const ipaPath = path.join(tmp, 'app.ipa');
if (/^https?:/.test(target)) {
  console.log(`Hämtar ${target} …`);
  execFileSync('curl', ['-sL', '--max-time', '300', '-o', ipaPath, target], { stdio: 'inherit' });
} else {
  fs.copyFileSync(target, ipaPath);
}
const appDir = path.join(tmp, 'extracted');
execFileSync('unzip', ['-q', ipaPath, '-d', appDir]);
const app = fs.readdirSync(path.join(appDir, 'Payload')).find((d) => d.endsWith('.app'));
const appRoot = path.join(appDir, 'Payload', app);

const results = [];
const check = (label, ok, detail = '') => results.push({ label, ok, detail });

// 1. Privacy manifest
const manifestPath = path.join(appRoot, 'PrivacyInfo.xcprivacy');
if (!fs.existsSync(manifestPath)) {
  check('PrivacyInfo.xcprivacy finns i app-target', false);
} else {
  check('PrivacyInfo.xcprivacy finns i app-target', true, `${fs.statSync(manifestPath).size} byte`);
  const plist = execFileSync('plutil', ['-convert', 'json', '-o', '-', manifestPath]).toString();
  const d = JSON.parse(plist);
  const types = (d.NSPrivacyCollectedDataTypes || []).map((t) => t.NSPrivacyCollectedDataType.replace('NSPrivacyCollectedDataType', ''));
  const accessed = (d.NSPrivacyAccessedAPITypes || []).map((t) => `${t.NSPrivacyAccessedAPIType.replace('NSPrivacyAccessedAPICategory', '')}:${(t.NSPrivacyAccessedAPITypeReasons || []).join('/')}`);
  check('manifest: tracking false', d.NSPrivacyTracking === false);
  for (const t of ['EmailAddress', 'UserID', 'DeviceID', 'ProductInteraction', 'SearchHistory', 'OtherUserContent']) {
    check(`manifest: ${t}`, types.includes(t), types.join(','));
  }
  check('manifest: accessed-API deklarerade', accessed.length >= 1, accessed.join(' '));
}

// 2. UIDeviceFamily
const family = execFileSync('plutil', ['-extract', 'UIDeviceFamily', 'json', '-o', '-', path.join(appRoot, 'Info.plist')]).toString().trim();
check('UIDeviceFamily == [1] (iPhone-only)', family.replace(/\s/g, '') === '[1]', family);

// 3. Entitlements
try {
  const prov = path.join(appRoot, 'embedded.mobileprovision');
  const ent = execFileSync('bash', ['-lc',
    `security cms -D -i "${prov}" 2>/dev/null | plutil -extract Entitlements xml1 -o - - 2>/dev/null`]).toString();
  check('entitlement: aps-environment = production', /<key>aps-environment<\/key>\s*<string>production<\/string>/.test(ent));
  check('entitlement: Sign in with Apple', /com\.apple\.developer\.applesignin/.test(ent));
} catch (e) {
  check('entitlement-kontroll kunde inte köras', false, String(e.message).slice(0, 80));
}

// 4. JS-bundle (UTF-16-medveten sökning)
const bundle = fs.readFileSync(path.join(appRoot, 'main.jsbundle'));
const countAscii = (s) => {
  let n = 0, i = 0;
  const needle = Buffer.from(s, 'utf8');
  while ((i = bundle.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
};
const countUtf16 = (s) => {
  let n = 0, i = 0;
  const needle = Buffer.from(s, 'utf16le');
  while ((i = bundle.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
};
const either = (s) => countAscii(s) + countUtf16(s);

for (const s of ['eu-north-1', 'Användarvillkor', 'minst 18 år', 'härleds från ditt användar-id', 'djb2', 'hej@eventpulse.nu', 'demo@eventpulse.nu']) {
  check(`bundle: "${s}" finns`, either(s) >= 1, `${countAscii(s)} ascii / ${countUtf16(s)} utf16`);
}
for (const s of ['OpenAI / Anthropic', 'salt-nyckel', '[TODO:', 'privacy@eventpulse.nu']) {
  check(`bundle: gammal text "${s}" borta`, either(s) === 0, `${either(s)} träffar`);
}

// 4a-bis. POLICY ≈ APP (2026-11-14). Tills i dag krävde den här gaten att
// "MiniMax" och "EU–US Data Privacy Framework" FANNS i bunten — den låste
// fast den falska agentchatten i den publicerade policyn. Build 6 har ingen
// agentchatt och skickar ingen text till MiniMax, så båda ska bort.
for (const s of ['MiniMax', 'EU–US Data Privacy Framework', 'agentchat', 'event-agent', 'smakprofil']) {
  check(`bundle: agentpåstående "${s}" borta`, either(s) === 0, `${either(s)} träffar`);
}
for (const s of Object.values(POLICY_EVIDENCE_MARKERS).flat()) {
  check(`bundle: policyn förklarar "${s}"`, either(s) >= 1, `${countAscii(s)} ascii / ${countUtf16(s)} utf16`);
}

// 4b. Legalavsnitten som tidigare läckte råa i18n-nycklar (p1, p2a, p2b, p2c).
// Varje avsnitt har antingen .body eller .bullets — inte båda. Fixen i
// LegalModal.buildSections filtrerar bort nyckel-ekot, så de riktiga
// rubrikerna MÅSTE finnas i bunten i alla tre språk som publiceras.
// Råa nycklar får inte finnas som literaler (det vore en ny leak).
const legalTitles = [
  '1. Vem vi är',
  '2.1 Kontouppgifter (när du skapar konto)',
  '2.2 Användargenererad data',
  '2.3 Enhets- och användningsdata',
  '1. Who we are',
  '2.1 Account data (when you create an account)',
  '2.2 User-generated data',
  '2.3 Device and usage data',
  '1. Chi siamo',
  "2.1 Dati dell'account (quando crei un account)",
  "2.2 Dati generati dall'utente",
  '2.3 Dati del dispositivo e di utilizzo',
];
for (const s of legalTitles) {
  check(`bundle: policyns rubrik "${s}" finns`, either(s) >= 1, `${countAscii(s)} ascii / ${countUtf16(s)} utf16`);
}
for (const s of ['legal.privacy.p1.bullets', 'legal.privacy.p2a.body', 'legal.privacy.p2b.body', 'legal.privacy.p2c.body']) {
  check(`bundle: rå nyckel "${s}" borta`, either(s) === 0, `${either(s)} träffar`);
}

// 4c. Personuppgiftsansvarig i den publicerade policyn.
// Perfectday AB, org.nr 556990-9830 (fastställt av ägaren 2026-11-06).
// "Tomor Gashi" som operatör var ett underbyggt antagande och får inte
// finnas kvar i den publicerade policyn.
for (const s of ['Perfectday AB', '556990-9830']) {
  check(`bundle: "${s}" finns`, either(s) >= 1, `${countAscii(s)} ascii / ${countUtf16(s)} utf16`);
}
for (const s of ['drivs av Tomor Gashi', 'operated by Tomor Gashi', 'gestito da Tomor Gashi']) {
  check(`bundle: gammal operatör "${s}" borta`, either(s) === 0, `${either(s)} träffar`);
}

// 5. Version/build
const shortVersion = execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(appRoot, 'Info.plist')]).toString().trim();
const build = execFileSync('plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', path.join(appRoot, 'Info.plist')]).toString().trim();
check('version/build läst', !!shortVersion, `${shortVersion} (${build})`);

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FEL '} ${r.label}${r.detail ? `  (${r.detail})` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} kontroller gröna i ${ipaPath}`);
console.log(`Artefakt: ${ipaPath}`);
process.exit(failed.length > 0 ? 1 : 0);
