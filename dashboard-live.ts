#!/usr/bin/env tsx
/**
 * Live dashboard prototype (Node/TS) for EventPulse queues.
 *
 * - Real-time queue counters (refresh every 1s)
 * - Non-flaky input mode (render pauses while reading command)
 * - Simple command shell for quick ops
 *
 * Commands:
 *   help
 *   refresh
 *   run <toolId>      # executes same tool dispatch as db.py
 *   legacy-run <id>   # alias (same as run)
 *   lr <id>           # short alias
 *   17                # Alltools-E2E via db.py (riktig A→B→C→D)
 *   e2e [n]           # Alltools-E2E (--from-preA, --limit n --apply; default n=10)
 *   e2e-run           # same as e2e
 *   tools             # list available tool ids (from db.py)
 *   UI                # move UI-ready queues to EVENTPULSE-APP
 *   quit
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';

/** Projektrot = mappen där denna fil ligger (inte process.cwd(), så npm/tsx från annan cwd fungerar). */
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = path.join(ROOT, 'runtime');

const activeChildPids = new Set<number>();

export function getChildProcessKillTarget(
  pid: number,
  platform: NodeJS.Platform = process.platform
): number {
  return platform === 'win32' ? pid : -pid;
}

function signalChildProcess(pid: number, signal: NodeJS.Signals): void {
  const target = getChildProcessKillTarget(pid);
  try {
    process.kill(target, signal);
  } catch {
    if (target !== pid) {
      try {
        process.kill(pid, signal);
      } catch {
        // Process already exited.
      }
    }
  }
}

function stopActiveChildren(signal: NodeJS.Signals = 'SIGTERM'): void {
  for (const pid of activeChildPids) {
    signalChildProcess(pid, signal);
  }
}

function waitForActiveChildrenToExit(timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (activeChildPids.size === 0 || Date.now() - started >= timeoutMs) {
        resolve();
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopActiveChildrenAndWait(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  const pids = [...activeChildPids];
  if (pids.length === 0) return;

  for (const pid of pids) {
    signalChildProcess(pid, signal);
  }
  await delay(5000);
  for (const pid of pids) {
    signalChildProcess(pid, 'SIGKILL');
  }
  if (activeChildPids.size > 0) {
    await waitForActiveChildrenToExit(1000);
  }
}

function runChild(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    });
    if (p.pid) activeChildPids.add(p.pid);

    const done = (code: number) => {
      if (p.pid) activeChildPids.delete(p.pid);
      resolve(code);
    };

    p.on('close', (code) => done(code ?? 1));
    p.on('error', () => done(1));
  });
}

const OPERATIONAL_QUEUES: Array<{ name: string; file: string }> = [
  { name: 'preA', file: 'preA-queue.jsonl' },
  { name: 'postA', file: 'postA-queue.jsonl' },
  { name: 'preB', file: 'preB-queue.jsonl' },
  { name: 'postB', file: 'postB-queue.jsonl' },
  { name: 'postB-preC', file: 'postB-preC-queue.jsonl' },
  { name: 'postTestC-A', file: 'postTestC-A.jsonl' },
  { name: 'postTestC-B', file: 'postTestC-B.jsonl' },
  { name: 'postTestC-D', file: 'postTestC-D.jsonl' },
  { name: 'postTestC-UI', file: 'postTestC-UI.jsonl' },
  { name: 'postTestC-man', file: 'postTestC-manual-review.jsonl' },
  { name: 'postTestC-man1', file: 'postTestC-man1.jsonl' },
  { name: 'postTestC-serverdown', file: 'postTestC-serverdown.jsonl' },
  { name: 'postTestC-404', file: 'postTestC-404.jsonl' },
  { name: 'postTestC-error500', file: 'postTestC-error500.jsonl' },
  { name: 'postTestC-timeout', file: 'postTestC-timeout.jsonl' },
  { name: 'postTestC-blocked', file: 'postTestC-blocked.jsonl' },
  { name: 'postTestC-out', file: 'postTestC-out.jsonl' },
  { name: 'post10-UI', file: 'post10-UI.jsonl' },
  { name: 'post10-man', file: 'post10-man.jsonl' },
  { name: 'postD-UI', file: 'postD-UI.jsonl' },
  { name: 'postD-man1', file: 'postD-man1.jsonl' },
  { name: 'postD-man', file: 'postD-man.jsonl' },
  { name: 'post-man', file: 'post-man.jsonl' },
  { name: 'postTestC-Fail', file: 'postTestC-Fail.jsonl' },
  { name: 'preUI', file: 'preUI-queue.jsonl' },
  { name: 'EVENTPULSE-APP', file: 'EVENTPULSE-APP-queue.jsonl' },
];

const DISPLAY_ONLY_QUEUES: Array<{ name: string; file: string }> = [
  { name: 'Discovery-UI', file: 'discovery-ui-queue.jsonl' },
];

const QUEUES = [...OPERATIONAL_QUEUES, ...DISPLAY_ONLY_QUEUES];

export function getQueueNames(): string[] {
  return QUEUES.map((queue) => queue.name);
}

export function getOperationalQueueNames(): string[] {
  return OPERATIONAL_QUEUES.map((queue) => queue.name);
}

const PREUI_EVENT_QUEUE_NAMES = [
  'postA',
  'postB',
  'postTestC-UI',
  'post10-UI',
  'postD-UI',
  'preUI',
  'EVENTPULSE-APP',
];

const PREUI_EVENTS_SOURCE_QUEUE_NAMES = PREUI_EVENT_QUEUE_NAMES;

export function isPreUIEventsSourceQueue(queueName: string): boolean {
  return PREUI_EVENTS_SOURCE_QUEUE_NAMES.includes(queueName);
}

const UI_PROMOTE_SOURCE_QUEUE_NAMES = [
  'postA',
  'postB',
  'postTestC-UI',
  'post10-UI',
  'postD-UI',
  'preUI',
] as const;
const UI_PROMOTE_TARGET_QUEUE_NAME = 'EVENTPULSE-APP';

export function getUiPromoteMoveArgs(): string[][] {
  return UI_PROMOTE_SOURCE_QUEUE_NAMES.map((queueName) => [
    'move-all',
    queueName,
    UI_PROMOTE_TARGET_QUEUE_NAME,
  ]);
}

export function collectPreUIEventsSourceIds(
  rows: Array<{ queueName: string; sourceId?: string }>
): string[] {
  const sourceIds = new Set<string>();
  for (const row of rows) {
    if (row.sourceId && isPreUIEventsSourceQueue(row.queueName)) {
      sourceIds.add(String(row.sourceId));
    }
  }
  return [...sourceIds];
}

const TOOL_IDS = [
  '0', '1', '2', '3',
  '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18',
  'ca', 'cb', 'cc', 'cd', 'ce', 'cf', 'cg',
  'aa', 'ab', 'ex',
];

const TOOL_LABELS: Record<string, string> = {
  '0': 'Tool 0 — importRawSources',
  '1': 'Tool A — runA',
  '2': 'Tool B — runB-parallel',
  '3': 'Tool C — runC-one-time-only',
  '8': 'ScB shallow',
  '9': 'ScB medium',
  '10': 'ScB deep',
  '11': 'ScB diagnostic',
  '12': 'ScB 404-exa',
  '13': 'ScB 404-AI',
  '14': 'Tool D — JS render gate',
  '15': 'Tool D-AI — per-site AI+ScB',
  '16': 'Source URL dedupe (safe apply)',
  '17': 'Alltools-E2E real A→B→C→D (preA batch)',
  '18': 'Alltools-E2E töm preA (batch 10, tills tomt)',
  'ca': 'Tool C1 --no-c4',
  'cb': 'Tool C-AI deep discovery',
  'cc': 'Monsterkörning C + AI',
  'cd': 'Validate patterns',
  'ce': 'C4-AI Ollama reports',
  'cf': 'Ollama Qwen extraction',
  'cg': 'Minimax extraction',
  'aa': 'Tool A-A runA-extract',
  'ab': 'Tool A-B importToEventPulse',
  'ex': 'Expo Go',
};

function countQueue(file: string): number {
  const p = path.join(RUNTIME, file);
  if (!fs.existsSync(p)) return 0;
  try {
    const txt = fs.readFileSync(p, 'utf8');
    if (!txt.trim()) return 0;
    return txt.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function queueCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of QUEUES) out[q.name] = countQueue(q.file);
  return out;
}

interface DiscoveryUiQueueRow {
  sourceId: string;
  sourceCandidateId?: string;
  testRunId?: string;
  name?: string;
  url?: string;
  city?: string | null;
  promotedAt?: string;
  preferredPath?: string;
  evidenceSummary?: string;
  status?: string;
}

function loadDiscoveryUiRows(limit?: number): DiscoveryUiQueueRow[] {
  const p = path.join(RUNTIME, 'discovery-ui-queue.jsonl');
  if (!fs.existsSync(p)) return [];
  try {
    const rows = parseDiscoveryUiRows(fs.readFileSync(p, 'utf8'));
    return typeof limit === 'number' ? rows.slice(-limit).reverse() : rows;
  } catch {
    return [];
  }
}

export function parseDiscoveryUiRows(content: string): DiscoveryUiQueueRow[] {
  return content
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as DiscoveryUiQueueRow];
      } catch {
        return [];
      }
    });
}

export function formatDiscoveryUiRows(rows: DiscoveryUiQueueRow[]): string[] {
  if (rows.length === 0) return ['(ingen)'];
  const lines = ['sourceId              path     status               promotedAt'];
  for (const row of rows) {
    lines.push(
      `${String(row.sourceId ?? '').slice(0, 20).padEnd(20)}  ` +
      `${String(row.preferredPath ?? '').slice(0, 7).padEnd(7)}  ` +
      `${String(row.status ?? '').slice(0, 20).padEnd(20)} ` +
      `${String(row.promotedAt ?? '').slice(0, 24)}`
    );
  }
  return lines;
}

export function summarizeDiscoveryUiRows(rows: DiscoveryUiQueueRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = row.status || 'unknown';
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const lines = [`total ${rows.length}`];
  for (const [status, count] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    lines.push(`${status} ${count}`);
  }
  return lines;
}

/**
 * e2ePath: runtime-köer + extractedevents (verktyg 17/18 kör riktig A–D).
 */
const E2E_EVENTS_PATH_ORDER: Array<{ key: string; label: string }> = [
  { key: 'api-network', label: 'E2E api/network (A/B)' },
  { key: 'html', label: 'E2E html (C)' },
  { key: 'render', label: 'E2E render (D)' },
  { key: 'pending', label: 'pending' },
  { key: 'unset', label: 'unset / äldre kö' },
];

const EXTRACTED_ROOT = path.join(ROOT, '03-Queue', '03-extractedevents');

function lineCountJsonl(fpath: string): number {
  if (!fs.existsSync(fpath)) return 0;
  try {
    const txt = fs.readFileSync(fpath, 'utf8');
    return txt.split('\n').filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

function loadSidHome(): Map<string, string> {
  const m = new Map<string, string>();
  for (const q of OPERATIONAL_QUEUES) {
    const p = path.join(RUNTIME, q.file);
    if (!fs.existsSync(p)) continue;
    let txt = '';
    try {
      txt = fs.readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    for (const line of txt.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const o = JSON.parse(t) as { sourceId?: string };
        if (!o.sourceId) continue;
        const id = String(o.sourceId);
        if (!m.has(id)) m.set(id, q.name);
      } catch {
        // ignore
      }
    }
  }
  return m;
}

function loadPreUIEventsSourceIds(): string[] {
  const rows: Array<{ queueName: string; sourceId?: string }> = [];

  for (const q of OPERATIONAL_QUEUES) {
    const p = path.join(RUNTIME, q.file);
    if (!fs.existsSync(p)) continue;
    let txt = '';
    try {
      txt = fs.readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    for (const line of txt.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const o = JSON.parse(t) as { sourceId?: string };
        rows.push({ queueName: q.name, sourceId: o.sourceId });
      } catch {
        // ignore malformed queue rows
      }
    }
  }

  return collectPreUIEventsSourceIds(rows);
}

type ExtractedEventLike = {
  title?: unknown;
  name?: unknown;
  date?: unknown;
  startDate?: unknown;
  start_time?: unknown;
  startTime?: unknown;
  startsAt?: unknown;
  confidence?: { signals?: unknown };
};

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isActualExtractedEvent(row: ExtractedEventLike): boolean {
  const signals = Array.isArray(row.confidence?.signals)
    ? row.confidence.signals.map((x) => String(x).toLowerCase())
    : [];
  if (
    signals.some(
      (s) => s === 'synthetic' || s === 'synthesized' || s === 'dead_domain' || s === 'ai_notes_based'
    )
  ) {
    return false;
  }

  const hasTitle = hasText(row.title) || hasText(row.name);
  const hasDate =
    hasText(row.date) ||
    hasText(row.startDate) ||
    hasText(row.start_time) ||
    hasText(row.startTime) ||
    hasText(row.startsAt);
  return hasTitle && hasDate;
}

function actualEventCountJsonl(fpath: string): number {
  if (!fs.existsSync(fpath)) return 0;
  try {
    const txt = fs.readFileSync(fpath, 'utf8');
    let count = 0;
    for (const line of txt.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        if (isActualExtractedEvent(JSON.parse(t) as ExtractedEventLike)) count += 1;
      } catch {
        // Ignore malformed rows; they are not verified event evidence.
      }
    }
    return count;
  } catch {
    return 0;
  }
}

export function inferE2ePathFromEvidence(args: {
  home?: string;
  rootEvents: number;
  cEvents: number;
  dEvents: number;
}): string {
  const home = args.home ?? '';
  if (args.dEvents > 0) return 'render';
  if (args.cEvents > 0) return 'html';
  if (args.rootEvents > 0) {
    return 'api-network';
  }

  if (
    home === 'postB-preC' ||
    home === 'postTestC-D' ||
    home === 'postTestC-UI' ||
    home === 'postTestC-man1' ||
    home === 'post10-UI' ||
    home === 'post10-man' ||
    home === 'postD-UI' ||
    home === 'postD-man1' ||
    home === 'postD-man' ||
    home === 'postA' ||
    home === 'postB' ||
    home === 'preB' ||
    home === 'preA' ||
    home === 'preUI'
  )
    return 'pending';
  return 'unset';
}

function inferE2ePathFromRuntime(sid: string, home: string): string {
  return inferE2ePathFromEvidence({
    home,
    rootEvents: actualEventCountJsonl(path.join(EXTRACTED_ROOT, `${sid}.jsonl`)),
    cEvents: actualEventCountJsonl(path.join(EXTRACTED_ROOT, 'C', `${sid}.jsonl`)),
    dEvents: actualEventCountJsonl(path.join(EXTRACTED_ROOT, 'D', `${sid}.jsonl`)),
  });
}

function eventsFromExtractedFiles(sid: string): number {
  return (
    actualEventCountJsonl(path.join(EXTRACTED_ROOT, `${sid}.jsonl`)) +
    actualEventCountJsonl(path.join(EXTRACTED_ROOT, 'C', `${sid}.jsonl`)) +
    actualEventCountJsonl(path.join(EXTRACTED_ROOT, 'D', `${sid}.jsonl`))
  );
}

/**
 * Aggregerat per sourceId: runtime-kö (första träff i QUEUES-ordning) + extractedevents + preUI-rader.
 */
function loadPreUISources(): {
  sourceIds: string[];
  eventsById: Map<string, number>;
  e2ePathById: Map<string, string>;
} {
  const eventsById = new Map<string, number>();
  const e2ePathById = new Map<string, string>();
  const preUiSourceIds = new Set<string>();

  const pUi = path.join(RUNTIME, 'preUI-queue.jsonl');
  if (fs.existsSync(pUi)) {
    try {
      const txt = fs.readFileSync(pUi, 'utf8');
      for (const line of txt.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const o = JSON.parse(t) as {
            sourceId?: string;
          };
          if (!o.sourceId) continue;
          const id = String(o.sourceId);
          preUiSourceIds.add(id);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  const homes = loadSidHome();
  const allIds = new Set<string>([...homes.keys(), ...preUiSourceIds.keys()]);

  for (const id of allIds) {
    const home = homes.get(id);
    const evFile = eventsFromExtractedFiles(id);
    eventsById.set(id, evFile);
    if (home !== undefined) {
      e2ePathById.set(id, inferE2ePathFromRuntime(id, home));
    } else if (evFile > 0) {
      e2ePathById.set(
        id,
        inferE2ePathFromEvidence({ rootEvents: evFile, cEvents: 0, dEvents: 0 })
      );
    } else {
      e2ePathById.set(id, 'unset');
    }
  }

  return { sourceIds: [...eventsById.keys()], eventsById, e2ePathById };
}

/** Räknar e2eEventsPath från runtime + extraktioner (samma princip som db.py). */
function e2eEventsPathTable(): { rows: Array<{ label: string; count: number }>; total: number } {
  const counts: Record<string, number> = {};
  for (const { key } of E2E_EVENTS_PATH_ORDER) counts[key] = 0;
  const { sourceIds, e2ePathById } = loadPreUISources();
  const total = sourceIds.length;
  if (total === 0) {
    return { rows: E2E_EVENTS_PATH_ORDER.map(({ key, label }) => ({ label, count: 0 })), total: 0 };
  }
  for (const sourceId of sourceIds) {
    const bucket = e2ePathById.get(sourceId) ?? 'unset';
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return {
    rows: E2E_EVENTS_PATH_ORDER.map(({ key, label }) => ({ label, count: counts[key] ?? 0 })),
    total,
  };
}

/** Intervall för events per källa (preUI eventsFound). 0–1 egna; sedan enligt önskemål. */
const PREUI_EVENT_BUCKETS: Array<{ min: number; max: number; label: string }> = [
  { min: 0, max: 0, label: '0 events' },
  { min: 1, max: 1, label: '1 event' },
  { min: 2, max: 5, label: '2-5 events' },
  { min: 6, max: 10, label: '6-10 events' },
  { min: 11, max: 20, label: '11-20 events' },
  { min: 21, max: 30, label: '21-30 events' },
  { min: 31, max: 100, label: '31-100 events' },
  { min: 101, max: 200, label: '101-200 events' },
  { min: 201, max: 500, label: '201-500 events' },
  { min: 501, max: 2000, label: '501-2000 events' },
  { min: 2001, max: Number.MAX_SAFE_INTEGER, label: '2001+ events' },
];

function bucketIndexForPreUIEvents(ev: number): number {
  const n = Math.max(0, Math.floor(ev));
  for (let i = 0; i < PREUI_EVENT_BUCKETS.length; i++) {
    const b = PREUI_EVENT_BUCKETS[i];
    if (n >= b.min && n <= b.max) return i;
  }
  return PREUI_EVENT_BUCKETS.length - 1;
}

/** Histogram över events för UI-klara köer; aggregerat i intervall. */
function eventsPerSourceHistogram(): Array<{ rangeLabel: string; sources: number }> {
  const { eventsById } = loadPreUISources();
  const sourceIds = loadPreUIEventsSourceIds();
  const counts = new Array(PREUI_EVENT_BUCKETS.length).fill(0);
  for (const id of sourceIds) {
    const ev = eventsById.get(id) ?? 0;
    counts[bucketIndexForPreUIEvents(ev)]++;
  }
  const out: Array<{ rangeLabel: string; sources: number }> = [];
  for (let i = 0; i < PREUI_EVENT_BUCKETS.length; i++) {
    if (counts[i] > 0) {
      out.push({ rangeLabel: PREUI_EVENT_BUCKETS[i].label, sources: counts[i] });
    }
  }
  return out;
}

export function formatHorizontalQueueCountTable(
  queueNames: string[],
  counts: Record<string, number>
): string[] {
  const colWidths = queueNames.map((name) => Math.max(name.length, String(counts[name] ?? 0).length));
  const header = queueNames.map((name, i) => name.padStart(colWidths[i])).join('  ');
  const values = queueNames
    .map((name, i) => String(counts[name] ?? 0).padStart(colWidths[i]))
    .join('  ');
  return [header, values];
}

function duplicateStats(): {
  duplicateSourceIds: number;
  duplicateExtraRows: number;
  details: Array<{ sourceId: string; queues: string[] }>;
} {
  const loc = new Map<string, Set<string>>();
  let totalRows = 0;

  for (const q of OPERATIONAL_QUEUES) {
    const p = path.join(RUNTIME, q.file);
    if (!fs.existsSync(p)) continue;
    let txt = '';
    try {
      txt = fs.readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    for (const line of txt.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      totalRows += 1;
      try {
        const obj = JSON.parse(trimmed) as { sourceId?: string };
        const sid = obj?.sourceId;
        if (!sid) continue;
        if (!loc.has(sid)) loc.set(sid, new Set());
        loc.get(sid)!.add(q.name);
      } catch {
        // ignore malformed row
      }
    }
  }

  const details: Array<{ sourceId: string; queues: string[] }> = [];
  for (const [sourceId, queues] of loc.entries()) {
    if (queues.size > 1) details.push({ sourceId, queues: Array.from(queues).sort() });
  }
  details.sort((a, b) => a.sourceId.localeCompare(b.sourceId));

  const uniqueIds = loc.size;
  return {
    duplicateSourceIds: details.length,
    duplicateExtraRows: Math.max(0, totalRows - uniqueIds),
    details,
  };
}

function duplicateSourceUrlStats(): {
  duplicateUrlGroups: number;
  redundantSourcesByUrl: number;
  details: Array<{ url: string; sourceIds: string[] }>;
} {
  const sourcesDir = path.join(ROOT, 'sources');
  if (!fs.existsSync(sourcesDir)) {
    return { duplicateUrlGroups: 0, redundantSourcesByUrl: 0, details: [] };
  }

  const byUrl = new Map<string, string[]>();
  let sourceFiles: string[] = [];
  try {
    sourceFiles = fs.readdirSync(sourcesDir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return { duplicateUrlGroups: 0, redundantSourcesByUrl: 0, details: [] };
  }

  for (const fileName of sourceFiles) {
    const filePath = path.join(sourcesDir, fileName);
    let txt = '';
    try {
      txt = fs.readFileSync(filePath, 'utf8').trim();
    } catch {
      continue;
    }
    if (!txt) continue;

    try {
      const obj = JSON.parse(txt) as { id?: string; url?: string };
      const sourceId = String(obj?.id || fileName.replace(/\.jsonl$/i, '')).trim();
      const url = String(obj?.url || '').trim();
      if (!sourceId || !url) continue;
      if (!byUrl.has(url)) byUrl.set(url, []);
      byUrl.get(url)!.push(sourceId);
    } catch {
      // ignore malformed source file
    }
  }

  const details: Array<{ url: string; sourceIds: string[] }> = [];
  for (const [url, sourceIds] of byUrl.entries()) {
    if (sourceIds.length > 1) {
      details.push({ url, sourceIds: [...sourceIds].sort() });
    }
  }
  details.sort((a, b) => a.url.localeCompare(b.url));

  const redundantSourcesByUrl = details.reduce((acc, d) => acc + (d.sourceIds.length - 1), 0);
  return {
    duplicateUrlGroups: details.length,
    redundantSourcesByUrl,
    details,
  };
}

/** Rader i Alltools-E2E/runtime/queues/*.jsonl (isolerad orkestrator, ej legacy runtime/). */
function e2eSandboxQueueRows(): number {
  const dir = path.join(ROOT, 'Alltools-E2E', 'runtime', 'queues');
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(dir, f);
      try {
        const txt = fs.readFileSync(p, 'utf8');
        n += txt.split('\n').filter((line) => line.trim()).length;
      } catch {
        // ignore
      }
    }
  } catch {
    return 0;
  }
  return n;
}

function countFailFromReports(): number {
  const reportDir = path.join(ROOT, '02-Ingestion', 'C-htmlGate', 'reports');
  if (!fs.existsSync(reportDir)) return 0;
  try {
    const files = fs
      .readdirSync(reportDir)
      .filter((f) => f.startsWith('batch-state') && f.endsWith('.jsonl'));
    let total = 0;
    for (const f of files) {
      const p = path.join(reportDir, f);
      const txt = fs.readFileSync(p, 'utf8').trim();
      if (!txt) continue;
      const lines = txt.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          if (obj?.report && typeof obj.report === 'object' && (obj.report as any).failedHard) {
            total += Number((obj.report as any).failedHard) || 0;
          }
        } catch {
          // ignore malformed rows
        }
      }
    }
    return total;
  } catch {
    return 0;
  }
}

function render() {
  const redIfPositive = (n: number): string => {
    const text = String(n);
    return n > 0 ? `\x1b[31m${text}\x1b[0m` : text;
  };

  const now = new Date().toLocaleTimeString('sv-SE');
  const counts = queueCounts();
  counts['postTestC-Fail'] = countFailFromReports();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const dup = duplicateStats();
  const dupUrl = duplicateSourceUrlStats();
  const preUI = counts['preUI'] ?? 0;
  const totalFail =
    (counts['postTestC-man'] ?? 0) +
    (counts['postTestC-man1'] ?? 0) +
    (counts['postD-man1'] ?? 0) +
    (counts['postD-man'] ?? 0) +
    (counts['post-man'] ?? 0);
  const conversion = total > 0 ? (preUI / total) * 100 : 0;
  const failRate = total > 0 ? (totalFail / total) * 100 : 0;
  const stuck =
    (counts['postB-preC'] ?? 0) +
    (counts['postTestC-man'] ?? 0) +
    (counts['postTestC-man1'] ?? 0);

  process.stdout.write('\x1b[2J\x1b[H');
  console.log(`EventPulse Live Dashboard (TS)  ${now}`);

  const e2ePathTbl = e2eEventsPathTable();
  const evHist = eventsPerSourceHistogram();

  const QUEUE_W = 36;
  const TOOLS_W = 38;
  const TABLE_W = 72;
  const SEP = ' | ';
  const TOTAL_W = QUEUE_W + SEP.length + TOOLS_W + SEP.length + TABLE_W;

  const leftLines: string[] = [];
  for (const q of QUEUES) {
    const c = counts[q.name] ?? 0;
    const mark = c > 0 ? '◀' : ' ';
    leftLines.push(`${q.name.padEnd(22)}${String(c).padStart(5)} ${mark}`);
  }

  const toolLines: string[] = [];
  toolLines.push('Verktyg (legacy):');
  for (const id of TOOL_IDS) {
    const label = TOOL_LABELS[id] || '';
    toolLines.push(`${id.padStart(2)}  ${label}`);
  }
  toolLines.push('');
  toolLines.push('Alltools-E2E:');
  toolLines.push(`17 / e2e [n]  (sb ${e2eSandboxQueueRows()})`);
  toolLines.push('18  töm preA (batch)');
  toolLines.push('');
  toolLines.push('Flytt:');
  toolLines.push('m <f> <t>  move-all');
  toolLines.push('a [from]   status/preA');
  toolLines.push('M          allt → preA');
  toolLines.push('UI         UI-klara → EVENTPULSE-APP');

  const lblW = 24;
  const tableLines: string[] = [];
    tableLines.push('runtime · e2ePath');
  tableLines.push('─'.repeat(Math.min(TABLE_W, 44)));
  for (const r of e2ePathTbl.rows) {
    const lbl = r.label.slice(0, lblW).padEnd(lblW);
    tableLines.push(`${lbl} ${String(r.count).padStart(4)}`);
  }
  tableLines.push(`${'TOTAL'.padEnd(lblW)} ${String(e2ePathTbl.total).padStart(4)}`);
  tableLines.push('');
  tableLines.push('preUI · events');
  tableLines.push('─'.repeat(Math.min(TABLE_W, 44)));
  if (evHist.length === 0) {
    tableLines.push('(ingen)');
  } else {
    for (const h of evHist) {
      const maxR = Math.max(8, TABLE_W - 6);
      tableLines.push(`${String(h.sources).padStart(4)}× ${h.rangeLabel.slice(0, maxR)}`);
    }
  }
  tableLines.push('');
  tableLines.push('preUI · kökällor');
  tableLines.push('─'.repeat(Math.min(TABLE_W, 72)));
  tableLines.push(...formatHorizontalQueueCountTable(PREUI_EVENT_QUEUE_NAMES, counts));
  tableLines.push('');
  tableLines.push('Discovery-UI · promoted sources');
  tableLines.push('─'.repeat(Math.min(TABLE_W, 72)));
  const discoveryUiRows = loadDiscoveryUiRows();
  const recentDiscoveryUiRows = loadDiscoveryUiRows(5);
  tableLines.push(...summarizeDiscoveryUiRows(discoveryUiRows));
  tableLines.push(...formatDiscoveryUiRows(recentDiscoveryUiRows));

  const mainRows = Math.max(leftLines.length, toolLines.length, tableLines.length);
  console.log('='.repeat(TOTAL_W));
  console.log(
    `${'Köer'.padEnd(QUEUE_W)}${SEP}${'Verktyg + flytt'.padEnd(TOOLS_W)}${SEP}${'preUI (tabeller)'.padEnd(TABLE_W)}`
  );
  console.log('-'.repeat(TOTAL_W));
  for (let i = 0; i < mainRows; i++) {
    const a = (leftLines[i] || '').slice(0, QUEUE_W).padEnd(QUEUE_W);
    const b = (toolLines[i] || '').slice(0, TOOLS_W).padEnd(TOOLS_W);
    const c = (tableLines[i] || '').slice(0, TABLE_W).padEnd(TABLE_W);
    console.log(`${a}${SEP}${b}${SEP}${c}`);
  }
  console.log('-'.repeat(TOTAL_W));
  console.log(`Total (visade köer): ${total}`);
  console.log(
    `KPI: conversion->preUI ${conversion.toFixed(1)}% | fail-rate ${failRate.toFixed(1)}% | stuck ${stuck}`
  );
  console.log(
    `Dubletter: sourceIds=${redIfPositive(dup.duplicateSourceIds)} | extraRows=${redIfPositive(dup.duplicateExtraRows)} | urlGroups=${redIfPositive(dupUrl.duplicateUrlGroups)} | urlExtra=${redIfPositive(dupUrl.redundantSourcesByUrl)}`
  );
  console.log(`Alltools-E2E sandbox (runtime/queues): ${e2eSandboxQueueRows()} rader`);
  console.log('');
  console.log(
    'Commands: help | tools | dupes | refresh | r | run <id> | 17 | 18 | e2e [n] | e2e-run | UI | m <f> <t> | a [from] | M | quit'
  );
}

const E2E_BATCH_CAP = 10;

function runAlltoolsE2eFromPreA(limit: number): Promise<number> {
  const args = [
    path.join('Alltools-E2E', 'e2e.py'),
    '--limit',
    String(limit),
    '--apply',
    '--sync-legacy',
    '--from-preA',
  ];
  console.log(`\nAlltools-E2E (preA): python3 ${args.join(' ')}`);
  return runChild('python3', args);
}

/** Verktyg 18: töm preA i batchar; render() efter varje lyckad batch (köetal uppdaterat). */
async function runTool18DrainPrea(): Promise<number> {
  let batchNo = 0;
  while (true) {
    const n = countQueue('preA-queue.jsonl');
    if (n === 0) {
      console.log('\n[E2E-18] preA är tom — alla batchar klara.');
      return 0;
    }
    const lim = Math.min(E2E_BATCH_CAP, n);
    batchNo += 1;
    console.log(`\n[E2E-18] ─── Batch ${batchNo} ─── preA kvar: ${n} → limit=${lim}`);
    const rc = await runAlltoolsE2eFromPreA(lim);
    if (rc !== 0) {
      console.log(`\n[E2E-18] Batch ${batchNo} misslyckades (exit ${rc}). Stoppar.`);
      return rc;
    }
    const left = countQueue('preA-queue.jsonl');
    console.log(`\n  📊 Live-dashboard uppdaterad efter batch ${batchNo} (preA kvar: ${left})`);
    render();
  }
}

function runTool(toolId: string): Promise<number> {
  if (!TOOL_IDS.includes(toolId)) {
    console.log(`Unknown tool id: ${toolId}`);
    return Promise.resolve(1);
  }
  if (toolId === '18') {
    return runTool18DrainPrea();
  }
  console.log(`\nRunning tool ${toolId} via db.py dispatch...`);
  const py = `import db; raise SystemExit(db.run_tool_by_id('${toolId}'))`;
  return runChild('python3', ['-c', py]);
}

function runAlltoolsE2e(limit: number, apply: boolean, syncLegacy: boolean): Promise<number> {
  const args = [
    path.join('Alltools-E2E', 'e2e.py'),
    '--limit',
    String(limit),
    '--from-preA',
  ];
  if (apply) {
    args.push('--apply');
    if (syncLegacy) args.push('--sync-legacy');
  }
  console.log(`\nAlltools-E2E: python3 ${args.join(' ')}`);
  return runChild('python3', args);
}

function runQueueMem(args: string[]): Promise<number> {
  return runChild('python3', ['queue-mem.py', ...args]);
}

async function runUiPromoteToEventPulseApp(): Promise<number> {
  let finalCode = 0;
  for (const args of getUiPromoteMoveArgs()) {
    const rc = await runQueueMem(args);
    if (rc !== 0) finalCode = rc;
  }
  return finalCode;
}

async function main() {
  let running = true;
  let paused = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    running = false;
    if (timer) clearInterval(timer);
    rl.close();
    await stopActiveChildrenAndWait(signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  const startRenderLoop = () => {
    if (timer) clearInterval(timer);
    render();
    timer = setInterval(() => {
      if (!paused) render();
    }, 10000);
  };

  const ask = (prompt: string) =>
    new Promise<string>((resolve) => rl.question(prompt, resolve));

  startRenderLoop();

  while (running) {
    const raw = (await ask('\nVal> ')).trim();

    if (!raw) continue;
    const [cmd, ...rest] = raw.split(/\s+/);
    const arg = rest.join(' ');

    if (cmd === 'quit' || cmd === 'q' || cmd === 'exit') {
      running = false;
    } else if (TOOL_IDS.includes(cmd)) {
      paused = true;
      await runTool(cmd);
      paused = false;
    } else if (cmd === 'help') {
      console.log('\nhelp          show commands');
      console.log('tools         show supported tool ids');
      console.log('refresh / r      redraw now');
      console.log('dupes            list duplicate sourceIds across queues');
      console.log('run <id>         run via db.py run_tool_by_id');
      console.log('17               Alltools-E2E (tool 17)');
      console.log('18               töm preA — render efter varje batch (pausar auto-refresh under körning)');
      console.log('e2e [n]          Alltools-E2E --from-preA --apply (default n=10)');
      console.log('e2e [n] nosync   same without --sync-legacy flag (no-op for real pipeline)');
      console.log('e2e-run          same as e2e');
      console.log('e2e dry [n]      dry run (no --apply)');
      console.log('legacy-run <id>  alias for run');
      console.log('lr <id>          short alias');
      console.log('UI               flytta postA/postB/postTestC-UI/post10-UI/postD-UI/preUI → EVENTPULSE-APP');
      console.log('m <f> <t>        move all sources from queue f to queue t');
      console.log('a                run queue-mem status (auto-dedup)');
      console.log('a <f>            move all sources from queue f to preA');
      console.log('M                move all queues to preA');
      console.log('quit          exit dashboard');
    } else if (cmd === 'dupes') {
      const dup = duplicateStats();
      const dupUrl = duplicateSourceUrlStats();
      if (dup.duplicateSourceIds === 0 && dupUrl.duplicateUrlGroups === 0) {
        console.log('\nNo queue sourceId duplicates or source URL duplicates found.');
      } else {
        console.log(`\nDuplicate sourceIds across queues: ${dup.duplicateSourceIds} (extraRows=${dup.duplicateExtraRows})`);
        for (const d of dup.details.slice(0, 50)) {
          console.log(`- ${d.sourceId}: ${d.queues.join(', ')}`);
        }
        if (dup.details.length > 50) {
          console.log(`... and ${dup.details.length - 50} more sourceId duplicates`);
        }

        console.log(`\nDuplicate source URLs in sources/: ${dupUrl.duplicateUrlGroups} (urlExtra=${dupUrl.redundantSourcesByUrl})`);
        for (const d of dupUrl.details.slice(0, 50)) {
          console.log(`- ${d.url} => ${d.sourceIds.join(', ')}`);
        }
        if (dupUrl.details.length > 50) {
          console.log(`... and ${dupUrl.details.length - 50} more URL duplicate groups`);
        }
      }
    } else if (cmd === 'tools') {
      console.log('\nTool ids:');
      for (const id of TOOL_IDS) {
        const label = TOOL_LABELS[id] || '';
        console.log(`${id.padStart(2)}  ${label}`);
      }
    } else if (cmd === 'refresh' || cmd === 'r') {
      render();
    } else if (cmd === 'move-all' || cmd === 'm') {
      const parts = arg.trim().split(/\s+/).filter(Boolean);
      if (parts.length !== 2) {
        console.log('Usage: m <fromQueue> <toQueue>');
      } else {
        paused = true;
        await runQueueMem(['move-all', parts[0], parts[1]]);
        paused = false;
      }
    } else if (cmd === 'UI' || cmd === 'ui') {
      paused = true;
      const fromQueues = UI_PROMOTE_SOURCE_QUEUE_NAMES.join(', ');
      const confirm = (
        await ask(`Bekräfta flytta ${fromQueues} → ${UI_PROMOTE_TARGET_QUEUE_NAME}? (yes/no): `)
      )
        .trim()
        .toLowerCase();
      if (confirm === 'yes' || confirm === 'y') {
        await runUiPromoteToEventPulseApp();
      } else {
        console.log('Avbrutet.');
      }
      paused = false;
    } else if (cmd === 'M') {
      paused = true;
      const confirm = (await ask('Bekräfta flytta ALLT till preA? (yes/no): ')).trim().toLowerCase();
      if (confirm === 'yes' || confirm === 'y') {
        for (const q of OPERATIONAL_QUEUES) {
          if (q.name === 'preA') continue;
          await runQueueMem(['move-all', q.name, 'preA']);
        }
      } else {
        console.log('Avbrutet.');
      }
      paused = false;
    } else if (cmd === 'toprea' || cmd === 'a') {
      const fromQ = arg.trim();
      if (!fromQ) {
        paused = true;
        await runQueueMem(['status']);
        paused = false;
      } else {
        paused = true;
        await runQueueMem(['move-all', fromQ, 'preA']);
        paused = false;
      }
    } else if (cmd === 'e2e' || cmd === 'e2e-run') {
      const parts = arg.trim().split(/\s+/).filter(Boolean);
      let limit = 10;
      let apply = true;
      let syncLegacy = true;
      const tokens = parts.filter((t) => t !== 'nosync');
      if (parts.includes('nosync')) syncLegacy = false;
      if (tokens[0] === 'dry') {
        apply = false;
        if (tokens[1] && /^\d+$/.test(tokens[1])) limit = parseInt(tokens[1], 10);
      } else if (tokens[0] && /^\d+$/.test(tokens[0])) {
        limit = parseInt(tokens[0], 10);
      }
      paused = true;
      await runAlltoolsE2e(limit, apply, apply && syncLegacy);
      paused = false;
    } else if (cmd === 'run' || cmd === 'legacy-run' || cmd === 'lr') {
      let toolArg = arg.trim();
      if (!toolArg) {
        console.log('Usage: run <id>  (or legacy-run <id> / lr <id>)');
      } else {
        // Be tolerant if user types: legacy-run legacy-run <id>
        if (toolArg.toLowerCase().startsWith('legacy-run ')) {
          const parts = toolArg.split(/\s+/, 2);
          toolArg = (parts[1] || '').trim();
        }
        paused = true;
        await runTool(toolArg);
        paused = false;
      }
    } else {
      console.log(`Unknown command: ${cmd}`);
    }
  }

  if (timer) clearInterval(timer);
  rl.close();
  console.log('Bye.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

