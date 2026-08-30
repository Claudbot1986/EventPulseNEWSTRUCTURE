/**
 * 08-Agent/services/imageGen.ts — AI image generation for EventPulse events.
 *
 * Generates one AI image per event using Black Forest Labs Flux-dev.
 * Uploads to Supabase Storage event-posters/ and updates events.image_url.
 *
 * EU AI Act (Art. 50) compliance:
 *   - No real venue/artist/brand names (anonymized in prompt)
 *   - No text/typography/logos in image
 *   - Prompt + model + timestamp stored on event row (image_prompt, image_model)
 *   - Synlig AI-stämpel + XMP-metadata inbakad i pixel-filen innan uppladdning
 *     (se applyAiCompliance i 08-Agent/tools/ai_compliance.ts). Utan detta
 *     skulle UI-hooken useAiImageUrl anta att stämpeln finns men filen vara
 *     raw modell-output → EU AI Act-brist.
 *
 * Idempotency:
 *   - dedupKey(title::venue) → same image for recurring events
 *   - Storage upsert=true (overwrites existing file)
 *
 * Usage:
 *   import { generateForEvent, generateBatch } from './imageGen.js';
 *   await generateForEvent(event);
 *   await generateBatch(50);
 *
 * Original code extracted from 06-UI/asterisk/autoGenServer.js (2026-08-25).
 * See docs/AI-IMAGE-PIPELINE-PLAN.md for architecture and rollout.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyAiCompliance, checkAiStamp } from '../tools/ai_compliance.js';

// ── Env loading ──────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = resolve(__dirname, '../../.env');

try {
  const envText = readFileSync(ENV_PATH, 'utf8');
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch (err) {
  console.warn('[imageGen] could not load .env from', ENV_PATH, (err as Error).message);
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface EventInput {
  id: string;
  title_sv?: string | null;
  title_en?: string | null;
  description_sv?: string | null;
  description_en?: string | null;
  category_slug?: string | null;
  venues?: { name: string } | { name: string }[] | null;
  venue_name?: string | null;
}

export interface ImageGenResult {
  eventId: string;
  imageUrl: string;
  storagePath: string;
  prompt: string;
  seed: number | null;
  costCents: number; // estimated, $0.025 ≈ 3 cents for flux-dev
}

export interface BatchResult {
  totalFetched: number;
  uniqueGroups: number;
  okCount: number;
  failCount: number;
  results: ImageGenResult[];
  errors: Array<{ eventIds: string[]; error: string }>;
}

// ── Supabase client (lazy) ───────────────────────────────────────────────────

let _supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in env');
  }
  _supabase = createClient(url, key, { auth: { persistSession: false } });
  return _supabase;
}

// ── Constants ────────────────────────────────────────────────────────────────

const BFL_BASE = 'https://api.bfl.ai/v1';
const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = 90_000;
const STORAGE_BUCKET = process.env.AUTOGEN_BUCKET || 'event-posters';
const FLUX_COST_CENTS = 3; // ~$0.025 per image (flux-dev, 1024×1024)

// ── Venue anonymization (12+ known Stockholm venues) ────────────────────────

const VENUE_GENERICIZERS: Array<{ match: RegExp; replace: string }> = [
  { match: /konserthuset/i, replace: 'a Stockholm concert hall' },
  { match: /stockholm concert/i, replace: 'a Stockholm concert hall' },
  { match: /debaser/i, replace: 'a Stockholm music club' },
  { match: /strindbergs?/i, replace: 'a Stockholm intimate theater' },
  { match: /stampen/i, replace: 'a Stockholm jazz club' },
  { match: /kulturhuset(?:stadsteatern)?/i, replace: 'a Stockholm cultural center' },
  { match: /malmö?\s*live|malmolive/i, replace: 'a Malmö concert venue' },
  { match: /scandinavium/i, replace: 'a Gothenburg arena' },
  { match: /tele2|globen|avicii arena/i, replace: 'a Stockholm arena' },
  { match: /junibacken/i, replace: "a Stockholm children's museum" },
  { match: /dramaten|kungliga dramatiska/i, replace: 'a Stockholm dramatic theater' },
  { match: /cirkus|cirkus(?:teatern)?/i, replace: 'a Stockholm variety theater' },
];

function anonymizeVenue(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return 'a Stockholm event venue';
  for (const { match, replace } of VENUE_GENERICIZERS) {
    if (match.test(name)) return replace;
  }
  return 'a Stockholm event venue';
}

// ── Category-driven scenes (verifierat 2026-08-24) ─────────────────────────

const CATEGORY_SCENES: Record<string, string> = {
  // Sports
  sports:  'a football match in a stadium with players in action on green grass under dramatic sky',
  idrott:  'a football match in a stadium with players in action on green grass under dramatic sky',
  fotboll: 'a football match in a stadium with players in action on green grass under dramatic sky',
  // Art / exhibition
  exhibition:        'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  'art-exhibitions': 'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  konst:             'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  utställning:       'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  galleri:           'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  // Music / concert
  music:    'a concert stage with musicians performing under dramatic stage lights, instruments visible, audience in silhouette',
  konsert:  'a concert stage with musicians performing under dramatic stage lights, instruments visible, audience in silhouette',
  // Theater
  theater:  'a theater stage with dramatic lighting, performers mid-scene, ornate curtain in background',
  teater:   'a theater stage with dramatic lighting, performers mid-scene, ornate curtain in background',
  föreställning: 'a theater stage with dramatic lighting, performers mid-scene, ornate curtain in background',
  // Family
  family: 'a bright family-friendly outdoor scene, kids playing in a sunny park, warm and colorful atmosphere',
  barn:   'a bright family-friendly outdoor scene, kids playing in a sunny park, warm and colorful atmosphere',
  kids:   'a bright family-friendly outdoor scene, kids playing in a sunny park, warm and colorful atmosphere',
  // Nightlife
  nightlife: 'a nightclub interior with colored stage lights, DJ booth, dance floor with movement, energetic atmosphere',
  nattliv:   'a nightclub interior with colored stage lights, DJ booth, dance floor with movement, energetic atmosphere',
  club:      'a nightclub interior with colored stage lights, DJ booth, dance floor with movement, energetic atmosphere',
  // Food
  food: 'a restaurant setting with plated dishes on a wooden table, warm ambient lighting, dining atmosphere',
  mat:  'a restaurant setting with plated dishes on a wooden table, warm ambient lighting, dining atmosphere',
  // Festival
  festival: 'an outdoor summer festival with stage and crowd, colorful flags and tents, sunny sky',
  // Produktionsdata-fallbacks (verifierat från Supabase 2026-08-24)
  community: 'a public outdoor gathering in a city square, civic atmosphere, daytime',
  culture:   'a cultural venue interior with artistic atmosphere, soft museum-style lighting',
  // Default
  default: 'an editorial event photograph with attendees in an atmospheric setting',
};

const GENERIC_CATEGORIES = new Set(['community', 'culture', 'event', 'default', '']);

function getVenueHint(venueName: string | null | undefined): string {
  if (!venueName || typeof venueName !== 'string') return '';
  const v = venueName.toLowerCase();
  if (/museet|gallery|galleri/.test(v)) return 'At a Stockholm art museum. ';
  if (/arena|stadium/.test(v)) return 'At a sports arena. ';
  if (/stadion/.test(v)) return 'At a stadium. ';
  if (/konserthus|concert hall/.test(v)) return 'At a concert hall. ';
  if (/teatern|dramaten|opera/.test(v)) return 'At a theater. ';
  if (/arena|stadion|stadium/.test(v)) return 'At a sports venue. ';
  return '';
}

function extractCategoryFallback(title: string | null | undefined): string | null {
  if (!title || typeof title !== 'string') return null;
  const t = title.toLowerCase();
  if (/idrott|fotboll|sport|match/.test(t)) return 'sports';
  if (/utställning|konst|galleri|museum|exhibition|surrealism/.test(t)) return 'exhibition';
  if (/konsert|concert|musik|music/.test(t)) return 'music';
  if (/teater|theater|föreställning|pjäs/.test(t)) return 'theater';
  if (/barn|family|kids/.test(t)) return 'family';
  if (/nattliv|night|club/.test(t)) return 'nightlife';
  if (/mat|food|restaurang/.test(t)) return 'food';
  if (/festival/.test(t)) return 'festival';
  return null;
}

function getVenueName(event: EventInput): string | null {
  if (event?.venues) {
    const v = Array.isArray(event.venues) ? event.venues[0] : event.venues;
    if (v && typeof v === 'object' && 'name' in v) return v.name;
  }
  return event?.venue_name ?? null;
}

// ── Prompt builder ──────────────────────────────────────────────────────────

export function buildAutoPrompt(event: EventInput): string {
  const title = (event?.title_sv || event?.title_en || '').trim();
  const titleShort = title.slice(0, 60);

  const venueName = getVenueName(event);
  const venueHint = getVenueHint(venueName);

  // Primär kategori
  let category = (event?.category_slug || '').toLowerCase();
  if (!category || GENERIC_CATEGORIES.has(category)) {
    const titleFallback = extractCategoryFallback(title);
    if (titleFallback) category = titleFallback;
  }

  const scene = CATEGORY_SCENES[category] || CATEGORY_SCENES.default;

  return (
    `${venueHint}Editorial photograph of ${scene}. ` +
    `Photographic style, vivid natural colors, soft natural lighting, cinematic depth of field. ` +
    `Mobile event thumbnail, square aspect. ` +
    `CRITICAL NEGATIVE PROMPT — ZERO TEXT ABSOLUTE: absolutely no readable text of any kind. ` +
    `No words, no letters, no numbers, no calligraphy, no typography, no signs, no banners, no labels, no logos, no watermarks, no UI text. ` +
    `No posters, no billboards, no flyers, no book covers, no t-shirt text, no newspaper print, no magazine covers. ` +
    `Even partial fragments of letters, half-formed words, or stylized text marks are forbidden. ` +
    `No recognizable brand names, no trademarks, no logos, no symbols. ` +
    `No recognizable architecture or identifiable landmarks (no Stockholm City Hall, no Globen, no specific buildings). ` +
    `If people appear they must be small in frame, full-body, in action, or in silhouette — never close-up portraits of faces. ` +
    `Clean, text-free, logo-free, abstract editorial photograph only. `
  );
}

// ── Dedup keys ──────────────────────────────────────────────────────────────

export function dedupKey(event: EventInput): string {
  const t = (event?.title_sv || event?.title_en || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const v = (getVenueName(event) || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${t}::${v}`;
}

export function dedupPath(key: string): string {
  return key.replace(/::/g, '-').replace(/[^a-z0-9\-]/g, '').slice(0, 200);
}

// ── BFL Flux-dev ────────────────────────────────────────────────────────────

interface BFLSubmitResponse {
  id: string;
  polling_url: string;
}

interface BFLAccessors {
  readonly _bflApiKey: string | undefined;
}

async function getBflApiKey(): Promise<string> {
  const key = process.env.BFL_API_KEY;
  if (!key) throw new Error('BFL_API_KEY missing in .env');
  return key;
}

async function generateFluxImage(prompt: string): Promise<{ b64: string; mime: string; seed: number | null; id: string }> {
  const apiKey = await getBflApiKey();
  const seed = Date.now() & 0x7fffffff;

  const submitRes = await fetch(`${BFL_BASE}/flux-dev`, {
    method: 'POST',
    headers: {
      'x-key': apiKey,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ prompt, width: 1024, height: 1024, steps: 28, seed }),
  });
  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`BFL submit ${submitRes.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await submitRes.json()) as BFLSubmitResponse;
  if (!data.polling_url) throw new Error('BFL submit returned no polling_url');

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(data.polling_url, {
      headers: { 'x-key': apiKey, accept: 'application/json' },
    });
    if (!pollRes.ok) throw new Error(`BFL poll ${pollRes.status}`);
    const pollData = (await pollRes.json()) as {
      status: string;
      result?: { sample: string; seed?: number };
    };
    if (pollData.status === 'Ready') {
      const imgRes = await fetch(pollData.result!.sample);
      if (!imgRes.ok) throw new Error(`BFL image fetch ${imgRes.status}`);
      const arrayBuf = await imgRes.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return {
        b64: btoa(binary),
        mime: 'image/png',
        seed: pollData.result?.seed ?? null,
        id: data.id,
      };
    }
    if (pollData.status === 'Failed' || pollData.status === 'Error') {
      throw new Error(`BFL generation failed: ${pollData.status}`);
    }
  }
  throw new Error(`BFL timed out after ${TIMEOUT_MS / 1000}s`);
}

// ── Supabase Storage + DB update ────────────────────────────────────────────

async function uploadAndPersist(
  eventIds: string[],
  b64: string,
  mime: string,
  storagePath: string,
  prompt: string,
  seed: number | null,
): Promise<string> {
  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    throw new Error('uploadAndPersist: eventIds is empty');
  }
  const supabase = getSupabaseClient();
  const rawBuffer = Buffer.from(b64, 'base64');
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const path = `events/${storagePath}.${ext}`;

  // ── EU AI Act Art. 50: stämpla INNAN uppladdning ─────────────────
  // applyAiCompliance är idempotent på input-nivå och kostar ~10–50 ms.
  // JPEG (vissa providers) lämnas rå — hooken useAiImageUrl kommer då
  // inte att hävda stampVisible (om vi vill ha fullständig compliance för
  // JPEG måste vi konvertera JPEG→PNG efter stämpling, men det ändrar
  // URL och kräver DB-uppdatering — separat uppgift).
  const buffer = mime === 'image/png'
    ? await applyAiCompliance({
        buffer: rawBuffer,
        prompt,
        model: 'flux-dev',
        position: 'bottom-left',
      })
    : rawBuffer;

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, buffer, {
      contentType: mime,
      upsert: true,
      cacheControl: '31536000',
    });
  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

  // ── Post-upload verifiering: ladda ner den uppladdade bilden och kör
  // checkAiStamp mot den vi just skickade upp. Om changedRatio < 0.5
  // har något gått fel i transport/compression — kasta så ingestion
  // backoffar istället för att publicera ostämplad.
  if (mime === 'image/png') {
    try {
      const dl = await fetch(
        `${process.env.SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`,
      );
      if (!dl.ok) {
        console.warn(`[imageGen] post-upload verify: fetch ${dl.status} (path=${path})`);
      } else {
        const dlBuf = Buffer.from(await dl.arrayBuffer());
        const check = await checkAiStamp(dlBuf, 'bottom-left', buffer);
        if (!check.ok) {
          throw new Error(
            `post-upload verify failed: changedRatio=${(check.changedRatio ?? 0).toFixed(3)}`,
          );
        }
      }
    } catch (verifyErr: unknown) {
      const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
      throw new Error(`post-upload verify failed: ${msg}`);
    }
  }

  const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const imageUrl = pub?.publicUrl;
  if (!imageUrl) throw new Error('No public URL returned for uploaded image');

  // Update ALLA event-rader. Försök först med alla fält (migration applicerad).
  // Om migrationen INTE är applicerad ännu, falla tillbaka till image_url-only.
  const generatedAt = new Date().toISOString();
  const fullUpdate = {
    image_url: imageUrl,
    image_prompt: prompt,
    image_model: 'flux-dev',
    image_generated_at: generatedAt,
    image_generation_status: 'done',
    image_ai_generated: true,
  };

  let updateErr: { message: string } | null = null;
  const { error: fullErr } = await supabase
    .from('events')
    .update(fullUpdate)
    .in('id', eventIds);
  updateErr = fullErr;

  // Fallback: om migration ej applicerad, försök image_url-only
  if (updateErr && /Could not find the .* column/i.test(updateErr.message)) {
    console.warn(`[imageGen] migration ej applicerad — faller tillbaka till image_url-only (${updateErr.message})`);
    const { error: fallbackErr } = await supabase
      .from('events')
      .update({ image_url: imageUrl })
      .in('id', eventIds);
    updateErr = fallbackErr;
  }

  if (updateErr) {
    throw new Error(`events update failed: ${updateErr.message}`);
  }

  return imageUrl;
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function generateForEvent(event: EventInput): Promise<ImageGenResult> {
  const prompt = buildAutoPrompt(event);
  const { b64, mime, seed } = await generateFluxImage(prompt);
  const key = dedupKey(event);
  const storagePath = dedupPath(key);
  const imageUrl = await uploadAndPersist([event.id], b64, mime, storagePath, prompt, seed);
  return {
    eventId: event.id,
    imageUrl,
    storagePath,
    prompt,
    seed,
    costCents: FLUX_COST_CENTS,
  };
}

/**
 * Batch-generate for the first N published events.
 * Dedups by (title::venue) — recurring events share one image.
 */
export async function generateBatch(
  limit: number,
  options: { onlyMissing?: boolean; concurrency?: number; onProgress?: (done: number, total: number, last: ImageGenResult | null) => void } = {}
): Promise<BatchResult> {
  const supabase = getSupabaseClient();
  const { onlyMissing = true, concurrency = 3, onProgress } = options;

  let query = supabase
    .from('events')
    .select('id, title_sv, title_en, description_sv, description_en, category_slug, venues(name)')
    .eq('status', 'published')
    .order('start_time', { ascending: true })
    .limit(limit);

  if (onlyMissing) {
    // Image_url IS NULL. RLS allows service role to filter on this.
    query = query.is('image_url', null);
  }

  const { data: rows, error: fetchErr } = await query;
  if (fetchErr) throw new Error(`Supabase fetch failed: ${fetchErr.message}`);
  if (!rows || rows.length === 0) {
    return { totalFetched: 0, uniqueGroups: 0, okCount: 0, failCount: 0, results: [], errors: [] };
  }

  // Dedup-gruppera
  const groupsMap = new Map<string, { ids: string[]; representative: EventInput }>();
  for (const row of rows) {
    const event: EventInput = {
      id: row.id,
      title_sv: row.title_sv,
      title_en: row.title_en,
      description_sv: row.description_sv,
      description_en: row.description_en,
      venues: row.venues,
      category_slug: row.category_slug,
    };
    const key = dedupKey(event);
    if (!groupsMap.has(key)) {
      groupsMap.set(key, { ids: [], representative: event });
    }
    groupsMap.get(key)!.ids.push(row.id);
  }
  const groups = Array.from(groupsMap.values());

  const results: ImageGenResult[] = [];
  const errors: Array<{ eventIds: string[]; error: string }> = [];
  let done = 0;
  const total = groups.length;

  // Process with limited concurrency (BFL rate-limit friendly)
  const queue = [...groups];
  const workers: Promise<void>[] = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const g = queue.shift();
        if (!g) break;
        const ev = g.representative;
        try {
          const prompt = buildAutoPrompt(ev);
          const { b64, mime, seed } = await generateFluxImage(prompt);
          const storagePath = dedupPath(dedupKey(ev));
          const imageUrl = await uploadAndPersist(g.ids, b64, mime, storagePath, prompt, seed);
          const result: ImageGenResult = {
            eventId: ev.id,
            imageUrl,
            storagePath,
            prompt,
            seed,
            costCents: FLUX_COST_CENTS,
          };
          results.push(result);
          done++;
          if (onProgress) onProgress(done, total, result);
        } catch (err) {
          errors.push({ eventIds: g.ids, error: (err as Error).message });
          done++;
          if (onProgress) onProgress(done, total, null);
        }
      }
    })());
  }
  await Promise.all(workers);

  return {
    totalFetched: rows.length,
    uniqueGroups: groups.length,
    okCount: results.length,
    failCount: errors.length,
    results,
    errors,
  };
}
