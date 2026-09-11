/**
 * 02-Ingestion/I-pdfExtraction/pdfExtractor.ts
 *
 * P2A (2026-09-10): PDF/affisch-extraktion för källor som publicerar
 * evenemang som PDF-bilagor (KB, Riksarkivet, lokala kulturföreningar).
 *
 * Strategi:
 *   1. Hämta PDF via fetch (ingen Scrapingbee — billigt, ingen JS-render behövs).
 *   2. Parsa med pdf-parse → raw text.
 *   3. Kör universal-extractor på texten (wrap:ad som HTML för att åter-
 *      använda itemprop/JSON-LD-vägen om PDF:n är HTML-baserad).
 *   4. Skicka events till postTestC-UI (eller D-gate om vi behöver AI-assist).
 *
 * Relation till ingestion:
 *   - Source registry: pdfExtractor söker `sources/*.jsonl` med
 *     `pdfUrls`-array (eller fallback: en `pdfUrl` per källa).
 *   - Output skrivs till samma events-tabell som C/D-gate → ingen separat
 *     kö behövs; postTestC-UI-kön processas av befintlig pipeline.
 *
 * Säkerhet:
 *   - Vi laddar bara PDFer från kända källor (sources-registry).
 *   - Max 5 MB per PDF (förhindrar OOM).
 *   - Text-extrahering är sandboxad i pdf-parse; vi skickar inte user-data.
 *
 * Usage:
 *   npx tsx 02-Ingestion/I-pdfExtraction/pdfExtractor.ts --limit 20 --concurrency 3
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractEvents } from '../F-eventExtraction/universal-extractor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SOURCES_DIR = path.join(PROJECT_ROOT, 'sources');
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'runtime');
const QUEUES_DIR = path.join(RUNTIME_DIR, 'postTestC-UI.jsonl');

// ─── Types ─────────────────────────────────────────────────────────────────

interface SourcePdfEntry {
  sourceId: string;
  url: string;
  pdfUrls: string[];
}

interface ExtractionResult {
  sourceId: string;
  pdfUrls: string[];
  pdfsProcessed: number;
  eventsFound: number;
  firstError: string | null;
}

interface PdfExtractionResult {
  totalSources: number;
  totalPdfs: number;
  totalEvents: number;
  results: ExtractionResult[];
  firstError: string | null;
}

// ─── Source registry helpers ───────────────────────────────────────────────

function loadSourcesWithPdfs(): SourcePdfEntry[] {
  if (!existsSync(SOURCES_DIR)) return [];
  const sources: SourcePdfEntry[] = [];
  for (const file of readdirSync(SOURCES_DIR)) {
    if (!file.endsWith('.jsonl')) continue;
    const full = path.join(SOURCES_DIR, file);
    try {
      const content = readFileSync(full, 'utf8').trim();
      if (!content) continue;
      const data = JSON.parse(content) as Record<string, unknown>;
      const sourceId = data.id || file.replace(/\.jsonl$/, '');
      const url = typeof data.url === 'string' ? data.url : '';
      const pdfUrls: string[] = [];
      if (Array.isArray(data.pdfUrls)) {
        for (const u of data.pdfUrls) {
          if (typeof u === 'string') pdfUrls.push(u);
        }
      } else if (typeof data.pdfUrl === 'string') {
        pdfUrls.push(data.pdfUrl);
      } else if (typeof data.programPdf === 'string') {
        pdfUrls.push(data.programPdf);
      }
      if (pdfUrls.length > 0 && url) {
        sources.push({ sourceId, url, pdfUrls });
      }
    } catch {
      /* skip malformed sources */
    }
  }
  return sources;
}

// ─── PDF fetch + parse ────────────────────────────────────────────────────

const MAX_PDF_BYTES = 5 * 1024 * 1024; // 5 MB
const FETCH_TIMEOUT_MS = 15_000;

async function fetchPdf(url: string): Promise<{ buf: Buffer | null; oversized: boolean; status: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'EventPulse/1.0 (PDF-extractor; Stockholm events)' },
    });
    if (!res.ok) {
      // 404/410 = URL permanently gone → tyst skip (loggas som warning, inte error).
      // Andra fel (5xx, timeout) = tillfälligt → rapporteras som firstError så
      // cron kan upptäcka och stanna.
      if (res.status === 404 || res.status === 410) {
        console.warn(`[pdfExtractor] ${url} gone (HTTP ${res.status}) — skipping`);
        return { buf: null, oversized: false, status: res.status };
      }
      return { buf: null, oversized: false, status: res.status };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_PDF_BYTES) {
      console.warn(`[pdfExtractor] ${url} skipped: ${buf.length} bytes > ${MAX_PDF_BYTES} limit`);
      return { buf: null, oversized: true, status: 200 };
    }
    return { buf, oversized: false, status: 200 };
  } catch {
    return { buf: null, oversized: false, status: null };
  } finally {
    clearTimeout(timer);
  }
}

async function extractPdfText(buf: Buffer): Promise<string> {
  // Lazy-load pdf-parse (den läser test-filer vid import som kan vara trasigt
  // utan en default-test-PDF, så vi importerar inuti funktionen).
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(buf);
  return data.text || '';
}

// ─── Universal extractor bridge ────────────────────────────────────────────

function textToHtml(text: string, sourceUrl: string): string {
  // Wrappar PDF-text i en minimal HTML-struktur så universal-extractor kan
  // köra sin HTML-heuristik. Vi splittar inte vid radbrytningar eftersom
  // PDF:er ofta har udda whitespace.
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="sv">
<head><meta property="og:url" content="${sourceUrl}" /></head>
<body><pre>${escaped}</pre></body>
</html>`;
}

// ─── Per-source processing ────────────────────────────────────────────────

async function processSource(
  source: SourcePdfEntry,
  concurrency: number,
): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    sourceId: source.sourceId,
    pdfUrls: source.pdfUrls,
    pdfsProcessed: 0,
    eventsFound: 0,
    firstError: null,
  };

  // Hämta alla PDF:er parallellt (med hård concurrency-cap)
  const queue = [...source.pdfUrls];
  let idx = 0;

  async function worker(): Promise<void> {
    while (true) {
      const myIdx = idx++;
      if (myIdx >= queue.length) break;
      const pdfUrl = queue[myIdx];
      try {
        const { buf, oversized, status } = await fetchPdf(pdfUrl);
        if (!buf) {
          // Oversized är tyst skip (inte ett fel); 404/410 (gone) är också
          // tyst skip. Övrigt null = transient fetch-fel → rapporteras som
          // firstError så cron kan upptäcka.
          const isPermanentGone = status === 404 || status === 410;
          if (!oversized && !isPermanentGone && !result.firstError) {
            result.firstError = `fetch failed (HTTP ${status ?? 'unknown'}): ${pdfUrl}`;
          }
          continue;
        }
        const text = await extractPdfText(buf);
        if (!text.trim()) continue; // tom PDF räknas inte som processad

        // Kör universal-extractor på text wrapped as HTML
        const html = textToHtml(text, pdfUrl);
        const extracted = extractEvents(html, source.sourceId, source.url);
        result.eventsFound += extracted.events.length;
        result.pdfsProcessed++;

        // Skriv events till postTestC-UI-kön (befintlig pipeline tar hand om dem)
        appendEventsToQueue(source.sourceId, extracted.events);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!result.firstError) result.firstError = msg;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker);
  await Promise.all(workers);

  return result;
}

interface ExtractedEvent {
  title?: string;
  startDate?: string;
  startTime?: string;
  venue?: string;
  city?: string;
  address?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  price?: string;
}

function appendEventsToQueue(sourceId: string, events: ExtractedEvent[]): void {
  if (events.length === 0) return;
  if (!existsSync(path.dirname(QUEUES_DIR))) {
    mkdirSync(path.dirname(QUEUES_DIR), { recursive: true });
  }
  const rows = events.map((e) => ({
    sourceId,
    queueName: 'postTestC-UI',
    queuedAt: new Date().toISOString(),
    priority: 3,
    attempt: 1,
    queueReason: 'pdfExtractor: events extracted from PDF',
    title: e.title,
    startDate: e.startDate,
    startTime: e.startTime,
    venue: e.venue,
    city: e.city,
    address: e.address,
    description: e.description,
    url: e.url,
    imageUrl: e.imageUrl,
    price: e.price,
  }));
  const content = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(QUEUES_DIR, content, { flag: 'a' });
}

// ─── Main entrypoint ───────────────────────────────────────────────────────

export async function runPdfExtraction(opts: {
  limit?: number;
  concurrency?: number;
  sources?: SourcePdfEntry[];
} = {}): Promise<PdfExtractionResult> {
  const limit = opts.limit ?? 20;
  const concurrency = opts.concurrency ?? 3;

  const sources = opts.sources ?? loadSourcesWithPdfs();
  const selected = sources.slice(0, limit);

  const result: PdfExtractionResult = {
    totalSources: sources.length,
    totalPdfs: 0,
    totalEvents: 0,
    results: [],
    firstError: null,
  };

  if (selected.length === 0) {
    console.log('[pdfExtractor] no sources with pdfUrls/programPdf/pdfUrl found in sources/');
    return result;
  }

  console.log(`[pdfExtractor] ${selected.length} sources with PDFs (${sources.length} total), concurrency=${concurrency}`);

  // Bearbeta källor parallellt (per-källa concurrency för PDF:er)
  const queue = [...selected];
  let idx = 0;
  const topConcurrency = Math.min(3, selected.length);

  async function topWorker(): Promise<void> {
    while (true) {
      const myIdx = idx++;
      if (myIdx >= queue.length) break;
      const source = queue[myIdx];
      const r = await processSource(source, concurrency);
      result.totalPdfs += r.pdfsProcessed;
      result.totalEvents += r.eventsFound;
      result.results.push(r);
      if (r.firstError && !result.firstError) result.firstError = r.firstError;
    }
  }

  await Promise.all(Array.from({ length: topConcurrency }, topWorker));

  return result;
}

// ─── CLI wrapper ───────────────────────────────────────────────────────────

import { fileURLToPath as _furl } from 'url';
const cliArgs = process.argv.slice(2);
const limitIdx = cliArgs.indexOf('--limit');
const concIdx = cliArgs.indexOf('--concurrency');

const limit = limitIdx !== -1 ? parseInt(cliArgs[limitIdx + 1], 10) : 20;
const concurrency = concIdx !== -1 ? parseInt(cliArgs[concIdx + 1], 10) : 3;

const isMainModule = (() => {
  try {
    const __filename = _furl(import.meta.url);
    return process.argv[1] === __filename || process.argv[1]?.endsWith('pdfExtractor.ts');
  } catch {
    return false;
  }
})();

if (isMainModule && cliArgs.length > 0) {
  runPdfExtraction({ limit, concurrency })
    .then((r) => {
      console.log(JSON.stringify({
        totalSources: r.totalSources,
        processedSources: r.results.length,
        totalPdfs: r.totalPdfs,
        totalEvents: r.totalEvents,
        firstError: r.firstError,
      }, null, 2));
      process.exit(r.firstError && r.totalEvents === 0 ? 1 : 0);
    })
    .catch((e) => {
      console.error('[pdfExtractor] FATAL:', e);
      process.exit(1);
    });
}
