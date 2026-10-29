#!/usr/bin/env node
/**
 * _backfill_old_pngs.mjs — backfilla 285 dubbelstämplade venue-PNG:er med
 * nya BFL-genererade WebP-bilder.
 *
 * Pipeline per dedup-URL (1 ny AI-bild täcker många events):
 *   1. Läs plan (från _backfill_inventory.mjs)
 *   2. Slumpa kategori-corpus + v4-prompts för att bygga prompt
 *   3. Anropa BFL Flux Pro 1.1
 *   4. Ladda ner PNG
 *   5. Stämpla med applyAiCompliance (hörnpill, 1024×576)
 *   6. Konvertera till WebP q80
 *   7. Ladda upp till event-posters/import-stamped/<backfill_id>.webp
 *   8. Uppdatera events.image_url för ALLA events som pekade på gammal URL
 *   9. Lägg till rad i image_library (eller uppdatera befintlig)
 *
 * Användning:
 *   node scripts/_backfill_old_pngs.mjs --dry-run    # plan
 *   node scripts/_backfill_old_pngs.mjs --apply      # kör
 *   node scripts/_backfill_old_pngs.mjs --limit 5 --apply  # testa 5 st
 */
/**
 * ⚠️ LEGACY (2026-10-29): använd applyAiComplianceToWebp() i
 * 08-Agent/tools/ai_compliance.ts i stället. Detta skript konverterar med
 * sharp(...).webp() utan withMetadata() och utan XMP-injektion — den
 * levererade filen får alltså ingen maskinläsbar Art. 50-märkning.
 */
import 'dotenv/config';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { applyAiCompliance, checkAiStamp } from '../08-Agent/tools/ai_compliance.ts';

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const BFL_KEY = process.env.BFL_API_KEY;
if (!BFL_KEY) { console.error('Missing BFL_API_KEY'); process.exit(2); }

const ENDPOINT = 'https://api.bfl.ai/v1/flux-pro-1.1';
const TIMEOUT_MS = 90_000;
const STAMPED_PREFIX = 'import-stamped';
const SAFETY_SUFFIX = 'no weapons, no knives, no blood, no gloves, no hands holding objects, no close-up faces of minors, no violence, child-safe imagery, family-friendly';

const argIdx = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const only = argIdx('--only');
const dryRun = !process.argv.includes('--apply');
const limitArg = argIdx('--limit');
const limit = limitArg ? parseInt(limitArg, 10) : null;

const root = join(process.cwd(), 'tmp_image_corpus');
const planPath = join(root, '_backfill_plan_2026-10-08.json');
if (!existsSync(planPath)) {
  console.error(`Saknar ${planPath} — kör _backfill_inventory.mjs först.`);
  process.exit(2);
}
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
let items = plan.items || [];
if (only) items = items.filter((it) => it.category_slug === only);
if (limit) items = items.slice(0, limit);

console.log(`[backfill] ${items.length} URLs att processa (av ${plan.total_unique_urls} totalt, ${plan.total_events} events täcks)`);
if (dryRun) console.log('[backfill] DRY-RUN: inga BFL-anrop, inga uploads, inga DB-ändringar');

// Ladda v4-prompts per kategori (om finns)
const promptsByCategory = {};
for (const it of items) {
  const cat = it.category_slug;
  if (promptsByCategory[cat]) continue;
  const v4Path = join(root, `${cat}_prompts_v4.json`);
  if (existsSync(v4Path)) {
    const v4 = JSON.parse(readFileSync(v4Path, 'utf8'));
    const byPat = {};
    for (const p of v4.prompts || []) byPat[p.pattern] = p.prompt;
    promptsByCategory[cat] = byPat;
  } else {
    promptsByCategory[cat] = null;
  }
}

async function generateOne(prompt) {
  const submit = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-key': BFL_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ prompt, width: 1024, height: 576, steps: 28, prompt_upsampling: false }),
  });
  if (!submit.ok) throw new Error(`BFL submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  const { id, polling_url } = await submit.json();
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetch(polling_url, { headers: { 'x-key': BFL_KEY, accept: 'application/json' } });
    if (!poll.ok) continue;
    const d = await poll.json();
    if (d.status === 'Ready') {
      const img = await fetch(d.result.sample);
      if (!img.ok) throw new Error(`BFL image fetch ${img.status}`);
      return Buffer.from(await img.arrayBuffer());
    }
    if (d.status === 'Failed' || d.status === 'Error') throw new Error(`BFL failed: ${d.status}`);
  }
  throw new Error('BFL timeout');
}

function buildPrompt(category, idx) {
  // Använd A_wide-mönstret om finns, annars generisk prompt
  const patterns = promptsByCategory[category];
  if (patterns && patterns.A_wide) {
    const variations = [
      'in soft northern daylight, shallow depth of field, editorial Stockholm color tones',
      'with warm tungsten and window light mixed, ambient interior glow',
      'overcast Nordic daylight, muted color palette, atmospheric perspective',
      'late afternoon golden hour light, long shadows, calm mood',
    ];
    const v = variations[idx % variations.length];
    return `${patterns.A_wide.trim().replace(/[.,;:]\s*$/, '')}, ${v}. ${SAFETY_SUFFIX}.`;
  }
  // Fallback om kategori saknar v4-prompts
  return `A wide editorial photograph suggesting a Stockholm ${category} event, in soft northern daylight, shallow depth of field. ${SAFETY_SUFFIX}.`;
}

let totalOk = 0, totalErr = 0, totalSkip = 0;
const t0 = Date.now();

for (let i = 0; i < items.length; i++) {
  const it = items[i];
  const shortName = it.old_storage_path.split('/').pop().replace(/\.png$/, '');
  const id = `bf-${createHash('sha1').update(it.old_storage_path).digest('hex').slice(0, 12)}`;
  const newStoragePath = `${STAMPED_PREFIX}/${id}.webp`;
  const newUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/event-posters/${newStoragePath}`;

  // Idempotens: om WebP redan finns på Storage, skippa
  let alreadyExists = false;
  if (!dryRun) {
    const { data: list } = await db.storage.from('event-posters').list(`${STAMPED_PREFIX}`, { search: `${id}.webp` });
    if (list && list.length > 0) alreadyExists = true;
  }
  if (alreadyExists) {
    console.log(`  · [${i + 1}/${items.length}] skip (finns redan): ${id}`);
    totalSkip++;
    continue;
  }

  if (dryRun) {
    console.log(`  [DRY] [${i + 1}/${items.length}] skulle generera ${id} för ${it.category_slug} (${it.event_count} events) — ${shortName}`);
    totalOk++;
    continue;
  }

  try {
    const prompt = buildPrompt(it.category_slug, i);
    const png = await generateOne(prompt);
    const stamped = await applyAiCompliance({
      buffer: png,
      prompt,
      model: 'flux-pro-1.1',
      position: 'bottom-left',
    });
    const verify = await checkAiStamp(stamped, 'bottom-left', png);
    if (!verify.ok) {
      console.warn(`  ✗ [${i + 1}/${items.length}] stämpel-verify misslyckades: ${id}`);
      totalErr++;
      continue;
    }
    const webp = await sharp(stamped).webp({ quality: 80, effort: 4 }).toBuffer();

    // Ladda upp WebP
    const { error: upErr } = await db.storage
      .from('event-posters')
      .upload(newStoragePath, webp, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' });
    if (upErr) throw new Error(`Storage upload: ${upErr.message}`);

    // Uppdatera events.image_url
    const { error: evErr } = await db
      .from('events')
      .update({
        image_url: newUrl,
        image_ai_generated: true,
        image_model: 'flux-pro-1.1',
        image_prompt: prompt,
        image_generated_at: new Date().toISOString(),
      })
      .eq('image_url', it.old_url);
    if (evErr) throw new Error(`events update: ${evErr.message}`);

    // Lägg till i image_library
    const { error: libErr } = await db
      .from('image_library')
      .upsert({
        storage_path: `event-posters/${newStoragePath}`,
        public_url: newUrl,
        category_slug: it.category_slug,
        source_event_id: it.sample_event_ids[0] ?? null,
        tags: ['bfl-backfill', 'old-png-replacement'],
        rating: 3,
      }, { onConflict: 'storage_path' });
    if (libErr) console.warn(`  image_library upsert misslyckades (fortsätter): ${libErr.message}`);

    console.log(`  ✓ [${i + 1}/${items.length}] ${id} → ${it.event_count} events uppdaterade (${it.category_slug})`);
    totalOk++;
  } catch (err) {
    console.error(`  ✗ [${i + 1}/${items.length}] ${id}: ${err.message}`);
    totalErr++;
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nKlart: ${totalOk} ok, ${totalSkip} skip, ${totalErr} fel — på ${elapsed}s`);
