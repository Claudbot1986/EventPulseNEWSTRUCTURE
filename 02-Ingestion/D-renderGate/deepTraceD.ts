import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { getSource } from '../tools/sourceRegistry';
import { extractFromHtml } from '../F-eventExtraction/universal-extractor';
import { renderPage } from './renderGate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNTIME_DIR = path.resolve(__dirname, '../../runtime');
const LOGS_DIR = path.resolve(RUNTIME_DIR, 'logs');
const INPUT_FILE = path.resolve(RUNTIME_DIR, 'postD-man.jsonl');
const REPORT_FILE = path.resolve(LOGS_DIR, `deeptrace-d-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const SOURCE_TIMEOUT_MS = 90000;

interface QueueEntry {
  sourceId: string;
  queueReason?: string;
}

function readQueue(): QueueEntry[] {
  if (!existsSync(INPUT_FILE)) return [];
  return readFileSync(INPUT_FILE, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l) as QueueEntry);
}

function discoverLinks(html: string, baseUrl: string, maxLinks = 20): string[] {
  const links = new Set<string>();
  const base = new URL(baseUrl);
  const hrefRe = /href=["']([^"'#]+)["']/gi;
  const includeRe = /(event|events|evenemang|kalender|program|schema|biljett|ticket|show|visit|whatson|happening|aktuellt)/i;
  const assetRe = /\.(css|js|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|eot|map|pdf|xml|txt|zip)$/i;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const href = m[1]?.trim();
    if (!href) continue;
    let abs = '';
    try {
      abs = new URL(href, baseUrl).toString();
      const u = new URL(abs);
      const hA = u.host.toLowerCase().replace(/^www\./, '');
      const hB = base.host.toLowerCase().replace(/^www\./, '');
      if (!(hA === hB || hA.endsWith(`.${hB}`) || hB.endsWith(`.${hA}`))) continue;
      if (assetRe.test(u.pathname)) continue;
      if (u.pathname.includes('/_next/static') || u.pathname.includes('/sitevision/system-resource')) continue;
    } catch {
      continue;
    }
    if (!includeRe.test(abs)) continue;
    links.add(abs);
    if (links.size >= maxLinks) break;
  }
  return Array.from(links);
}

async function traceOne(sourceId: string) {
  const source = getSource(sourceId);
  if (!source) {
    return { sourceId, status: 'missing-source' };
  }

  const root = await renderPage(source.url, { timeout: 30000 });
  if (!root.success || !root.html) {
    return {
      sourceId,
      status: 'render-fail',
      url: source.url,
      error: root.error || 'render failed',
    };
  }

  const rootExtract = extractFromHtml(root.html, sourceId, source.url);
  const rootEvents = rootExtract.events || [];
  const links = discoverLinks(root.html, source.url, 20);

  const linkDiagnostics: Array<{
    url: string;
    events: number;
    methodsUsed?: string[];
    methodBreakdown?: Record<string, number>;
    renderOk: boolean;
    error?: string;
  }> = [];
  let bestEvents = rootEvents.length;
  let bestUrl = source.url;
  for (const url of links.slice(0, 8)) {
    // eslint-disable-next-line no-await-in-loop
    const rr = await renderPage(url, { timeout: 25000 });
    if (!rr.success || !rr.html) {
      linkDiagnostics.push({ url, events: 0, renderOk: false, error: rr.error || 'render failed' });
      continue;
    }
    const extracted = extractFromHtml(rr.html, sourceId, url);
    const events = extracted.events?.length || 0;
    linkDiagnostics.push({
      url,
      events,
      methodsUsed: extracted.methodsUsed,
      methodBreakdown: extracted.methodBreakdown,
      renderOk: true,
    });
    if (events > bestEvents) {
      bestEvents = events;
      bestUrl = url;
    }
  }

  let diagnosis = 'unknown';
  let rootCause = 'unknown';
  if (links.length === 0) diagnosis = 'discovery-gap-no-candidates';
  else if (bestEvents === 0) diagnosis = 'extraction-gap-candidates-but-zero';
  else if (bestEvents === 1) diagnosis = 'low-yield-one-event';
  else diagnosis = 'recoverable-with-subpage-targeting';
  if (diagnosis === 'discovery-gap-no-candidates') {
    rootCause = 'No internal event-like links survived discovery filters from rendered root HTML.';
  } else if (diagnosis === 'extraction-gap-candidates-but-zero') {
    rootCause = 'Candidate pages rendered, but extractor found no valid event objects (missing or unmatched event structure).';
  } else if (diagnosis === 'low-yield-one-event') {
    rootCause = 'At least one event detected, but source yields only one extractable event.';
  } else if (diagnosis === 'recoverable-with-subpage-targeting') {
    rootCause = 'Events exist on subpage; discovery/ranking can promote this source to success path.';
  }

  return {
    sourceId,
    status: 'ok',
    url: source.url,
    rootEvents: rootEvents.length,
    rootMethodsUsed: rootExtract.methodsUsed,
    rootMethodBreakdown: rootExtract.methodBreakdown,
    candidateLinks: links.length,
    sampledLinks: linkDiagnostics.length,
    bestEvents,
    bestUrl,
    diagnosis,
    rootCause,
    linkDiagnostics,
  };
}

async function main() {
  mkdirSync(LOGS_DIR, { recursive: true });
  const entries = readQueue();
  const target = entries
    .filter(e => (e.queueReason || '').includes('no events found after JS rendering'))
    .map(e => e.sourceId);
  const unique = [...new Set(target)];
  const results = [];
  for (const sourceId of unique) {
    console.log(`Tracing ${sourceId}...`);
    const traced = await Promise.race([
      traceOne(sourceId),
      new Promise(resolve =>
        setTimeout(
          () =>
            resolve({
              sourceId,
              status: 'trace-timeout',
              diagnosis: 'trace-timeout',
              error: `source timeout after ${SOURCE_TIMEOUT_MS}ms`,
            }),
          SOURCE_TIMEOUT_MS
        )
      ),
    ]);
    results.push(traced);
    console.log(`Done ${sourceId}: ${(traced as any).diagnosis || (traced as any).status}`);
  }
  const summary = {
    ts: new Date().toISOString(),
    totalCandidates: unique.length,
    results,
  };
  writeFileSync(REPORT_FILE, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`Deep trace complete: ${REPORT_FILE}`);
  const grouped: Record<string, number> = {};
  for (const r of results as any[]) {
    const k = r.diagnosis || r.status || 'unknown';
    grouped[k] = (grouped[k] || 0) + 1;
  }
  console.log('Diagnosis summary:', grouped);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
