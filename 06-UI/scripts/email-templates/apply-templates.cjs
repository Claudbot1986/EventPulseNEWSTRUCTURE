#!/usr/bin/env node
/**
 * apply-templates.cjs — rullar ut kod-först-emailmallarna till Supabase Auth
 * via Management API.
 *
 * Säkerhetsflöde (i ordning):
 *   1. GET  /v1/projects/{ref}/config/auth  → snapshot till
 *      auth-config-backup-<timestamp>.json (GITIGNORED — innehåller SMTP-lösen)
 *   2. PATCH mailer_subjects_magic_link / mailer_templates_magic_link_content
 *      + motsvarande email_change-fält
 *   3. GET igen → verifiera att de fyra fälten faktiskt matchar lokala filer
 *
 * Läser SUPABASE_ACCESS_TOKEN ur root-.env. Token skrivs ALDRIG till stdout.
 *
 * Kör:  node 06-UI/scripts/email-templates/apply-templates.cjs
 */

const fs = require('fs');
const path = require('path');

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'bsllkpvkowwndhhxtlln';
const API_BASE = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;
const DIR = __dirname;

const SUBJECT_SIGNIN = 'Din kod till EventPulse';
const SUBJECT_EMAIL_CHANGE = 'Bekräfta din e-postadress — EventPulse';
// Appen verifierar exakt 6 siffror (EMAIL_OTP_LENGTH). Supabase-projektet
// stod på 8 (default i nyare projekt) → mejlens koder var oanvändbara.
// 6 är GoTrues standard och matchar hela app-kedjan.
const OTP_LENGTH = 6;

function loadToken() {
  const envPath = path.resolve(DIR, '..', '..', '..', '.env');
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*SUPABASE_ACCESS_TOKEN\s*=\s*(.+?)\s*$/);
    if (m) {
      const token = m[1].replace(/^["']|["']$/g, '');
      if (token && !token.includes('FYLL') && !token.includes('TODO')) return token;
    }
  }
  throw new Error('SUPABASE_ACCESS_TOKEN saknas eller är en placeholder i .env');
}

async function api(method, token, body) {
  const res = await fetch(API_BASE, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function main() {
  const token = loadToken();

  // 1. Snapshot innan vi rör något — rollback-underlag om något går snett.
  console.log('1/3 Hämtar nuvarande auth-config → backup-snapshot …');
  const before = await api('GET', token);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(DIR, `auth-config-backup-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(before, null, 2));
  console.log(`   Backup skriven: ${path.basename(backupPath)} (gitignored)`);

  // 2. PATCH mallar + ämnesrader. Koden hamnar ALDRIG i ämnesraden
  //    (lock-screen-notiser skulle läcka den).
  const magic = fs.readFileSync(path.join(DIR, 'magic-link-code.html'), 'utf8');
  const change = fs.readFileSync(path.join(DIR, 'email-change-code.html'), 'utf8');
  console.log('2/3 PATCH:ar mailer-mallar (magic_link + email_change) …');
  await api('PATCH', token, {
    mailer_subjects_magic_link: SUBJECT_SIGNIN,
    mailer_templates_magic_link_content: magic,
    mailer_subjects_email_change: SUBJECT_EMAIL_CHANGE,
    mailer_templates_email_change_content: change,
    mailer_otp_length: OTP_LENGTH,
  });

  // 3. Verifiera — Management API svarar 200 även på fält det tyst ignorerar
  //    (hänt 2026-09-20 med MAILER_*-nycklar), så vi jämför mot källfilerna.
  console.log('3/3 Verifierar mot servern …');
  const after = await api('GET', token);
  const checks = [
    ['mailer_subjects_magic_link', SUBJECT_SIGNIN],
    ['mailer_templates_magic_link_content', magic],
    ['mailer_subjects_email_change', SUBJECT_EMAIL_CHANGE],
    ['mailer_templates_email_change_content', change],
    ['mailer_otp_length', OTP_LENGTH],
  ];
  let ok = true;
  for (const [field, expected] of checks) {
    const match = after[field] === expected;
    if (!match) ok = false;
    console.log(`   ${match ? 'OK ' : 'FAIL'} ${field}`);
  }
  if (!ok) {
    console.error('\nNågot fält fastnade inte — återställ från backup-filen ovan vid behov.');
    process.exit(1);
  }
  console.log('\nKlart. Återstår: skicka ett testmail och live-verifiera att koden syns.');
}

main().catch((err) => {
  console.error(`apply-templates misslyckades: ${err.message}`);
  process.exit(1);
});
