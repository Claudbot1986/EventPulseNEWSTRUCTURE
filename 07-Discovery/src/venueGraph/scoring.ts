import type { VenueCandidateScore, VenueCandidateScoreInput } from './types.js';

const STOCKHOLM_VARIANTS = [
  'stockholm',
  'södermalm',
  'norrmalm',
  'vasastan',
  'östermalm',
  'kungsholmen',
  'djurgården',
  'gamla stan',
  'johanneshov',
  'hammarby',
  'kista',
];

const PROMOTER_COMPANY_PATTERNS = [
  ' ab',
  ' inc',
  ' ltd',
  ' llc',
  ' live',
  'agency',
  'booking',
  'entertainment',
  'events',
  'festival',
  'group',
  'management',
  'promoter',
  'productions',
  'ticketmaster',
];

const GENERIC_VENUE_NAMES = [
  'online',
  'stockholm',
  'stockholm, sweden',
  'sweden',
  'tba',
  'tbc',
  'tbd',
  'venue',
  'virtual',
];

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isStockholm(city?: string | null): boolean {
  const normalized = (city || '').toLowerCase();
  return STOCKHOLM_VARIANTS.some((variant) => normalized.includes(variant));
}

function isPromoterLike(displayName: string): boolean {
  const normalized = ` ${displayName.toLowerCase()} `;
  return PROMOTER_COMPANY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function isGenericName(displayName: string): boolean {
  const normalized = displayName.toLowerCase().trim();
  return GENERIC_VENUE_NAMES.some((name) => normalized === name || normalized.includes(name));
}

function looksAddressOnly(displayName: string): boolean {
  return /\d+\s*$/.test(displayName.trim()) && /(gatan|vägen|torget|plan|street|road)/i.test(displayName);
}

export function scoreVenueCandidate(input: VenueCandidateScoreInput): VenueCandidateScore {
  const riskFlags: string[] = [];
  const stockholmRelevance = isStockholm(input.city) ? 25 : 0;
  const venueQuality = (input.hasAddress ? 20 : 0) + (input.hasCoordinates ? 20 : 0);
  const relationStrength = Math.min(20, input.relationStrength * 5);
  const eventFrequency = Math.min(15, input.eventFrequency * 3);
  const sourceReliability = Math.max(0, Math.min(15, (input.sourceReliability / 100) * 15));
  const historicalSuccess = Math.max(0, Math.min(5, (input.historicalSuccess / 100) * 5));

  let confidence = stockholmRelevance + venueQuality + relationStrength + eventFrequency + sourceReliability + historicalSuccess;

  if (input.observationCount <= 1) {
    riskFlags.push('weak_single_observation');
    confidence -= 8;
  }

  if (isPromoterLike(input.displayName)) {
    riskFlags.push('promoter_like_name');
    confidence -= 35;
  }

  if (isGenericName(input.displayName)) {
    riskFlags.push('generic_or_placeholder_name');
    confidence -= 45;
  }

  if (looksAddressOnly(input.displayName)) {
    riskFlags.push('address_only_name');
    confidence -= 18;
  }

  const qualityScore = clampScore(venueQuality + stockholmRelevance + relationStrength);
  const confidenceScore = clampScore(confidence);
  const priorityScore = clampScore(confidenceScore + eventFrequency + relationStrength - riskFlags.length * 6);

  const explanationParts = [
    isStockholm(input.city) ? 'Stockholm relevance' : 'no Stockholm city signal',
    input.hasAddress ? 'has address' : 'missing address',
    input.hasCoordinates ? 'has coordinates' : 'missing coordinates',
    `${input.observationCount} observation(s)`,
  ];
  if (riskFlags.includes('promoter_like_name')) {
    explanationParts.push('penalized as promoter-like');
  }
  if (riskFlags.includes('generic_or_placeholder_name')) {
    explanationParts.push('penalized as generic placeholder');
  }
  if (riskFlags.includes('address_only_name')) {
    explanationParts.push('penalized as address-only');
  }

  return {
    confidence_score: confidenceScore,
    priority_score: priorityScore,
    quality_score: qualityScore,
    risk_flags: riskFlags,
    explanation: explanationParts.join('; '),
    signals: {
      stockholmRelevance,
      venueQuality,
      relationStrength,
      eventFrequency,
      sourceReliability: Math.round(sourceReliability),
      historicalSuccess: Math.round(historicalSuccess),
    },
  };
}

export function classifyVenueName(displayName: string): 'valid' | 'placeholder' | 'promoter_like' | 'address_only' {
  if (isGenericName(displayName)) return 'placeholder';
  if (isPromoterLike(displayName)) return 'promoter_like';
  if (looksAddressOnly(displayName)) return 'address_only';
  return 'valid';
}
