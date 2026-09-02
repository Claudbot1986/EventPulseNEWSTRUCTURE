/**
 * EventPulse UI-review — steg 2: isolerad vision-review via Ollama GLM-5.3-Flash.
 *
 * SÄKERHETSREGLER:
 *  1. Detta script körs som EN egen process. Bilden (base64) skickas DIREKT
 *     till Ollama — den passerar aldrig Claude Codes modellrequest.
 *  2. Claude Code får ALDRIG använda Read på screenshots i denna workflow.
 *     Claude konsumerar endast review.json / review.md / review-error.json.
 *  3. Fel fångas, loggas till review-error.json och avslutar med exit 1 —
 *     huvudsessionen får aldrig en okontrollerad krasch.
 *
 * Anrop (från run-iteration.mjs eller manuellt):
 *   npx tsx scripts/ui-review/ui-vision-review.ts \
 *     --screenshot runtime/verify/ui-review/<session>/iter-1/view-utforska-top.png \
 *     [--screenshot <fler.png>] [--out-dir DIR] [--view utforska] [--focus "extra fokus"]
 *
 * Miljö: OLLAMA_BASE_URL (default http://127.0.0.1:11434/v1),
 *        UI_REVIEW_MODEL  (default glm-5.3-flash:cloud),
 *        OLLAMA_API_KEY   (default 'ollama' — Ollama kräver ingen riktig nyckel).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------- Konfiguration (inga hårdkodade absoluta paths) ----------

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = 'glm-5.3-flash:cloud';
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // skydd mot absurt stora payloads

// ---------- Typer ----------

interface RecommendedChange {
  area: string;
  problem: string;
  change: string;
  reason: string;
}

interface UiReview {
  score: number;
  summary: string;
  critical_issues: string[];
  high_priority: string[];
  medium_priority: string[];
  low_priority: string[];
  strengths: string[];
  recommended_changes: RecommendedChange[];
}

interface ReviewMeta {
  model: string;
  base_url: string;
  view: string;
  screenshots: string[];
  timestamp: string;
  latency_ms: number;
}

// ---------- Prompt ----------

const SYSTEM_PROMPT = `Du är en krävande senior UI-design-reviewer för EventPulse — en personlig event-agent för Stockholm (mobilapp, renderad här via Expo web i mobil-viewport).

EventPulse designbenchmark (docs/UI-DESIGN.md, auktoritativ):
- Pure black canvas (#000000) — hela appen, inga undantag
- Transparenta kort — endast tunn border (#1A1A1A), ingen egen bakgrund; bilden + bakgrunden syns igenom
- Endast dagrubriker (SectionList headers) får egen bakgrund (#202635)
- Inline date clusters — gula (#FFB454) boxar med dag+tid i eventHeader, ALDRIG under titeln
- Kompakt typografi: eventTitle 17/700 varmvit (#F7F2EA), venue 12/500 muted (#A9B0BE), pris 12/700 mint (#72E0C5)
- Spacing: xs=4, sm=8, md=12
- Palett (inga andra färger): #000000 #202635 #1A1A1A #3A4254 #F7F2EA #A9B0BE #727B8D #FFB454 #332516 #72E0C5 #FF6B8A #FF7597

Produktmål: användaren ska snabbt hitta och välja rätt event i Stockholm. Browse-first eventfeed är huvudyta; agent är den framtida huvudvägen. UI:t ska kännas personligt, mörkt och cinematografiskt — inte generiskt.

Bedöm MINST dessa dimensioner:
visual hierarchy, spacing, alignment, typography, density, consistency, component proportions, card design, navigation, discoverability, visual polish, mobile usability, uppenbara tillgänglighetsproblem, empty states, loading states (om synliga), clipping/overflow, trasiga layouter, om UI:t känns intentional eller generiskt, samt om UI:t stödjer EventPulse produktmål.

Regler:
- Säg INTE bara att det "ser bra ut". Prioritera konkreta, genomförbara förbättringar.
- Referera specifika element du ser i skärmdumpen (rubriker, kort, tabbar, datumboxar).
- Flagga avvikelser mot designbenchmarken ovan (t.ex. kort med synlig bakgrund, felplacerade date clusters, färger utanför paletten).
- critical_issues = trasigt/ohanterligt (clipping, broken layout, oläsbar text, osynliga element)
- high_priority = tydliga fel som påverkar användning
- Skriv ALL fritext på svenska. Fältnamn förblir exakt som i schemat.

Svara med ENDA ett JSON-objekt, utan markdown-stängsel, exakt denna struktur:
{
  "score": <heltal 0-100>,
  "summary": "<2-4 meningar>",
  "critical_issues": ["..."],
  "high_priority": ["..."],
  "medium_priority": ["..."],
  "low_priority": ["..."],
  "strengths": ["..."],
  "recommended_changes": [{"area": "...", "problem": "...", "change": "...", "reason": "..."}]
}`;

function buildUserPrompt(view: string, imageLabels: string[], focus?: string): string {
  const lines = [
    `Granska denna UI-vy ("${view}") enligt systeminstruktionen.`,
    '',
    ...imageLabels.map((label, i) => `Bild ${i + 1}: ${label}`),
    '',
    'Prioritera förslag som är UI-polish (spacing, typografi, proportioner, kontrast, hierarki) — inte nya produktfeatures.',
  ];
  if (focus) {
    lines.push('', `Extra fokus från orkestratorn: ${focus}`);
  }
  return lines.join('\n');
}

// ---------- Hjälpfunktioner ----------

function parseArgs(argv: string[]): {
  screenshots: string[];
  outDir: string;
  view: string;
  focus?: string;
  timeoutMs: number;
  model: string;
  baseUrl: string;
} {
  const screenshots: string[] = [];
  let outDir = process.cwd();
  let view = 'utforska';
  let focus: string | undefined;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let model = process.env.UI_REVIEW_MODEL || DEFAULT_MODEL;
  let baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--screenshot' && next) { screenshots.push(next); i++; }
    else if (arg === '--out-dir' && next) { outDir = next; i++; }
    else if (arg === '--view' && next) { view = next; i++; }
    else if (arg === '--focus' && next) { focus = next; i++; }
    else if (arg === '--timeout-ms' && next) { timeoutMs = parseInt(next, 10); i++; }
    else if (arg === '--model' && next) { model = next; i++; }
    else if (arg === '--base-url' && next) { baseUrl = next; i++; }
  }
  return { screenshots, outDir, view, focus, timeoutMs, model, baseUrl };
}

function imageLabel(p: string): string {
  const name = path.basename(p);
  if (name.includes('-top.')) return 'övre delen av vyn (primär — bedöm främst denna)';
  if (name.includes('-mid.')) return 'mitten av vyn efter scroll (bedöm densitet och konsistens i feeden)';
  if (name.includes('-full.')) return 'hela sidan från topp till botten (kontext)';
  return name;
}

function toDataUrl(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(`bild för stor (${(buf.length / 1024 / 1024).toFixed(1)} MB > ${MAX_IMAGE_BYTES / 1024 / 1024} MB): ${filePath}`);
  }
  const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mime};base64,${buf.toString('base64')}`;
}

/** Extrahera JSON ur modellsvar — tål markdown-stängsel och omkringliggande text. */
function extractJson(raw: string): unknown {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('inget JSON-objekt hittat i modellsvar');
  }
  return JSON.parse(text.slice(start, end + 1));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function normalizeReview(parsed: unknown): UiReview {
  const obj = (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {};
  const scoreRaw = typeof obj.score === 'number' ? obj.score : parseInt(String(obj.score ?? ''), 10);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.round(scoreRaw))) : 0;
  const changes: RecommendedChange[] = Array.isArray(obj.recommended_changes)
    ? (obj.recommended_changes as unknown[])
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => ({
          area: String(c.area ?? 'övrigt'),
          problem: String(c.problem ?? ''),
          change: String(c.change ?? ''),
          reason: String(c.reason ?? ''),
        }))
        .filter((c) => c.problem || c.change)
    : [];
  return {
    score,
    summary: typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary : '(ingen sammanfattning)',
    critical_issues: asStringArray(obj.critical_issues),
    high_priority: asStringArray(obj.high_priority),
    medium_priority: asStringArray(obj.medium_priority),
    low_priority: asStringArray(obj.low_priority),
    strengths: asStringArray(obj.strengths),
    recommended_changes: changes,
  };
}

function renderMarkdown(review: UiReview, meta: ReviewMeta): string {
  const section = (title: string, items: string[]): string =>
    items.length === 0 ? `## ${title}\n\n_(inga)_\n` : `## ${title}\n\n${items.map((s) => `- ${s}`).join('\n')}\n`;

  const lines: string[] = [
    `# UI Vision Review — ${meta.view}`,
    '',
    `- **Score:** ${review.score}/100`,
    `- **Modell:** ${meta.model} (Ollama, isolerad process)`,
    `- **Tid:** ${meta.timestamp}`,
    `- **Latens:** ${(meta.latency_ms / 1000).toFixed(1)}s`,
    `- **Skärmdumpar:** ${meta.screenshots.map((s) => path.basename(s)).join(', ')}`,
    '',
    '## Sammanfattning',
    '',
    review.summary,
    '',
    section('Critiska problem', review.critical_issues),
    section('Hög prioritet', review.high_priority),
    section('Medel prioritet', review.medium_priority),
    section('Låg prioritet', review.low_priority),
    section('Styrkor', review.strengths),
    '## Rekommenderade ändringar',
    '',
  ];
  if (review.recommended_changes.length === 0) {
    lines.push('_(inga)_');
  } else {
    for (const c of review.recommended_changes) {
      lines.push(`### ${c.area}`);
      lines.push(`- **Problem:** ${c.problem}`);
      lines.push(`- **Ändring:** ${c.change}`);
      lines.push(`- **Motivering:** ${c.reason}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function writeError(outDir: string, error: Record<string, unknown>): void {
  const errorPath = path.join(outDir, 'review-error.json');
  try {
    fs.writeFileSync(errorPath, JSON.stringify({ timestamp: new Date().toISOString(), ...error }, null, 2));
    console.error(`[vision-review] fel loggat till ${errorPath}`);
  } catch (e) {
    console.error(`[vision-review] KUNDE INTE SKRIVA review-error.json: ${e}`);
  }
}

// ---------- Ollama-anrop ----------

async function callOllama(
  baseUrl: string,
  model: string,
  apiKey: string,
  view: string,
  imagePaths: string[],
  focus: string | undefined,
  timeoutMs: number
): Promise<{ content: string; latencyMs: number }> {
  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: buildUserPrompt(view, imagePaths.map(imageLabel), focus) },
    ...imagePaths.map((p) => ({ type: 'image_url', image_url: { url: toDataUrl(p) } })),
  ];
  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content },
    ],
    temperature: 0.2,
    // GLM-5.3-Flash är en thinking-modell: resonemanget förbrukar tokens innan
    // content. Med liten budget blir content tomt (finish_reason "length").
    max_tokens: 16384,
    stream: false,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const errText = (await response.text()).slice(0, 2000);
      throw Object.assign(new Error(`Ollama HTTP ${response.status}: ${errText}`), { httpStatus: response.status });
    }
    const data = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string; reasoning?: string };
      }>;
    };
    const choice = data.choices?.[0];
    // Thinking-modeller (GLM) kan lämna content tom och allt i reasoning
    // (t.ex. vid token-brist). Faller tillbaka på reasoning om content saknas.
    const contentText = (choice?.message?.content || '').trim()
      || (choice?.message?.reasoning || '').trim();
    if (!contentText) {
      const finish = choice?.finish_reason || 'okänd';
      throw new Error(`tomt svar från modellen (finish_reason: ${finish})`);
    }
    return { content: contentText, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Main ----------

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const apiKey = process.env.OLLAMA_API_KEY || 'ollama';

  if (args.screenshots.length === 0) {
    writeError(outDir, { stage: 'args', error: 'inget --screenshot angivet' });
    console.error('[vision-review] FEL: inget --screenshot angivet');
    return 1;
  }
  for (const s of args.screenshots) {
    if (!fs.existsSync(s)) {
      writeError(outDir, { stage: 'args', error: `screenshot saknas: ${s}` });
      console.error(`[vision-review] FEL: screenshot saknas: ${s}`);
      return 1;
    }
  }

  console.log(`[vision-review] model=${args.model} baseUrl=${args.baseUrl} bilder=${args.screenshots.length} vy=${args.view}`);

  try {
    let result: { content: string; latencyMs: number };
    try {
      result = await callOllama(args.baseUrl, args.model, apiKey, args.view, args.screenshots, args.focus, args.timeoutMs);
    } catch (firstError) {
      // Robusthet: misslyckades fler-bild-anropet, försök EN gång med endast primärbilden.
      if (args.screenshots.length > 1 && (firstError as { httpStatus?: number }).httpStatus !== undefined) {
        console.warn(`[vision-review] första anropet misslyckades (${(firstError as Error).message.slice(0, 200)}); försöker igen med endast primärbilden`);
        result = await callOllama(args.baseUrl, args.model, apiKey, args.view, [args.screenshots[0]], args.focus, args.timeoutMs);
      } else {
        throw firstError;
      }
    }

    const review = normalizeReview(extractJson(result.content));
    const meta: ReviewMeta = {
      model: args.model,
      base_url: args.baseUrl,
      view: args.view,
      screenshots: args.screenshots.map((s) => path.resolve(s)),
      timestamp: new Date().toISOString(),
      latency_ms: result.latencyMs,
    };

    const reviewJsonPath = path.join(outDir, 'review.json');
    fs.writeFileSync(reviewJsonPath, JSON.stringify({ ...meta, ...review }, null, 2));
    const reviewMdPath = path.join(outDir, 'review.md');
    fs.writeFileSync(reviewMdPath, renderMarkdown(review, meta));

    console.log(`[vision-review] score=${review.score}/100`);
    console.log(`[vision-review] critical=${review.critical_issues.length} high=${review.high_priority.length} medium=${review.medium_priority.length} low=${review.low_priority.length}`);
    console.log(`[vision-review] review.json: ${reviewJsonPath}`);
    console.log(`[vision-review] review.md: ${reviewMdPath}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeError(outDir, {
      stage: 'ollama-call',
      error: message,
      model: args.model,
      base_url: args.baseUrl,
      screenshots: args.screenshots,
    });
    console.error(`[vision-review] FEL: ${message}`);
    return 1;
  }
}

// main() själv kastar aldrig — sista skyddsnätet för huvudsessionen.
main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`[vision-review] OFÖRVÄNTAT FEL: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });