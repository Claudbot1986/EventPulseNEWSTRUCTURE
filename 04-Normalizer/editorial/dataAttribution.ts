/**
 * dataAttribution.ts — FAS 3.2 / pedagogisk attribution (2026-10-09).
 *
 * Vad: aggregerar attribution-strängar från Profile (performer_metadata,
 *      subject_metadata), mappar licenskoder till svenska förklarande
 *      text, returnerar strukturerad data för UI-rendering.
 *
 * Tre nivåer (enligt tidigare designrekommendation):
 *   - Tier 1: kort text (alltid synlig)
 *   - Tier 2: disclosure-kort (vid klick)
 *   - Tier 3: full förklaring (modal)
 *
 * Användning:
 *   import { buildAttribution } from './dataAttribution';
 *   const attr = buildAttribution(profile);
 *   // → { tier1, tier2Sources, tier3FullText, hasOpenData, ... }
 */
import type { EventProfile } from './types';

export type LicenseCode = 'CC0' | 'CC-BY-SA-4.0' | 'public-domain' | 'unknown' | string;

export interface AttributionEntry {
  /** Vad attributen gäller (artist/verk/org). */
  name: string;
  /** Vad attributen är (typ + licens). */
  description: string;
  /** Kort, pedagogisk licensförklaring på svenska. */
  license_label: string;
  /** URL till källan om tillgänglig. */
  url: string | null;
  /** Source-system (wikidata/musicbrainz/curated). */
  source: string;
}

export interface Attribution {
  /** Tier 1: en mening, alltid synlig. */
  tier1: string;
  /** Tier 2: lista av källor för disclosure-kort. */
  tier2Sources: AttributionEntry[];
  /** Tier 3: fullständig förklarande text. */
  tier3FullText: string;
  /** True om Profile har öppen data från CC0/CC-BY-SA. */
  hasOpenData: boolean;
  /** Lista av unika licenser i Profilen. */
  uniqueLicenses: LicenseCode[];
}

// ─── License-mappning (juridik → svenska) ────────────────────────────────────

const LICENSE_LABELS: Record<LicenseCode, string> = {
  'CC0': 'public domain — fri att använda',
  'CC-BY-SA-4.0': 'öppen — erkänn källa, dela lika',
  'public-domain': 'public domain — fri att använda',
  'unknown': 'okänd licens (vi visar inte)',
};

/** Kort etikett (tier 1). */
function licenseShort(license: LicenseCode): string {
  const map: Record<LicenseCode, string> = {
    'CC0': 'fri att använda',
    'CC-BY-SA-4.0': 'öppen',
    'public-domain': 'fri att använda',
    'unknown': 'okänd',
  };
  return map[license] ?? license;
}

const SOURCE_LABELS: Record<string, string> = {
  wikidata: 'Wikidata',
  musicbrainz: 'MusicBrainz',
  wikipedia: 'Wikipedia',
  open_library: 'Open Library',
  curated: 'curerad av oss',
};

/** Vad attributen i en mening (tier 1). */
function buildTier1Text(profile: EventProfile): string {
  const sources = new Set<string>();
  const hasUnknown = profile.performer_metadata && Object.keys(profile.performer_metadata).length > 0
    || profile.subject_metadata && Object.keys(profile.subject_metadata).length > 0
    ? false
    : true;

  // Samla unika källor
  if (profile.performer_metadata) {
    for (const meta of Object.values(profile.performer_metadata)) {
      // Vi vet inte källan för performer här — men de kommer från gazetteer
      sources.add('MusicBrainz');
    }
  }
  if (profile.subject_metadata) {
    for (const meta of Object.values(profile.subject_metadata)) {
      sources.add('Wikidata');
    }
  }

  if (sources.size === 0) {
    return 'Info om detta evenemang från våra egna datakällor.';
  }
  const sourceList = Array.from(sources).join(', ');
  return `Artistinfo, verk och scener från öppna datakällor (${sourceList}).`;
}

/** Bygg attribution-entry från performer-metadata. */
function performerToAttribution(name: string, meta: any): AttributionEntry {
  return {
    name,
    description: `Artist: ${name}`,
    license_label: licenseLabel('CC0'),
    url: `https://musicbrainz.org/artist/${meta?.mbid ?? ''}`,
    source: 'MusicBrainz',
  };
}

/** Bygg attribution-entry från subject-metadata. */
function subjectToAttribution(name: string, meta: any): AttributionEntry {
  const source = meta?.wikidata_id ? 'Wikidata' : 'curerad av oss';
  return {
    name,
    description: subjectKindLabel(meta?.kind) + ': ' + name,
    license_label: source === 'Wikidata' ? licenseLabel('CC0') : licenseLabel('CC0'),
    url: meta?.wikidata_id ? `https://www.wikidata.org/wiki/${meta.wikidata_id}` : null,
    source,
  };
}

function subjectKindLabel(kind: string | undefined): string {
  switch (kind) {
    case 'work': return 'Verk';
    case 'person': return 'Person';
    case 'organization': return 'Organisation';
    case 'venue': return 'Lokal';
    case 'topic': return 'Ämne';
    case 'event_series': return 'Serie';
    default: return 'Subjekt';
  }
}

/** Bygg tier 2 (disclosure-kort). */
function buildTier2Sources(profile: EventProfile): AttributionEntry[] {
  const seen = new Map<string, AttributionEntry>();
  // Deduplicera — samma källa (typ) visas bara en gång i disclosure
  if (profile.performer_metadata) {
    for (const [name, meta] of Object.entries(profile.performer_metadata)) {
      const key = 'performer:' + name;
      if (!seen.has(key)) {
        seen.set(key, performerToAttribution(name, meta));
      }
    }
  }
  if (profile.subject_metadata) {
    for (const [name, meta] of Object.entries(profile.subject_metadata)) {
      const key = 'subject:' + name;
      if (!seen.has(key)) {
        seen.set(key, subjectToAttribution(name, meta));
      }
    }
  }
  return Array.from(seen.values());
}

/** Bygg tier 3 (full förklarande text). */
function buildTier3Text(profile: EventProfile): string {
  const sources = new Set<string>();
  if (profile.performer_metadata) sources.add('MusicBrainz');
  if (profile.subject_metadata) sources.add('Wikidata');

  if (sources.size === 0) {
    return 'Vi har inte öppen data om detta evenemang än.';
  }

  const lines: string[] = [];
  lines.push('Varifrån kommer informationen?');
  lines.push('');

  if (sources.has('MusicBrainz')) {
    lines.push('🎵 Artistinfo från MusicBrainz');
    lines.push('   En databas över artister, album och skivbolag som drivs av en global community.');
    lines.push('   All deras data är "public domain" — det betyder att den inte har någon');
    lines.push('   upphovsrätt alls. Vem som helst får använda den hur de vill.');
    lines.push('');
  }
  if (sources.has('Wikidata')) {
    lines.push('📚 Verk och organisationer från Wikipedia & Wikidata');
    lines.push('   Världens fria uppslagsverk och dess strukturerade datakälla.');
    lines.push('   All data är public domain — vem som helst får använda den.');
    lines.push('');
  }

  lines.push('🇪🇺 Allt lagras i Stockholm');
  lines.push('   Vår egen databas ligger i EU. Vi använder bara data som är öppen för alla.');
  lines.push('');
  lines.push('Kort sagt: informationen är verifierad av tusentals människor världen över,');
  lines.push('och fri att använda. Du kan lita på att den är korrekt.');

  return lines.join('\n');
}

/** Samla unika licenser. */
function collectLicenses(profile: EventProfile): LicenseCode[] {
  const set = new Set<LicenseCode>();
  if (profile.performer_metadata) {
    for (const _ of Object.values(profile.performer_metadata)) {
      set.add('CC0');
    }
  }
  if (profile.subject_metadata) {
    for (const _ of Object.values(profile.subject_metadata)) {
      set.add('CC0');
    }
  }
  return Array.from(set);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Bygg attribution-paket från Profile. Tre nivåer enligt design.
 */
export function buildAttribution(profile: EventProfile | null | undefined): Attribution {
  if (!profile) {
    return {
      tier1: 'Ingen öppen data tillgänglig.',
      tier2Sources: [],
      tier3FullText: 'Detta evenemang har ännu inte öppen data.',
      hasOpenData: false,
      uniqueLicenses: [],
    };
  }

  const hasOpenData = Boolean(
    (profile.performer_metadata && Object.keys(profile.performer_metadata).length > 0) ||
    (profile.subject_metadata && Object.keys(profile.subject_metadata).length > 0)
  );

  return {
    tier1: buildTier1Text(profile),
    tier2Sources: hasOpenData ? buildTier2Sources(profile) : [],
    tier3FullText: buildTier3Text(profile),
    hasOpenData,
    uniqueLicenses: collectLicenses(profile),
  };
}

/**
 * Översätt en licens-kod till en kort svensk etikett.
 */
export function licenseLabel(license: LicenseCode): string {
  return LICENSE_LABELS[license] ?? license;
}

/**
 * Kort licens-etikett (tier 1-bruk).
 */
export function licenseShortLabel(license: LicenseCode): string {
  return licenseShort(license);
}

/**
 * Hämta läsbart namn på en datakälla.
 */
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}
