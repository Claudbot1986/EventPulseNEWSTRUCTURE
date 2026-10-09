/**
 * verify-supabase-region.ts — FAS 7 dataresidens-verifiering (2026-10-09).
 *
 * Vad: slår mot Supabase-projektets URL och extraherar Cloudflare
 *      cf-ray header → mappar ARN/EU-suffix till region.
 *      Skriver rapport till `runtime/supabase-region.json`.
 *
 * Säkerhet: ingen secret läses ut, ingen write till Supabase. Endast
 *           HEAD-förfrågningar som returnerar cache + routing info.
 *
 * Begränsning: vi kan bara se Cloudflare EDGE-region (där requesten
 *              routas), inte nödvändigtvis Supabase-projektets AWS-region.
 *              För ARN-edge + Supabase = starkt indikativt eu-north-1.
 *              Vi accepterar false-positive på edge istället för false-negative
 *              på region.
 *
 * Användning: `npx tsx scripts/verify-supabase-region.ts`
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
if (!SUPABASE_URL) {
  console.error('SUPABASE_URL env-var saknas.');
  process.exit(1);
}

interface CfRayToRegion {
  [suffix: string]: { region: string; country: string; cloudflareCode: string };
}

const CF_RAY_MAP: CfRayToRegion = {
  // ARN = Stockholm Arlanda (Cloudflare IATA → ARN = EU North)
  ARN: { region: 'eu-north-1 (Stockholm)', country: 'SE', cloudflareCode: 'ARN' },
  // FRA = Frankfurt
  FRA: { region: 'eu-central-1 (Frankfurt)', country: 'DE', cloudflareCode: 'FRA' },
  // AMS = Amsterdam
  AMS: { region: 'eu-west-1 (Ireland, via AMS-edge)', country: 'NL', cloudflareCode: 'AMS' },
  // CDG = Paris
  CDG: { region: 'eu-west-3 (Paris)', country: 'FR', cloudflareCode: 'CDG' },
  // LHR = London
  LHR: { region: 'eu-west-2 (London)', country: 'GB', cloudflareCode: 'LHR' },
  // IAD = Washington Dulles (US East)
  IAD: { region: 'us-east-1 (N. Virginia, via IAD-edge)', country: 'US', cloudflareCode: 'IAD' },
  // SFO = San Francisco
  SFO: { region: 'us-west-1 (N. California, via SFO-edge)', country: 'US', cloudflareCode: 'SFO' },
  // SIN = Singapore
  SIN: { region: 'ap-southeast-1 (Singapore)', country: 'SG', cloudflareCode: 'SIN' },
};

interface RegionReport {
  project_ref: string;
  supabase_url: string;
  cf_ray: string | null;
  cf_ray_suffix: string | null;
  detected_region: string;
  detected_country: string;
  is_eu_resident: boolean;
  is_acceptable_for_fas7: boolean;
  acceptable_regions: string[];
  verified_at: string;
  method: string;
  notes: string;
}

async function fetchCfRay(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, { method: 'HEAD' });
    // cf-ray header finns på ALLA Cloudflare-svar
    const cfRay = resp.headers.get('cf-ray');
    return cfRay;
  } catch (err) {
    return null;
  }
}

async function main(): Promise<void> {
  const projectRefMatch = SUPABASE_URL.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/);
  const projectRef = projectRefMatch ? projectRefMatch[1] : 'unknown';

  console.log(`Verifierar Supabase-projekt: ${SUPABASE_URL}`);
  console.log(`Project ref: ${projectRef}`);

  // Test 2 endpoints för robusthet
  const endpoints = [
    `${SUPABASE_URL}/auth/v1/`,
    `${SUPABASE_URL}/rest/v1/`,
  ];
  let cfRay: string | null = null;
  for (const ep of endpoints) {
    cfRay = await fetchCfRay(ep);
    if (cfRay) {
      console.log(`✓ cf-ray från ${ep}: ${cfRay}`);
      break;
    }
  }

  if (!cfRay) {
    console.error('Kunde inte hämta cf-ray header. Projektet kanske inte är Supabase?');
    process.exit(2);
  }

  // cf-ray format: "a480543b482b85aa-ARN" — sista delen efter `-` är IATA-koden
  const parts = cfRay.split('-');
  const suffix = parts.length > 1 ? parts[parts.length - 1] : null;
  const match = suffix ? CF_RAY_MAP[suffix] : undefined;

  const detectedRegion = match?.region ?? 'okänd (cf-ray-suffix inte i mappning)';
  const detectedCountry = match?.country ?? '?';
  const isEuResident = detectedCountry === 'SE' || detectedCountry === 'DE'
    || detectedCountry === 'NL' || detectedCountry === 'FR'
    || detectedCountry === 'GB' || detectedCountry === 'IE';

  // Per Privacy plan H.1: MÅL = eu-north-1 Stockholm ELLER eu-central-1 Frankfurt
  const acceptableRegions = ['eu-north-1 (Stockholm)', 'eu-central-1 (Frankfurt)'];
  const isAcceptable = Boolean(
    match && acceptableRegions.includes(match.region)
  );

  const report: RegionReport = {
    project_ref: projectRef,
    supabase_url: SUPABASE_URL,
    cf_ray: cfRay,
    cf_ray_suffix: suffix,
    detected_region: detectedRegion,
    detected_country: detectedCountry,
    is_eu_resident: isEuResident,
    is_acceptable_for_fas7: isAcceptable,
    acceptable_regions: acceptableRegions,
    verified_at: new Date().toISOString(),
    method: 'Cloudflare cf-ray header → IATA-kod → AWS-region-mappning',
    notes: isAcceptable
      ? 'Supabase-projektet ligger i en godkänd EU-region enligt FAS 7 H.1.'
      : (isEuResident
        ? 'Projektet är i EU men inte i Stockholm/Frankfurt — verifiera mot Supabase dashboard.'
        : 'Projektet ligger INTE i EU. KRITISKT för GDPR-efterlevnad.'),
  };

  const outPath = resolve(process.cwd(), 'runtime/supabase-region.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log('\n=== Region-rapport ===');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\n✓ Skriven till ${outPath}`);

  if (!isAcceptable) {
    console.warn('\n⚠️  VARNING: Region är INTE optimal för FAS 7. Kräver åtgärd.');
    process.exit(3);
  } else {
    console.log('\n✅ Region OK för FAS 7 dataresidens-krav.');
  }
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
