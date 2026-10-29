#!/usr/bin/env tsx
/**
 * scripts/adaptive_image_gen.ts
 *
 * Adaptiv bildgenerering för EventPulse med MiniMax image-01.
 *
 * Varför detta finns:
 *   Det gamla biblioteket är 68 % close-ups trots att ZOOM_WEIGHTS (användarens
 *   foto-preferens 2026-10-21) anger 75 % wide/establishing/aerial. Att köra
 *   "alla bilder på en gång" blir därför dyrt och riskabelt — en felaktig prompt
 *   eller ett felaktigt shot-mönster sprids till hundratals bilder innan det
 *   upptäcks.
 *
 * Slingan:
 *   1. Planera EXAKT vilka (kategori, shot-nivå) som saknas, utifrån
 *      events_public + befintliga filer på disk + ZOOM_WEIGHTS.
 *   2. Generera en omgång (--start=5).
 *   3. Granska VARJE bild med MiniMax M3 vision: shot-nivå, text, artefakter.
 *   4. Grinden:
 *        allt godkänt  -> omgångstorleken fördubblas (5 -> 10 -> 20 -> ...)
 *        något fel   -> storleken halveras (minst 1), cooldown, försök igen
 *   5. Rate limit: MiniMax image_generation är 10 RPM. Rullande 60s-fönster
 *      med säkerhetsmarginal (9) — kontrollen väntar i stället för att köra
 *      in i 429.
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/adaptive_image_gen.ts --start=5
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, openSync, closeSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { applyAiComplianceToWebp } from '../08-Agent/tools/ai_compliance.js';
import {
  buildZoomPrompts,
  buildFilenamePrefix,
  ZOOM_LEVELS,
  ZOOM_WEIGHTS,
} from '../BFL-generator/lib/zoom-prompter.js';

// === KONSTANTER ==========================================================
const MINIMAX_BASE = 'https://api.minimax.io/v1';
const IMAGE_MODEL = 'image-01';
const M3_MODEL = 'MiniMax-M3';

const OUT_DIR = 'local_image_library_stamped_v2';
const SRC_LIB_DIR = 'local_image_library_stamped';

// 2026-10-29 — tillståndet kan ligga i en egen mapp per körning (--run-dir).
// Bakgrundskörningen och dashboard-körningen får inte dela state-fil:
// räknarna (round/size/generated) skulle annars blandas ihop.
const DEFAULT_STATE_DIR = 'runtime/adaptive-image-gen';
let STATE_DIR = DEFAULT_STATE_DIR;
let STATE_FILE = path.join(STATE_DIR, 'state.json');
let VERIFY_LOG = path.join(STATE_DIR, 'verify.ndjson');
let PROGRESS_FILE = path.join(STATE_DIR, 'progress.json');

// Låset är GLOBAL (inte per run-dir). RpmGuard räknar per process, så två
// parallella körningar skulle tillsammans ge upp till 18 anrop/min mot
// MiniMax taket 10/min → 429. Låset gör att bara en körning går åt gång.
//
// Sökvägen härleds från SKRIPTETS placering, inte från cwd: dashboarden
// läser låset via PROJECT_ROOT. Ett cwd-beroende lås skulle kunna hamna på
// en annan plats än servern tittar efter → ingen mutual exclusion.
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_FILE = path.join(PROJECT_ROOT, 'runtime', 'adaptive-image-gen', 'run.lock');

const RPM_LIMIT = 10;
const RPM_SAFE = 9; // säkerhetsmarginal under taket

// 2026-10-29 — aspect ratio 3:2, inte 16:9.
// UI:ns huvudcontainer för biblioteksbilder är App.js `eventImage`
// (maxWidth 420, height 280) = exakt 3:2, och den renderar med
// resizeMode="cover". Mätt 2026-10-29:
//   16:9 (1280x720) → cover-crop till 3:2 klipper av 15,6 % av bredden
//                    → AI-stämpeln (nedre vänstra hörnet) blir AVKLIPPT
//                      till "…erad" (verifierat visuellt + 0 orange pixlar
//                      kvar i hörnet efter crop).
//   3:2 (1248x832) → ingen beskärning i huvudcontainern, stämpeln
//                    "AI-genererad" ligger helt intakt (verifierat).
// Det är också EU AI Act Art. 50-märkningen som ska vara läsbar.
// Övriga containrar: 56x56 och 72x72 thumbnails (1:1, cover) — där är
// stämpeln för liten för att betyda något, men 3:2 beskär mindre (33 %
// mot 44 % av bredden).
//
// BEMÄRK: eventkortet (EventPulseCard) sätter ramen till bildens EGNA
// aspect och använder resizeMode="contain". Därför måste ALLA bilder i
// biblioteket ha samma ratio, annars blir korten olika höga.
// MiniMax: aspect_ratio '3:2' → 1248x832. width/height (bara image-01,
// 512-2048, delbart med 8) används för att låsa storleken.
const IMG_W = 1248;
const IMG_H = 832;
const IMG_ASPECT = '3:2';

/** Skala-index: 0 = extrem närbild ... 9 = overhead. Används för toleransgrind. */
const SHOT_SCALE: Record<string, number> = {
  'extreme-closeup': 0,
  closeup: 1,
  'medium-closeup': 2,
  medium: 3,
  'medium-long': 4,
  'long-wide': 5,
  wide: 6,
  'very-wide': 7,
  establishing: 8,
  aerial: 9,
};

const ID_TO_SLUG: Record<string, string> = Object.fromEntries(
  ZOOM_LEVELS.map((z) => [z.id, z.slug]),
);
const SLUG_TO_ID: Record<string, string> = Object.fromEntries(
  ZOOM_LEVELS.map((z) => [z.slug, z.id]),
);

/** Tolerans i skal-enheter. 2 = en närbild-familj godkänns aldrig för wide-mål. */
const SHOT_TOLERANCE = 2;

// === HJÄLPFUNKTIONER =====================================================
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fs_exists = (p: string): boolean => existsSync(p);

function env(name: string): string | undefined {
  return process.env[name];
}

function log(msg: string): void {
  console.log(`[adaptive] ${msg}`);
}

function warn(msg: string): void {
  console.warn(`[adaptive] ⚠ ${msg}`);
}

// === CLI ==================================================================
interface Args {
  start: number;
  maxRounds: number;
  categories: string[] | null;
  concurrency: number;
  maxTotal: number;
  dryRun: boolean;
  reset: boolean;
  /** EXTRA bilder utöver kvotplanen (dashboardens "fyll ut"-knapp). */
  extra: number;
  /** Egen mapp för state/verify/progress. Tomt = standardmappen. */
  runDir: string | null;
}
function parseArgs(): Args {
  const out: Args = {
    start: 5,
    maxRounds: 12,
    categories: null,
    concurrency: 2,
    maxTotal: 200,
    dryRun: false,
    reset: false,
    extra: 0,
    runDir: null,
  };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--start=')) out.start = parseInt(a.slice(8), 10);
    else if (a.startsWith('--max-rounds=')) out.maxRounds = parseInt(a.slice(13), 10);
    else if (a.startsWith('--categories='))
      out.categories = a.slice(13).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--concurrency=')) out.concurrency = parseInt(a.slice(14), 10);
    else if (a.startsWith('--max-total=')) out.maxTotal = parseInt(a.slice(12), 10);
    else if (a.startsWith('--extra=')) out.extra = Math.max(0, parseInt(a.slice(8), 10) || 0);
    else if (a.startsWith('--run-dir=')) out.runDir = a.slice(10) || null;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--reset') out.reset = true;
  }
  return out;
}

// === PLAN ================================================================
interface Need {
  category: string;
  /** shotId -> antal som saknas */
  perShot: Record<string, number>;
  total: number;
  /** events i kategorin (framtida) */
  events: number;
  target: number;
}

/** Kvotformel: användarbeslut 2026-10-18 — target = 20 + max(0, ceil((events-600)/30)) */
function quotaTarget(events: number): number {
  return 20 + Math.max(0, Math.ceil((events - 600) / 30));
}

/** Largest-remainder-fördelning av count över vikterna. */
function distribute(count: number, weights: Record<string, number>): Record<string, number> {
  const ids = Object.keys(weights);
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const raw = ids.map((id) => ({ id, exact: (count * weights[id]) / total }));
  const floor = raw.map((r) => ({ id: r.id, slots: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let used = floor.reduce((a, r) => a + r.slots, 0);
  floor.sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < count - used; i++) floor[i].slots++;
  return Object.fromEntries(floor.map((f) => [f.id, f.slots]));
}

/**
 * Inventerar befintliga bilder per kategori + shot-nivå (från filnamn).
 *
 * VIKTIGT (2026-10-29): bara bilder i **3:2** räknas som "klara".
 *
 * Utan detta filter räknades de gamla 16:9-bilderna i
 * local_image_library_stamped/ som färdiga, och planen blev 328 bilder
 * i stället för 762 — dvs. nästan hela biblioteket hade legat kvar i
 * 16:9 med den gamla kompositionsmixen (68 % close-up) i stället för den
 * nya (12,5 % close-up). Mätt 2026-10-29:
 *   - med gamla biblioteket som "klart":  328 bilder
 *   - endast 3:2 räknas som klart:        762 bilder
 *
 * Filformatet (16:9 vs 3:2) avgör om bilden behöver genereras om, så det
 * ska utgå från bildens faktiska pixeldimensioner — inte från vilken
 * mapp filen ligger i.
 */
async function inventoryExisting(dir: string): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {};
  if (!existsSync(dir)) return out;
  for (const cat of readdirSync(dir)) {
    const p = path.join(dir, cat);
    if (!statSync(p).isDirectory()) continue;
    out[cat] = {};
    for (const f of readdirSync(p)) {
      if (!f.endsWith('.webp')) continue;
      const m = f.match(/^zoom_(.+?)_(extreme-closeup|medium-closeup|medium-long|long-wide|very-wide|medium|wide|closeup|aerial|establishing)_/);
      if (!m) continue;
      // Endast 3:2 (tolerans ±1 %) räknas som färdig.
      try {
        const meta = await sharp(path.join(p, f)).metadata();
        if (!meta.width || !meta.height) continue;
        const aspect = meta.width / meta.height;
        if (Math.abs(aspect - 1.5) / 1.5 > 0.01) continue;
      } catch {
        continue;
      }
      out[cat][m[2]] = (out[cat][m[2]] ?? 0) + 1;
    }
  }
  return out;
}

async function countFutureEvents(): Promise<Record<string, number>> {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas');
  const db = createClient(url, key, { auth: { persistSession: false } });
  const out: Record<string, number> = {};
  let offset = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await db
      .from('events_public')
      .select('category_slug')
      .gt('start_time', new Date().toISOString())
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`events_public: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) {
      if (r.category_slug) out[r.category_slug] = (out[r.category_slug] ?? 0) + 1;
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

/**
 * Bygger planen: per kategori, per shot-nivå, hur många bilder som SAKNAS.
 *
 * `extra` lägger till N bilder UTÖVER kvotplanen, proportionellt mot
 * kategorins antal framtida events. Användarens knapp på dashboarden
 * ("fyll ut med 300 nya bilder") använder detta: kvoten är då uppfylld,
 * men knappen ska kunna fylla på biblioteket ändå.
 */
async function buildPlan(categories: string[] | null, extra = 0): Promise<Need[]> {
  const events = await countFutureEvents();
  // Inventera BÅDA biblioteken. Efter 3:2-filtret bidrar det gamla
  // biblioteket med 0 (alla dess bilder är 16:9), medan det nya v2-
  // biblioteket bidrar med de bilder som redan är rätt format.
  const inventories = await Promise.all([
    inventoryExisting(SRC_LIB_DIR),
    inventoryExisting(OUT_DIR),
  ]);
  const existing: Record<string, Record<string, number>> = {};
  for (const inv of inventories) {
    for (const [cat, shots] of Object.entries(inv)) {
      existing[cat] ??= {};
      for (const [shot, n] of Object.entries(shots)) {
        existing[cat][shot] = (existing[cat][shot] ?? 0) + n;
      }
    }
  }
  const hasCluster = new Set(
    readdirSync('BFL-generator/tmp')
      .filter((f) => f.startsWith('cluster_') && f.endsWith('.json'))
      .map((f) => f.slice('cluster_'.length, -'.json'.length)),
  );

  const plan: Need[] = [];
  const cats = Object.keys(events)
    .filter((c) => events[c] > 0)
    .filter((c) => hasCluster.has(c))
    .filter((c) => (categories ? categories.includes(c) : true))
    .sort((a, b) => events[b] - events[a]);

  // EXTRA-fördelning: störst andel till kategorin med flest events.
  // Largest-remainder så att summan blir exakt `extra`.
  const extraByCat: Record<string, number> = {};
  if (extra > 0 && cats.length > 0) {
    const totalEvents = cats.reduce((a, c) => a + events[c], 0);
    const raw = cats.map((c) => ({ c, exact: (extra * events[c]) / totalEvents }));
    const floor = raw.map((r) => ({ c: r.c, slots: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
    let used = floor.reduce((a, r) => a + r.slots, 0);
    floor.sort((a, b) => b.rem - a.rem);
    for (let i = 0; used < extra && floor.length > 0; i++, used++) {
      floor[i % floor.length].slots++;
    }
    for (const f of floor) extraByCat[f.c] = f.slots;
  }

  for (const c of cats) {
    const target = quotaTarget(events[c]) + (extraByCat[c] ?? 0);
    const have = existing[c] ?? {};
    const desired = distribute(target, ZOOM_WEIGHTS);
    const perShot: Record<string, number> = {};
    for (const [id, want] of Object.entries(desired)) {
      const haveSlug = have[ID_TO_SLUG[id]] ?? 0;
      const deficit = want - haveSlug;
      if (deficit > 0) perShot[id] = deficit;
    }
    const total = Object.values(perShot).reduce((a, b) => a + b, 0);
    if (total > 0) plan.push({ category: c, perShot, total, events: events[c], target });
  }
  return plan;
}

// === PROMPT-KÄLLA ========================================================
interface PromptSlot {
  category: string;
  shotId: string;
  clusterTag: string;
  pose: string;
  light: string;
  prompt: string;
}

interface Provider {
  category: string;
  shotId: string;
  remaining: number;
  buf: PromptSlot[];
}

function loadCluster(category: string): { tag_frequency: Record<string, number> } | null {
  const p = path.join('BFL-generator', 'tmp', `cluster_${category}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

// === RATE LIMIT ==========================================================
class RpmGuard {
  private stamps: number[] = [];
  constructor(private readonly max: number) {}
  /** Reserverar en request-slott; väntar om fönstret är fullt. */
  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 60_000);
      if (this.stamps.length < this.max) {
        this.stamps.push(now);
        return;
      }
      const waitMs = Math.min(5_000, 60_000 - (now - this.stamps[0]) + 250);
      await sleep(Math.max(250, waitMs));
    }
  }
}

// === GENERERING ===========================================================
interface GenResult {
  slot: PromptSlot;
  ok: boolean;
  apiError?: string;
  file?: string;
  bytes?: number;
  verdict?: Verdict;
}

async function generateOne(slot: PromptSlot, guard: RpmGuard): Promise<GenResult> {
  await guard.acquire();
  const apiKey = env('MINIMAX_API_KEY');
  if (!apiKey) return { slot, ok: false, apiError: 'MINIMAX_API_KEY saknas' };

  // 2026-10-29 — nätverksfel (connect timeout, socket reset) är INTE ett
  // HTTP-fel: `fetch` kastar. Utan try/catch dödar en sådan avbruten
  // anslutning HELA körningen (observerat 2026-10-29 efter 553 bilder).
  // Ett nätverksfel ska vara ett api-fel som grinden hanterar.
  let r: Response;
  try {
    r = await fetch(`${MINIMAX_BASE}/image_generation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: slot.prompt,
        response_format: 'url',
        width: IMG_W,
        height: IMG_H,
        aspect_ratio: IMG_ASPECT,
        n: 1,
        prompt_optimizer: true,
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    return { slot, ok: false, apiError: `nätverksfel: ${String((e as Error)?.message ?? e)}` };
  }
  if (!r.ok) return { slot, ok: false, apiError: `HTTP ${r.status}` };
  const j = (await r.json()) as {
    base_resp?: { status_code?: number; status_msg?: string };
    data?: { image_urls?: string[] };
    metadata?: { success_count?: number; failed_count?: number };
  };
  if (j?.base_resp?.status_code !== 0)
    return { slot, ok: false, apiError: `minimax ${j?.base_resp?.status_code}: ${j?.base_resp?.status_msg}` };
  const failed = j?.metadata?.failed_count ?? 0;
  if (failed > 0) return { slot, ok: false, apiError: `content safety: failed_count=${failed}` };
  const url = j?.data?.image_urls?.[0];
  if (!url) return { slot, ok: false, apiError: 'inget image_urls i svaret' };

  let img: Response;
  try {
    img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    return { slot, ok: false, apiError: `nedladdning nätverksfel: ${String((e as Error)?.message ?? e)}` };
  }
  if (!img.ok) return { slot, ok: false, apiError: `download ${img.status}` };
  const raw = Buffer.from(await img.arrayBuffer());

  // Stämpel: bottom-left / 150x36 + XMP-metadata (EU AI Act Art. 50)
  // applyAiComplianceToWebp stämpler OCH lägger in XMP-paketet i WebP-filen.
  // (Sharp skriver inte XMP till WebP — måste göras efter konverteringen.)
  const webp = await applyAiComplianceToWebp({
    buffer: raw,
    prompt: slot.prompt,
    model: IMAGE_MODEL,
    position: 'bottom-left',
  });

  const dir = path.join(OUT_DIR, slot.category);
  mkdirSync(dir, { recursive: true });
  const runTag = 'adp';
  const idx = String(readdirSync(dir).filter((f) => f.includes('_adp_')).length).padStart(3, '0');
  const base = buildFilenamePrefix(
    slot.category,
    slot.shotId,
    slot.pose as never,
    slot.light as never,
    runTag,
    Number(idx),
  );
  const file = path.join(dir, `${base}.webp`);
  writeFileSync(file, webp);
  writeFileSync(
    `${file}.json`,
    JSON.stringify(
      {
        category: slot.category,
        cluster_tag: slot.clusterTag,
        cluster_tags: [slot.clusterTag],
        zoomId: slot.shotId,
        pose: slot.pose,
        light: slot.light,
        prompt: slot.prompt,
        model: IMAGE_MODEL,
        minimax_task_id: null,
        minimax_url: url,
        stamped_path: file,
        stamped: true,
        stamp_variant: 'bottom-left',
        bytes_raw: raw.length,
        bytes_stamped: webp.length,
        created_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  return { slot, ok: true, file, bytes: webp.length };
}

// === GRANSKNING (M3 vision) ==============================================
interface Verdict {
  shot: string;
  text: string;
  artifacts: boolean;
  pass: boolean;
  reason: string;
  note?: string;
  votes?: number;
  spread?: string;
}

const VERIFY_PROMPT = `Du granskar en AI-genererad evenemangskortbild för EventPulse (Stockholm).
Svara ENDAST med ett JSON-objekt, inget annat, i exakt denna form:
{"shot":"<en av: extreme-closeup, closeup, medium-closeup, medium, medium-long, long-wide, wide, very-wide, establishing, aerial, unclear>","text":"<none | garbled | readable>","artifacts":<true|false>,"reason":"<max 15 ord>"}

Regler:
- "shot": bedöm KAMERANS avstånd till motivet, inte motivets storlek.
  extreme-closeup = bara händer/detaljer, closeup = ansikte, medium-closeup = huvud+axlar,
  medium = midja upp, medium-long = hela kroppen, long-wide = 3-4 personer syns,
  wide = hela scenen, very-wide = hela lokalen, establishing = exteriör med stad,
  aerial = snedvi uppifrån.
- "text": "garbled" om det finns text som ser ut som förvanskat/språkligt nonsens.
  "readable" om text är korrekt läsbar. "none" om ingen text.
  IGNORERA en liten märknings-etikett i bildens nedre vänstra hörn (den är
  tekniskt pålagd och är inte en del av bilden) — räkna den inte som text.
- "artifacts": true vid tydliga AI-fel (extra lemmar, förvrängda ansikten, nonsens-objekt).`;

interface RawVerdict {
  shot: string;
  text: string;
  artifacts: boolean;
  reason: string;
}

/** Plockar det SENASTE parsbara JSON-objektet (M3 levererar tankar + svar). */
function extractJson(raw: string): RawVerdict | null {
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  let found: RawVerdict | null = null;
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] !== '{') continue;
    const end = stripped.indexOf('}', i);
    if (end < 0) break;
    try {
      const o = JSON.parse(stripped.slice(i, end + 1));
      if (o && typeof o === 'object' && 'shot' in o) {
        found = {
          shot: String(o.shot ?? 'unclear'),
          text: String(o.text ?? 'none'),
          artifacts: Boolean(o.artifacts),
          reason: String(o.reason ?? ''),
        };
        i = end;
      }
    } catch {
      /* försök nästa */
    }
  }
  return found;
}

/** Ett enda M3-vision-anrop. */
async function checkOnce(file: string): Promise<RawVerdict | null> {
  const apiKey = env('MINIMAX_API_KEY');
  const buf = await sharp(file).resize({ width: 768 }).jpeg({ quality: 80 }).toBuffer();
  const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
  let res: Response;
  try {
    res = await fetch(`${MINIMAX_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: M3_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: VERIFY_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.1,
        // M3 kör extended thinking i samma fält — med 300 tokens ägdes hela
        // budgeten av tankarna och svaret kom aldrig. 2000 räcker (mätt:
        // reasoning_tokens 244–363).
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    // Nätverksfel ska ge "ingen giltig granskning", inte döda körningen.
    warn(`  M3-anrop misslyckades: ${String((e as Error)?.message ?? e)}`);
    return null;
  }
  if (!res.ok) return null;
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return extractJson(j?.choices?.[0]?.message?.content ?? '');
}

/**
 * Granskar en bild med N oberoende kontroller + majoritetsröstning.
 *
 * Varför 3 stycken: kalibrering 2026-10-28 visade att M3:s shot-klassning
 * varierar mellan körningar (samma familj-bild: wide, wide, establishing).
 * En enda kontroll skulle flagga felaktigt. text/artifacts-fälten är ännu
 * mer instabila (känd-dålig bild: readable, garbled, readable) och används
 * därför bara som mjuka signaler, inte som grind.
 */
async function verifyImage(file: string, targetShotId: string, votes = 3): Promise<Verdict> {
  const raw = await Promise.all(Array.from({ length: votes }, () => checkOnce(file)));
  const valid = raw.filter((r): r is RawVerdict => r !== null);
  if (!valid.length) {
    return { shot: 'unclear', text: 'unclear', artifacts: false, pass: false, reason: 'ingen giltig granskning' };
  }

  // Majoritetsröstning på shot
  const tally = new Map<string, number>();
  for (const v of valid) tally.set(v.shot, (tally.get(v.shot) ?? 0) + 1);
  const [majorShot, majorCount] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  const garbled = valid.filter((v) => v.text === 'garbled').length;
  const artifacts = valid.filter((v) => v.artifacts).length;

  const targetSlug = ID_TO_SLUG[targetShotId];
  const targetScale = SHOT_SCALE[targetSlug];
  const actualScale = SHOT_SCALE[majorShot];
  const reasons: string[] = [];
  const notes: string[] = [];

  // Grindens kärna är INTE ett numeriskt avstånd utan en familjeregel.
  // Mätt drift (11 bilder, community, 2026-10-28): Δ+1 4 st, Δ+2 4 st,
  // Δ0 1 st, Δ-1 1 st, Δ+3 1 st. MiniMax drar alltid MOT bredare, aldrig mot
  // närbild — vilket är exakt den riktning användaren vill ha. Därför:
  //
  // 1. Mål ∈ wide-familj  → hårt fel om bilden landade i close-familj.
  //    (Detta är "fula"-defekten: en närbild där en helhetsbild skulle stå.)
  // 2. Mål ∈ close-familj → bilden får glidit UT i wide-familj (mjuk notis,
  //    variantförlust men mixen blir bara mer i linje med editorial-önskemålet).
  // 3. Mål ∈ close-familj → hårt fel om bilden är >2 steg snävare än målet
  //    (t.ex. mål MED(3) träffade EC(0)) — då är den för tight för kortet.
  const isWideTarget = targetScale >= 5;
  const isWideActual = actualScale !== undefined && actualScale >= 5;

  if (actualScale === undefined) {
    reasons.push(`okänd shot-nivå (${majorShot})`);
  } else if (isWideTarget) {
    if (!isWideActual) reasons.push(`närbild (${majorShot}) där ${targetSlug} skulle stå`);
  } else if (isWideActual) {
    notes.push(`glidde till ${majorShot} (mål ${targetSlug}) — variantförlust`);
  } else if (targetScale - actualScale > 2) {
    reasons.push(`för snåvt (${majorShot} vs ${targetSlug})`);
  }

  if (garbled >= 2) reasons.push(`förvanskat text ${garbled}/${valid.length}`);
  if (artifacts >= 2) reasons.push(`artefakter ${artifacts}/${valid.length}`);

  return {
    shot: majorShot,
    text: garbled >= 2 ? 'garbled' : 'none',
    artifacts: artifacts >= 2,
    pass: reasons.length === 0,
    reason: reasons.length ? reasons.join(', ') : `ok (${majorShot}, ${majorCount}/${valid.length} röster)`,
    note: notes.length ? notes.join('; ') : undefined,
    votes: valid.length,
    spread: [...tally.entries()].map(([k, v]) => `${k}:${v}`).join(' '),
  };
}

// === TILSTÅND =============================================================
interface State {
  round: number;
  size: number;
  generated: number;
  passed: number;
  failed: number;
  apiErrors: number;
  planCursor: Record<string, number>;
}
function loadState(): State {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
    } catch { /* ignore */ }
  }
  return { round: 0, size: 0, generated: 0, passed: 0, failed: 0, apiErrors: 0, planCursor: {} };
}
function saveState(s: State): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(s, null, 2));
  renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
}
function appendVerify(row: unknown): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(VERIFY_LOG, `${JSON.stringify(row)}\n`, { flag: 'a' });
}

// === PROGRESS ============================================================
// Dashboardens progress-bar läser den här filen. Den skrivs efter VARJE
// bild (inte bara per omgång) så att baren rör sig jämnt.
interface Progress {
  startedAt: string;
  updatedAt: string;
  round: number;
  size: number;
  target: number;
  remaining: number;
  generated: number;
  passed: number;
  failed: number;
  apiErrors: number;
  lastFile: string | null;
  lastCategory: string | null;
  lastVerdict: string | null;
  done: boolean;
}
function writeProgress(p: Progress): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(`${PROGRESS_FILE}.tmp`, JSON.stringify(p, null, 2));
    renameSync(`${PROGRESS_FILE}.tmp`, PROGRESS_FILE);
  } catch { /* progress får aldrig fälla genereringen */ }
}

// === LÅS ================================================================
// Globalt lås så att bara EN adaptive_image_gen-process kan köra åt gång.
// MiniMax image_generation har 10 RPM tak — två processer (t.ex.
// bakgrundskörning + dashboardknapp) skulle tillsammans köra in i 429-fel.
// Låset tas över automatiskt om ägaren dog (stale PID).
function acquireLock(): (() => void) | null {
  mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(LOCK_FILE, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      closeSync(fd);
      const release = () => {
        try {
          const cur = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
          if (cur.pid === process.pid) rmSync(LOCK_FILE, { force: true });
        } catch { /* ignore */ }
      };
      process.on('exit', release);
      // 'exit'-eventet körs INTE vid SIGINT/SIGTERM — utan dessa handlers
      // ligger låsfilen kvar efter en avbruten körning. (Stale lås tas
      // över av nästa start, men operatören ska inte behöva veta det.)
      for (const sig of ['SIGINT', 'SIGTERM'] as const) {
        process.on(sig, () => {
          release();
          process.exit(sig === 'SIGINT' ? 130 : 143);
        });
      }
      return release;
    } catch {
      // Låset finns — lever ägaren?
      let ownerPid = 0;
      try {
        ownerPid = Number(JSON.parse(readFileSync(LOCK_FILE, 'utf8'))?.pid ?? 0);
      } catch { /* trasig låsfil */ }
      if (ownerPid > 0) {
        try {
          process.kill(ownerPid, 0);
          warn(`en annan körning har låset (pid ${ownerPid}) — avbryter`);
          return null;
        } catch {
          /* ägaren lever inte → ta över */
        }
      }
      try { rmSync(LOCK_FILE, { force: true }); } catch { /* ignore */ }
    }
  }
  return null;
}

// === HUVUDLOOP ===========================================================
async function main(): Promise<void> {
  const args = parseArgs();

  // Egen mapp för state/verify/progress (dashboardens körningar).
  if (args.runDir) {
    STATE_DIR = path.resolve(args.runDir);
    STATE_FILE = path.join(STATE_DIR, 'state.json');
    VERIFY_LOG = path.join(STATE_DIR, 'verify.ndjson');
    PROGRESS_FILE = path.join(STATE_DIR, 'progress.json');
  }

  // Globalt lås — bara en körning åt gång (RPM-taket är per process).
  const releaseLock = acquireLock();
  if (!releaseLock) {
    log('avbryter: en annan adaptive_image_gen-körning pågår');
    process.exitCode = 2;
    return;
  }

  if (args.reset) {
    // Nollställ räknare + granskningslogg så en ny körning inte ärvde
    // förra körningens totalsiffror (state.loadState() läser dem annars).
    for (const p of [STATE_FILE, VERIFY_LOG]) {
      if (existsSync(p)) rmSync(p);
    }
    log('state återställd (--reset)');
  }
  const state = loadState();
  const plan = await buildPlan(args.categories, args.extra);

  if (!plan.length) {
    log('ingen plan — inget att generera');
    writeProgress({
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      round: 0,
      size: 0,
      target: 0,
      remaining: 0,
      generated: 0,
      passed: 0,
      failed: 0,
      apiErrors: 0,
      lastFile: null,
      lastCategory: null,
      lastVerdict: 'ingen plan',
      done: true,
    });
    return;
  }
  const planTotal = plan.reduce((a, p) => a + p.total, 0);
  log(`plan: ${plan.length} kategorier, ${planTotal} bilder totalt behov`);
  for (const p of plan.slice(0, 8)) {
    log(`  ${p.category.padEnd(18)} events=${String(p.events).padStart(5)} target=${String(p.target).padStart(3)} behov=${String(p.total).padStart(3)}  ${Object.entries(p.perShot).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  }
  if (plan.length > 8) log(`  ... + ${plan.length - 8} till`);

  // --dry-run: visa planen men generera ingenting. Används för att verifiera
  // planberäkningen (t.ex. --extra) utan att spendera API-anrop.
  if (args.dryRun) {
    log(`DRY-RUN: skulle generera ${planTotal} bilder i ${plan.length} kategorier`);
    releaseLock?.();
    return;
  }

  // Prompt-materialisering är LAZY: en shot-nivås prompts byggs först när
  // slingan faktiskt behöver dem. Annars skulle varje körning vänta på hundratals
  // M3-anrop innan en enda bild genererades.
  const providers: Provider[] = [];
  for (const p of plan) {
    for (const [shotId, count] of Object.entries(p.perShot)) {
      providers.push({ category: p.category, shotId, remaining: count, buf: [] });
    }
  }
  log(`${providers.length} prompt-leveranser i kö`);

  const guard = new RpmGuard(RPM_SAFE);
  let size = state.size || args.start;
  let round = state.round;
  let generated = state.generated;
  let passed = state.passed;
  let failed = state.failed;
  let apiErrors = state.apiErrors;
  let providerIdx = 0;

  /** Materialiserar prompts tills vi har n stycken (eller kön tar slut). */
  async function takeSlots(n: number): Promise<PromptSlot[]> {
    const out: PromptSlot[] = [];
    while (out.length < n && providerIdx < providers.length) {
      const pr = providers[providerIdx];
      if (!pr.buf.length) {
        log(`  bygger prompts (M3): ${pr.category}/${pr.shotId} × ${pr.remaining} ...`);
        const built = await buildZoomPrompts({
          category: pr.category,
          tagFrequency: loadCluster(pr.category)?.tag_frequency ?? {},
          count: pr.remaining,
          zoomFilter: [pr.shotId as never],
          rootDir: process.cwd(),
          maxConcurrency: 7,
        });
        const mocks = built.filter((b) => b.model === 'mock-fallback').length;
        if (mocks) warn(`  ${mocks} mock-fallback hoppades över för ${pr.category}/${pr.shotId}`);
        pr.buf = built
          .filter((b) => b.model !== 'mock-fallback')
          .map((b) => ({
            category: pr.category,
            shotId: b.zoomId,
            clusterTag: b.cluster_tag,
            pose: b.pose,
            light: b.light,
            prompt: b.prompt,
          }));
        pr.remaining = 0;
      }
      while (pr.buf.length && out.length < n) out.push(pr.buf.shift() as PromptSlot);
      if (!pr.buf.length) providerIdx++;
    }
    return out;
  }

  const remainingTotal = (): number =>
    providers.slice(providerIdx).reduce((a, p) => a + p.remaining + p.buf.length, 0);

  // Progress skrivs efter VARJE bild så att dashboardens bar rör sig jämnt.
  const startedAt = new Date().toISOString();
  const lastInfo: { file: string | null; category: string | null; verdict: string | null } = {
    file: null,
    category: null,
    verdict: null,
  };
  const emitProgress = (
    info?: { file: string; category: string; verdict: string },
    done = false,
  ): void => {
    if (info) {
      lastInfo.file = info.file;
      lastInfo.category = info.category;
      lastInfo.verdict = info.verdict;
    }
    writeProgress({
      startedAt,
      updatedAt: new Date().toISOString(),
      round,
      size,
      target: planTotal,
      remaining: remainingTotal(),
      generated,
      passed,
      failed,
      apiErrors,
      lastFile: lastInfo.file,
      lastCategory: lastInfo.category,
      lastVerdict: lastInfo.verdict,
      done,
    });
  };

  while (round < args.maxRounds && remainingTotal() > 0 && generated < args.maxTotal) {
    round++;
    const take = Math.min(size, remainingTotal(), args.maxTotal - generated);
    if (take <= 0) break;
    const batch = await takeSlots(take);

    log(`--- omgång ${round}: ${batch.length} bilder (storlek=${size}, totalt ${generated}/${args.maxTotal}) ---`);

    // Generera med begränsad parallellism (håll oss under RPM-taket).
    //
    // 2026-10-29 — granskningen sker INNE i workern, inte i en separat fas
    // efteråt. Förut var strukturen "generera omgång → granska omgång →
    // nästa omgång", vilket gjorde att arbetarna stod stilla under
    // granskningen. Mätt 2026-10-29: 3,3 bilder/min med separata faser,
    // 2,8 bilder/min med concurrency 2. Med överlappande granskning blir
    // flaskhalsen RPM-guarden (9/min) i stället för väntetiden.
    const results: GenResult[] = [];
    let idx = 0;
    const workers = Array.from({ length: Math.min(args.concurrency, batch.length) }, async () => {
      for (;;) {
        const i = idx++;
        if (i >= batch.length) return;
        const res = await generateOne(batch[i], guard);
        if (res.ok) {
          log(`  ✓ ${path.basename(res.file ?? '')}  [${res.slot.shotId}/${res.slot.clusterTag}]`);
          // Granska direkt — 3 röster parallellt, medan andra workers
          // fortsätter generera nästa bild.
          res.verdict = await verifyImage(res.file as string, res.slot.shotId);
          // Räknarna uppdateras per bild (inte per omgång) så att
          // progress-baren i dashboarden följer med i realtid.
          generated++;
          if (res.verdict.pass) passed++;
          else failed++;
          emitProgress({
            file: path.basename(res.file ?? ''),
            category: res.slot.category,
            verdict: `${res.verdict.pass ? '✓' : '✗'} ${res.slot.shotId}/${res.slot.clusterTag}: ${res.verdict.reason}`,
          });
        } else {
          warn(`  ✗ ${res.slot.shotId}/${res.slot.clusterTag}: ${res.apiError}`);
          apiErrors++;
          emitProgress();
        }
        results.push(res);
      }
    });
    await Promise.all(workers);

    // Samla grindens utfall (granskningen har redan skett i workern och
    // räknarna är redan uppdaterade där).
    const okResults = results.filter((r) => r.ok);
    let roundFail = 0;
    for (const res of okResults) {
      const v = res.verdict!;
      if (!v.pass) roundFail++;
      appendVerify({
        ts: new Date().toISOString(),
        round,
        file: res.file,
        category: res.slot.category,
        cluster_tag: res.slot.clusterTag,
        target_shot: res.slot.shotId,
        verdict: v,
      });
      log(`  ${v.pass ? '✓' : '✗'} ${res.slot.shotId}/${res.slot.clusterTag}: ${v.reason}${v.spread ? `  [${v.spread}]` : ''}${v.note ? `  (${v.note})` : ''}`);
    }
    const roundApiErrors = results.length - okResults.length;

    // GRIND
    const sizeBefore = size;
    if (roundApiErrors > 0 || roundFail > 0) {
      size = Math.max(1, Math.floor(size / 2));
      warn(
        `omgång ${round}: ${roundApiErrors} API-fel, ${roundFail} innehålls-fel → storlek ${sizeBefore} → ${size}`,
      );
      if (roundApiErrors > 0) {
        log('vänta 20s (rate limit / nätverksproblem) ...');
        await sleep(20_000);
      }
    } else {
      size = Math.min(size * 2, 64);
      log(`omgång ${round}: allt godkänt → storlek ${sizeBefore} → ${size}`);
    }

    saveState({ round, size, generated, passed, failed, apiErrors, planCursor: {} });
    emitProgress();
    log(
      `  status: genererade=${generated} godkända=${passed} underkända=${failed} api-fel=${apiErrors} kvar=${remainingTotal()}`,
    );
  }

  emitProgress(undefined, true);
  log(`KLART. genererade=${generated} godkända=${passed} underkända=${failed} api-fel=${apiErrors}`);
  log(`logg: ${VERIFY_LOG}`);
  releaseLock?.();

  // SLUTRAPPORT: producerad mix vs målmix
  const rows = fs_exists(VERIFY_LOG)
    ? readFileSync(VERIFY_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const byTarget: Record<string, number> = {};
  const byActual: Record<string, number> = {};
  for (const r of rows) {
    byTarget[r.target_shot] = (byTarget[r.target_shot] ?? 0) + 1;
    byActual[r.verdict.shot] = (byActual[r.verdict.shot] ?? 0) + 1;
  }
  const wideActual = Object.entries(byActual)
    .filter(([k]) => (SHOT_SCALE[k] ?? -1) >= 5)
    .reduce((a, [, v]) => a + v, 0);
  const totalActual = Object.values(byActual).reduce((a, b) => a + b, 0);
  log('--- producerad mix (granskade bilder) ---');
  log(`  mål per shot: ${JSON.stringify(byTarget)}`);
  log(`  faktisk per shot: ${JSON.stringify(byActual)}`);
  log(`  wide+establishing+aerial-andel: ${totalActual ? ((100 * wideActual) / totalActual).toFixed(1) : '0'}% (mål 75%, editorial-önskemål 2026-10-21)`);
}

main().catch((e) => {
  console.error('[adaptive] FEL:', e);
  process.exit(1);
});
