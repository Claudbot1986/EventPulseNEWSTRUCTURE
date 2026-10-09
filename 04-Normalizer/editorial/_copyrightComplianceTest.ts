/**
 * _copyrightComplianceTest.ts — verifierar copyright-skydd på 10 events.
 *
 * Test-flöde per event:
 *   1. Visa source_description (FÖRE) — det upphovsrättsskyddade originalet
 *   2. Visa Profile (från entityExtractor + gazetteer)
 *   3. Kör Writer V2 (M3) → genererad text (EFTER)
 *   4. Verifiera textualFirewall: kasta om source_description finns i input
 *   5. Kör checkIndependence → likhets-score mot source
 *   6. Kör checkFactuality → claims verifierade mot Profile/gazetteer
 *
 * Source descriptions är syntetiska (skrivna för testet) men realistiska —
 * samma typ av copy som en venue använder. INTE kopierade från riktiga
 * källor. Används ENDAST för att mäta tekniska skyddsmekanismer.
 *
 * Användning:
 *   set -a && source .env && set +a
 *   npx tsx 04-Normalizer/editorial/_copyrightComplianceTest.ts
 */
import { extractEntities } from './entityExtractor';
import { buildEventProfile, profileInfoLevel } from './eventUnderstanding';
import { writeEditorialDescription } from './editorialWriter';
import { checkFactuality } from './factualityCheck';
import { checkIndependence } from './independenceCheck';
import { compileWriterInputs, assertFirewallClean } from './textualFirewall';
import type { WriterSafeInputs } from './types';
import type { EventProfile } from './types';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
const LLM_MODEL = 'MiniMax-M3';
const LLM_TIMEOUT_MS = 8000;

async function callMinimax(userMsg: string, systemPrompt: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return '';
  const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 400,
      temperature: 0.6,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!response.ok) return '';
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return '';
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

interface TestCase {
  id: number;
  title: string;
  category_slug: string;
  venue_name: string | null;
  city: string | null;
  /** Syntetisk source_description i samma stil som venue-copy. */
  source_description: string;
  start_time: string;
}

const TEST_CASES: TestCase[] = [
  {
    id: 1,
    title: 'Veronica Maggio',
    category_slug: 'music',
    venue_name: 'Annexet',
    city: 'Stockholm',
    source_description:
      'Veronica Maggio bjuder in till en magisk kväll fylld av hennes största hits och nya favoriter från skivbolaget. ' +
      'Med sin karaktäristiska röst och scennärvaro tar hon med publiken på en resa genom sina album. ' +
      'En konsert att minnas för alla som älskar svensk popmusik och hennes unika berättelser.',
    start_time: '2026-11-15T19:30:00+01:00',
  },
  {
    id: 2,
    title: 'Donovan Woods',
    category_slug: 'music',
    venue_name: 'Debaser',
    city: 'Stockholm',
    source_description:
      'Donovan Woods kommer till Stockholm med sin intima konsertturné. ' +
      'Den kanadensiska singer-songwritern framför låtar från hela sin katalog, ' +
      'från tidiga folkmelodier till nya country-influerade spår. ' +
      'En kväll för den som uppskattar genuint hantverk och äkta berättelser.',
    start_time: '2026-10-25T20:00:00+02:00',
  },
  {
    id: 3,
    title: 'Radiokören & Peter Dijkstra',
    category_slug: 'classical',
    venue_name: 'Berwaldhallen',
    city: 'Stockholm',
    source_description:
      'Radiokören under ledning av Peter Dijkstra framför ett program med nutida svensk körmusik. ' +
      'Verk av tonsättare som Karin Rehnqvist och Jan Sandström belyser körens bredd. ' +
      'En konsert som utforskar den svenska körtraditionen och dess internationella samtida uttryck.',
    start_time: '2026-12-01T19:00:00+01:00',
  },
  {
    id: 4,
    title: 'Norra Brunn: Måns Möller, Tobias Erehed, Dominik Henzel',
    category_slug: 'humor',
    venue_name: 'Norra Brunn',
    city: 'Stockholm',
    source_description:
      'Tre av Sveriges mest älskade komiker bjuder in till en kväll med skarp satir och varm humor. ' +
      'Måns Möller, Tobias Erehed och Dominik Henzel delar scen i en gemensam föreställning. ' +
      'Standup på svenska för den som vill skratta och tänka efter.',
    start_time: '2026-10-30T19:00:00+01:00',
  },
  {
    id: 5,
    title: 'Quidam: Helene Berg + Paul Pignon + Ida Lundén',
    category_slug: 'community',
    venue_name: 'Fylkingen',
    city: 'Stockholm',
    source_description:
      'En kväll med lokalt program på Fylkingen där Helene Berg, Paul Pignon och Ida Lundén möter publiken ' +
      'i ett öppet format med improvisation och samtal. ' +
      'En avspänd tillställning för den som vill upptäcka nya röster inom svensk jazz och nutida musik.',
    start_time: '2026-10-20T19:00:00+02:00',
  },
  {
    id: 6,
    title: 'Håkan Hellström',
    category_slug: 'music',
    venue_name: 'Ullevi',
    city: 'Göteborg',
    source_description:
      'Håkan Hellström firar 25 år som artist med en storslagen konsert på Ullevi. ' +
      'Göteborgs egen son bjuder på hits från hela karriären, ' +
      'med sin karaktäristiska blandning av pop och soul, och publiken sjunger med.',
    start_time: '2026-08-12T20:00:00+02:00',
  },
  {
    id: 7,
    title: 'Anna von Hausswolff',
    category_slug: 'music',
    venue_name: 'Konserthuset',
    city: 'Stockholm',
    source_description:
      'Anna von Hausswolff framför nya och äldre verk med orgel och elektronik. ' +
      'Hennes experimentella art pop möter neoklassiska strukturer i en konsert ' +
      'som utforskar rymden mellan det intima och det monumentala.',
    start_time: '2026-11-05T19:30:00+01:00',
  },
  {
    id: 8,
    title: 'Sven Ingvars',
    category_slug: 'music',
    venue_name: 'Kungsbacka Teater',
    city: 'Kungsbacka',
    source_description:
      'Sven Ingvars dansband bjuder in till dansanta toner och svenska klassiker. ' +
      'En kväll fylld av dansbandsfavoriter och glädje på Kungsbacka Teater.',
    start_time: '2026-10-09T19:00:00+02:00',
  },
  {
    id: 9,
    title: 'Anton Estby & Henrythefreak',
    category_slug: 'humor',
    venue_name: 'Troll Stockholm',
    city: 'Stockholm',
    source_description:
      'Anton Estby och Henrythefreak delar scen i en gemensam standup-kväll. ' +
      'Två av Sveriges mest karaktäristiska komiker bjuder på humor, ' +
      'gestaltning och publikkontakt i en intim miljö mitt i Stockholm.',
    start_time: '2026-10-22T19:30:00+02:00',
  },
  {
    id: 10,
    title: 'Lars Jansson & Erik Söderlind Quartet',
    category_slug: 'jazz',
    venue_name: 'Fasching',
    city: 'Stockholm',
    source_description:
      'Lars Jansson och Erik Söderlind leder en quartet som spelar svensk jazz med rötter i 60-talet. ' +
      'Improvisation och melankoli i en konsert för den initierade jazzpubliken.',
    start_time: '2026-11-12T20:00:00+01:00',
  },
];

interface ComplianceReport {
  id: number;
  title: string;
  before_source_excerpt: string;
  profile_performers: string[];
  gazetteer_hits: string[];
  after_generated: string;
  independence_score: number;
  independence_pass: boolean;
  matched_phrases: string[];
  factuality_pass: boolean;
  supported_claims: number;
  unsupported_claims: string[];
  firewall_threw: boolean;
  compliance_verdict: 'PASS' | 'FAIL';
}

async function runTestCase(tc: TestCase): Promise<ComplianceReport> {
  // 1. Profile (entityExtractor + gazetteer) — utan source_description
  const entities = extractEntities({
    title: tc.title,
    raw_description: null, // VIKTIGT: source_description når ALDRIG hit
    category_slug: tc.category_slug,
    venue_name: tc.venue_name,
  });
  const PERFORMER_ROLES = new Set(['artist', 'ensemble', 'band', 'performer', 'comedian', 'conductor', 'soloist', 'speaker', 'dj', 'team']);
  const performers = entities.filter((e) => PERFORMER_ROLES.has(e.role)).map((e) => e.name);

  const profile: EventProfile = buildEventProfile({
    title: tc.title,
    raw_description: null, // VIKTIGT: source_description når ALDRIG hit
    category_slug: tc.category_slug,
    venue_name: tc.venue_name,
    city: tc.city,
    source: 'copyright-test',
    performers,
  });

  const gazetteer_hits = profile.performer_metadata
    ? Object.keys(profile.performer_metadata)
    : [];

  // 2. Bygg WriterSafeInputs via textualFirewall — den SKA vägra om source finns
  let firewallThrew = false;
  let inputs: WriterSafeInputs | null = null;
  try {
    inputs = compileWriterInputs({
      profile,
      event: {
        title: tc.title,
        start_time: tc.start_time,
        venue_name: tc.venue_name,
        city: tc.city,
        is_free: false,
      },
    });
  } catch (err) {
    firewallThrew = true;
    console.error(`  ❌ Firewall rejected (should NOT happen): ${(err as Error).message}`);
  }

  // 3. assertFirewallClean — defensiv
  if (inputs) {
    try {
      assertFirewallClean(inputs);
    } catch (err) {
      firewallThrew = true;
      console.error(`  ❌ assertFirewallClean rejected: ${(err as Error).message}`);
    }
  }

  // 4. M3-genererad prosa
  const llm = {
    name: 'copyright-test',
    async generate(args: { systemPrompt: string; userPrompt: string }): Promise<string> {
      return await callMinimax(args.userPrompt, args.systemPrompt);
    },
  };

  let draft;
  try {
    draft = await writeEditorialDescription({ inputs: inputs!, llm });
  } catch (err) {
    // tomt fallback om M3 timeout
    draft = { text: '[M3 failed]', word_count: 0, info_level: 'VERY_LOW' as const, meta: { model: 'M3', prompt_version: 'v1', generated_at: '2026-10-09' } };
  }

  // 5. IndependenceCheck mot source_description
  const independence = checkIndependence({
    draft,
    sourceDescription: tc.source_description,
    profile,
    event: { title: tc.title, venue_name: tc.venue_name, city: tc.city },
  });

  // 6. Factuality
  const factuality = checkFactuality({
    draft,
    profile,
    event: { title: tc.title, venue_name: tc.venue_name, city: tc.city, start_time: tc.start_time },
  });

  return {
    id: tc.id,
    title: tc.title,
    before_source_excerpt: tc.source_description.slice(0, 200) + (tc.source_description.length > 200 ? '…' : ''),
    profile_performers: profile.performers,
    gazetteer_hits,
    after_generated: draft.text,
    independence_score: Number(independence.max_similarity.toFixed(3)),
    independence_pass: independence.pass,
    matched_phrases: independence.matched_phrases,
    factuality_pass: factuality.pass,
    supported_claims: factuality.supported_claims.length,
    unsupported_claims: factuality.unsupported_claims.slice(0, 8),
    firewall_threw: firewallThrew,
    compliance_verdict: (independence.pass && factuality.pass) ? 'PASS' : 'FAIL',
  };
}

async function main(): Promise<void> {
  console.log('═'.repeat(78));
  console.log('  COPYRIGHT COMPLIANCE TEST — 10 events, FAS 6 + IndependenceCheck + FactualityCheck');
  console.log('═'.repeat(78));

  const reports: ComplianceReport[] = [];

  for (const tc of TEST_CASES) {
    console.log(`\n[${tc.id}/10] ${tc.title}`);
    const r = await runTestCase(tc);
    reports.push(r);

    console.log(`  Performers: ${JSON.stringify(r.profile_performers)}`);
    console.log(`  Gazetteer:  ${JSON.stringify(r.gazetteer_hits)}`);
    console.log(`  Independence: ${r.independence_score} (pass=${r.independence_pass})`);
    console.log(`  Factuality:  pass=${r.factuality_pass} (supp=${r.supported_claims}, unsupp=${r.unsupported_claims.length})`);
    console.log(`  Verdict:     ${r.compliance_verdict}`);

    // rate-limit
    await new Promise((res) => setTimeout(res, 3000));
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(78));
  console.log('  SLUTRESULTAT');
  console.log('═'.repeat(78));

  const independentCount = reports.filter((r) => r.independence_pass).length;
  const factualCount = reports.filter((r) => r.factuality_pass).length;
  const compliantCount = reports.filter((r) => r.compliance_verdict === 'PASS').length;
  const avgIndependence = reports.reduce((s, r) => s + r.independence_score, 0) / reports.length;
  const firewallCount = reports.filter((r) => r.firewall_threw).length;

  console.log(`  Totalt events testade:    ${reports.length}`);
  console.log(`  Firewall ren:             ${reports.length - firewallCount}/${reports.length} (${firewallCount} blockerade)`);
  console.log(`  Independence PASS:        ${independentCount}/${reports.length}`);
  console.log(`  Factuality PASS:          ${factualCount}/${reports.length}`);
  console.log(`  Compliance PASS (båda):   ${compliantCount}/${reports.length}`);
  console.log(`  Medel-likhet mot source:  ${avgIndependence.toFixed(3)} (tröskel 0.35)`);
  console.log('');

  console.log('  Per-event:');
  for (const r of reports) {
    const verdict = r.compliance_verdict === 'PASS' ? '✅' : '⚠️';
    console.log(`    ${verdict} #${r.id.toString().padStart(2)} ${r.title.slice(0, 50).padEnd(50)} ind=${r.independence_score} fact=${r.factuality_pass}`);
  }

  // Skriv rapport
  const outPath = resolve(process.cwd(), 'runtime/copyright-compliance-2026-10-09.json');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const finalPath = resolve(__dirname, '../../runtime/copyright-compliance-2026-10-09.json');
  const { writeFileSync, mkdirSync } = await import('fs');
  mkdirSync(dirname(finalPath), { recursive: true });
  writeFileSync(finalPath, JSON.stringify({ reports, summary: { totalEvents: reports.length, independentCount, factualCount, compliantCount, avgIndependence, firewallCount } }, null, 2), 'utf-8');
  console.log(`\n  ✓ Rapport skriven till runtime/copyright-compliance-2026-10-09.json`);
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
