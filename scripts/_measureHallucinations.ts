/**
 * _measureHallucinations.ts — 2026-10-13.
 *
 * Empirisk hallucination-mätare för editorial_description.
 *
 * För varje event med description:
 *   1. Extrahera atomära claims (meningar med faktapåståenden)
 *   2. Verifiera varje claim mot Profile + event-data
 *   3. Klassificera:
 *        ✓ supported    — claim spåras till Profile eller strukturerat fält
 *        ⚠ unverifiable — stilistisk, kan ej verifieras men motsägs inte
 *        ✗ unsupported  — specifik faktapåstående som inte finns i Profile
 *        ✗ contradicted — går emot Profile (t.ex. land=US när profile säger SE)
 *
 * Output: per-event-granskning + aggregerad rapport.
 *
 * Användning:
 *   set -a && source .env && set +a
 *   npx tsx scripts/_measureHallucinations.ts --category=music --limit=20
 */
import { createClient } from '@supabase/supabase-js';

interface Profile {
  event_type?: string;
  performers?: string[];
  genres?: string[];
  performer_metadata?: Record<string, {
    name?: string;
    country?: string;
    type?: string;
    genres?: string[];
    aliases?: string[];
  }>;
  subject_metadata?: Record<string, unknown>;
}

interface Claim {
  text: string;
  sentence: string;
  category: 'verified' | 'unverifiable' | 'unsupported' | 'contradicted';
  reason: string;
}

const HALLUCINATION_TRIGGERS = [
  // Typiska adjektiv som M3 hittar på (ej i Profile)
  /\b(känd[a]?|populär[a]?|mäktig[a]?|legendarisk[a]?|hyllad[a]?|älskad[a]?|fantastisk[a]?|storslagen[a]?|härlig[a]?|underbar[a]?|kraftfull[a]?|stark[a]?|lojal[a]?|exceptionell[a]?|enastående[a]?|unik[a]?|spännande[a]?|energisk[a]?|intensiv[a]?|stämningsfull[a]?|minnesvärd[a]?)\b/i,
  // Karriär-påståenden
  /\b(lång karriär|mångårig|flerårig|decennier av|generationer av|känd för sin|som medlem i|medlem i|grundare av|frontfigur i)\b/i,
  // Scen-påståenden utöver det strukturerade
  /\b(intar scenen|kliver upp|sätter scenen|fyller lokalen|förvandlar|tar oss med på|låter oss möta|öppnar med|avslutar med)\b/i,
  // Fantasi-beskrivande adjektiv
  /\b(fängslande|fängslande|omvälvande|hjärtevärmande|sinnlig|intim|storslagen dramatisk|exceptionell närvaro)\b/i,
  // Stad-påståenden som inte verifieras
  /\b(Stockholms hjärta|stadens puls|kulturella scenen|musikscenen|kulturhuvudstad)\b/i,
];

const FACTUAL_PATTERNS = [
  // Saker som kan verifieras
  /\b\dkonsert\b/i,
  /\b\dklassiskt\b/i,
  /\b\på\b\s+([A-ZÅÄÖ][\wåäö]+)/,  // "på Fasching"
];

function normalize(s: string | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function splitIntoClaims(text: string): string[] {
  // Dela på meningar (terminal-punkt + ev citattecken)
  return text.split(/[.!?]+["')\]]?\s+/).map((s) => s.trim()).filter((s) => s.length > 5);
}

function verifyClaim(
  claim: string,
  profile: Profile,
  event: { title: string; venue_name: string | null; city: string | null },
): { ok: boolean; category: Claim['category']; reason: string } {
  const lowerClaim = claim.toLowerCase();

  // 1. SUPPORTED — claim innehåller verifierbar fakta som matchar Profile
  // a) Artist-namn
  const performers = profile.performers ?? [];
  for (const p of performers) {
    if (lowerClaim.includes(p.toLowerCase())) {
      return { ok: true, category: 'verified', reason: `artist "${p}" finns i Profile.performers` };
    }
  }
  // b) Venue-namn
  if (event.venue_name && lowerClaim.includes(event.venue_name.toLowerCase())) {
    return { ok: true, category: 'verified', reason: `venue "${event.venue_name}" finns i event` };
  }
  // c) Stad
  if (event.city && lowerClaim.includes(event.city.toLowerCase())) {
    return { ok: true, category: 'verified', reason: `city "${event.city}" finns i event` };
  }
  // d) Genre från Profile
  for (const g of profile.genres ?? []) {
    if (lowerClaim.includes(g.toLowerCase())) {
      return { ok: true, category: 'verified', reason: `genre "${g}" finns i Profile.genres` };
    }
  }
  // e) Performer-metadata (country, type)
  for (const [, meta] of Object.entries(profile.performer_metadata ?? {})) {
    if (meta?.country && lowerClaim.includes(meta.country.toLowerCase())) {
      return { ok: true, category: 'verified', reason: `country "${meta.country}" i performer_metadata` };
    }
    if (meta?.type && lowerClaim.includes(meta.type.toLowerCase())) {
      return { ok: true, category: 'verified', reason: `type "${meta.type}" i performer_metadata` };
    }
  }

  // 2. CONTRADICTED — claim motsäger Profile
  for (const [, meta] of Object.entries(profile.performer_metadata ?? {})) {
    if (!meta?.country || meta.country === '') continue;
    const wrongCountries = ['us', 'uk', 'gb', 'ca', 'au'].filter((c) => c !== meta.country!.toLowerCase());
    for (const wrong of wrongCountries) {
      const countryName = { us: 'amerikansk', uk: 'brittisk', gb: 'brittisk', ca: 'kanadensisk', au: 'australisk' }[wrong];
      if (lowerClaim.includes(countryName!)) {
        return { ok: false, category: 'contradicted', reason: `claim säger ${countryName} men performer_metadata.country=${meta.country}` };
      }
    }
  }

  // 3. UNSUPPORTED — claim innehåller känd halluciant-trigger
  for (const re of HALLUCINATION_TRIGGERS) {
    if (re.test(claim)) {
      return { ok: false, category: 'unsupported', reason: `hallucination-trigger: ${re.source.slice(0, 40)}` };
    }
  }

  // 4. UNVERIFIABLE — varken stöd eller motsägelse i Profile — antas stilistiskt
  return { ok: true, category: 'unverifiable', reason: 'ingen Profile-match; stilistisk påstående utan verifierbar fakta' };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const catArg = args.find((a) => a.startsWith('--category='));
  const category = catArg ? catArg.slice('--category='.length) : null;
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.slice('--limit='.length), 10) : 30;

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const now = new Date().toISOString();

  let q = supabase
    .from('events')
    .select(`
      id, title_sv, category_slug, venue_full_name, venue_city,
      editorial_description, event_profile, editorial_model
    `)
    .gt('start_time', now)
    .not('editorial_description', 'is', null)
    .limit(limit);
  if (category) q = q.eq('category_slug', category);
  const { data, error } = await q;
  if (error) { console.error('Fel:', error.message); process.exit(1); }

  console.log('═'.repeat(78));
  console.log(`  HALLUCINATION-MÄTNING — ${data?.length} events${category ? ` (${category})` : ''}`);
  console.log('═'.repeat(78));

  const events = data ?? [];
  const stats = {
    total: 0,
    supportedClaims: 0,
    unverifiableClaims: 0,
    unsupportedClaims: 0,
    contradictedClaims: 0,
    eventsWithHallucination: 0,
  };

  const examples: { event: string; type: string; claim: string; reason: string }[] = [];

  for (const ev of events) {
    if (!ev.editorial_description || !ev.event_profile) continue;
    stats.total++;
    const profile = ((ev.event_profile as any).profile ?? {}) as Profile;
    const eventInfo = { title: ev.title_sv ?? '', venue_name: ev.venue_full_name, city: ev.venue_city };
    const sentences = splitIntoClaims(ev.editorial_description);

    console.log(`\n--- ${ev.title_sv?.slice(0, 50) ?? '?'}`);
    console.log(`  desc: "${normalize(ev.editorial_description).slice(0, 200)}"`);

    let hasHallu = false;
    for (const s of sentences) {
      const r = verifyClaim(s, profile, eventInfo);
      if (r.category === 'verified') stats.supportedClaims++;
      else if (r.category === 'unverifiable') stats.unverifiableClaims++;
      else {
        if (r.category === 'unsupported') stats.unsupportedClaims++;
        else if (r.category === 'contradicted') stats.contradictedClaims++;
        hasHallu = true;
        if (examples.length < 10) examples.push({ event: ev.title_sv ?? '?', type: r.category, claim: s.slice(0, 100), reason: r.reason });
      }
      const icon = r.category === 'verified' ? '✓' :
                   r.category === 'unverifiable' ? '⚠' :
                   r.category === 'unsupported' ? '✗' : '✗✗';
      console.log(`    ${icon} [${r.category.padEnd(13)}] "${s.slice(0, 70)}${s.length > 70 ? '…' : ''}" — ${r.reason.slice(0, 80)}`);
    }
    if (hasHallu) stats.eventsWithHallucination++;
  }

  console.log('\n' + '═'.repeat(78));
  console.log('  AGGREGERAD RAPPORT');
  console.log('═'.repeat(78));
  console.log(`  Events granskade: ${stats.total}`);
  console.log(`  Events med hallucination: ${stats.eventsWithHallucination} (${Math.round((stats.eventsWithHallucination / stats.total) * 100)}%)`);

  const totalClaims = stats.supportedClaims + stats.unverifiableClaims + stats.unsupportedClaims + stats.contradictedClaims;
  console.log(`\n  Claims totalt: ${totalClaims}`);
  console.log(`    ✓ supported:    ${stats.supportedClaims} (${Math.round((stats.supportedClaims / totalClaims) * 100)}%)`);
  console.log(`    ⚠ unverifiable: ${stats.unverifiableClaims} (${Math.round((stats.unverifiableClaims / totalClaims) * 100)}%)`);
  console.log(`    ✗ unsupported:  ${stats.unsupportedClaims} (${Math.round((stats.unsupportedClaims / totalClaims) * 100)}%)`);
  console.log(`    ✗✗ contradicted:${stats.contradictedClaims} (${Math.round((stats.contradictedClaims / totalClaims) * 100)}%)`);

  if (examples.length > 0) {
    console.log('\n  Första 10 halluciant-claims:');
    for (const ex of examples) {
      console.log(`    [${ex.type}] ${ex.event?.slice(0, 30)}`);
      console.log(`       claim: "${ex.claim}"`);
      console.log(`       orsak: ${ex.reason}`);
    }
  }
  console.log('═'.repeat(78));
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
