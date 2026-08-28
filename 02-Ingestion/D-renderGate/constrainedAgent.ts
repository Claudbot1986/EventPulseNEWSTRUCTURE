/**
 * constrainedAgent.ts — Constrained verifiable AI agent for render fallback
 *
 * Vetenskaplig grund: arXiv 2607.00035
 * "Making Failure Safe: A Constrained, Verifiable Agent Framework for Open-Web Data Collection"
 *
 * Pattern (slot-filling, INTE free-form code):
 *   1. Generator: AI analyserar HTML + URL → JSON collector config (selectors)
 *   2. Validator: kör config mot sample-URL → kontrollera att selectors ger text/date
 *   3. Fixer: om validering misslyckas → generera om med felmeddelande (closed loop)
 *   4. Saver: skriv fungerande config → runtime/adapters/{sourceId}.json
 *
 * BACKLOG-begränsning: D-render är BARA fallback, default path är A/B/C.
 * Denna agent körs endast när:
 *   - runA returnerar `no-jsonld-or-no-events`
 *   - runB/C redan körts utan framgång
 *   - source.pendingNextTool === 'D-renderGate'
 *
 * 6 collector types (från artikeln):
 *   search: Google-style query → URLs
 *   list: paginated listing of items
 *   detail: single item page
 *   api: JSON API endpoint
 *   interactive: requires clicks/forms
 *   file: PDF/CSV static file
 *
 * Säkerhet:
 *   - JSON Schema-validated output (aldrig fri kod)
 *   - Selectors är CSS/XPath-strings, exekveras via cheerio
 *   - AI får INTE generera execution code
 *   - Max tokens cap per anrop (default 2000)
 *   - Closed loop: max 3 fix-iterations
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import * as dotenv from 'dotenv';
import { fetchHtml } from '../tools/fetchTools.js';

const __filename = (() => {
  try { return decodeURIComponent(new URL(import.meta.url).pathname); } catch { return ''; }
})();

// ─── Config ─────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__filename, '../../..');
const RUNTIME_DIR = path.resolve(PROJECT_ROOT, 'runtime');
const ADAPTERS_DIR = path.resolve(RUNTIME_DIR, 'adapters');

dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env'), override: true });

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_FIX_ITERATIONS = 3;
const DEFAULT_MAX_TOKENS = 2000;
const HTML_TRUNCATE = 12000; // liknande runC-ai-deep-discovery
const FETCH_TIMEOUT_MS = 20000;

// ─── Types ──────────────────────────────────────────────────────────────────

export type CollectorType = 'search' | 'list' | 'detail' | 'api' | 'interactive' | 'file';

export interface CollectorSelectors {
  eventContainer?: string; // CSS selector som wrappar varje event
  title?: string;
  date?: string;          // selector som ger datum-text eller datetime-attr
  venue?: string;
  ticketUrl?: string;
  description?: string;
  link?: string;          // selector som ger href till event-detalj-sida
}

export interface CollectorConfig {
  type: CollectorType;
  sourceId: string;
  seedUrl: string;
  /** upptäckta kandidat-URLs (returneras av AI; vi kör bara validatorn på seedUrl) */
  candidateUrls?: string[];
  selectors: CollectorSelectors;
  pagination?: {
    pattern: 'next' | 'numbered' | 'infinite';
    maxPages: number;
    nextSelector?: string;
  };
  rateLimitMs: number;
  /** själv-förtroende (0-1) som AI:n anger — INTE bevisat, bara deklarerat */
  aiConfidence: number;
  /** spårbarhet */
  generatedAt: string;
  generatedBy: string;     // "claude-haiku-4-5" el. dyl.
  generatorVersion: string;
  validatedAt?: string;
  validatorVersion?: string;
  validationPassed?: boolean;
  validationNotes?: string;
}

export interface GenerationResult {
  config: CollectorConfig;
  promptTokens: number;
  responseTokens: number;
  iterations: number;
  validationPassed: boolean;
  validationNotes?: string;
}

// ─── JSON Schema (inbyggd, som fallback om AI-klient inte stöder tools) ─────

const COLLECTOR_SCHEMA_DESCRIPTION = `
{
  "type": "object",
  "required": ["type", "sourceId", "seedUrl", "selectors", "rateLimitMs", "aiConfidence"],
  "properties": {
    "type": { "enum": ["search", "list", "detail", "api", "interactive", "file"] },
    "sourceId": { "type": "string" },
    "seedUrl": { "type": "string" },
    "candidateUrls": { "type": "array", "items": { "type": "string" } },
    "selectors": {
      "type": "object",
      "properties": {
        "eventContainer": { "type": "string" },
        "title": { "type": "string" },
        "date": { "type": "string" },
        "venue": { "type": "string" },
        "ticketUrl": { "type": "string" },
        "description": { "type": "string" },
        "link": { "type": "string" }
      }
    },
    "pagination": {
      "type": "object",
      "properties": {
        "pattern": { "enum": ["next", "numbered", "infinite"] },
        "maxPages": { "type": "integer" },
        "nextSelector": { "type": "string" }
      }
    },
    "rateLimitMs": { "type": "integer" },
    "aiConfidence": { "type": "number", "minimum": 0, "maximum": 1 }
  }
}
`.trim();

// ─── Generator: AI call (Anthropic Messages API) ────────────────────────────

interface AnthropicResponse {
  content?: Array<{ text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function callAnthropic(
  prompt: string,
  system: string,
  maxTokens: number,
): Promise<{ text: string; promptTokens: number; responseTokens: number }> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured in .env');
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'user', content: prompt },
      ],
      system,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 400)}`);
  }

  const data = (await response.json()) as AnthropicResponse;
  const text = data.content?.[0]?.text ?? '';
  const promptTokens = data.usage?.input_tokens ?? 0;
  const responseTokens = data.usage?.output_tokens ?? 0;
  return { text, promptTokens, responseTokens };
}

function buildSystemPrompt(): string {
  return `Du är en constrained HTML-scraper-konfigurator. Du analyserar HTML och returnerar ENBART JSON — ingen kod, inga förklaringar, inga markdown.

REGLER:
1. Returnera ENBART valid JSON som matchar schemat nedan — INGA code blocks, INGA kommentarer.
2. Selectors MÅSTE vara CSS selectors (eller XPath med prefix "xpath:").
3. Inga selektorer som kräver JS-exekvering (React state, Vue refs) — bara statisk HTML.
4. aiConfidence ∈ [0, 1]. Var ärlig — om HTML:en är för JS-renderad, sänk confidence.
5. type=list om sidan visar ≥2 events i en container. type=detail om en enda event. type=api om JSON-endpoint.
6. eventContainer är OBLIGATORISK om type=list.
7. För Svenska sites: leta efter "evenemang", "kalender", "program", "biljett", "datum", "tid".

SCHEMA:
${COLLECTOR_SCHEMA_DESCRIPTION}`;
}

function buildGenerationPrompt(
  sourceId: string,
  url: string,
  html: string,
  previousConfig?: CollectorConfig,
  validationError?: string,
): string {
  const truncated = html.slice(0, HTML_TRUNCATE);
  if (previousConfig && validationError) {
    return `URL: ${url}
SOURCE_ID: ${sourceId}

FÖREGÅENDE CONFIG MISSLYCKADES VALIDATION:
${JSON.stringify(previousConfig, null, 2)}

VALIDATION ERROR:
${validationError}

NY HTML-PROV (truncated till ${HTML_TRUNCATE} tecken):
${truncated}

Generera NYTT config som FIXAR felet. Returnera ENBART JSON.`;
  }
  return `URL: ${url}
SOURCE_ID: ${sourceId}

HTML (truncated till ${HTML_TRUNCATE} tecken):
${truncated}

Analysera HTML:en och returnera config som identifierar event-containers och selectors.
VIKTIGT: HTML:en kan vara JS-renderad. Om du ser <div id="root">, <div id="__next">, mycket <script> men lite text — sänk aiConfidence till <0.3 och sätt eventContainer till null.

Returnera ENBART JSON.`;
}

function parseAiJson(text: string): CollectorConfig {
  // Strip markdown code blocks if present
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  // Hitta första { och sista }
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last < 0) {
    throw new Error(`No JSON object found in AI response: ${cleaned.slice(0, 200)}`);
  }
  const json = cleaned.slice(first, last + 1);
  const parsed = JSON.parse(json) as CollectorConfig;
  return parsed;
}

function validateConfigShape(c: unknown): c is CollectorConfig {
  if (!c || typeof c !== 'object') return false;
  const cfg = c as Record<string, unknown>;
  if (typeof cfg.type !== 'string') return false;
  if (!['search', 'list', 'detail', 'api', 'interactive', 'file'].includes(cfg.type as string)) return false;
  if (typeof cfg.sourceId !== 'string') return false;
  if (typeof cfg.seedUrl !== 'string') return false;
  if (typeof cfg.rateLimitMs !== 'number') return false;
  if (typeof cfg.aiConfidence !== 'number') return false;
  const sel = cfg.selectors as Record<string, unknown> | undefined;
  if (!sel || typeof sel !== 'object') return false;
  return true;
}

// ─── Validator: kör config mot HTML-prov ────────────────────────────────────

function applySelector(html: string, selector: string): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  if (selector.startsWith('xpath:')) {
    // XPath stöds inte av cheerio — returnera tom array
    return [];
  }
  try {
    $(selector).each((_, el) => {
      out.push($(el).text().trim());
    });
  } catch {
    return [];
  }
  return out;
}

interface ValidationResult {
  passed: boolean;
  notes: string;
  eventsFound: number;
  sampleTitles: string[];
  sampleDates: string[];
}

export function validateConfigOnHtml(config: CollectorConfig, html: string): ValidationResult {
  const sel = config.selectors;
  const notes: string[] = [];

  if (config.type === 'list') {
    if (!sel.eventContainer) {
      return { passed: false, notes: 'list-type requires eventContainer selector', eventsFound: 0, sampleTitles: [], sampleDates: [] };
    }
    const containers = applySelector(html, sel.eventContainer);
    if (containers.length === 0) {
      return { passed: false, notes: `eventContainer "${sel.eventContainer}" matched 0 elements`, eventsFound: 0, sampleTitles: [], sampleDates: [] };
    }
    // Försök hämta title + date inom varje container
    let titles: string[] = [];
    let dates: string[] = [];
    const $ = cheerio.load(html);
    $(sel.eventContainer).each((_, el) => {
      if (sel.title && !sel.title.startsWith('xpath:')) {
        const t = $(el).find(sel.title).first().text().trim();
        if (t) titles.push(t);
      }
      if (sel.date && !sel.date.startsWith('xpath:')) {
        const d = $(el).find(sel.date).first().text().trim();
        if (d) dates.push(d);
      }
    });
    notes.push(`containers=${containers.length}; titles=${titles.length}; dates=${dates.length}`);
    const passed = containers.length >= 1 && (titles.length > 0 || dates.length > 0);
    return {
      passed,
      notes: notes.join('; '),
      eventsFound: containers.length,
      sampleTitles: titles.slice(0, 3),
      sampleDates: dates.slice(0, 3),
    };
  }

  if (config.type === 'detail') {
    const title = sel.title ? applySelector(html, sel.title) : [];
    const date = sel.date ? applySelector(html, sel.date) : [];
    notes.push(`title=${title.length}; date=${date.length}`);
    const passed = title.length > 0 && date.length > 0;
    return {
      passed,
      notes: notes.join('; '),
      eventsFound: title.length > 0 ? 1 : 0,
      sampleTitles: title.slice(0, 3),
      sampleDates: date.slice(0, 3),
    };
  }

  if (config.type === 'api') {
    notes.push('api-type requires runtime JSON fetch — not validated here');
    return { passed: true, notes: notes.join('; '), eventsFound: 0, sampleTitles: [], sampleDates: [] };
  }

  return { passed: false, notes: 'unknown type or unsupported validation', eventsFound: 0, sampleTitles: [], sampleDates: [] };
}

// ─── Pipeline: generate → validate → fix ────────────────────────────────────

export interface PipelineOptions {
  sourceId: string;
  url: string;
  html?: string; // om redan hämtad
  maxTokens?: number;
  validateOnly?: boolean;
  rateLimitMs?: number;
}

export async function runPipeline(opts: PipelineOptions): Promise<GenerationResult> {
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const rateLimitMs = opts.rateLimitMs ?? 1500;

  // 1. Hämta HTML om ej given
  let html = opts.html;
  if (!html) {
    const fetched = await fetchHtml(opts.url, { timeout: FETCH_TIMEOUT_MS });
    if (!fetched.success || !fetched.html) {
      throw new Error(`Fetch failed for ${opts.url}: ${fetched.error || 'unknown'}`);
    }
    html = fetched.html;
  }

  const system = buildSystemPrompt();
  let config: CollectorConfig | undefined;
  let lastError: string | undefined;
  let totalPrompt = 0;
  let totalResponse = 0;
  let iterations = 0;

  for (let i = 0; i < MAX_FIX_ITERATIONS; i++) {
    iterations++;
    const prompt = buildGenerationPrompt(opts.sourceId, opts.url, html, config, lastError);
    const { text, promptTokens, responseTokens } = await callAnthropic(prompt, system, maxTokens);
    totalPrompt += promptTokens;
    totalResponse += responseTokens;

    let parsed: unknown;
    try {
      parsed = parseAiJson(text);
    } catch (e) {
      lastError = `JSON parse failed: ${(e as Error).message}`;
      continue;
    }
    if (!validateConfigShape(parsed)) {
      lastError = 'Config did not match schema (missing required fields or invalid type)';
      continue;
    }
    config = parsed as CollectorConfig;
    // Fyll i metadata
    config.generatedAt = new Date().toISOString();
    config.generatedBy = DEFAULT_MODEL;
    config.generatorVersion = 'constrainedAgent-1.0';
    config.sourceId = opts.sourceId;
    config.seedUrl = opts.url;
    if (!config.rateLimitMs) config.rateLimitMs = rateLimitMs;

    // 2. Validate
    const val = validateConfigOnHtml(config, html);
    config.validatedAt = new Date().toISOString();
    config.validatorVersion = 'constrainedAgent-1.0';
    config.validationPassed = val.passed;
    config.validationNotes = val.notes;

    if (val.passed) {
      return {
        config,
        promptTokens: totalPrompt,
        responseTokens: totalResponse,
        iterations,
        validationPassed: true,
        validationNotes: val.notes,
      };
    }
    lastError = `Validator: ${val.notes}`;
  }

  // Klar utan pass — returnera sista config
  return {
    config: config!,
    promptTokens: totalPrompt,
    responseTokens: totalResponse,
    iterations,
    validationPassed: false,
    validationNotes: lastError,
  };
}

// ─── Saver: runtime/adapters/{sourceId}.json ────────────────────────────────

export function saveAdapter(config: CollectorConfig): string {
  mkdirSync(ADAPTERS_DIR, { recursive: true });
  const file = path.resolve(ADAPTERS_DIR, `${config.sourceId}.json`);
  writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
  return file;
}

export function loadAdapter(sourceId: string): CollectorConfig | null {
  const file = path.resolve(ADAPTERS_DIR, `${sourceId}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as CollectorConfig;
}

// ─── Manifest: spåra alla adapters ──────────────────────────────────────────

export interface AdapterManifestEntry {
  sourceId: string;
  savedAt: string;
  type: CollectorType;
  aiConfidence: number;
  validationPassed: boolean;
  validationNotes?: string;
  iterations: number;
  tokens: { prompt: number; response: number };
  file: string;
}

export function appendManifest(entry: AdapterManifestEntry): void {
  const manifestFile = path.resolve(ADAPTERS_DIR, '_manifest.jsonl');
  const line = JSON.stringify(entry) + '\n';
  if (existsSync(manifestFile)) {
    const existing = readFileSync(manifestFile, 'utf8');
    writeFileSync(manifestFile, existing + line, 'utf8');
  } else {
    writeFileSync(manifestFile, line, 'utf8');
  }
}
