/**
 * quarantine_trigger.ts — link-health Hybrid B reparationsprogram-trigger.
 *
 * Körs efter check_link_health (se cron/runDaily.sh steg 3.5). Hittar
 * events vars cf KORSADE tröskeln idag (cf>=2 OCH first_broken_at::date
 * är idag = första gången källan går i karantän, INTE varje dag-broken).
 * För varje sådan källa:
 *
 *   1. Idempotency-check: source-changes.jsonl för action='mark-review-needed'
 *      idag. Finns → skippa (vi skickar inte dubblett-pending-entries).
 *   2. Hämta cap:10 events från källan (för note + payload).
 *   3. submitForReview(source, 'link_health_quarantined', note, 'link-health-trigger',
 *      projectRoot, { events: [...], cf: 2 }).
 *   4. appendChange(source-quarantined, confidence='high', appliedBy='auto-rule').
 *
 * Errors-as-data: vi returnerar ALLA errors i QuarantineResult.errors; vi
 * kastar aldrig. Cron-scriptet avgör om det ska fortsätta eller ej.
 *
 * NOT in scope:
 *   - Auto-archive cf>=7 (utökat trappsteg; vänta in data).
 *   - Soft-quarantine (användaren valde bort).
 *   - Per-event pending entries (cross-domain API-ändring; större scope).
 */

import { db as defaultDb, type SupabaseClient } from '../dashboard/db';
import {
  appendChange,
  makeChange,
  readChanges,
} from './source_changes';
import {
  submitForReview,
} from '../../02-Ingestion/C-htmlGate/manual-review/index.js';

// ─── Public types ────────────────────────────────────────────────────────────

export interface QuarantineOptions {
  projectRoot: string;
  /** Tröskelvärde för cf. Default 2 (Hybrid B). */
  threshold?: number;
  /** Cap antal events per källa i pending-note + payload. Default 10. */
  maxEventsPerSource?: number;
  /** Dry-run: rapport utan mutationer. */
  dryRun?: boolean;
  /** ISO date override (för tester). Default: today UTC. */
  date?: string;
  /** Test-injection: ersätt Supabase-klienten. */
  _client?: SupabaseClient | null;
}

export interface QuarantinedEventRef {
  id: string;
  title: string;
  start_time: string;
}

export interface QuarantineResult {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  threshold: number;
  /** Kilder som NYTT skickades till manual-review-kön idag. */
  newlyQuarantined: string[];
  /** Kilder som redan var quarantine-flaggade idag; skippade pending-write. */
  reQuarantinedSkipped: string[];
  /** Antal pending.jsonl-writes som utfördes. */
  pendingQueueWrites: number;
  errors: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayIso(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

interface CrossedThresholdRow {
  source: string;
  id: string;
  title_sv: string | null;
  title_en: string | null;
  consecutive_broken_count: number;
  first_broken_at: string;
}

/**
 * Hitta källor där cf just passerat tröskeln idag (first_broken_at::date
 * = today). Group-by source sker i JS efter fetch (Supabase GROUP BY är
 * svårt att uttrycka utan RPC).
 */
async function fetchNewlyCrossedSources(
  client: SupabaseClient,
  threshold: number,
  today: string,
): Promise<CrossedThresholdRow[]> {
  const { data, error } = await client
    .from('events')
    .select('id, source, title_sv, title_en, start_time, consecutive_broken_count, first_broken_at')
    .eq('status', 'published')
    .eq('link_status', 'broken')
    .gte('consecutive_broken_count', threshold)
    .gte('first_broken_at', `${today}T00:00:00Z`)
    .lt('first_broken_at', `${today}T23:59:59.999Z`)
    .limit(500);

  if (error) {
    throw new Error(`fetch events (cf-crossed): ${error.message}`);
  }
  return (data ?? []) as CrossedThresholdRow[];
}

/**
 * Hämta cap:N events från källan för note + payload. Vi plockar de
 * närmast kommande (sorterade på start_time asc) eftersom det är de som
 * användaren annars skulle ha sett.
 */
async function fetchEventsForSource(
  client: SupabaseClient,
  source: string,
  limit: number,
): Promise<QuarantinedEventRef[]> {
  const { data, error } = await client
    .from('events')
    .select('id, title_sv, title_en, start_time')
    .eq('source', source)
    .eq('status', 'published')
    .order('start_time', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`fetch events for ${source}: ${error.message}`);
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    title: (r.title_sv || r.title_en || '(no title)').slice(0, 80),
    start_time: r.start_time,
  }));
}

/**
 * Bygg note för pending-kön: listar cap events med kort info.
 */
function buildNote(source: string, events: QuarantinedEventRef[], threshold: number): string {
  const lines = events.map(
    (e, i) => `  ${i + 1}. ${e.title} (${e.start_time.slice(0, 10)})`,
  );
  return `Auto-quarantine: source '${source}' har cf>=${threshold}. ` +
    `${events.length} av ${events.length} events i cap-listan:\n` +
    lines.join('\n');
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function runQuarantineTrigger(
  opts: QuarantineOptions,
): Promise<QuarantineResult> {
  const startedAt = new Date().toISOString();
  const threshold = opts.threshold ?? 2;
  const maxEventsPerSource = opts.maxEventsPerSource ?? 10;
  const dryRun = opts.dryRun ?? false;
  const today = opts.date ?? todayIso();
  const empty: QuarantineResult = {
    startedAt,
    finishedAt: startedAt,
    dryRun,
    threshold,
    newlyQuarantined: [],
    reQuarantinedSkipped: [],
    pendingQueueWrites: 0,
    errors: [],
  };

  const client = opts._client !== undefined ? opts._client : defaultDb();
  if (!client) {
    return {
      ...empty,
      finishedAt: new Date().toISOString(),
      errors: ['supabase client not configured'],
    };
  }

  // 1. Hämta rader som just korsat tröskeln (cf>=threshold, idag).
  let crossed: CrossedThresholdRow[];
  try {
    crossed = await fetchNewlyCrossedSources(client, threshold, today);
  } catch (e) {
    return {
      ...empty,
      finishedAt: new Date().toISOString(),
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }
  if (crossed.length === 0) {
    return { ...empty, finishedAt: new Date().toISOString() };
  }

  // 2. Gruppera per källa.
  const bySource = new Map<string, CrossedThresholdRow[]>();
  for (const row of crossed) {
    if (!row.source) continue;
    const arr = bySource.get(row.source) ?? [];
    arr.push(row);
    bySource.set(row.source, arr);
  }

  // 3. För varje källa: idempotency-check via source-changes.
  const result: QuarantineResult = {
    ...empty,
    finishedAt: new Date().toISOString(),
  };

  for (const [source, rows] of bySource.entries()) {
    // Idempotency: redan quarantine-flaggad idag?
    const existing = readChanges(opts.projectRoot, {
      sourceId: source,
      since: today,
    });
    const alreadyToday = existing.some(
      (c) => c.action === 'mark-review-needed' && c.date === today,
    );
    if (alreadyToday) {
      result.reQuarantinedSkipped.push(source);
      continue;
    }

    if (dryRun) {
      // Rapportera vad vi SKULLE ha gjort, utan att mutera.
      result.newlyQuarantined.push(source);
      continue;
    }

    // 4. Hämta cap:events från källan och bygg note.
    let eventsForNote: QuarantinedEventRef[];
    try {
      eventsForNote = await fetchEventsForSource(client, source, maxEventsPerSource);
    } catch (e) {
      result.errors.push(
        `[${source}] ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    const note = buildNote(source, eventsForNote, threshold);

    // 5. Skicka till manual-review-kön.
    try {
      submitForReview(
        source,
        'link_health_quarantined',
        note,
        'link-health-trigger',
        opts.projectRoot,
        {
          trigger: 'link-health-hybrid-b',
          cf: threshold,
          crossedAt: today,
          affectedEventCount: eventsForNote.length,
          events: eventsForNote,
        },
      );
      result.pendingQueueWrites += 1;
    } catch (e) {
      result.errors.push(
        `[${source}] submitForReview: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }

    // 6. Append audit-log entry. Idempotent på (date, sourceId, action).
    try {
      appendChange(
        opts.projectRoot,
        makeChange({
          sourceId: source,
          action: 'mark-review-needed',
          before: {},
          after: {},
          rationale:
            `Link-health Hybrid B: source '${source}' har cf>=${threshold} sedan ${today}. ` +
            `Reparationsprogram öppnat.`,
          evidence:
            `cf=${threshold} crossed on ${today}; ${crossed.length} events med cf>=${threshold} ` +
            `i samma källa; ${eventsForNote.length} events plockade till pending-note.`,
          confidence: 'high',
          appliedBy: 'auto-rule',
          reviewStatus: 'pending-review',
        }),
      );
    } catch (e) {
      // source-changes.jsonl-write-fail är ofarligt (audit only).
      result.errors.push(
        `[${source}] appendChange: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    result.newlyQuarantined.push(source);
  }

  result.finishedAt = new Date().toISOString();
  return result;
}

// ─── CLI entry ─────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('quarantine_trigger.ts')) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dateIdx = args.indexOf('--date');
  const date = dateIdx !== -1 && args[dateIdx + 1] ? args[dateIdx + 1] : undefined;
  runQuarantineTrigger({
    projectRoot: process.cwd(),
    dryRun,
    ...(date !== undefined ? { date } : {}),
  }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.errors.length > 0 ? 1 : 0);
  });
}
