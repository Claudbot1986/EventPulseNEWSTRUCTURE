/**
 * importToEventPulse.ts — EventPulse Import
 *
 * Läser events från 03-Queue/03-extractedevents/{sourceId}.jsonl,
 * enquear varje event till bullmq `raw_events` (→ normalizer → Supabase),
 * och flyttar källan till EVENTPULSE-APP-queue.jsonl.
 *
 * Flöde: preUI → runA-extract → extractedevents/ → importToEventPulse → Supabase → EVENTPULSE-APP
 *
 * Usage:
 *   npx tsx 03-Queue/importToEventPulse.ts              # alla extractedevents/
 *   npx tsx 03-Queue/importToEventPulse.ts --limit N     # N källor
 *   npx tsx 03-Queue/importToEventPulse.ts --dry-run      # testa utan att köra
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';
import { loadSkippedSourceIds } from '../02-Ingestion/lib/quarantineGuard.js';
import { isEventPast } from './eventFreshness';
import { eventStartTime } from '../02-Ingestion/F-eventExtraction/usableEvents';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Paths ────────────────────────────────────────────────────────────────────

const RUNTIME_DIR     = path.resolve(__dirname, '..');
const PREUI_Q         = path.join(RUNTIME_DIR, 'runtime', 'preUI-queue.jsonl');
const EVENTPULSE_Q    = path.join(RUNTIME_DIR, 'runtime', 'EVENTPULSE-APP-queue.jsonl');
const EXTRACTED_DIR   = path.resolve(__dirname, '03-extractedevents');

function loadCliEnv(): void {
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });
}

// ── BullMQ ───────────────────────────────────────────────────────────────────

interface RawEventInput {
  title: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  lat: number | null;
  lng: number | null;
  categories: string[];
  is_free: boolean;
  price_min_sek: number | null;
  price_max_sek: number | null;
  ticket_url: string | null;
  image_url: string | null;
  source: string;
  source_id: string | null;
  detected_language: 'sv' | 'en' | 'other' | null;
  raw_payload: Record<string, unknown>;
}

/**
 * Minimalt gränssnitt för att kolla ett jobbs tillstånd — gör att logiken kan
 * testas utan Redis.
 */
interface JobLookup {
  getJob(jobId: string): Promise<{
    getState(): Promise<string>;
    remove(): Promise<void>;
  } | undefined>;
}

/**
 * BullMQ dedupear på jobId: `add` med ett jobId som redan existerar är en
 * TYST no-op — även om jobbet ligger i KLART eller MISLYCKAT läge.
 *
 * 2026-10-23 — med `removeOnComplete: 100` (queue.ts) ligger de 100 senast
 * klara jobben kvar i Redis. De blockerar då nattens re-import av exakt de
 * event som importerades sist — en rättad rad (t.ex. venue '[object Object]'
 * → rätt platsnamn) når aldrig databasen, utan att något säger ifrån.
 * Mätt på riktiga körningen: 82 av 1463 framtida events kolliderade.
 *
 * Lösningen är att ta bort jobbet NÄR det är i ett terminalt läge (klart
 * eller mislyckat) och sedan lägga in det igen. Väntande och aktiva jobb
 * lämnas orörda — där är dedupe önskvärt (samma rad ska inte köas två
 * gånger samtidigt).
 */
export async function releaseTerminalJob(
  q: JobLookup,
  jobId: string,
): Promise<'removed' | 'kept' | 'absent'> {
  const existing = await q.getJob(jobId);
  if (!existing) return 'absent';
  const state = await existing.getState();
  if (state === 'completed' || state === 'failed') {
    await existing.remove();
    return 'removed';
  }
  return 'kept';
}

/**
 * BullMQ-jobId för en rad.
 *
 * 2026-10-23 — jobId byggdes på (source, source_id ?? titel). BullMQ
 * dedupear på jobId, så två föreställningar med SAMMA titel men olika
 * klockslag kollapsade till en enda rad: "Sagolek – Den lille prinsen"
 * 10:00 och 11:30 samma dag. Mätt på riktiga körningen: 158 av 1463
 * framtida events försvann tyst — de fanns i filen men kom aldrig till
 * databasen.
 *
 * Nyckeln speglar nu NORMALIZERNS dedup-nyckel (normalizer.ts:437-439):
 *   med source_id → (source, source_id)
 *   utan          → (source, titel, start_time)
 * Det är invarianten som ska hålla: jobId-granulariteten får aldrig vara
 * FINARE än dedup-granulariteten — då kan BullMQ kasta bort en rad som
 * normalizern skulle ha behållit. Finare är OK: normalizern slår ihop dem
 * ändå, och det är den som äger dedup-regeln.
 *
 * ':' byts ut — BullMQ avvisar jobbId som innehåller kolon.
 */
export function buildJobId(raw: RawEventInput): string {
  const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9-_]/g, '_');
  if (raw.source_id) return `${raw.source}--${sanitize(raw.source_id)}`;
  return `${raw.source}--${sanitize(raw.title)}--${sanitize(raw.start_time ?? '')}`;
}

async function enqueueRawEvent(raw: RawEventInput): Promise<void> {
  // Reuse the canonical 'raw_events' queue instance from queue.js — it has the
  // same name/prefix/jobOptions this local duplicate built. The old code
  // imported a non-exported getConnection and passed it as a BullMQ
  // ConnectionOptions field (invalid — see the RUNTIME-PRESERVING NOTE in
  // queue.ts). One-shot CLI: no per-add close needed, process exit cleans up.
  const { rawEventsQueue: q } = await import('./queue.js');

  const jobId = buildJobId(raw);
  await releaseTerminalJob(q, jobId);
  await q.add(jobId, raw, { jobId });
}

// ── Queue helpers ───────────────────────────────────────────────────────────

interface QueueEntry {
  sourceId: string;
  queueName: string;
  queuedAt: string;
  priority: number;
  attempt: number;
  queueReason?: string;
  workerNotes?: string;
}

function readQueueEntries(file: string): QueueEntry[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8')
    .split('\n').filter(l => l.trim())
    .map(l => JSON.parse(l) as QueueEntry)
    .filter(e => e !== null && 'sourceId' in e);
}

function removeFromPreUI(sourceId: string): void {
  if (!fs.existsSync(PREUI_Q)) return;
  const lines = fs.readFileSync(PREUI_Q, 'utf-8').split('\n');
  const filtered = lines.filter(l => {
    if (!l.trim()) return true;
    try { return JSON.parse(l).sourceId !== sourceId; }
    catch { return true; }
  });
  fs.writeFileSync(PREUI_Q, filtered.join('\n') + '\n');
}

function appendToEventPulseApp(sourceId: string, eventsEnqueued: number): void {
  // Always rewrite queue with deduplication (idempotent write)
  const existing = readQueueEntries(EVENTPULSE_Q);
  if (existing.some(e => e.sourceId === sourceId)) {
    console.log(`[import] ${sourceId}: redan i EVENTPULSE-APP — hoppar över duplicat`);
    return;
  }
  const newEntry: QueueEntry = {
    sourceId,
    queueName: 'EVENTPULSE-APP',
    queuedAt: new Date().toISOString(),
    priority: 1,
    attempt: 1,
    queueReason: 'importToEventPulse',
    workerNotes: `${eventsEnqueued} events importerade`,
  };
  const allEntries = [...existing, newEntry];
  fs.writeFileSync(EVENTPULSE_Q, allEntries.map(e => JSON.stringify(e)).join('\n') + '\n');
}

// ── Extracted event reading ─────────────────────────────────────────────────

interface ExtractedEvent {
  id?: string;
  title?: string | { rendered: string };
  name?: string;
  description?: string | null;
  start_time?: string;
  end_time?: string | null;
  startTime?: string;
  endTime?: string;
  venue_name?: string | null;
  venue_address?: string | null;
  lat?: number | null;
  lng?: number | null;
  categories?: string[];
  category?: string;
  is_free?: boolean;
  price_min_sek?: number | null;
  price_max_sek?: number | null;
  ticket_url?: string | null;
  ticketUrl?: string | null;
  url?: string | null;
  image_url?: string | null;
  imageUrl?: string | null;
  source_id?: string | null;
  detected_language?: 'sv' | 'en' | 'other' | null;
  raw_payload?: Record<string, unknown>;
  // Fields from extractFromJsonLd (date/time as separate fields)
  date?: string;
  time?: string;
  endDate?: string;
  venue?: string;
  address?: string;
  city?: string;
  [key: string]: unknown;
}

function extractTitle(ev: ExtractedEvent): string {
  const t = ev.title;
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object' && 'rendered' in t) return (t as { rendered: string }).rendered;
  return ev.name ?? 'Unknown';
}

function extractDescription(ev: ExtractedEvent): string | null {
  const d = ev.description;
  if (typeof d === 'string') return d;
  return null;
}

// 2026-10-24 — starttid-definitionen bor i F-eventExtraction/usableEvents.ts
// så att C-gatens "har användbart datum?" och importens "kasta bort
// förflutna/datumlösa" är Samma regel. Två kopior kan glida isär.
function extractStartTime(ev: ExtractedEvent): string {
  return eventStartTime(ev);
}

function extractEndTime(ev: ExtractedEvent): string | null {
  if (ev.end_time) return ev.end_time;
  if (ev.endTime) return ev.endTime;
  return toIsoEndTime(ev.endDate, ev.endTime, ev.date, ev.time);
}

function toIsoEndTime(endDate?: string, endTime?: string, startDate?: string, startTime?: string): string | null {
  if (endDate && endTime) {
    const [h, m] = endTime.split(':');
    return `${endDate}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:00.000Z`;
  }
  if (endDate) return `${endDate}T23:59:59.000Z`;
  return null;
}

/**
 * Identitet för en extraherad rad — används för att slå ihop samma event
 * från olika gater.
 *
 * 2026-10-23 — första versionen nycklade på (titel, datum-dag). Det kollapsade
 * ÄKTA men olika event: berwaldhallen har t.ex. "Bowie in Berlin" 18:00 och
 * 20:00 samma dag (206 rader → 104 unika), och gota-lejon har flera show
 * samma dag med olika biljetter. Live-körningen tappade 22 berwaldhallen-
 * events på det sättet.
 *
 * Nu är identiteten en SAMMANSATT nyckel: alla identitetsfält som finns med
 * (source_id/id, titel, tidsstämpel, url). Två rader slås ihop bara om de är
 * identiska i ALLA de fält de båda har — så en rad som saknar ett fält
 * slås aldrig ihop med en rad som har det. Det är den säkra riktningen:
 * dubbletter slås ihop, men olika event försvinner aldrig.
 * Kvarvarande dubbletter hanteras av BullMQ (jobId) och normalizern (dedup).
 */
export function eventIdentity(ev: ExtractedEvent): string {
  const rawTitle = ev.title;
  const title = (typeof rawTitle === 'string' ? rawTitle : rawTitle?.rendered ?? '')
    .trim()
    .toLowerCase();
  const sid = String(ev.source_id ?? ev.id ?? '').trim();
  const stamp = eventTimestamp(ev);
  const url = String(ev.url ?? ev.ticket_url ?? ev.ticketUrl ?? '').trim();

  const parts = [sid, title, stamp, url].filter(p => p.length > 0);
  if (parts.length === 0) return `r:${JSON.stringify(ev).slice(0, 200)}`;
  return parts.join('|');
}

/**
 * Full tidsstämpel för en rad. Fältordningen varierar mellan gater:
 * A/B/C använder `date` + `time` (separat), D/B använder `startTime`/`start_time`
 * (ISO med klockslag). Klockslaget MÅSTE vara med — utan det slås flera
 * föreställningar samma dag ihop.
 */
function eventTimestamp(ev: ExtractedEvent): string {
  const iso = ev.start_time ?? ev.startTime;
  if (typeof iso === 'string' && iso.trim()) return iso.trim();
  const date = String(ev.date ?? '').trim();
  if (!date) return '';
  const time = String(ev.time ?? '').trim();
  return time ? `${date}T${time}` : date;
}

/**
 * Slå ihop artefakter för en källa.
 *
 * 2026-10-23 — Bug: readExtractedEvents returnerade FÖRSTA träffen (top-level
 * före gate-subdirs) och ignorerade resten. En källa som passerat flera gater
 * har artefakter på flera ställen — t.ex. lokalhelhet-calendar: 23 rader
 * top-level (A-gate, 2026-08-21) + 224 rader i C/ (2026-09-09). Importern
 * läste top-level-filen och såg aldrig C-gatens 224 rader → 76 framtida
 * events nådde aldrig databasen trots att de var extraherade.
 *
 * Ny regel: alla artefakter läses, rader med samma identitet slås ihop, och
 * den NYARE artefaktens rad vinner — en senare gatkörning är en förfining av
 * en tidigare. Artefakter behandlas i mtime-ordning (äldst först) så att
 * "vinner" alltid betyder "senast skriven".
 */
export function mergeExtractedEvents(artifacts: ExtractedEvent[][]): ExtractedEvent[] {
  const byIdentity = new Map<string, ExtractedEvent>();
  const order: string[] = [];
  for (const rows of artifacts) {
    for (const ev of rows) {
      if (!ev) continue;
      const key = eventIdentity(ev);
      if (!byIdentity.has(key)) order.push(key);
      byIdentity.set(key, ev); // nyare artefakt vinner
    }
  }
  return order.map(k => byIdentity.get(k)).filter((e): e is ExtractedEvent => e !== undefined);
}

/**
 * Läs ALLA artefakter för en källa: top-level (A/B/C utan subdir) plus
 * gate-subdirs (A/, B/, C/, D/) — och slå ihop dem.
 *
 * @param rootOverride Test-hook: låter tester peka på en temporär katalog.
 */
export function readExtractedEvents(sourceId: string, rootOverride?: string): ExtractedEvent[] {
  const root = rootOverride ?? EXTRACTED_DIR;
  const candidates: { file: string; mtimeMs: number }[] = [];

  const topLevel = path.join(root, `${sourceId}.jsonl`);
  if (fs.existsSync(topLevel)) {
    candidates.push({ file: topLevel, mtimeMs: fs.statSync(topLevel).mtimeMs });
  }
  for (const gate of ['D', 'C', 'B', 'A']) {
    const subFile = path.join(root, gate, `${sourceId}.jsonl`);
    if (fs.existsSync(subFile)) {
      candidates.push({ file: subFile, mtimeMs: fs.statSync(subFile).mtimeMs });
    }
  }
  // Äldst först — så att "senaste raden vinner" i mergeExtractedEvents.
  candidates.sort((a, b) => a.mtimeMs - b.mtimeMs);

  const artifacts = candidates.map(({ file }) =>
    fs.readFileSync(file, 'utf-8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => {
        try { return JSON.parse(l) as ExtractedEvent; }
        catch { return null; }
      })
      .filter((e): e is ExtractedEvent => e !== null),
  );

  return mergeExtractedEvents(artifacts);
}

/**
 * Source-inference: mappa cross-domain URLs (t.ex. bokningssubdomäner) till
 * deras kanoniska source-namn. Berwaldhallen är en split-domain setup där
 * API:t ligger på www.berwaldhallen.se men Tixly-URL:erna pekar på
 * boka.berwaldhallen.se. Om vi inte mappar om här persisteras events med
 * source=NULL (eller fel source-nam), vilket bryter source-quality-rapporter
 * och gör att events inte matchas mot källans kategorier.
 *
 * 2026-09-27: boka.berwaldhallen.se → berwaldhallen. Fler cross-domain-maps
 * kan läggas till här allteftersom de upptäcks.
 */
function inferCanonicalSource(sourceId: string, ev: ExtractedEvent): string {
  const url = ev.ticket_url ?? ev.ticketUrl ?? ev.url ?? '';
  const sid = ev.source_id ?? ev.id ?? '';
  if (
    typeof url === 'string' &&
    (url.includes('boka.berwaldhallen.se') || url.includes('www.berwaldhallen.se'))
  ) return 'berwaldhallen';
  if (typeof sid === 'string' && sid.startsWith('berwaldhallen-')) return 'berwaldhallen';
  return sourceId;
}

export function toRawEvent(sourceId: string, ev: ExtractedEvent): RawEventInput {
  // source_id-fallback: många adapters (t.ex. berwaldhallen) använder `id` istället
  // för `source_id`. Utan fallback skulle jobId kollidera vid dubletter (samma
  // titel → samma jobId → BullMQ dedupe → bara första raden processas).
  const effectiveSourceId = ev.source_id ?? ev.id ?? null;
  // Cross-domain-URL-mapping till kanonisk source (se inferCanonicalSource).
  const canonicalSource = inferCanonicalSource(sourceId, ev);

  return {
    title:          extractTitle(ev),
    description:    extractDescription(ev),
    start_time:     extractStartTime(ev),
    end_time:       extractEndTime(ev),
    venue_name:     ev.venue_name ?? ev.venue ?? null,
    venue_address:  ev.venue_address ?? ev.address ?? null,
    lat:            ev.lat ?? null,
    lng:            ev.lng ?? null,
    categories:     ev.categories ?? (ev.category ? [ev.category] : []),
    is_free:        ev.is_free ?? false,
    price_min_sek:  ev.price_min_sek ?? (ev.price && typeof ev.price === 'object' ? ((ev.price as Record<string, unknown>).min as number | null) ?? null : null),
    price_max_sek:  ev.price_max_sek ?? (ev.price && typeof ev.price === 'object' ? ((ev.price as Record<string, unknown>).max as number | null) ?? null : null),
    ticket_url:     ev.ticket_url ?? ev.ticketUrl ?? ev.url ?? null,
    image_url:      ev.image_url ?? ev.imageUrl ?? null,
    source:         canonicalSource,
    source_id:      effectiveSourceId,
    detected_language: ev.detected_language ?? null,
    raw_payload:    ev.raw_payload ?? {},
  };
}

// ── Import logic ─────────────────────────────────────────────────────────────

/**
 * Importera EN källa.
 *
 * @param rootOverride Test-hook: låter verifieringsgater peka på en
 *   temporär katalog så att de inte röör en pågående körnings artefakter.
 */
export async function importSource(
  sourceId: string,
  dryRun: boolean,
  rootOverride?: string,
): Promise<{ enqueued: number; errors: number; skippedPast: number }> {
  const events = readExtractedEvents(sourceId, rootOverride);
  if (events.length === 0) {
    console.log(`[import] ${sourceId}: ingen event-data i extractedevents/ → hoppar`);
    return { enqueued: 0, errors: 0, skippedPast: 0 };
  }

  console.log(`[import] ${sourceId}: ${events.length} events`);

  let enqueued = 0;
  let errors = 0;
  let skippedPast = 0;

  for (const ev of events) {
    try {
      const raw = toRawEvent(sourceId, ev);
      // Datumvakt (2026-09-15): gamla events ska aldrig in i databasen —
      // passerade eller odöpta rader hoppar vi över. Defense-in-depth:
      // samma guard finns i normalizerns processRawEvent.
      //
      // 2026-10-24 — bugg: holdags-events (bara datum) lades som UTC-midnatt
      // och föll bort så snart 00:00 UTC passerat, alltså även event som
      // pågår HELA dagen. Se 03-Queue/eventFreshness.ts.
      if (isEventPast(raw.start_time)) {

        skippedPast++;
        continue;
      }
      if (dryRun) {
        console.log(`[import:dry-run]   "${raw.title}"`);
        enqueued++;
      } else {
        await enqueueRawEvent(raw);
        enqueued++;
      }
    } catch (err) {
      console.error(`[import]   ✗ fel: ${(err as Error).message}`);
      errors++;
    }
  }

  if (skippedPast > 0) {
    console.log(`[import] ${sourceId}: skip ${skippedPast} (passerat datum/saknar datum)`);
  }

  if (!dryRun) {
    removeFromPreUI(sourceId);
    appendToEventPulseApp(sourceId, enqueued);
  }

  return { enqueued, errors, skippedPast };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

/**
 * Väljer vilka källor som ska importeras.
 *
 * 2026-10-23 — retired/quarantined-källor ska INTE importeras.
 * Alla fyra gates (A/B/C/D) gör detta via isSkipped(); importen gjorde det
 * inte, så en källa som lagts i kyrkogravet fortsatte att skicka sina
 * gamla extraherade rader till databasen varje natt. Mätt: 4 framtida
 * rader från 'scandinavium' (retired) nådde aldrig databasen — normalizerns
 * titel-gate avvisar dem ("Scandinavium" är ett venue-namn, inte ett
 * event) — vilket gjorde att p3-gaten flaggade dem som saknade, och
 * 65 rader med '[object Object]' i venue_full_address kom från
 * retired/quarantined-källor som aldrig kan köas om.
 *
 * Utdelad som ren funktion så att den kan testas utan Redis/Supabase.
 */
export function selectImportableSources(
  sourceIds: Iterable<string>,
  skipped: Set<string>,
  onlySources: Set<string> | null,
  limit: number,
): { selected: string[]; skippedOut: string[] } {
  const all = [...sourceIds];
  const skippedOut = all.filter((id) => skipped.has(id));
  const selected = all
    .filter((id) => !skipped.has(id))
    .filter((id) => onlySources == null || onlySources.has(id))
    .slice(0, limit);
  return { selected, skippedOut };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 && args[limitIdx + 1]
    ? parseInt(args[limitIdx + 1], 10)
    : Infinity;
  // --source <id[,id2,...> importerar bara specifika källor.
  const sourceIdx = args.indexOf('--source');
  const onlySources = sourceIdx !== -1 && args[sourceIdx + 1]
    ? new Set(args[sourceIdx + 1].split(',').map((s) => s.trim()).filter(Boolean))
    : null;

  console.log();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  EventPulse-import  │  extractedevents → Supabase     ');
  console.log('═══════════════════════════════════════════════════════════');
  if (dryRun) console.log('  [DRY-RUN]');

  if (!fs.existsSync(EXTRACTED_DIR)) {
    console.log('\n  extractedevents/ finns inte — kör runA-extract först.');
    process.exit(1);
  }

  // Samla sourceIds från både top-level (legacy) och gate-subdirs (A/B/C/D)
  const sourceIds = new Set<string>();
  for (const entry of fs.readdirSync(EXTRACTED_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      sourceIds.add(entry.name.replace(/\.jsonl$/, ''));
    } else if (entry.isDirectory()) {
      for (const f of fs.readdirSync(path.join(EXTRACTED_DIR, entry.name))) {
        if (f.endsWith('.jsonl')) sourceIds.add(f.replace(/\.jsonl$/, ''));
      }
    }
  }

  const skipped = loadSkippedSourceIds();
  const { selected: sourceFiles, skippedOut } = selectImportableSources(
    sourceIds,
    skipped,
    onlySources,
    limit,
  );
  if (skippedOut.length > 0) {
    console.log(
      `\n  Hoppar över ${skippedOut.length} retired/quarantined-källor ` +
        `(inga rader ska importeras från dem): ${skippedOut.join(', ')}\n`,
    );
  }

  if (sourceFiles.length === 0) {
    if (onlySources) {
      console.log(`\n  Inga extracted events hittade för: ${[...onlySources].join(', ')}`);
    } else {
      console.log('\n  Inga extracted events hittade.');
    }
    process.exit(0);
  }

  console.log(`\n  ${sourceFiles.length} källor att importera\n`);

  let totalEnqueued = 0;
  let totalErrors = 0;
  let processed = 0;

  for (const sourceId of sourceFiles) {
    processed++;
    const result = await importSource(sourceId, dryRun);
    totalEnqueued += result.enqueued;
    totalErrors += result.errors;
    console.log(`  [${processed}/${sourceFiles.length}] ${sourceId}: ${result.enqueued} events`);
  }

  console.log();
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  KLAR  │  ${totalEnqueued} events till bullmq  │  ${totalErrors} errors`);
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(totalErrors > 0 ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadCliEnv();
  main().catch(err => {
    console.error('[import] Fatalt fel:', err);
    process.exit(1);
  });
}
