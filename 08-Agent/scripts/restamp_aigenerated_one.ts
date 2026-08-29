/**
 * 08-Agent/scripts/restamp_aigenerated_one.ts
 *
 * Re-stämplar EN specifik AI-bild i Supabase Storage bucket `event-posters`
 * med EU AI Act Art. 50-disclosure (orange "● AI"-pill + XMP-metadata).
 *
 * Varför: ai-generated/ foldern producerades innan ai_compliance lades till i
 * pipeline, så de bilderna saknar pixel-stämpel + XMP. HemStarScreen läser
 * från denna folder via library_fallback (event.image_ai_generated=false →
 * useAiImageUrl returnerar uri men stampVisible=false → UI visar ingen
 * overlay, och pixel-stämpeln som SKULLE vara synlig i cover-crop är
 * obefintlig i bilden själv → EU AI Act Art. 50-brott).
 *
 * Användning:
 *   npx tsx --env-file=.env 08-Agent/scripts/restamp_aigenerated_one.ts <objectPath>
 *
 * Exempel:
 *   npx tsx --env-file=.env 08-Agent/scripts/restamp_aigenerated_one.ts \
 *     'ai-generated/christmasnightstage1-stage1.png'
 *
 * Verifierar före/efter via checkAiStamp och skriver ut pixel-räkning.
 */

import { createClient } from '@supabase/supabase-js';

import { applyAiCompliance, checkAiStamp, parseXmp } from '../tools/ai_compliance';

async function main(): Promise<void> {
  const objectPath = process.argv[2];
  if (!objectPath) {
    console.error('Usage: restamp_aigenerated_one.ts <objectPath-relative-to-bucket>');
    console.error('  t.ex. ai-generated/christmasnightstage1-stage1.png');
    process.exit(1);
  }

  const bucket = process.env.RESTAMP_BUCKET || 'event-posters';
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(`[restamp-one] bucket=${bucket}  path=${objectPath}`);

  // 1. Fetch original
  const pubUrl = `${url}/storage/v1/object/public/${bucket}/${objectPath}`;
  const getRes = await fetch(pubUrl);
  if (!getRes.ok) {
    throw new Error(`fetch ${pubUrl} failed: ${getRes.status}`);
  }
  const ab = await getRes.arrayBuffer();
  const buffer = Buffer.from(ab);

  const before = await checkAiStamp(buffer);
  console.log(`[restamp-one] before: orange=${before.orangeCount}  dark=${before.darkPlateCount}  hasStamp=${before.ok}`);

  // 2. Apply compliance (stämpel + XMP)
  const newBuf = await applyAiCompliance({
    buffer,
    prompt: 'EventPulse AI-generated event poster (restamped)',
    model: 'flux-2-klein-4b',
  });

  // 3. Verify locally
  const after = await checkAiStamp(newBuf);
  const xmp = parseXmp(newBuf);
  console.log(`[restamp-one] after:  orange=${after.orangeCount}  dark=${after.darkPlateCount}  hasStamp=${after.ok}`);
  console.log(`[restamp-one] xmp:    found=${xmp.found}  policy=${xmp.hasPolicy}  model=${xmp.model}  rightsMentionsAi=${xmp.rightsMentionsAi}`);

  if (!after.ok) {
    throw new Error('applyAiCompliance did not produce a visible stamp — aborting upload');
  }

  // 4. Upload back (upsert, idempotent)
  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(objectPath, newBuf, {
      contentType: 'image/png',
      upsert: true,
      cacheControl: '31536000',
    });
  if (upErr) {
    throw new Error(`upload failed: ${upErr.message}`);
  }

  console.log(`[restamp-one] ✓ uploaded ${objectPath}  (${buffer.length}→${newBuf.length} B)`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[restamp-one] FATAL:', msg);
  process.exit(1);
});