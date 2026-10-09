/**
 * autoHealFailedSources.ts — Fas P (2026-10-09)
 *
 * Proaktiv heal-loop för Stockholm-källor som failat men inte nått
 * auto-quarantine-tröskeln (cf ≤ 3). Loop:
 *
 *   1. Välj cf≤3 Stockholm-källor med lastEventsFound=0
 *      — och som INTE redan är "exhausted" (se MAX_HEAL_ATTEMPTS nedan)
 *   2. Generera URL-kandidater (original, root, typiska event-suffixes)
 *   3. Testa varje URL med universal-extractor (A1+C1 m.fl.)
 *   4. Om events>0 hittas: logga som "heal candidate" + nollställ heal-räknare
 *   5. Om alla URLs ger 0 events: logga som "still dead" + öka heal-räknare
 *   6. Om heal-räknaren når MAX_HEAL_ATTEMPTS → markera "exhausted",
 *      exkluderas permanent från framtida heal-körningar
 *
 * Säkerhetsregler (hårdkodade):
 *   - Stockholm-only (befintlig isInScope-filter)
 *   - Max 10 källor per körning (förhindrar runaway)
 *   - Max 3 URL-varianter per källa (skyddar mot rate-limit)
 *   - MAX_HEAL_ATTEMPTS = 3 (källan ger upp efter 3 misslyckade heal-försök)
 *   - INGEN auto-update av source-filer — allt går via heal-log för manuell review
 *   - Varje test-URL loggas separat för spårbarhet
 *
 * Run: npx tsx 02-Ingestion/tools/autoHealFailedSources.ts
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllSources, getAllStatuses, getSource } from './sourceRegistry';
import { fetchHtml } from './fetchTools';
import { extractEvents } from '../F-eventExtraction/universal-extractor';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'runtime');
const HEAL_LOG = path.join(RUNTIME_DIR, 'heal-log.jsonl');
const HEAL_STATE_FILE = path.join(RUNTIME_DIR, 'heal-state.json');

// ─── Config ──────────────────────────────────────────────────────────────────

const MAX_SOURCES_PER_RUN = 10;
const MAX_URL_VARIANTS_PER_SOURCE = 3;
const MAX_HEAL_ATTEMPTS = 3; // källor ger upp efter 3 misslyckade heal-försök
const FETCH_TIMEOUT_MS = 20000;
const USER_AGENT = 'EventPulse-AutoHeal/1.0 (Fas P; +https://eventpulse.local/heal)';

// Typiska evenemangssidor-subpaths i Sverige, ordnade efter sannolikhet
const URL_SUFFIX_CANDIDATES = [
  '',                  // root
  '/evenemang',
  '/event',
  '/events',
  '/kalender',
  '/kalendarium',
  '/program',
  '/arrangemang',
  '/konserter',
  '/forestallningar',
  '/utstallningar',
  '/aktiviteter',
  '/agenda',
];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HealCandidateResult {
  sourceId: string;
  originalUrl: string;
  originalEvents: number;
  bestUrl: string | null;
  bestEvents: number;
  bestMethods: string[];
  variantResults: Array<{
    url: string;
    events: number;
    methods: string[];
    statusCode?: number;
    error?: string;
  }>;
  outcome: 'heal_candidate' | 'still_dead' | 'skipped' | 'exhausted';
  reason?: string;
  checkedAt: string;
  /** Räknare efter denna körning (för spårning mot MAX_HEAL_ATTEMPTS) */
  healAttempts?: number;
}

/** Persistent state: hur många heal-försök per källa + exhausted-flagga */
export interface HealState {
  /** sourceId → antal heal-försök (räknas upp vid still_dead, nollställs vid heal_candidate) */
  attempts: Record<string, number>;
  /** sourceId som markerats exhausted (maxförsök uppnådda) — exkluderas permanent */
  exhausted: Record<string, { since: string; reason: string }>;
}

export interface HealRunSummary {
  startedAt: string;
  completedAt: string;
  candidatesChecked: number;
  healCandidatesFound: number;
  stillDeadCount: number;
  results: HealCandidateResult[];
}

// ─── URL-varianter ───────────────────────────────────────────────────────────

/**
 * Genererar URL-varianter för en source: originalURL + suffix-baserade.
 * Filtrerar bort duplikat och ogiltiga URLs.
 */
export function generateUrlCandidates(sourceUrl: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  // Original-URL först
  const normalizedOriginal = sourceUrl.replace(/\/+$/, '') || sourceUrl;
  if (!seen.has(normalizedOriginal)) {
    seen.add(normalizedOriginal);
    candidates.push(sourceUrl); // behåll original-formen för audit
  }

  // Försök härleda root-URL om path innehåller typiska segment
  let baseUrl = sourceUrl;
  try {
    const u = new URL(sourceUrl);
    const pathParts = u.pathname.split('/').filter(Boolean);
    // Om path har 2+ segment som INTE ser ut som en asset, använd root
    if (pathParts.length >= 2 && !pathParts.some(p => /\.(html|json|xml|pdf)$/i.test(p))) {
      baseUrl = `${u.protocol}//${u.host}`;
    }
  } catch {
    return candidates;
  }

  // Lägg till suffix-kandidater baserat på base
  for (const suffix of URL_SUFFIX_CANDIDATES) {
    if (candidates.length >= MAX_URL_VARIANTS_PER_SOURCE) break;
    const candidate = `${baseUrl}${suffix}`;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      candidates.push(candidate);
    }
  }

  return candidates.slice(0, MAX_URL_VARIANTS_PER_SOURCE);
}

// ─── Heal-state (persistent attempts + exhausted-markering) ─────────────────

function readHealState(): HealState {
  if (!existsSync(HEAL_STATE_FILE)) {
    return { attempts: {}, exhausted: {} };
  }
  try {
    const content = readFileSync(HEAL_STATE_FILE, 'utf8').trim();
    if (!content) return { attempts: {}, exhausted: {} };
    return JSON.parse(content) as HealState;
  } catch {
    // Korrupt state → starta om (säkrare än att krascha)
    return { attempts: {}, exhausted: {} };
  }
}

function writeHealState(state: HealState): void {
  // Atomic write via tmp+rename
  const tmp = `${HEAL_STATE_FILE}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
    // Rename — använder fs.renameSync från node, men för enkelhet: writeFileSync direkt
    writeFileSync(HEAL_STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.error('[heal] Failed to write heal-state:', err);
  }
}

// ─── Source-urval ────────────────────────────────────────────────────────────

/**
 * Plockar ut cf≤3 Stockholm-källor som misslyckats med 0 events.
 * Exkluderar auto-quarantined (cf≥5) och permanenta success.
 */
export function selectHealCandidates(
  sources = getAllSources({ scope: 'stockholm' }),
  statuses = getAllStatuses(),
  healState = readHealState(),
): Array<{ id: string; url: string; consecutiveFailures: number; lastError?: string }> {
  const statusById = new Map(statuses.map(s => [s.sourceId, s]));
  const candidates: Array<{ id: string; url: string; consecutiveFailures: number; lastError?: string }> = [];

  for (const src of sources) {
    // Respekt: redan exhausted → skippa permanent
    if (healState.exhausted[src.id]) continue;

    const status = statusById.get(src.id);
    if (!status) continue;

    // Bara fail/partial/routing_required med 0 events
    if (status.lastEventsFound > 0) continue;
    if (status.status === 'success') continue;
    if (status.status === 'never_run') continue;
    if (status.consecutiveFailures < 1) continue;
    if (status.consecutiveFailures > 3) continue; // cf 4-5 är nära auto-quarantine

    // Filtrera bort uppenbart permanenta reasons
    const lastError = (status.lastError ?? '').toLowerCase();
    const isPermanent = lastError.includes('redirect_loop') || lastError.includes('ssl') || lastError.includes('tls');
    if (isPermanent) continue;

    candidates.push({
      id: src.id,
      url: src.url,
      consecutiveFailures: status.consecutiveFailures,
      lastError: status.lastError,
    });

    if (candidates.length >= MAX_SOURCES_PER_RUN) break;
  }

  // Prioritera lägst cf (mer återaktiverings-hop)
  candidates.sort((a, b) => a.consecutiveFailures - b.consecutiveFailures);
  return candidates.slice(0, MAX_SOURCES_PER_RUN);
}

// ─── Test en URL ─────────────────────────────────────────────────────────────

export async function testUrl(url: string): Promise<{
  url: string;
  events: number;
  methods: string[];
  statusCode?: number;
  error?: string;
}> {
  try {
    const fetchResult = await fetchHtml(url, {
      timeout: FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!fetchResult.success || !fetchResult.html) {
      return {
        url,
        events: 0,
        methods: [],
        statusCode: fetchResult.statusCode,
        error: fetchResult.error ?? 'unknown fetch error',
      };
    }

    const extracted = extractEvents(fetchResult.html, 'auto-heal-probe', url);
    return {
      url,
      events: extracted.events.length,
      methods: extracted.methodsUsed ?? [],
      statusCode: 200,
    };
  } catch (err: unknown) {
    return {
      url,
      events: 0,
      methods: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Heal-körning ────────────────────────────────────────────────────────────

export async function runHeal(options: {
  maxSources?: number;
  sourceIds?: string[]; // om angiven: bara dessa källor (för test)
  verbose?: boolean;
  /** Injicera heal-state (för test/CLI); default läser från fil */
  healStateOverride?: HealState;
} = {}): Promise<HealRunSummary> {
  const startedAt = new Date().toISOString();
  const maxSources = options.maxSources ?? MAX_SOURCES_PER_RUN;

  // Seeda runtime dir om saknas
  if (!existsSync(RUNTIME_DIR)) {
    mkdirSync(RUNTIME_DIR, { recursive: true });
  }

  // Läs persistent state (attempts + exhausted); eller använd override
  const healState: HealState = options.healStateOverride ?? readHealState();

  // Välj kandidater
  let candidates: Array<{ id: string; url: string; consecutiveFailures: number; lastError?: string }>;

  if (options.sourceIds && options.sourceIds.length > 0) {
    // Targeted-läge (för test/cron med specifika källor)
    candidates = options.sourceIds
      .map(id => {
        const src = getSource(id);
        const status = getAllStatuses().find(s => s.sourceId === id);
        if (!src || !status) return null;
        // Respektera exhausted även i targeted-läge
        if (healState.exhausted[id]) return null;
        return {
          id: src.id,
          url: src.url,
          consecutiveFailures: status.consecutiveFailures,
          lastError: status.lastError,
        };
      })
      .filter((c): c is { id: string; url: string; consecutiveFailures: number; lastError?: string } => c !== null);
  } else {
    candidates = selectHealCandidates(undefined, undefined, healState).slice(0, maxSources);
  }

  const results: HealCandidateResult[] = [];
  let stateDirty = false;

  for (const candidate of candidates) {
    if (options.verbose) console.log(`\n[heal] ${candidate.id} (cf=${candidate.consecutiveFailures}, prior attempts=${healState.attempts[candidate.id] ?? 0})`);

    const urls = generateUrlCandidates(candidate.url);
    const variantResults: HealCandidateResult['variantResults'] = [];
    let originalEvents = 0;
    let bestUrl: string | null = null;
    let bestEvents = 0;
    let bestMethods: string[] = [];

    for (const url of urls) {
      const testResult = await testUrl(url);

      if (url === candidate.url) {
        originalEvents = testResult.events;
      }

      variantResults.push({
        url: testResult.url,
        events: testResult.events,
        methods: testResult.methods,
        statusCode: testResult.statusCode,
        error: testResult.error,
      });

      if (testResult.events > bestEvents) {
        bestEvents = testResult.events;
        bestUrl = url;
        bestMethods = testResult.methods;
      }

      if (options.verbose) {
        console.log(`  ${testResult.events} events | ${testResult.methods.join(',').slice(0, 60) || '<no-methods>'} | ${testResult.statusCode ?? testResult.error?.slice(0, 40) ?? '?'}`);
      }

      // Undvik rate-limit: kort paus mellan URLs
      await new Promise(r => setTimeout(r, 200));
    }

    // Outcome-logik
    let outcome: HealCandidateResult['outcome'];
    let reason: string | undefined;

    if (bestUrl && bestUrl !== candidate.url && bestEvents > 0) {
      outcome = 'heal_candidate';
      reason = `URL ${bestUrl} ger ${bestEvents} events; original gav ${originalEvents}`;
    } else if (bestEvents > 0 && originalEvents > 0) {
      outcome = 'still_dead';
      reason = `Original URL fungerar redan (${originalEvents} events); cf-räkning kan vara stale`;
    } else {
      outcome = 'still_dead';
      reason = `Alla ${variantResults.length} URL-varianter gav 0 events`;
    }

    // Uppdatera heal-state baserat på outcome
    const priorAttempts = healState.attempts[candidate.id] ?? 0;
    let nextAttempts = priorAttempts;

    if (outcome === 'heal_candidate') {
      // Lyckad heal → nollställ räknare (källan är aktivigen)
      healState.attempts[candidate.id] = 0;
      nextAttempts = 0;
    } else {
      // still_dead → öka räknare
      nextAttempts = priorAttempts + 1;
      healState.attempts[candidate.id] = nextAttempts;

      // Om max uppnått → mark exhausted
      if (nextAttempts >= MAX_HEAL_ATTEMPTS) {
        outcome = 'exhausted';
        reason = `${MAX_HEAL_ATTEMPTS} heal-försök utan framgång — exkluderas permanent från heal-loopen. ${reason ?? ''}`;
        healState.exhausted[candidate.id] = {
          since: new Date().toISOString(),
          reason: `Still dead efter ${MAX_HEAL_ATTEMPTS} försök`,
        };
      }
    }
    stateDirty = true;

    const result: HealCandidateResult = {
      sourceId: candidate.id,
      originalUrl: candidate.url,
      originalEvents,
      bestUrl,
      bestEvents,
      bestMethods,
      variantResults,
      outcome,
      reason,
      checkedAt: new Date().toISOString(),
      healAttempts: nextAttempts,
    };

    results.push(result);

    // Append till heal-log (atomic write)
    try {
      appendFileSync(HEAL_LOG, JSON.stringify(result) + '\n', 'utf8');
    } catch (err) {
      console.error(`[heal] Failed to write log for ${candidate.id}:`, err);
    }
  }

  // Spara state om ändrad
  if (stateDirty) {
    writeHealState(healState);
  }

  const completedAt = new Date().toISOString();
  const summary: HealRunSummary = {
    startedAt,
    completedAt,
    candidatesChecked: results.length,
    healCandidatesFound: results.filter(r => r.outcome === 'heal_candidate').length,
    stillDeadCount: results.filter(r => r.outcome === 'still_dead').length,
    results,
  };

  if (options.verbose) {
    console.log(`\n[heal] Summary: ${summary.candidatesChecked} checked, ${summary.healCandidatesFound} heal-candidates, ${summary.stillDeadCount} still-dead`);
    const exhaustedCount = results.filter(r => r.outcome === 'exhausted').length;
    if (exhaustedCount > 0) console.log(`[heal] ${exhaustedCount} källor markerades exhausted (kommer inte köras igen)`);
  }

  return summary;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

// Allow `npx tsx autoHealFailedSources.ts --source <id> [--verbose]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const sourceIdx = args.indexOf('--source');
  const verbose = args.includes('--verbose');
  const sourceIds = sourceIdx >= 0 && args[sourceIdx + 1]
    ? args[sourceIdx + 1].split(',').map(s => s.trim())
    : undefined;

  runHeal({ sourceIds, verbose })
    .then(summary => {
      console.log(JSON.stringify({
        checked: summary.candidatesChecked,
        healCandidates: summary.healCandidatesFound,
        stillDead: summary.stillDeadCount,
        durationMs: new Date(summary.completedAt).getTime() - new Date(summary.startedAt).getTime(),
      }, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal:', err);
      process.exit(1);
    });
}