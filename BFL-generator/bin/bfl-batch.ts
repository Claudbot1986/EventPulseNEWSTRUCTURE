#!/usr/bin/env tsx
/**
 * bin/bfl-batch.ts — bfl5 v2 (round5-wrapper med kluster-minne)
 *
 * FLÖDE:
 *   1. Läs kluster-summary: tmp/cluster_<category>.json
 *   2. Räkna behov (need) med quota.ts
 *   3. Viktfördela N prompts baserat på kluster-frekvens
 *   4. Bygg N unika BFL-prompter via M3 (lib/cluster-prompter.ts)
 *   5. Generera bilder (BFL Flux Pro 1.1) med concurrency 7
 *   6. Stämpla (legacy 240×64 SE-pill)
 *   7. Spara metadata (.json) med cluster_tags
 *   8. --apply: ladda upp till Supabase storage + image_library
 *
 * CLI:
 *   tsx bin/bfl-batch.ts --category=<slug> [--count=N] [--cluster=<slug>] [--apply]
 *
 * Säkerhet:
 *   - Default = --dry-run (visar plan, laddar inte upp)
 *   - BFL-nyckel läses från BFL_API_KEY
 *   - M3-nyckel läses från MINIMAX_API_KEY
 *   - Retry 429: vänta 30s och gör ett nytt försök
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { quota } from '../lib/quota.js';
import { buildPrompts, type BuiltPrompt } from '../lib/cluster-prompter.js';
import { findImagesForEvents, type MatchResult } from '../lib/match.js';

const BFL_ENDPOINT = 'https://api.bfl.ai/v1/flux-pro-1.1';
const BFL_POLL_INTERVAL_MS = 2000;
const BFL_TIMEOUT_MS = 180_000;
const BFL_CONCURRENCY = 7;
const M3_CONCURRENCY = 7;
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

const IMG_W = 1024;
const IMG_H = 576;

interface CliArgs {
  category: string;
  count?: number;
  cluster?: string;
  apply: boolean;
  stampVariant?: 'legacy' | 'small';
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { category: '', apply: false };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--category=')) out.category = arg.slice('--category='.length);
    else if (arg.startsWith('--count=')) out.count = parseInt(arg.slice('--count='.length), 10);
    else if (arg.startsWith('--cluster=')) out.cluster = arg.slice('--cluster='.length);
    else if (arg === '--apply') out.apply = true;
    else if (arg.startsWith('--variant=')) {
      const v = arg.slice('--variant='.length);
      if (v === 'legacy' || v === 'small') out.stampVariant = v;
    }
  }
  if (!out.category) {
    console.error('Användning: tsx bin/bfl-batch.ts --category=<slug> [--count=N] [--cluster=<slug>] [--apply] [--variant=legacy|small]');
    process.exit(2);
  }
  return out;
}

function getApiKey(envName: string): string | null {
  return process.env[envName] || null;
}

interface ClusterFile {
  category: string;
  total_events: number;
  minimax_tagged: number;
  empty: number;
  tag_frequency: Record<string, number>;
}

function loadClusterFile(category: string): ClusterFile {
  // Hitta tmp-mappen: först cwd, sedan BFL-generator/ om vi körs från EventPulse-root
  const candidates = [
    join(process.cwd(), 'tmp', `cluster_${category}.json`),
    join(process.cwd(), 'BFL-generator', 'tmp', `cluster_${category}.json`),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf8')) as ClusterFile;
    }
  }
  throw new Error(`Saknar cluster_${category}.json. Kör först: tsx BFL-generator/bin/bfl-cluster-real.ts --category=${category}`);
}

async function fetchLibraryCount(category: string): Promise<number> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return 0;
  const res = await fetch(
    `${url}/rest/v1/image_library?category_slug=eq.${encodeURIComponent(category)}&select=id`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) return 0;
  return ((await res.json()) as unknown[]).length;
}

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
  const inset = variant === 'small' ? 18 : STAMP_INSET;
  const left = IMG_W - w - inset;
  const top = IMG_H - h - inset;
  return await sharp(buf)
    .composite([{ input: Buffer.from(buildStampSvg(variant)), left, top }])
    .webp({ quality: 80, effort: 4 })
    .toBuffer();
}

async function generateOneBfl(prompt: string, attempt = 1): Promise<{ buf: Buffer; id: string; seed: number | null }> {
  const apiKey = getApiKey('BFL_API_KEY');
  if (!apiKey) throw new Error('BFL_API_KEY saknas');

  const submit = await fetch(BFL_ENDPOINT, {
    method: 'POST',
    headers: { 'x-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ prompt, width: IMG_W, height: IMG_H, steps: 28, prompt_upsampling: false }),
  });

  if (submit.status === 429 && attempt < 3) {
    console.warn(`[bfl] 429 rate-limit, väntar 30s (försök ${attempt}/3)`);
    await new Promise(r => setTimeout(r, 30_000));
    return generateOneBfl(prompt, attempt + 1);
  }
  if (!submit.ok) throw new Error(`BFL submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);

  const { id, polling_url } = await submit.json();
  const deadline = Date.now() + BFL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, BFL_POLL_INTERVAL_MS));
    const poll = await fetch(polling_url, { headers: { 'x-key': apiKey, accept: 'application/json' } });
    if (poll.status === 429 && attempt < 3) {
      console.warn(`[bfl] 429 poll, väntar 30s (försök ${attempt}/3)`);
      await new Promise(r => setTimeout(r, 30_000));
      return generateOneBfl(prompt, attempt + 1);
    }
    if (!poll.ok) throw new Error(`BFL poll ${poll.status}`);
    const pd = await poll.json() as { status: string; result: { sample: string; seed?: number } };
    if (pd.status === 'Ready') {
      const img = await fetch(pd.result.sample);
      if (!img.ok) throw new Error(`image fetch ${img.status}`);
      return { buf: Buffer.from(await img.arrayBuffer()), id, seed: pd.result.seed ?? null };
    }
    if (pd.status === 'Failed' || pd.status === 'Error') throw new Error(`BFL ${pd.status}`);
  }
  throw new Error('BFL timeout (180s)');
}

interface ItemResult {
  category: string;
  prompt: BuiltPrompt;
  rep: number;
  ok: boolean;
  stamped_path?: string;
  meta_path?: string;
  bfl_id?: string;
  seed?: number | null;
  error?: string;
  skipped?: boolean;
}

async function processItem(
  item: { category: string; prompt: BuiltPrompt; rep: number },
  opts: { apply: boolean; stampVariant: 'legacy' | 'small' },
): Promise<ItemResult> {
  const { category, prompt, rep } = item;

  // TVÅ kataloger: original (orörd) + stämplad (klar för upload)
  const origDir = join(process.cwd(), 'local_image_library', category);
  const stampedDir = join(process.cwd(), 'local_image_library_stamped', category);
  mkdirSync(origDir, { recursive: true });
  mkdirSync(stampedDir, { recursive: true });

  const tagSlug = prompt.cluster_tags.join('-').replace(/[^a-z0-9-]/gi, '').slice(0, 30) || 'unknown';
  const hash = createHash('sha256').update(prompt.prompt + 'bfl5v2' + rep).digest('hex').slice(0, 10);
  const fname = `bfl5v2_${tagSlug}_r${rep}_${hash}`;

  const origPath = join(origDir, `${fname}.png`);         // ORIGINAL: rå från BFL, ALDRIG stämplad
  const stampedPath = join(stampedDir, `${fname}.webp`);  // STÄMPLAD: klar för upload
  const metaPath = join(origDir, `${fname}.json`);        // METADATA: ligger intill original

  // Skippa om både original OCH stämplad finns
  if (existsSync(origPath) && existsSync(stampedPath) && existsSync(metaPath)) {
    return { category, prompt, rep, ok: true, stamped_path: stampedPath, meta_path: metaPath, skipped: true };
  }

  if (!opts.apply) {
    return { category, prompt, rep, ok: true };
  }

  try {
    const { buf, id, seed } = await generateOneBfl(prompt.prompt);

    // STEG 1: Spara ORIGINAL orörd (BFL levererar PNG)
    writeFileSync(origPath, buf);

    // STEG 2: Stämpla en KOPIA och spara separat
    const stamped = await stampImage(buf, opts.stampVariant);
    writeFileSync(stampedPath, stamped);

    // STEG 3: Metadata intill original
    const meta = {
      category_slug: category,
      pattern: 'A_wide',
      rep,
      round: '5v2',
      prompt: prompt.prompt,
      cluster_tags: prompt.cluster_tags,
      weight: prompt.weight,
      stamp_variant: opts.stampVariant,
      model: 'flux-pro-1.1',
      bfl_id: id,
      seed,
      generated_at: new Date().toISOString(),
      bytes_original: buf.length,
      bytes_stamped: stamped.length,
      original_path: origPath.replace(process.cwd() + '/', ''),
      stamped_path: stampedPath.replace(process.cwd() + '/', ''),
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    return { category, prompt, rep, ok: true, stamped_path: stampedPath, meta_path: metaPath, bfl_id: id, seed };
  } catch (err) {
    // Vid fel: städa bort eventuella halvfärdiga filer
    if (existsSync(origPath) && !existsSync(stampedPath)) {
      try { unlinkSync(origPath); } catch {}
    }
    return { category, prompt, rep, ok: false, error: err instanceof Error ? err.message : 'okänt fel' };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const stampVariant = args.stampVariant ?? 'legacy';

  // 1. Ladda kluster
  const cluster = loadClusterFile(args.category);
  console.log(`[batch] kategori=${args.category} events=${cluster.total_events} kluster-taggar=${Object.keys(cluster.tag_frequency).length}`);

  // 2. Räkna behov
  const library = await fetchLibraryCount(args.category);
  const q = quota({ events: cluster.total_events, library });
  console.log(`[batch] library nu: ${library}, target: ${q.target}, need: ${q.need} (${q.reason})`);

  if (q.need === 0 && !args.count) {
    console.log('[batch] inget behov, avslutar.');
    return;
  }

  // Filtrera kluster om --cluster anges
  let tagFrequency = cluster.tag_frequency;
  if (args.cluster) {
    if (!tagFrequency[args.cluster]) {
      console.error(`[batch] okänd kluster-tagg: ${args.cluster}`);
      process.exit(2);
    }
    tagFrequency = { [args.cluster]: tagFrequency[args.cluster] };
  }

  // 3-4. Bygg prompts
  const count = args.count ?? q.need;
  console.log(`[batch] bygger ${count} prompts baserat på kluster-vikter…`);
  const prompts = await buildPrompts({
    category: args.category,
    tagFrequency,
    count,
    maxConcurrency: M3_CONCURRENCY,
  });
  console.log(`[batch] ${prompts.length} prompts färdiga.`);

  // Visa fördelning
  const byTag = new Map<string, number>();
  for (const p of prompts) {
    const t = p.cluster_tags[0] ?? 'unknown';
    byTag.set(t, (byTag.get(t) ?? 0) + 1);
  }
  console.log('[batch] fördelning:');
  for (const [tag, n] of [...byTag.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tag.padEnd(28)} ${n}`);
  }

  if (prompts.length === 0) {
    console.log('[batch] inga prompts att generera, avslutar.');
    return;
  }

  // 5. Generera bilder
  const items = prompts.map((p, i) => ({ category: args.category, prompt: p, rep: i }));
  const results: ItemResult[] = [];
  let cursor = 0;
  let completed = 0;
  const t0 = Date.now();
  const total = items.length;
  const estimatePerItemSec = 15; // grov uppskattning för ETA
  const etaSec = total * estimatePerItemSec / BFL_CONCURRENCY;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      const it = items[idx];
      const r = await processItem(it, { apply: args.apply, stampVariant });
      results.push(r);
      completed++;
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const remaining = ((total - completed) * estimatePerItemSec / BFL_CONCURRENCY).toFixed(1);
      if (r.ok) {
        const tag = r.prompt.cluster_tags.join(',') || 'unknown';
        if (r.skipped) {
          console.log(`  [${completed}/${total}] ${it.category}/r${it.rep} (${tag}) — skippar (finns) — ${elapsed}s, ~${remaining}s kvar`);
        } else if (args.apply) {
          console.log(`  [${completed}/${total}] ${it.category}/r${it.rep} (${tag}) ✓ — ${elapsed}s, ~${remaining}s kvar`);
        }
      } else {
        console.error(`  [${completed}/${total}] ${it.category}/r${it.rep} ✗ ${r.error}`);
      }
    }
  }

  console.log(`[batch] startar ${BFL_CONCURRENCY} workers, ETA ~${etaSec.toFixed(0)}s för ${total} bilder (läge: ${args.apply ? 'APPLY' : 'DRY-RUN'})…`);
  await Promise.all(Array.from({ length: BFL_CONCURRENCY }, () => worker()));

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = results.filter(r => r.ok).length;
  const errs = results.filter(r => !r.ok).length;
  const skipped = results.filter(r => r.skipped).length;
  console.log(`\n[batch] KLART på ${elapsed}s`);
  console.log(`  ok:      ${ok}`);
  console.log(`  skip:    ${skipped}`);
  console.log(`  fel:     ${errs}`);

  if (!args.apply) {
    console.log('\n[batch] DRY-RUN: inget skapat. Kör med --apply för att generera.');
    return;
  }

  // 6. Verifiera "minne" — varje bild har cluster_tags
  const withTags = results.filter(r => r.ok && !r.skipped && r.meta_path).length;
  if (withTags > 0) {
    console.log(`\n[batch] verifiering: ${withTags} bilder har cluster_tags i metadata (.json)`);
    console.log(`         → när bilderna laddas upp till image_library senare, bevara cluster_tags-kolumnen`);
  }

  // 7. Testa matchning direkt mot en av de genererade bilderna
  if (withTags > 0) {
    console.log('\n[batch] testar matchning: hittar första nya bilden för ett exempel-event?');
    // Använd första klustret som test-event
    const firstTag = prompts[0]?.cluster_tags[0];
    if (firstTag) {
      const testResult = await findImagesForEvents([{
        event_id: 'test-event-after-batch',
        category_slug: args.category,
        raw_description: `Ett Stockholm-${firstTag}-evenemang med ${firstTag}-tema`,
      }]);
      const r: MatchResult = testResult[0];
      console.log(`  event-tagging: ${JSON.stringify(r.event_tags)}`);
      console.log(`  träffar:       ${r.candidates.length} (best overlap=${r.candidates[0]?.overlap ?? 0})`);
      if (r.best) {
        console.log(`  ✓ matchad bild: ${r.best.storage_path}`);
        console.log(`    cluster_tags: ${JSON.stringify(r.best.cluster_tags)}`);
      } else {
        console.log('  ⚠ ingen träff — normalt just efter generering (Supabase-upload behövs först)');
      }
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
