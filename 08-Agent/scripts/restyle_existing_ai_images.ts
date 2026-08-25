/**
 * 08-Agent/scripts/restyle_existing_ai_images.ts
 *
 * Re-stämplar befintliga AI-bilder i Supabase Storage bucket
 * `event-posters` med EU AI Act Art. 50-disclosure. **Inga BFL-anrop,
 * ingen GPT-anrop** — bara Sharp (stämpel + XMP) + Storage-IO.
 *
 * Idempotent: bilder som redan är stämplade hoppas över (orange > 50
 * pixlar i SE-hörn-regionen detekterar stämpeln).
 *
 * Varför behövs detta:
 *   - Befintliga bilder i Storage saknar XMP-block + synlig stämpel
 *     (genererade innan applyAiCompliance lades till i pipeline).
 *   - HemStarScreen läser från denna bucket, så utan re-stämpling
 *     exponeras bilder som inte uppfyller Art. 50 disclosure.
 *
 * Kör:
 *   npx tsx --env-file=.env 08-Agent/scripts/restyle_existing_ai_images.ts
 *
 * Valfria flaggor:
 *   --limit=N    processa max N unika filer (default 200)
 *   --bucket=B   Storage bucket (default 'event-posters')
 *   --force      re-stämpla även om stämpel redan finns
 */

import { createClient } from '@supabase/supabase-js';

import { applyAiCompliance, checkAiStamp } from '../tools/ai_compliance';

// ── CLI args ──────────────────────────────────────────────────────────────
function parseArgs(argv: ReadonlyArray<string>): { limit: number; bucket: string; force: boolean; autogenUrl: string } {
  let limit = 200;
  let bucket = 'event-posters';
  let force = false;
  let autogenUrl = 'http://localhost:7790';
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--limit' && next) { limit = Math.max(1, parseInt(next, 10) || 200); i++; }
    else if (a === '--bucket' && next) { bucket = next; i++; }
    else if (a === '--autogen-url' && next) { autogenUrl = next; i++; }
    else if (a === '--force') { force = true; }
  }
  return { limit, bucket, force, autogenUrl };
}

interface AutogenFile {
  fileUrl: string;
  objectPath: string;     // path INSIDE the bucket (e.g. "events/foo.png")
  eventIds: string[];
  title: string;
}

async function listFilesViaAutogen(autogenUrl: string, bucket: string, limit: number): Promise<AutogenFile[]> {
  // autoGenServer proxy:ar events-tabellen och returnerar id+image_url. Vi
  // dedup'ar per image_url — samma dedup-nyckel = samma fysiska fil.
  //
  // Därför listar vi inte Storage direkt: vi vill bara stämpla bilder som
  // HemStarScreen faktiskt visar (= de som har en matchande event-rad).
  const out: AutogenFile[] = [];
  // autoGenServer defaultar till 10, men vi vill ha alla 20. Använd limit=20.
  const fetchLimit = Math.min(20, Math.max(limit, 20));
  const res = await fetch(`${autogenUrl}/events-first?limit=${fetchLimit}`);
  if (!res.ok) throw new Error(`/events-first ${res.status}`);
  const data = (await res.json()) as {
    events: Array<{ id: string; title_sv: string | null; image_url: string | null }>;
    count: number;
  };

  const prefix = `/storage/v1/object/public/${bucket}/`;
  const seen = new Set<string>();
  for (const e of data.events) {
    if (!e.image_url) continue;
    if (!e.image_url.includes(prefix)) continue;
    const objectPath = e.image_url.slice(e.image_url.indexOf(prefix) + prefix.length);
    if (seen.has(objectPath)) {
      // Dedup: lägg till event-id på befintlig post
      const existing = out.find((o) => o.objectPath === objectPath);
      if (existing) existing.eventIds.push(e.id);
      continue;
    }
    seen.add(objectPath);
    out.push({
      fileUrl: e.image_url,
      objectPath,
      eventIds: [e.id],
      title: e.title_sv || '',
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before re-stamping.');
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(`[restyle] bucket=${args.bucket}  limit=${args.limit}  force=${args.force}  autogen=${args.autogenUrl}`);

  // 1. Hämta lista via autoGenServer /events-first (proxy som redan
  //    fungerar, ger oss bara de bilder HemStarScreen faktiskt visar).
  const files = await listFilesViaAutogen(args.autogenUrl, args.bucket, args.limit);
  console.log(`[restyle] ${files.length} unika filer att stämpla`);

  // 3. Loopa: hämta, kontrollera, stämpla, ladda upp
  let stamped = 0;
  let skipped = 0;
  let failed = 0;
  const startMs = Date.now();

  for (const f of files) {
    const file = f.objectPath.split('/').pop() || f.objectPath;
    try {
      // Hämta
      const getRes = await fetch(f.fileUrl);
      if (!getRes.ok) throw new Error(`fetch ${getRes.status}`);
      const ab = await getRes.arrayBuffer();
      const buffer = Buffer.from(ab);

      // Kontrollera om redan stämplad (skip om OK)
      const stampCheck = await checkAiStamp(buffer);
      if (stampCheck.ok && !args.force) {
        console.log(`  ⊝ ${file}  redan stämplad (orange=${stampCheck.orangeCount}) — skip`);
        skipped += 1;
        continue;
      }

      // Metadata för XMP. Befintliga bilder saknar image_prompt /
      // image_model i events-tabellen (kolumner finns men var alltid
      // null eftersom autoGenServer's .update()-anrop tyst misslyckades
      // vid den tiden bilderna genererades).
      //
      // Vi stämplar med generisk metadata som publikt går att verifiera
      // via exiftool / Adobe Bridge, och refererar till BFL Flux som
      // modellnamn (vi vet av autoGenServer.js att det är den enda
      // pipeline som skriver till event-posters/events/).
      const model = 'flux-dev';
      const prompt = `EventPulse AI-generated event poster (re-stamped ${new Date().toISOString().slice(0,10)})`;

      // Stämpla (lokal, ingen API-kostnad)
      const newBuf = await applyAiCompliance({ buffer, prompt, model });

      // Ladda upp (upsert — idempotent)
      const { error: upErr } = await supabase.storage
        .from(args.bucket)
        .upload(f.objectPath, newBuf, {
          contentType: 'image/png',
          upsert: true,
          cacheControl: '31536000',
        });
      if (upErr) throw new Error(`upload failed: ${upErr.message}`);

      const postCheck = await checkAiStamp(newBuf);
      console.log(`  ✓ ${file}  ${buffer.length}→${newBuf.length} B  orange=${postCheck.orangeCount}  dark=${postCheck.darkPlateCount}  events=${f.eventIds.length}`);
      stamped += 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${file}  ${msg}`);
      failed += 1;
    }
  }

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log('');
  console.log(`[restyle] DONE in ${elapsedSec}s`);
  console.log(`  stamped : ${stamped}`);
  console.log(`  skipped : ${skipped}  (redan Art. 50-compliant)`);
  console.log(`  failed  : ${failed}`);
  console.log('');
  console.log(`[restyle] next: kör 'verify_ai_compliance.ts' för att bekräfta 100 % compliance.`);
}

main().catch((err: unknown) => {
  console.error('[restyle] FATAL:', err);
  process.exit(1);
});
