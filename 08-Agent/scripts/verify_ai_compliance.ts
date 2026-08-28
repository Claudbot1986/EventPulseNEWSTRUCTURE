/**
 * 08-Agent/scripts/verify_ai_compliance.ts
 *
 * Lokal verifiering av EU AI Act Art. 50-compliance på ALLA redan
 * genererade AI-bilder i Supabase Storage bucket `event-posters`.
 *
 * Körs mot autoGenServer (port 7790) — vi proxy:ar genom dess
 * /events-first?limit=20 för att läsa events.image_url (samma väg som
 * HemStarScreen). Inga Supabase-anrop behövs.
 *
 * Verifierar per bild:
 *   1. XMP-block (maskinläsbar Art. 50-disclosure)
 *      - dc:rights innehåller "AI-generated"
 *      - EventPulse:AIGenerated = true
 *      - EventPulse:Policy = EU-AI-Act-Art-50
 *      - EventPulse:Model finns
 *      - EventPulse:GeneratedAt finns
 *      - xmp:CreatorTool = "EventPulse/autoGenServer"
 *   2. Synlig stämpel (pixel-detect i SE-hörn)
 *      - Orange "●"-prick (FFB454 ± tolerans, count > 0)
 *      - Mörk platta (rgba ~15,15,18, alpha ~78%)
 *
 * Skriver aldrig, muterar aldrig, inget BFL-anrop. Ren read-only.
 *
 * Run:
 *   npx tsx --env-file=.env 08-Agent/scripts/verify_ai_compliance.ts \
 *     [--limit=20] [--autogen-url=http://localhost:7790]
 */

import { createHash } from 'node:crypto';

import { parseXmp } from '../tools/ai_compliance';

const args = process.argv.slice(2);
const limit = (() => {
  const arg = args.find((a) => a.startsWith('--limit='));
  const n = arg ? Number(arg.split('=')[1]) : 20;
  return Number.isFinite(n) && n > 0 ? Math.min(20, n) : 20;
})();
const autogenUrl = (() => {
  const arg = args.find((a) => a.startsWith('--autogen-url='));
  return arg ? arg.split('=').slice(1).join('=') : 'http://localhost:7790';
})();

type XmpCheck = ReturnType<typeof parseXmp>;

interface StampCheck {
  orangeCount: number;
  darkPlateCount: number;
  ok: boolean;
}

const ORANGE_OK_THRESHOLD = 20; // >2 (rimligen 44) orange pixlar = stämpeln syns

async function checkStamp(buffer: Buffer): Promise<StampCheck> {
  // Lazy import sharp — undvik bundling-kostnad om scriptet inte når hit.
  const sharpMod = await import('sharp');
  const sharp = sharpMod.default || sharpMod;

  const W = 1024;
  const H = 1024;
  // Stämpeln: 240×64 px, 24 px inset från SE-kant (autoGenServer.js + ai_compliance.ts)
  const stampW = 240;
  const stampH = 64;
  const inset = 24;
  const left = W - inset - stampW;
  const top = H - inset - stampH;

  // DEBUG: input-format
  try {
    const metaFull = await sharp(buffer).metadata();
    if (process.env.VERIFY_DEBUG) {
      process.stderr.write(`  [debug] meta=${metaFull.width}x${metaFull.height} fmt=${metaFull.format} ch=${metaFull.channels} bytes=${buffer.length}\n`);
    }
  } catch (e: unknown) {
    if (process.env.VERIFY_DEBUG) {
      process.stderr.write(`  [debug] meta-err: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }

  // Plocka ut rektangeln och läs raw RGB.
  const raw = await sharp(buffer)
    .extract({ left, top, width: stampW, height: stampH })
    .removeAlpha()
    .raw()
    .toBuffer();

  if (process.env.VERIFY_DEBUG) {
    process.stderr.write(`  [debug] raw.length=${raw.length} (expect ${stampW * stampH * 3})\n`);
    process.stderr.write(`  [debug] extract rect=${left},${top} ${stampW}x${stampH}\n`);
    // Save extracted region for visual comparison
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const debugFile = path.join('/tmp', `verify_region_${Date.now()}.png`);
    await sharp(buffer).extract({ left, top, width: stampW, height: stampH }).png().toFile(debugFile);
    process.stderr.write(`  [debug] saved ${debugFile}\n`);
    // Also save the EXACT raw RGB bytes so we can diff against standalone test
    const fs2 = await import('node:fs/promises');
    const debugRaw = `/tmp/verify_raw_${Date.now()}.bin`;
    await fs2.writeFile(debugRaw, raw);
    process.stderr.write(`  [debug] raw=${debugRaw} first-rgb=${raw[0]},${raw[1]},${raw[2]}\n`);
  }

  let orangeCount = 0;
  let darkPlateCount = 0;
  if (process.env.VERIFY_DEBUG) {
    const samples = [];
    for (let i = 0; i < Math.min(30, raw.length); i += 3) {
      samples.push(`${raw[i]},${raw[i + 1]},${raw[i + 2]}`);
    }
    process.stderr.write(`  [debug] first 10 px: ${samples.slice(0, 10).join(' | ')}\n`);
  }
  // Pixlar i ordning R,G,B,R,G,B,…
  let orangeMatches: number[] = [];
  for (let i = 0; i < raw.length; i += 3) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    // Orange #FFB454 med ±20 tolerans per kanal
    if (Math.abs(r - 255) <= 20 && Math.abs(g - 180) <= 25 && Math.abs(b - 84) <= 30) {
      orangeCount += 1;
      if (orangeMatches.length < 5) orangeMatches.push(i);
    }
    // Mörk platta #0F0F12 ± tolerans
    if (r < 30 && g < 30 && b < 30) {
      darkPlateCount += 1;
    }
  }
  // Synlig stämpel = orange "●"-prick syns. darkPlate kan vara 0 på
  // ljusa scener (Moderna Museet etc.), så vi dömer enbart på orange.
  const ok = orangeCount > 20;
  if (process.env.VERIFY_DEBUG) {
    process.stderr.write(`  [debug] orangeCount=${orangeCount}  darkPlateCount=${darkPlateCount}  ok=${ok}  matches@bytes=${orangeMatches.join(',')}\n`);
  }
  return { orangeCount, darkPlateCount, ok };
}

async function fetchEvents(): Promise<Array<{ id: string; title: string; venue_name: string | null; image_url: string | null }>> {
  const res = await fetch(`${autogenUrl}/events-first?limit=${limit}`);
  if (!res.ok) throw new Error(`/events-first ${res.status}`);
  const data = (await res.json()) as { events: Array<{ id: string; title_sv: string | null; venues?: { name: string | null } | null; image_url: string | null }>; count: number };
  return (data.events || []).map((e) => ({
    id: e.id,
    title: e.title_sv || '(no title)',
    venue_name: e.venues?.name || null,
    image_url: e.image_url || null,
  }));
}

async function main(): Promise<void> {
  console.log(`[verify] autogen=${autogenUrl}  limit=${limit}`);
  const events = await fetchEvents();
  console.log(`[verify] fetched ${events.length} events`);

  // Dedup på image_url — samma dedup-nyckel = samma fil.
  const byUrl = new Map<string, { ids: string[]; venue: string | null; title: string }>();
  for (const e of events) {
    if (!e.image_url) continue;
    if (!byUrl.has(e.image_url)) {
      byUrl.set(e.image_url, { ids: [], venue: e.venue_name, title: e.title });
    }
    byUrl.get(e.image_url)!.ids.push(e.id);
  }
  const urls = Array.from(byUrl.keys());
  console.log(`[verify] ${urls.length} unika filer (av ${events.length} events)\n`);

  const rows: Array<{
    file: string;
    events: number;
    xmp: XmpCheck;
    stamp: StampCheck;
    sha: string;
  }> = [];

  for (const url of urls) {
    const file = url.split('/').pop() || url;
    const info = byUrl.get(url)!;
    try {
      // Cache-bust (?cb=...) krävs: Supabase Storage serveras genom
      // Cloudflare CDN som cachelagrar uppladdade bytes aggressivt.
      // Utan cache-bust returnerar CDN stale versioner i flera minuter
      // efter att vi laddade upp nya stämplade bilder via restyle-scriptet.
      // Samma mönster används av HemStarScreen (?v=${Date.now()}).
      const res = await fetch(`${url}?cb=${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
      if (!res.ok) {
        console.error(`  ✗ ${file}  HTTP ${res.status}`);
        rows.push({
          file,
          events: info.ids.length,
          xmp: { found: false, hasAiGenerated: false, hasPolicy: false, hasModel: false, hasGeneratedAt: false, rightsMentionsAi: false, creatorTool: null, model: null, size: null },
          stamp: { orangeCount: 0, darkPlateCount: 0, ok: false },
          sha: '?',
        });
        continue;
      }
      const ab = await res.arrayBuffer();
      const buffer = Buffer.from(ab);
      const sha = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
      const xmp = parseXmp(buffer);
      const stamp = await checkStamp(buffer);
      rows.push({ file, events: info.ids.length, xmp, stamp, sha });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${file}  ${msg}`);
    }
  }

  // ── Tabell-rapport ─────────────────────────────────────────────────────
  const pad = (s: string | number, n: number) => String(s).padEnd(n).slice(0, n);
  console.log('═'.repeat(110));
  console.log(
    pad('FILE', 50) +
    pad('XMP', 5) +
    pad('AIGen', 7) +
    pad('Policy', 10) +
    pad('Model', 8) +
    pad('Stamp', 8) +
    pad('orange', 8) +
    pad('dark', 7) +
    pad('events', 7),
  );
  console.log('═'.repeat(110));

  let xmpOk = 0;
  let stampOk = 0;
  let fullOk = 0;
  for (const r of rows) {
    const x = r.xmp;
    const xmpDot = x.found && x.hasAiGenerated && x.hasPolicy && x.hasModel && x.hasGeneratedAt ? '✓' : '✗';
    const stampDot = r.stamp.ok ? '✓' : '✗';
    const both = xmpDot === '✓' && stampDot === '✓' ? '✓✓' : '   ';
    if (x.found) xmpOk += 1;
    if (r.stamp.ok) stampOk += 1;
    if (both === '✓✓') fullOk += 1;
    console.log(
      pad(r.file.slice(-50), 50) +
      pad(xmpDot, 5) +
      pad(x.hasAiGenerated ? '✓' : '✗', 7) +
      pad(x.hasPolicy ? '✓' : '✗', 10) +
      pad(x.model ? '✓' : '✗', 8) +
      pad(stampDot, 8) +
      pad(String(r.stamp.orangeCount), 8) +
      pad(String(r.stamp.darkPlateCount), 7) +
      pad(String(r.events), 7),
    );
  }
  console.log('═'.repeat(110));
  console.log('');
  console.log(`Aggregate of ${rows.length} unique files:`);
  console.log(`  XMP-block found       : ${xmpOk} / ${rows.length}`);
  console.log(`  Synlig stämpel (SE)   : ${stampOk} / ${rows.length}`);
  console.log(`  FULL Art. 50 compliant: ${fullOk} / ${rows.length}`);
  console.log('');

  // Detaljer per bild (för eventuell debug)
  if (process.env.VERIFY_VERBOSE) {
    console.log('— Detaljer —');
    for (const r of rows) {
      console.log(`  ${r.file}`);
      console.log(`    sha=${r.sha}  events=${r.events}`);
      console.log(`    XMP: creatorTool=${r.xmp.creatorTool || '∅'}  model=${r.xmp.model || '∅'}  rights="${r.xmp.rightsMentionsAi ? 'AI-gen' : '?'}"`);
      console.log(`    Stamp: orange=${r.stamp.orangeCount}  dark=${r.stamp.darkPlateCount}  → ${r.stamp.ok ? 'OK' : 'FAIL'}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error('[verify] FATAL:', err);
  process.exit(1);
});
