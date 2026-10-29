/**
 * BFL-generator/bin/bfl-zoom-batch.ts
 *
 * NY pipeline (parallell med bfl-batch.ts, rör inte originalet).
 *
 * Vad den gör (Alt 2):
 *   1. LOKAL check: fetchLibraryCount(cat) + countEventsByCategory()
 *      mot image_library / events i Supabase.
 *   2. Beräknar target per kategori enligt användarens regel:
 *        target = 20 + max(0, ceil((events - 600) / 30))
 *      Alltid minst 20, ovan 600 events: 1/30 events.
 *   3. Två-fas-fyllning:
 *        Fas 1: fyller gap mot target. count-vikten proportionell mot
 *               tagFrequency (clusterstorlek) — INTE gap-priority.
 *        Fas 2: om count > totalGap, allokerar resten viktat mot
 *               tagFrequency mellan kategorier som har flest events.
 *   4. Genererar prompts via zoom-prompter.ts (10 zoom × 3 pose × 3 ljus).
 *   5. Genererar bilder med MiniMax image-01.
 *   6. Stämplar med "AI-generated" (samma SVG som bfl-batch.ts).
 *   7. Sparar under local_image_library_stamped/<cat>/ (eller --out).
 *
 * CLI:
 *   tsx bin/bfl-zoom-batch.ts --count=10 [--categories=music,community]
 *     [--model=minimax-image-01] [--variant=legacy|small]
 *     [--out=local_image_library_stamped] [--dry-run]
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ DEPRECATED (2026-10-29) — LÄGG INTE NYA BILDER MED DETTA SKRIPT.
 *
 * Detta skript har en EGEN stämpelgenerator (`buildStampSvg`) som duplicerar
 * 08-Agent/tools/ai_compliance.ts — och skillnaden är inte kosmetisk:
 *
 *   - Ingen maskinläsbar XMP skrivs alls (skriptet använder aldrig
 *     applyAiCompliance / buildAiXmp).
 *   - Ingen withMetadata() → leverantörens signerade AIGC-märkning i EXIF
 *     (MiniMax image-01) försvinner i konverteringen.
 *   - Aspect ratio 16:9 (1280×720), inte 3:2 som UI:t kräver.
 *   - Stämpeln är den engelska legacy-pillen 240×64 ("AI-generated") i nedre
 *     högra hörnet — användarbeslutet 2026-10-29 är "AI-genererad" på svenska
 *     i nedre vänstra hörnet (150×36).
 *
 * Det är så här de 488 gamla bilderna i local_image_library_stamped/ blev
 * till — de har ingen maskinlösbar märkning alls.
 *
 * ANVÄND I STÄLLET: scripts/adaptive_image_gen.ts
 *   → applyAiComplianceToWebp() i 08-Agent/tools/ai_compliance.ts
 *   (stämplar, bevarar AIGC-märkningen, skriver XMP in i WebP-filen, 3:2)
 *
 * Att köra det här skriptet igen skulle reproducera de gamla problemen.
 * ═══════════════════════════════════════════════════════════════════════════

 */

import * as path from 'node:path';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import sharp from 'sharp';

import { buildZoomPrompts, ZOOM_LEVELS, buildRoundRobin, buildFilenamePrefix } from '../lib/zoom-prompter.js';
import {
  loadCoverageState,
  registerCombo,
  persist as persistCoverage,
  existingCombos,
  type CoverageState,
} from '../lib/zoom-coverage-state.js';

// === KONSTANTER (samma som bfl-batch.ts) ====================================
const IMG_W = 1024;
const IMG_H = 576;
const MINIMAX_BASE = 'https://api.minimax.io/v1';
const MINIMAX_IMAGE_MODEL = 'image-01';

// === STÄMPLING (samma SVG-konstanter som bfl-batch.ts) =====================
const STAMP_WIDTH = 240;
const STAMP_HEIGHT = 64;
const STAMP_INSET = 24;
const STAMP_OPACITY = 0.82;
const STAMP_DOT_R = 8;
const STAMP_FONT_SIZE = 22;
const STAMP_TEXT = 'AI-generated';
const STAMP_BG = 'rgba(15,15,18,0.82)';
const STAMP_STROKE = 'rgba(255,180,84,0.65)';
const STAMP_DOT_FILL = '#FFB454';
const STAMP_FONT = 'Arial, sans-serif';
const STAMP_FG = '#FFFFFF';

// === ANVÄNDARENS KVOT-FORMEL =============================================
const PHASE_1_QUOTA = 20;          // alltid minst 20/cat
const PHASE_2_RATE = 30;           // 1/30 events
const PHASE_2_MIN_EVENTS = 600;    // bara ovanför 600 events

/**
 * Skriv progress till run-state-filen (för UI-räknare i dashboard).
 * Läser befintlig state om den finns, slår ihop med uppdaterad imageCount + log.
 */
function writeRunStateProgress(args: CliArgs, imageCount: number, extraLog: string[] = []): void {
  if (!args.runId) return;
  const statePath = path.join(process.cwd(), 'tmp', 'bfl_runs', `zoom_${args.runId}.json`);
  let prev: any = {};
  if (existsSync(statePath)) {
    try { prev = JSON.parse(readFileSync(statePath, 'utf8')); } catch { /* ignore */ }
  }
  const merged = {
    ...prev,
    runId: args.runId,
    imageCount,
    log: [...(prev.log ?? []), ...extraLog].slice(-200),
    lastUpdated: new Date().toISOString(),
  };
  try {
    writeFileSync(statePath, JSON.stringify(merged, null, 2));
  } catch {
    // ignore — får inte krascha bilden pga run-state
  }
}

/**
 * Finalisera run-state med terminal-status (success/failed).
 * Batch är SINGLE SOURCE OF TRUTH — orchestrator's child.on('close') är
 * opålitlig när stdout/stderr stängs under tiden log-räknaren kör. Vi skriver
 * därför slut-status själva så UI kan visa "klar" istället för "running" för evigt.
 */
function finalizeRunState(
  args: CliArgs,
  imageCount: number,
  status: 'success' | 'failed',
  exitCode: number,
  extraLog: string[] = [],
): void {
  if (!args.runId) return;
  const statePath = path.join(process.cwd(), 'tmp', 'bfl_runs', `zoom_${args.runId}.json`);
  let prev: any = {};
  if (existsSync(statePath)) {
    try { prev = JSON.parse(readFileSync(statePath, 'utf8')); } catch { /* ignore */ }
  }
  const merged = {
    ...prev,
    runId: args.runId,
    imageCount,
    status,
    finishedAt: new Date().toISOString(),
    exitCode,
    log: [...(prev.log ?? []), ...extraLog].slice(-200),
    lastUpdated: new Date().toISOString(),
  };
  // Skriv INNAN vi returnerar — och logga om det gick bra/illa
  try {
    writeFileSync(statePath, JSON.stringify(merged, null, 2));
    console.log(`[zoom-batch] finalizeRunState wrote status=${status} exitCode=${exitCode} to ${statePath}`);
  } catch (e) {
    console.error(`[zoom-batch] finalizeRunState FAILED to write: ${e instanceof Error ? e.message : String(e)}`);
    console.error(`[zoom-batch] attempted path: ${statePath}`);
  }
}

function computeTarget(events: number): { phase1: number; phase2: number; total: number } {
  const phase1 = PHASE_1_QUOTA;
  const phase2 = Math.max(0, Math.ceil((events - PHASE_2_MIN_EVENTS) / PHASE_2_RATE));
  return { phase1, phase2, total: phase1 + phase2 };
}

// === CLI ===================================================================
interface CliArgs {
  count: number;
  categories: string[] | null;
  model: string;
  variant: 'legacy' | 'small';
  out: string;
  rawDir: string;     // NY: där rå PNG sparas
  dryRun: boolean;
  concurrency: number;
  runId: string | null;  // NY: om satt, skriv progress hit för UI-räknare
  resetState: boolean;  // NY: töm state/zoom-coverage.json innan pipeline (för "5 batchar × 10 = 50 nya")
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    count: 10,
    categories: null,
    model: MINIMAX_IMAGE_MODEL,
    variant: 'legacy',
    out: 'local_image_library_stamped',
    rawDir: 'local_image_library',
    dryRun: false,
    concurrency: 4,
    runId: null,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--count=')) out.count = parseInt(arg.slice(8), 10);
    else if (arg.startsWith('--categories=')) {
      out.categories = arg.slice(13).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--model=')) out.model = arg.slice(8);
    else if (arg.startsWith('--variant=')) {
      const v = arg.slice(10);
      if (v === 'legacy' || v === 'small') out.variant = v;
    } else if (arg.startsWith('--out=')) out.out = arg.slice(6);
    else if (arg.startsWith('--raw-dir=')) out.rawDir = arg.slice(10);
    else if (arg === '--no-raw') out.rawDir = '';
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--concurrency=')) out.concurrency = parseInt(arg.slice(14), 10);
    else if (arg.startsWith('--run-id=')) out.runId = arg.slice('--run-id='.length);
    else if (arg === '--reset-state') out.resetState = true;
  }
  return out;
}

// === SUPABASE-CHECKAR =====================================================
async function fetchLibraryCount(category: string): Promise<number> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000); // BUG-FIX 2026-10-21: 10s timeout för att undvika pipeline-hängning
  try {
    const res = await fetch(
      `${url}/rest/v1/image_library?category_slug=eq.${encodeURIComponent(category)}&select=id`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: controller.signal,
      },
    );
    if (!res.ok) return 0;
    return ((await res.json()) as unknown[]).length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[zoom-batch] fetchLibraryCount(${category}) misslyckades: ${msg}`);
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

async function countEventsByCategory(opts: { timeoutMs?: number } = {}): Promise<Record<string, number>> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return {};
  const timeoutMs = opts.timeoutMs ?? 30_000; // BUG-FIX 2026-10-21: absolut timout för att undvika hängning
  const out: Record<string, number> = {};
  const PAGE = 1000;
  let offset = 0;
  const startedAt = Date.now();
  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      console.warn(`[zoom-batch] countEventsByCategory: timeout efter ${timeoutMs}ms (offset=${offset})`);
      return out;
    }
    const controller = new AbortController();
    const fetchTimer = setTimeout(() => controller.abort(), 10_000); // per-page 10s
    try {
      const res = await fetch(
        `${url}/rest/v1/events?select=category_slug&offset=${offset}&limit=${PAGE}`,
        {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          signal: controller.signal,
        },
      );
      if (!res.ok) break;
      const rows = (await res.json()) as Array<{ category_slug: string | null }>;
      if (!rows.length) break;
      for (const r of rows) {
        if (r.category_slug) out[r.category_slug] = (out[r.category_slug] ?? 0) + 1;
      }
      if (rows.length < PAGE) break;
      offset += PAGE;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[zoom-batch] countEventsByCategory page-fel vid offset=${offset}: ${msg}`);
      return out; // graceful exit — använd tom data istället för att hänga
    } finally {
      clearTimeout(fetchTimer);
    }
  }
  return out;
}

// === CLUSTER-FIL =========================================================
interface ClusterFile {
  category: string;
  total_events: number;
  tag_frequency: Record<string, number>;
}

function loadClusterFile(category: string): ClusterFile | null {
  const candidates = [
    path.join(process.cwd(), 'tmp', `cluster_${category}.json`),
    path.join(process.cwd(), 'BFL-generator', 'tmp', `cluster_${category}.json`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as ClusterFile;
  }
  return null;
}

// === MINIMAX GENERERING ===================================================
async function generateMinimax(prompt: string, model: string): Promise<{ buf: Buffer; url: string; taskId: string | null }> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MINIMAX_API_KEY saknas');
  const r = await fetch(`${MINIMAX_BASE}/image_generation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      prompt,
      response_format: 'url',
      width: IMG_W,
      height: IMG_H,
      aspect_ratio: '16:9',
      n: 1,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`MiniMax HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json() as {
    base_resp?: { status_code?: number; status_msg?: string };
    data?: { image_urls?: string[]; task_id?: string };
  };
  const code = j?.base_resp?.status_code;
  if (code !== 0) throw new Error(`MiniMax status_code=${code} msg=${j?.base_resp?.status_msg}`);
  const urls = j?.data?.image_urls ?? [];
  if (!urls.length) throw new Error('No image_urls in MiniMax response');
  const img = await fetch(urls[0]);
  if (!img.ok) throw new Error(`MiniMax download ${img.status}`);
  return { buf: Buffer.from(await img.arrayBuffer()), url: urls[0], taskId: j?.data?.task_id ?? null };
}

// === STÄMPLING ============================================================
function buildStampSvg(variant: 'legacy' | 'small'): string {
  const w = variant === 'small' ? 180 : STAMP_WIDTH;
  const h = variant === 'small' ? 48 : STAMP_HEIGHT;
  const opacity = variant === 'small' ? 0.50 : STAMP_OPACITY;
  const fontSize = variant === 'small' ? 16 : STAMP_FONT_SIZE;
  const dotR = variant === 'small' ? 6 : STAMP_DOT_R;
  const bgFill = `rgba(15,15,18,${opacity})`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${Math.floor(h / 2)}" ry="${Math.floor(h / 2)}"
        fill="${bgFill}"
        stroke="${STAMP_STROKE}" stroke-width="1.5"/>
  <circle cx="26" cy="${h / 2}" r="${dotR}" fill="${STAMP_DOT_FILL}"/>
  <text x="${26 + dotR + 10}" y="${h / 2 + fontSize / 3}" font-family="${STAMP_FONT}" font-size="${fontSize}"
        font-weight="bold" fill="${STAMP_FG}" letter-spacing="0.5">${STAMP_TEXT}</text>
</svg>`;
}

async function stampImage(buf: Buffer, variant: 'legacy' | 'small'): Promise<Buffer> {
  const w = variant === 'small' ? 180 : STAMP_WIDTH;
  const h = variant === 'small' ? 48 : STAMP_HEIGHT;
  const left = IMG_W - w - STAMP_INSET;
  const top = IMG_H - h - STAMP_INSET;
  return await sharp(buf)
    .composite([{ input: Buffer.from(buildStampSvg(variant)), left, top }])
    .webp({ quality: 88 })
    .toBuffer();
}

// === FÖRDELNINGSLÖSARE ====================================================
interface CategoryState {
  category: string;
  library: number;
  events: number;
  target: number;
  totalGap: number;
  tagFrequency: Record<string, number>;
  weight: number;  // andel av total count
  toGenerate: number;
}

function distributeCount(
  cats: CategoryState[],
  totalCount: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (cats.length === 0 || totalCount <= 0) return out;

  const totalWeight = cats.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return out;

  // Round-robin med största rest
  const raw = cats.map((c) => ({ cat: c.category, exact: (totalCount * c.weight) / totalWeight }));
  const floors = raw.map((r) => ({ cat: r.cat, slots: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let used = floors.reduce((s, r) => s + r.slots, 0);
  floors.sort((a, b) => b.rem - a.rem);
  let i = 0;
  while (used < totalCount && i < floors.length) {
    floors[i].slots++;
    used++;
    i++;
  }
  for (const f of floors) out.set(f.cat, f.slots);
  return out;
}

// === HUVUD-FLOW ===========================================================
async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  console.log(`[zoom-batch] count=${args.count} categories=${args.categories?.join(',') ?? '*'} model=${args.model} variant=${args.variant}`);

  // 1. Hämta events per kategori
  const eventsByCat = await countEventsByCategory();
  const cats = args.categories ?? Object.keys(eventsByCat);
  console.log(`[zoom-batch] checking ${cats.length} kategorier...`);

  // 2. Hämta library-counts parallellt och bygg state
  // BUG-FIX 2026-10-21: parallellisera SB-anrop för att undvika N×10s-sekventiell-väntan
  const states: CategoryState[] = [];
  const catsWithEvents = cats.filter((cat) => (eventsByCat[cat] ?? 0) > 0);
  const libraryResults = await Promise.all(
    catsWithEvents.map(async (cat) => ({
      cat,
      events: eventsByCat[cat] ?? 0,
      library: await fetchLibraryCount(cat),
      cluster: loadClusterFile(cat),
    })),
  );
  for (const { cat, events, library, cluster } of libraryResults) {
    if (!cluster || Object.keys(cluster.tag_frequency).length === 0) {
      console.log(`[zoom-batch] ${cat.padEnd(20)} ${events} events / ${library} lib → SKIP (no cluster file)`);
      continue;
    }
    const t = computeTarget(events);
    states.push({
      category: cat,
      library,
      events,
      target: t.total,
      totalGap: Math.max(0, t.total - library),
      tagFrequency: cluster.tag_frequency,
      weight: events, // clusterstorlek = antal events
      toGenerate: 0,
    });
  }

  // 3. Lokal print av state
  console.log('');
  console.log('  ' + 'kategori'.padEnd(20) + 'events'.padStart(8) + 'library'.padStart(9) + 'target'.padStart(8) + 'gap'.padStart(6));
  console.log('  ' + '─'.repeat(56));
  for (const s of states) {
    console.log(`  ${s.category.padEnd(18)} ${String(s.events).padStart(8)} ${String(s.library).padStart(8)} ${String(s.target).padStart(7)} ${String(s.totalGap).padStart(5)}`);
  }
  console.log('');

  // 4. Två-fas-fördelning:
  //    Fas 1: prioritera gap. count <= totalGap: alla går mot gap (viktat mot events).
  //    Fas 2: count > totalGap: fyll gap först, resten vägs mot clusterstorlek.
  const totalGap = states.reduce((s, c) => s + c.totalGap, 0);
  if (args.count <= totalGap) {
    // Allt går mot gap (viktfördelat mot events per kategori)
    const allocation = distributeCount(states, args.count);
    for (const s of states) s.toGenerate = allocation.get(s.category) ?? 0;
  } else {
    // Fas 1 fyller alla gaps (men cap vid totalGap, inte count)
    const fas1 = distributeCount(states, totalGap);
    for (const s of states) s.toGenerate = fas1.get(s.category) ?? 0;
    // Fas 2 — resterande count
    const remaining = args.count - totalGap;
    if (remaining > 0) {
      const fas2 = distributeCount(states, remaining);
      for (const s of states) s.toGenerate += fas2.get(s.category) ?? 0;
    }
  }

  console.log(`[zoom-batch] fördelning (count=${args.count}, totalGap=${totalGap}):`);
  for (const s of states) {
    if (s.toGenerate === 0) continue;
    console.log(`  ${s.category.padEnd(20)} +${s.toGenerate} bilder  (weight=${s.weight})`);
  }
  console.log('');

  if (args.dryRun) {
    console.log('[zoom-batch] --dry-run, avbryter före bildgenerering.');
    return;
  }

  // 5. Generera bilder per kategori
  mkdirSync(args.out, { recursive: true });
  const stampVariant = args.variant;

  // Total ackumulator för slut-status (finalizeRunState skriver detta som imageCount)
  let totalOkCount = 0;

  // Ladda coverage-state — används för att skippa redan-existerande kombinationer
  // och registrera nya efter generering.
  let coverage: CoverageState;
  if (args.resetState) {
    console.log('[zoom-batch] --reset-state: tömmer state/zoom-coverage.json för variation');
    const { resetCoverageState } = await import('../lib/zoom-coverage-state.js');
    coverage = resetCoverageState(process.cwd());
  } else {
    coverage = loadCoverageState(process.cwd());
  }
  console.log(`[zoom-batch] coverage-state: ${Object.keys(coverage.combos).length} kategorier, totalt ${Object.values(coverage.totals).reduce((s, n) => s + n, 0)} bilder`);

  for (const s of states) {
    if (s.toGenerate === 0) continue;
    console.log(`[zoom-batch] ${s.category}: genererar ${s.toGenerate} bilder`);
    const catDir = path.join(args.out, s.category);
    mkdirSync(catDir, { recursive: true });

    // 6. Bygg prompts via zoom-prompter (round-robin-fördelning)
    const prompts = await buildZoomPrompts({
      category: s.category,
      tagFrequency: s.tagFrequency,
      count: s.toGenerate,
      maxConcurrency: args.concurrency,
    });

    // 6a. Initial progress write (UI ser kategori-byte direkt)
    // BUG-FIX 2026-10-19: skicka totalOkCount (totalt hittills över tidigare kategorier),
    // inte 0 — annars återställs imageCount vid varje kategori-byte.
    writeRunStateProgress(args, totalOkCount, [`[zoom-batch] ${s.category}: genererar ${s.toGenerate} bilder`]);

    // 6b. Skippa de prompts vars (tag, zoom, pose, light) redan finns i state
    const skipLog: string[] = [];
    const filteredPrompts = prompts.filter((p) => {
      const existing = existingCombos(coverage, s.category, p.cluster_tag);
      const key = `${p.zoomId}|${p.pose}|${p.light}`;
      if (existing.has(key)) {
        skipLog.push(`${p.cluster_tag}/${p.zoomId}/${p.pose}/${p.light}`);
        return false;
      }
      return true;
    });
    if (skipLog.length) {
      console.log(`  ↳ hoppade över ${skipLog.length} redan-existerande: ${skipLog.slice(0, 3).join(', ')}${skipLog.length > 3 ? '…' : ''}`);
    }

    // 7. Generera varje bild (sekventiellt per prompt för att undvika racing mot MiniMax-quota)
    let okCount = 0;
    // Unik runId per körning så filnamn aldrig krockar mellan körningar ELLER kategorier
    // Format: zoom_<cat>_<zoom>_<pose>_<light>_<runTag>_<idx>.webp
    // runTag = pipeline-version + kort unikt id (för att undvika krock med samma idx i samma kategori)
    const runTag = `${Date.now().toString(36).slice(-4)}-${Math.random().toString(36).slice(2, 6)}`;
    for (let i = 0; i < filteredPrompts.length; i++) {
      const p = filteredPrompts[i];
      // Människoläsbart filnamn: zoom_<cat>_<zoom-slug>_<pose>_<light>_<runTag>_<idx>
      // Ex: zoom_music_extreme-closeup_dynamic_warm-tungsten_859b-64up_000
      const baseName = buildFilenamePrefix(
        s.category,
        p.zoomId,
        p.pose as 'still' | 'dynamic' | 'silhouette',
        p.light as 'warm tungsten' | 'cool daylight' | 'mixed',
        runTag,
        i,
      );
      const stampedName = `${baseName}.webp`;
      const rawName = `${baseName}.png`;
      const fpath = path.join(catDir, stampedName);
      const metaPath = path.join(catDir, `${stampedName}.json`);
      try {
        const { buf, url, taskId } = await generateMinimax(p.prompt, args.model);
        // 7a. Spara RÅ png (samma som bfl-batch.ts pattern) om --raw-dir är satt
        let rawPath: string | null = null;
        if (args.rawDir) {
          const rawCatDir = path.join(args.rawDir, s.category);
          mkdirSync(rawCatDir, { recursive: true });
          rawPath = path.join(rawCatDir, rawName);
          writeFileSync(rawPath, buf);
        }
        // 7b. Stämpla → webp
        const stamped = await stampImage(buf, stampVariant);
        writeFileSync(fpath, stamped);
        // 7c. Metadata med original_path (som bfl-batch.ts).
        // Både cluster_tag (singular, debug) OCH cluster_tags (plural array,
        // matchar image_library.upload-bfl som läser detta fält).
        const createdAt = new Date().toISOString();
        writeFileSync(metaPath, JSON.stringify({
          category: s.category,
          cluster_tag: p.cluster_tag,
          cluster_tags: [p.cluster_tag],  // för _upload_bfl_to_library.ts
          zoomId: p.zoomId,
          pose: p.pose,
          light: p.light,
          prompt: p.prompt,
          model: args.model,
          minimax_task_id: taskId,
          minimax_url: url,
          original_path: rawPath ? rawPath.replace(process.cwd() + '/', '') : null,
          stamped_path: fpath.replace(process.cwd() + '/', ''),
          stamped: true,
          stamp_variant: stampVariant,
          bytes_raw: rawPath ? buf.length : null,
          bytes_stamped: stamped.length,
          created_at: createdAt,
        }, null, 2));
        // 7d. Registrera i coverage-state (persistent minne)
        coverage = registerCombo(
          coverage,
          s.category,
          p.cluster_tag,
          [p.zoomId, p.pose, p.light],
          runTag,
          createdAt,
          fpath.replace(process.cwd() + '/', ''),
        );
        okCount++;
        // 7e. Skriv progress till run-state (UI-räknare).
        // BUG-FIX 2026-10-19: skicka totalOkCount + okCount (totalt hittills över kategorier),
        // inte bara okCount (per-kategori-räknare). Annars återställs imageCount vid
        // varje kategori-byte → UI-räknaren tickar inte upp korrekt.
        writeRunStateProgress(
          args,
          totalOkCount + okCount,
          [`✓ ${stampedName}  zoom=${p.zoomId} pose=${p.pose} light=${p.light} tag=${p.cluster_tag}`],
        );
        const rawKb = rawPath ? `raw=${(buf.length / 1024).toFixed(0)}kB ` : '';
        console.log(`  ✓ ${stampedName}  (${rawKb}stamped=${(stamped.length / 1024).toFixed(0)} kB)  zoom=${p.zoomId} pose=${p.pose} light=${p.light} tag=${p.cluster_tag}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ ${stampedName}  ${msg}`);
        writeFileSync(metaPath, JSON.stringify({ category: s.category, prompt: p.prompt, error: msg, created_at: new Date().toISOString() }, null, 2));
      }
    }
    console.log(`[zoom-batch] ${s.category}: klart, ${okCount}/${filteredPrompts.length} bilder`);
    // Persista coverage-state efter varje kategori (så vi inte tappar data vid krasch)
    persistCoverage(coverage, process.cwd());
    console.log(`[zoom-batch] coverage-state sparat (totalt: ${Object.values(coverage.totals).reduce((s, n) => s + n, 0)} bilder)`);
    console.log('');
    // Ackumulera totalt antal skapade bilder över alla kategorier
    totalOkCount += okCount;
  }

  console.log(`[zoom-batch] klart. output: ${path.resolve(args.out)}`);
  console.log(`[zoom-batch] finalizeRunState anropas med totalOkCount=${totalOkCount}, runId=${args.runId}`);
  // SINGLE SOURCE OF TRUTH: batch skriver slut-status. Orchestrator's
  // child.on('close') är opålitlig (B3-bugg) — vi markerar därför success här
  // så UI kan visa "klar" istället för "running" för evigt.
  finalizeRunState(args, totalOkCount, 'success', 0, [
    `[zoom-batch] klar totalt: ${totalOkCount} nya bilder`,
  ]);
}

main().catch((err) => {
  console.error('[zoom-batch] FATAL:', err);
  // Försök skriva failed-status till run-state om vi har runId
  try {
    const args = parseArgs(process.argv);
    finalizeRunState(args, 0, 'failed', 1, [`[zoom-batch] FATAL: ${String(err?.message ?? err)}`]);
  } catch { /* ignore */ }
  process.exit(1);
});