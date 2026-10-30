#!/usr/bin/env -S npx tsx
/**
 * check_asian_chars.ts — teckenkontroll av samtliga events efter ingestion.
 *
 * Körs vid slutet av ingestion. Läser ALLA publicerade events ur
 * `events_public` (paginerat — PostgREST kapar vid 1000 rader annars) och
 * rapporterar varje fält som innehåller icke-latina skript: kinesiska
 * (han), japanska (kana), koreanska (hangul) samt övriga asiatiska skript.
 *
 * Viktigt: skriptet skiljer på två saker som lätt blandas ihop.
 *
 *   1. DEFEKT — icke-latina skript i text VI har genererat själva
 *      (eventpulse_summary, editorial_description) eller i ett fält som
 *      speglar en raderad/sbynad lokal (`venue_full_name`). Detta är vårt
 *      fel: det läcker in i svenska meningar.
 *
 *   2. KÄLLA — icke-latina skript i källans egen titel/beskrivning
 *      (t.ex. en rysk teaterföreställning eller en kinesisk bokcirkel).
 *      Detta är INTE ett fel. Originalet ska bevaras och översättas till
 *      det språk appen visar.
 *
 * Användning:
 *   npx tsx scripts/check_asian_chars.ts                       # rapport
 *   npx tsx scripts/check_asian_chars.ts --within-days 90     # bara framtida
 *   npx tsx scripts/check_asian_chars.ts --json runtime/.../r.json
 *   npx tsx scripts/check_asian_chars.ts --fix                 # reparera
 *
 * Exit-koder: 0 = inga fynd, 1 = fynd (eller fel i --fix), 2 = körfel.
 *
 * Miljö: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (eller SUPABASE_SERVICE_KEY).
 */

import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  summarizeText,
  findForeignScriptRuns,
  countAsianCharacters,
  isNonLatinLanguage,
  SUPPORTED_LANGUAGES,
} from '../packages/shared/src/text/scriptScan.js';

/** Fält som visas för användaren i appen. */
const DISPLAY_FIELDS = [
  'title_sv',
  'title_en',
  'description_sv',
  'description_en',
  'venue_full_name',
  'eventpulse_summary',
  'editorial_description',
] as const;

type DisplayField = (typeof DISPLAY_FIELDS)[number];

/** Fält vi själva genererar — icke-latina tecken här är alltid ett fel. */
const GENERATED_FIELDS = new Set<DisplayField>(['eventpulse_summary', 'editorial_description']);

/** Fält som speglar lokaldata — icke-latina tecken här är nästan alltid ett fel. */
const VENUE_FIELDS = new Set<DisplayField>(['venue_full_name']);

const PAGE = 1000;

type Args = {
  limit: number;
  withinDays: number;
  jsonPath: string | null;
  fix: boolean;
  language: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: 0,
    withinDays: 0,
    jsonPath: null,
    fix: false,
    language: 'sv',
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit') args.limit = Number.parseInt(argv[++i] ?? '', 10) || 0;
    else if (arg === '--within-days') args.withinDays = Number.parseInt(argv[++i] ?? '', 10) || 0;
    else if (arg === '--json') args.jsonPath = argv[++i] ?? null;
    else if (arg === '--language') args.language = argv[++i] ?? 'sv';
    else if (arg === '--fix') args.fix = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: npx tsx scripts/check_asian_chars.ts [--within-days N] [--limit N] ' +
          '[--json PATH] [--language TAG] [--fix]',
      );
      process.exit(0);
    } else {
      console.error(`Okänt argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

type Finding = {
  event_id: string;
  source: string;
  start_time: string | null;
  field: DisplayField;
  kind: 'defect' | 'source-content';
  scripts: Array<{ id: string; label: string; group: string; count: number }>;
  runs: string[];
  excerpt: string;
  title: string | null;
};

function excerptOf(text: string, run: string): string {
  const index = text.indexOf(run);
  if (index < 0) return text.slice(0, 120);
  const from = Math.max(0, index - 40);
  const to = Math.min(text.length, index + run.length + 40);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ')}${to < text.length ? '…' : ''}`;
}

async function fetchAllEvents(sb: ReturnType<typeof createClient>, args: Args) {
  const columns = [
    'id',
    'source',
    'start_time',
    'title_sv',
    'title_en',
    ...DISPLAY_FIELDS.filter((f) => !['title_sv', 'title_en'].includes(f)),
  ].join(',');

  let query = sb.from('events_public').select(columns).order('start_time', { ascending: true });
  if (args.withinDays > 0) {
    const cutoff = new Date(Date.now() + args.withinDays * 86_400_000).toISOString();
    query = query.lt('start_time', cutoff);
  }

  const events: Array<Record<string, unknown>> = [];
  const cap = args.limit > 0 ? args.limit : Number.MAX_SAFE_INTEGER;
  for (let from = 0; from < cap; from += PAGE) {
    const to = Math.min(from + PAGE, cap) - 1;
    const { data, error } = await query.range(from, to);
    if (error) throw new Error(`events_public: ${error.message}`);
    events.push(...((data ?? []) as Array<Record<string, unknown>>));
    if (!data || data.length < to - from + 1) break;
  }
  return events;
}

/**
 * Klassificera ett fynd.
 *
 * - `venue-leak`  — det främmande namnet är ett LOKALNAMN. Vårt fel: det
 *   läcker in i listor och summaries.
 * - `event-title` — det främmande namnet är EVENTETS TITEL. Inte ett fel:
 *   titeln ska översättas, aldrig raderas.
 * - `generated-text` — det främmande namnet finns i text VI genererat
 *   (`eventpulse_summary`, `editorial_description`) och hör inte till titeln.
 *   Vårt fel: en AI-artefakt mitt i en svensk mening.
 */
function classify(field: DisplayField, run: string, event: Record<string, unknown>): Finding['kind'] {
  const title = `${event.title_sv ?? ''} ${event.title_en ?? ''}`;
  if (title.includes(run)) return 'source-content';
  if (VENUE_FIELDS.has(field)) return 'defect';
  if (GENERATED_FIELDS.has(field)) return 'defect';
  return 'source-content';
}

function scanEvents(events: Array<Record<string, unknown>>, language: string): Finding[] {
  const findings: Finding[] = [];
  for (const event of events) {
    for (const field of DISPLAY_FIELDS) {
      const value = event[field];
      if (typeof value !== 'string' || !value.trim()) continue;

      const summary = summarizeText(value, language);
      if (summary.scripts.length === 0) continue;

      const runs = findForeignScriptRuns(value, language);
      // Endast skript som INDE är tillåtna för det valda språket är fynd.
      // I en arabisk app är arabiska tecken inte fynd.
      if (runs.length === 0) continue;

      for (const run of runs) {
        findings.push({
          event_id: String(event.id),
          source: String(event.source ?? ''),
          start_time: (event.start_time as string | null) ?? null,
          field,
          kind: classify(field, run.text, event),
          scripts: summary.scripts.map((s) => ({
            id: s.id,
            label: s.label,
            group: s.group,
            count: s.count,
          })),
          runs: [run.text],
          excerpt: excerptOf(value, run.text),
          title: (event.title_sv as string | null) ?? (event.title_en as string | null) ?? null,
        });
      }
    }
  }
  return findings;
}

function summarize(findings: Finding[], eventsScanned: number) {
  const byKind = new Map<Finding['kind'], number>();
  const byField = new Map<string, number>();
  const byScript = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byEvent = new Map<string, Set<string>>();

  for (const finding of findings) {
    byKind.set(finding.kind, (byKind.get(finding.kind) ?? 0) + 1);
    byField.set(finding.field, (byField.get(finding.field) ?? 0) + 1);
    bySource.set(finding.source, (bySource.get(finding.source) ?? 0) + 1);
    const eventScripts = byEvent.get(finding.event_id) ?? new Set<string>();
    for (const script of finding.scripts) {
      byScript.set(script.id, (byScript.get(script.id) ?? 0) + script.count);
      eventScripts.add(script.id);
    }
    byEvent.set(finding.event_id, eventScripts);
  }

  return {
    events_scanned: eventsScanned,
    findings: findings.length,
    affected_events: byEvent.size,
    by_kind: Object.fromEntries(byKind),
    by_field: Object.fromEntries(byField),
    by_script: Object.fromEntries(byScript),
    by_source: Object.fromEntries(bySource),
  };
}

function printReport(findings: Finding[], stats: ReturnType<typeof summarize>) {
  console.log(`\n[check_asian_chars] Skannade ${stats.events_scanned} publicerade events.`);
  console.log(`[check_asian_chars] ${stats.findings} fynd i ${stats.affected_events} events.`);
  console.log(`[check_asian_chars] per fält: ${JSON.stringify(stats.by_field)}`);
  console.log(`[check_asian_chars] per skript: ${JSON.stringify(stats.by_script)}`);
  console.log(`[check_asian_chars] per källa: ${JSON.stringify(stats.by_source)}`);
  console.log(`[check_asian_chars] per typ: ${JSON.stringify(stats.by_kind)}`);

  const defects = findings.filter((f) => f.kind === 'defect');
  const content = findings.filter((f) => f.kind === 'source-content');

  if (defects.length > 0) {
    console.log(`\n[check_asian_chars] DEFEKT (genererad text / lokaldata) — ${defects.length}:`);
    for (const finding of defects.slice(0, 25)) {
      console.log(
        `  - ${finding.field} | ${finding.event_id.slice(0, 8)} | ${finding.source} | ` +
          `${finding.scripts.map((s) => `${s.label}(${s.count})`).join(',')} | "${finding.excerpt}"`,
      );
    }
    if (defects.length > 25) console.log(`  … och ${defects.length - 25} till.`);
  }

  if (content.length > 0) {
    console.log(`\n[check_asian_chars] KÄLLA (original från källan) — ${content.length}:`);
    for (const finding of content.slice(0, 25)) {
      console.log(
        `  - ${finding.field} | ${finding.event_id.slice(0, 8)} | ${finding.source} | ` +
          `${finding.scripts.map((s) => `${s.label}(${s.count})`).join(',')} | "${finding.excerpt}"`,
      );
    }
    if (content.length > 25) console.log(`  … och ${content.length - 25} till.`);
  }
}

/**
 * Reparationen ligger i `scripts/repair_asian_text.ts` — ett eget steg så att
 * kontrollen alltid är en ren, läsbar mätning. Kör:
 *
 *   npx tsx --env-file=.env scripts/repair_asian_text.ts --dry-run
 *   npx tsx --env-file=.env scripts/repair_asian_text.ts --apply
 *
 * Främmande EVENTTITLAR översätts i stället för att repareras:
 *   node --env-file=.env scripts/translate_foreign_titles.mjs --languages sv,en --apply
 */
function printRepairHint(findings: Finding[]) {
  const defects = findings.filter((f) => f.kind === 'defect').length;
  const content = findings.filter((f) => f.kind === 'source-content').length;
  console.log(`\n[check_asian_chars] ${defects} defekt(er) → scripts/repair_asian_text.ts --apply`);
  console.log(`[check_asian_chars] ${content} källinnehåll → scripts/translate_foreign_titles.mjs --apply`);
}

async function main() {
  const args = parseArgs(process.argv);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY (eller SUPABASE_SERVICE_KEY) krävs.');
    process.exit(2);
  }

  if (isNonLatinLanguage(args.language)) {
    console.error(
      `--language ${args.language} använder ett icke-latin skript. ` +
        'Teckenkontrollen ska köras mot appens visningsspråk — använd t.ex. --language sv.',
    );
    process.exit(2);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  let events: Array<Record<string, unknown>>;
  try {
    events = await fetchAllEvents(sb, args);
  } catch (error) {
    console.error('[check_asian_chars] kunde inte läsa events:', (error as Error).message);
    process.exit(2);
  }

  const findings = scanEvents(events, args.language);
  const stats = summarize(findings, events.length);
  printReport(findings, stats);

  const report = {
    generated_at: new Date().toISOString(),
    language: args.language,
    within_days: args.withinDays,
    ...stats,
    findings: findings.map((f) => ({
      ...f,
      asian_characters: countAsianCharacters(
        (f.runs ?? []).join(' '),
      ),
    })),
  };

  const jsonPath = args.jsonPath
    ?? path.join('runtime', 'text-integrity', `asian-chars-${Date.now()}.json`);
  try {
    mkdirSync(path.dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n[check_asian_chars] JSON-rapport: ${jsonPath}`);
  } catch (error) {
    console.error('[check_asian_chars] kunde inte skriva rapporten:', (error as Error).message);
  }

  if (args.fix) {
    printRepairHint(findings);
  } else if (findings.length > 0) {
    printRepairHint(findings);
  }

  process.exit(findings.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[check_asian_chars] fatal:', (error as Error).message);
  process.exit(2);
});
