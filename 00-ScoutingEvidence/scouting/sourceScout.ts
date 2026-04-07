/**
 * SourceScout — First assessment tool for candidate URLs
 *
 * Entrypoint: gives a single unified verdict on whether a URL
 * looks like a promising event source.
 *
 * Flow:
 *   URL Sanity → JSON-LD → Network → HTML → Final Verdict
 *
 * This is NOT:
 *   - Full ingestion pipeline
 *   - Queue/batch processor
 *   - Normalizer integration
 *   - Supabase writer
 *
 * This IS:
 *   - First-pass assessment
 *   - Evidence gathering
 *   - Single unified ScoutResult
 *   - Routing suggestion for next step
 *
 * Usage:
 *   npx tsx 00-ScoutingEvidence/scouting/sourceScout.ts <url>
 *   npx tsx 00-ScoutingEvidence/scouting/sourceScout.ts --batch <urls.txt>
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { checkUrlSanity, extractSourceName } from './urlSanity.js';
import type { ScoutResult, RecommendedPath, ScoutStatus } from './scoutResult.js';
import { scoutTimestamp, slugify } from './scoutResult.js';

// ─── Import existing tools (adapted paths for NEWSTRUCTURE) ──────────────────

// jsonLdDiagnostic — JSON-LD first pass
import { diagnoseUrl } from '../../01-Sources/diagnostics/jsonLdDiagnostic.js';

// networkInspector — Network/API second pass
import { inspectUrl } from '../../02-Ingestion/B-JSON-feedGate/networkInspector.js';

// networkGate — GotEvent model routing
import { evaluateNetworkGate } from '../../02-Ingestion/B-JSON-feedGate/A-networkGate.js';

// C1-preHtmlGate — HTML third pass
import { screenUrl } from '../../02-Ingestion/C-htmlGate/C1-preHtmlGate/C1-preHtmlGate.js';

// ─── Path resolution (robust, not cwd-dependent) ─────────────────────────

function getScoutingRoot(): string {
  // Derive the NEWSTRUCTURE root from this file's location
  // scouting/sourceScout.ts → 00-ScoutingEvidence/ → NEWSTRUCTURE/
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // 00-ScoutingEvidence/scouting → 00-ScoutingEvidence → NEWSTRUCTURE
  return join(__dirname, '..', '..');
}

function getCandidatesDir(): string {
  const base = join(getScoutingRoot(), '01-Sources', 'candidates');
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true });
  }
  return base;
}

function getNotSuitableDir(): string {
  const base = join(getScoutingRoot(), '01-Sources', 'scouted-not-suitable');
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true });
  }
  return base;
}

function getManualReviewDir(): string {
  const base = join(getScoutingRoot(), '01-Sources', 'manual-review');
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true });
  }
  return base;
}

/**
 * Determine which directory to save a scout result in.
 * Routing is based on status, not recommendedPath.
 *
 * - promising / maybe         → 01-Sources/candidates/
 * - not_suitable / blocked / bad_url → 01-Sources/scouted-not-suitable/
 * - manual_review             → 01-Sources/manual-review/
 */
function getResultDirectory(r: ScoutResult): string {
  if (r.status === 'promising' || r.status === 'maybe') {
    return getCandidatesDir();
  }
  if (r.status === 'manual_review') {
    return getManualReviewDir();
  }
  // not_suitable, blocked, bad_url
  return getNotSuitableDir();
}

// ─── Confidence helper ───────────────────────────────────────────────────

export type MaybeType =
  | 'jsonld-success'     // rare — JSON-LD succeeded but not enough to be promising
  | 'network-viable'     // no-jsonld/wrong-type but network path is open
  | 'html-strong'        // no-jsonld, HTML categorization is strong
  | 'html-medium'        // no-jsonld, HTML has medium structure or medium signals
  | 'html-weak-signals' // no-jsonld, HTML is weak but date/venue signals present
  | 'wrong-type-html'    // JSON-LD wrong-type, HTML has event potential
  | 'manual-review';     // could not complete full pass

export interface ConfidenceResult {
  confidence: number;
  /** Short label for why maybe — undefined for clear-cut statuses */
  maybeType?: MaybeType;
  /** Human-readable phrase describing why this confidence */
  confidenceLabel: string;
}

/**
 * Compute confidence based on scout status and evidence.
 * Centralized so it's easier to calibrate and understand.
 *
 * Returns both the numeric confidence and a maybe-type label when status is 'maybe'.
 * Callers use confidenceResult.confidence and may push confidenceResult.maybeType
 * to reasons[] to make the maybe-type explicit in output.
 */
function computeConfidenceResult(
  status: ScoutStatus,
  maybeType?: MaybeType
): ConfidenceResult {
  // Clear-cut statuses — return immediately, no need for evidence flags
  if (status === 'promising') {
    return { confidence: 0.9, confidenceLabel: 'Clear event source signal' };
  }
  if (status === 'blocked') {
    return { confidence: 0.95, confidenceLabel: 'URL unreachable or blocked' };
  }
  if (status === 'bad_url') {
    return { confidence: 0.95, confidenceLabel: 'Malformed or unreachable URL' };
  }
  if (status === 'not_suitable') {
    return { confidence: 0.75, confidenceLabel: 'No event signal detected' };
  }
  if (status === 'manual_review') {
    return { confidence: 0.3, maybeType: 'manual-review', confidenceLabel: 'Could not complete assessment' };
  }

  // status === 'maybe'
  // Use maybeType to determine exact confidence and label
  const labels: Record<MaybeType, { confidence: number; label: string }> = {
    'jsonld-success':    { confidence: 0.85, label: 'JSON-LD partial success' },
    'network-viable':    { confidence: 0.65, label: 'Network path open and viable' },
    'html-strong':       { confidence: 0.7,  label: 'HTML shows strong event structure' },
    'html-medium':       { confidence: 0.45, label: 'HTML has medium event potential' },
    'html-weak-signals': { confidence: 0.5,  label: 'HTML weak but date/venue signals present' },
    'wrong-type-html':   { confidence: 0.5,  label: 'Wrong JSON-LD type but HTML shows event potential' },
    'manual-review':    { confidence: 0.3,  label: 'Insufficient signal for auto-determination' },
  };

  const entry = labels[maybeType ?? 'manual-review'];
  return {
    confidence: entry.confidence,
    maybeType,
    confidenceLabel: entry.label,
  };
}

// ─── Verdict computation ────────────────────────────────────────────────────

function computeVerdict(
  url: string,
  sanity: Awaited<ReturnType<typeof checkUrlSanity>>,
  jsonLd: Awaited<ReturnType<typeof diagnoseUrl>>,
  network?: Awaited<ReturnType<typeof inspectUrl>>,
  networkGate?: Awaited<ReturnType<typeof evaluateNetworkGate>>,
  html?: Awaited<ReturnType<typeof screenUrl>>
): ScoutResult {
  const sourceName = extractSourceName(url);
  const reasons: string[] = [];
  let status: ScoutStatus = 'manual_review';
  let recommendedPath: RecommendedPath = 'manual';
  let confidence = 0.5;
  const evidence: ScoutResult['evidence'] = {};

  // ── URL Sanity gate ──────────────────────────────────────────────────────
  if (!sanity.reachable) {
    // Build redirect info string if we have a chain
    const redirectInfo = sanity.redirectChain && sanity.redirectChain.length > 1
      ? ` (redirect chain: ${sanity.redirectChain.join(' → ')})`
      : '';

    if (sanity.error?.toLowerCase().includes('timeout')) {
      const conf = computeConfidenceResult('blocked');
      status = 'blocked';
      reasons.push(`Timeout when reaching URL${redirectInfo}: ${sanity.error}`);
      recommendedPath = 'reject';
      confidence = conf.confidence;
    } else if (sanity.error?.toLowerCase().includes('dns') || sanity.error?.toLowerCase().includes('getaddrinfo')) {
      const conf = computeConfidenceResult('bad_url');
      status = 'bad_url';
      reasons.push(`DNS error${redirectInfo}: ${sanity.error}`);
      recommendedPath = 'reject';
      confidence = conf.confidence;
    } else {
      const conf = computeConfidenceResult('blocked');
      status = 'blocked';
      reasons.push(`Cannot reach URL${redirectInfo}: ${sanity.error}`);
      recommendedPath = 'reject';
      confidence = conf.confidence;
    }
    return makeResult(url, sourceName, status, recommendedPath, confidence, reasons, evidence);
  }

  // Build redirect notice if there were redirects
  const redirectNotice = sanity.redirectCount && sanity.redirectCount > 0
    ? ` [${sanity.redirectCount} redirect(s)]`
    : '';

  evidence.urlSanity = {
    reachable: true,
    normalizedUrl: sanity.normalizedUrl,
    redirectCount: sanity.redirectCount,
    finalUrl: sanity.finalUrl,
    statusCode: sanity.statusCode,
  };

  // ── JSON-LD gate ─────────────────────────────────────────────────────────
  if (jsonLd.diagnosis === 'success') {
    const conf = computeConfidenceResult('promising');
    status = 'promising';
    recommendedPath = 'jsonld';
    confidence = conf.confidence;
    reasons.push(
      `JSON-LD success (${conf.confidenceLabel}): ${jsonLd.extractorResult.eventsExtracted} event(s) via ${jsonLd.foundTypes.join(', ')}`
    );
    evidence.jsonLd = {
      found: true,
      diagnosis: jsonLd.diagnosis,
      eventBlocks: jsonLd.jsonLdBlocks.filter(b => {
        const types = Array.isArray(b['@type']) ? b['@type'] : b['@type'] ? [b['@type']] : [];
        return types.some((t: string) => t?.includes('Event'));
      }).length,
      foundTypes: jsonLd.foundTypes,
      eventsExtracted: jsonLd.extractorResult.eventsExtracted,
      reason: jsonLd.reason,
    };
    return makeResult(url, sourceName, status, recommendedPath, confidence, reasons, evidence);
  }

  if (jsonLd.diagnosis === 'no-jsonld') {
    reasons.push('No JSON-LD found on this page');
    evidence.jsonLd = {
      found: false,
      diagnosis: jsonLd.diagnosis,
      eventBlocks: 0,
      foundTypes: [],
      eventsExtracted: 0,
      reason: jsonLd.reason,
    };
  } else if (jsonLd.diagnosis === 'wrong-type') {
    reasons.push(`JSON-LD present but wrong type: ${jsonLd.foundTypes.join(', ')}`);
    evidence.jsonLd = {
      found: true,
      diagnosis: jsonLd.diagnosis,
      eventBlocks: jsonLd.jsonLdBlocks.length,
      foundTypes: jsonLd.foundTypes,
      eventsExtracted: 0,
      reason: jsonLd.reason,
    };
  }

  // ── Network gate ─────────────────────────────────────────────────────────
  if (network && networkGate) {
    evidence.network = {
      verdict: network.verdict,
      signalsFound: networkGate.networkSignalsFound,
      openAccessible: networkGate.openEventDataAccessible,
      likelyApis: network.summary.likely,
      possibleApis: network.summary.possible,
      reason: networkGate.reason,
    };

    if (networkGate.nextPath === 'network' && networkGate.openEventDataAccessible) {
      const maybeType = networkGate.phaseMode === 1 ? undefined : 'network-viable' as MaybeType;
      const conf = computeConfidenceResult(maybeType ? 'maybe' : 'promising', maybeType);
      status = conf.confidence === 0.9 ? 'promising' : 'maybe';
      recommendedPath = 'network';
      confidence = conf.confidence;
      reasons.push(`Network Path (${conf.confidenceLabel}): ${networkGate.reason}`);
      return makeResult(url, sourceName, status, recommendedPath, confidence, reasons, evidence);
    } else if (networkGate.networkSignalsFound) {
      reasons.push(`Network fallback to HTML: ${networkGate.reason}`);
    } else {
      reasons.push(`No network signals: ${networkGate.reason}`);
    }
  }

  // ── HTML gate ────────────────────────────────────────────────────────────
  // IMPROVED: no-jsonld + weak HTML should NOT be rejected if page has dates/venues
  // This is a key insight from comparing with 100candidateTester.ts approach
  if (html) {
    evidence.html = {
      fetchable: html.fetchable,
      categorization: html.categorization,
      timeTags: html.timeTagCount,
      datesFound: html.dateCount,
      headings: html.headingCount,
      venueMarkers: html.venueMarkerCount,
      priceMarkers: html.priceMarkerCount,
      listItemCount: html.listItemCount,
      reason: html.reason,
    };

    // Rule: dates/venues suggest this IS an event page even without JSON-LD
    const hasEventSignals = html.dateCount >= 3 || html.venueMarkerCount >= 1 || html.timeTagCount >= 2;
    const hasMediumStructure = html.categorization === 'medium' || html.headingCount >= 3 || html.listItemCount >= 5;

    if (html.categorization === 'strong') {
      const conf = computeConfidenceResult('maybe', 'html-strong');
      status = 'maybe';
      recommendedPath = 'html';
      confidence = conf.confidence;
      reasons.push(`HTML (${conf.confidenceLabel}): ${html.reason}`);
    } else if (hasEventSignals && html.categorization === 'weak') {
      // Weak HTML but has date/venue signals → NOT rejected, route to html path
      const conf = computeConfidenceResult('maybe', 'html-weak-signals');
      status = 'maybe';
      recommendedPath = 'html';
      confidence = conf.confidence;
      reasons.push(`HTML (${conf.confidenceLabel}): d=${html.dateCount}, v=${html.venueMarkerCount}, t=${html.timeTagCount}. ${html.reason}`);
    } else if (hasEventSignals || hasMediumStructure) {
      const conf = computeConfidenceResult('maybe', 'html-medium');
      status = 'maybe';
      recommendedPath = 'html';
      confidence = conf.confidence;
      reasons.push(`HTML (${conf.confidenceLabel}): ${html.reason}`);
    } else if (html.categorization === 'no-main' || html.categorization === 'unfetchable') {
      // Only reject when page truly has no event structure
      const conf = computeConfidenceResult('not_suitable');
      status = 'not_suitable';
      recommendedPath = 'reject';
      confidence = conf.confidence;
      reasons.push(`No event structure: ${html.reason}`);
    } else {
      // noise or weak without signals → not suitable
      const conf = computeConfidenceResult('not_suitable');
      status = 'not_suitable';
      recommendedPath = 'reject';
      confidence = conf.confidence;
      reasons.push(`HTML low-signal: ${html.reason}`);
    }
  } else if (status === 'manual_review') {
    reasons.push('Could not complete full pass — manual review recommended');
  }

  return makeResult(url, sourceName, status, recommendedPath, confidence, reasons, evidence);
}

function makeResult(
  url: string,
  sourceName: string,
  status: ScoutStatus,
  recommendedPath: RecommendedPath,
  confidence: number,
  reasons: string[],
  evidence: ScoutResult['evidence']
): ScoutResult {
  const nextStepMap: Record<RecommendedPath, string> = {
    jsonld: '→ Pass directly to 02-Ingestion JSON-LD fast path',
    network: '→ Pass to 02-Ingestion Network Path for API extraction',
    html: '→ Pass to 02-Ingestion HTML Path for DOM heuristics',
    render: '→ Pass to 02-Ingestion Render Path (headless browser)',
    manual: '→ Route to manual review queue',
    reject: '→ Do not add to sources; move to 01-Sources/scouted-not-suitable/',
  };

  return {
    url,
    sourceName,
    status,
    recommendedPath,
    confidence,
    reasons,
    evidence,
    nextStep: nextStepMap[recommendedPath] ?? '→ Manual review required',
    timestamp: new Date().toISOString(),
  };
}

// ─── Candidate file writer ───────────────────────────────────────────────────

function formatMarkdown(r: ScoutResult): string {
  const statusIcon: Record<ScoutStatus, string> = {
    promising: '✅',
    maybe: '⚠️',
    not_suitable: '❌',
    blocked: '🚫',
    bad_url: '💥',
    manual_review: '🔍',
  };

  const pathIcon: Record<RecommendedPath, string> = {
    jsonld: '📋',
    network: '🌐',
    html: '🏠',
    render: '🎨',
    manual: '👤',
    reject: '🗑️',
  };

  let md = `# Scout Result: ${r.sourceName ?? r.url}\n\n`;
  md += `**URL:** ${r.url}\n`;
  md += `**Status:** ${statusIcon[r.status]} ${r.status}\n`;
  md += `**Recommended Path:** ${pathIcon[r.recommendedPath]} ${r.recommendedPath}\n`;
  md += `**Confidence:** ${(r.confidence * 100).toFixed(0)}%\n`;
  md += `**Scouted:** ${r.timestamp}\n\n`;

  md += `## Verdict\n\n`;
  for (const reason of r.reasons) {
    md += `- ${reason}\n`;
  }
  md += `\n**Next step:** ${r.nextStep}\n\n`;

  md += `## Evidence\n\n`;
  if (r.evidence.urlSanity) {
    md += `### URL Sanity\n`;
    md += `- Reachable: ${r.evidence.urlSanity.reachable}\n`;
    if (r.evidence.urlSanity.normalizedUrl) {
      md += `- Normalized URL: ${r.evidence.urlSanity.normalizedUrl}\n`;
    }
    if (r.evidence.urlSanity.statusCode) {
      md += `- Status: ${r.evidence.urlSanity.statusCode}\n`;
    }
    if (r.evidence.urlSanity.error) {
      md += `- Error: ${r.evidence.urlSanity.error}\n`;
    }
    md += `\n`;
  }
  if (r.evidence.jsonLd) {
    md += `### JSON-LD\n`;
    md += `- Found: ${r.evidence.jsonLd.found}\n`;
    md += `- Diagnosis: ${r.evidence.jsonLd.diagnosis}\n`;
    md += `- Event blocks: ${r.evidence.jsonLd.eventBlocks}\n`;
    md += `- Types found: [${r.evidence.jsonLd.foundTypes.join(', ')}]\n`;
    md += `- Events extracted: ${r.evidence.jsonLd.eventsExtracted}\n`;
    md += `- Reason: ${r.evidence.jsonLd.reason}\n\n`;
  }
  if (r.evidence.network) {
    md += `### Network\n`;
    md += `- Verdict: ${r.evidence.network.verdict}\n`;
    md += `- Signals found: ${r.evidence.network.signalsFound}\n`;
    md += `- Open/accessible: ${r.evidence.network.openAccessible}\n`;
    md += `- Likely APIs: ${r.evidence.network.likelyApis}\n`;
    md += `- Possible APIs: ${r.evidence.network.possibleApis}\n`;
    md += `- Reason: ${r.evidence.network.reason}\n\n`;
  }
  if (r.evidence.html) {
    md += `### HTML\n`;
    md += `- Fetchable: ${r.evidence.html.fetchable}\n`;
    md += `- Categorization: ${r.evidence.html.categorization}\n`;
    md += `- Time tags: ${r.evidence.html.timeTags}\n`;
    md += `- Dates found: ${r.evidence.html.datesFound}\n`;
    md += `- Headings: ${r.evidence.html.headings}\n`;
    md += `- Venue markers: ${r.evidence.html.venueMarkers}\n`;
    md += `- Price markers: ${r.evidence.html.priceMarkers}\n`;
    md += `- List items: ${r.evidence.html.listItemCount ?? 0}\n`;
    md += `- Reason: ${r.evidence.html.reason}\n\n`;
  }

  md += `---\n*Generated by sourceScout*\n`;
  return md;
}

export async function saveCandidateResult(r: ScoutResult): Promise<string> {
  const ts = scoutTimestamp();
  const slug = slugify(r.sourceName ?? r.url);
  const filename = `${ts}-${slug}.md`;

  const dir = getResultDirectory(r);
  const filepath = join(dir, filename);

  const md = formatMarkdown(r);
  writeFileSync(filepath, md, 'utf-8');

  return filepath;
}

// ─── Main scout function ─────────────────────────────────────────────────────

export async function scoutUrl(url: string, phaseMode: 1 | 2 | 3 = 2): Promise<ScoutResult> {
  // Step 1: URL Sanity — if unreachable, verdict directly without fake JSON-LD
  const sanity = await checkUrlSanity(url);
  if (!sanity.reachable) {
    // Determine status from error type
    const errorLower = (sanity.error ?? '').toLowerCase();
    let status: ScoutStatus;
    if (errorLower.includes('timeout')) {
      status = 'blocked';
    } else if (errorLower.includes('dns') || errorLower.includes('getaddrinfo')) {
      status = 'bad_url';
    } else {
      status = 'blocked';
    }
    const conf = computeConfidenceResult(status);
    return makeResult(
      url,
      extractSourceName(url),
      status,
      'reject',
      conf.confidence,
      [`Cannot reach URL: ${sanity.error ?? 'unknown'}`],
      {
        urlSanity: {
          reachable: false,
          redirectCount: 0,
          error: sanity.error,
          statusCode: sanity.statusCode,
        },
      }
    );
  }

  // Step 2: JSON-LD (use finalUrl after any redirects)
  const jsonLd = await diagnoseUrl(sanity.finalUrl ?? sanity.normalizedUrl ?? url);

  // If JSON-LD succeeded, verdict now
  if (jsonLd.diagnosis === 'success') {
    return computeVerdict(url, sanity, jsonLd);
  }

  // Step 3: Network (only if JSON-LD didn't fully succeed)
  let network;
  let networkGate;
  if (jsonLd.diagnosis === 'no-jsonld' || jsonLd.diagnosis === 'wrong-type') {
    try {
      network = await inspectUrl(sanity.finalUrl ?? sanity.normalizedUrl ?? url);
      networkGate = await evaluateNetworkGate(url, jsonLd.diagnosis, phaseMode, network);
    } catch {
      // network inspection failed — continue to HTML
    }
  }

  // Step 4: HTML (only if network didn't route elsewhere)
  let html;
  if (networkGate?.nextPath !== 'network') {
    try {
      html = await screenUrl(sanity.normalizedUrl ?? url);
    } catch {
      // HTML screening failed — verdict based on what we have
    }
  }

  return computeVerdict(url, sanity, jsonLd, network, networkGate, html);
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage:');
    console.error('  npx tsx 00-ScoutingEvidence/scouting/sourceScout.ts <url>');
    console.error('  npx tsx 00-ScoutingEvidence/scouting/sourceScout.ts --batch <urls.txt>');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx 00-ScoutingEvidence/scouting/sourceScout.ts https://www.konserthuset.se');
    console.error('  npx tsx 00-ScoutingEvidence/scouting/sourceScout.ts --batch my-candidates.txt');
    process.exit(1);
  }

  if (args[0] === '--batch') {
    const fs = await import('fs');
    const urls = fs.readFileSync(args[1], 'utf-8')
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l && !l.startsWith('#'));

    console.log(`═══ SOURCE SCOUT — BATCH (${urls.length} URLs) ═══\n`);
    const results: ScoutResult[] = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      process.stdout.write(`[${i + 1}/${urls.length}] ${url} ... `);
      try {
        const r = await scoutUrl(url);
        results.push(r);
        const icon = r.status === 'promising' ? '✅' : r.status === 'maybe' ? '⚠️' : r.status === 'not_suitable' ? '❌' : r.status === 'blocked' ? '🚫' : r.status === 'bad_url' ? '💥' : '🔍';
        console.log(`${icon} ${r.status} (${(r.confidence * 100).toFixed(0)}%) → ${r.recommendedPath}`);
        console.log(`         ↳ ${r.reasons[0] ?? 'no reason'}`);

        // Save candidate file
        const savedPath = await saveCandidateResult(r);
        console.log(`         💾 ${savedPath}`);
      } catch (err) {
        console.log(`💥 error: ${err}`);
      }
    }

    // Summary
    console.log('\n═══ BATCH SUMMARY ═══');
    const byStatus = new Map<ScoutStatus, number>();
    for (const r of results) {
      byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    }
    for (const [s, n] of byStatus) {
      console.log(`  ${s}: ${n}`);
    }
    return;
  }

  // Single URL
  const url = args[0];
  console.log(`═══ SOURCE SCOUT ═══`);
  console.log(`URL: ${url}\n`);

  const r = await scoutUrl(url);

  const icon = r.status === 'promising' ? '✅' : r.status === 'maybe' ? '⚠️' : r.status === 'not_suitable' ? '❌' : r.status === 'blocked' ? '🚫' : r.status === 'bad_url' ? '💥' : '🔍';
  console.log(`Status:    ${icon} ${r.status}`);
  console.log(`Path:      ${r.recommendedPath}`);
  console.log(`Confidence: ${(r.confidence * 100).toFixed(0)}%`);
  console.log();
  console.log('Reasons:');
  for (const reason of r.reasons) {
    console.log(`  - ${reason}`);
  }
  console.log();
  console.log(`Next step: ${r.nextStep}`);
  console.log();

  // Save candidate file
  const savedPath = await saveCandidateResult(r);
  console.log(`💾 Saved: ${savedPath}`);
}

main().catch(console.error);
