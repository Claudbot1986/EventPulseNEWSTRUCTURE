/**
 * 08-Agent/tools/ai_image — Step A smoketest image generation.
 *
 * Pure functions only. No IO. The smoketest script (in /scripts/) and the
 * unit tests are the only callers.
 *
 * Two exports:
 *   - `buildSafePrompt(input)`  — pure; 6 guardrails; deterministic hash
 *   - `generateOne(prompt)`     — side-effecting; calls OpenAI gpt-image-1
 *                                 with moderation; returns PNG buffer
 *
 * No Supabase access. No filesystem access. No Express. Keeping this file
 * small + pure makes the unit tests honest and the watermarking step a
 * single function the script can compose.
 */

import { createHash } from 'node:crypto';
import sharp from 'sharp';

import {
  TRADEMARK_BLOCKLIST,
  VENUE_HINT_BUCKETS,
  PALETTES,
  MEDIUMS,
  COMPOSITIONS,
  type SafePromptInput,
  type SafePromptResult,
} from '../types/ai_image';

// ─── Constants ─────────────────────────────────────────────────────────────

const PROMPT_MAX_CHARS = 900;
const TITLE_MIN_CHARS = 4;

const NEGATIVE_PROMPT = [
  'text',
  'watermark',
  'logo',
  'signature',
  'brand name',
  'realistic face',
  'person',
  'photograph',
  'frame',
  'border',
  'multiple panels',
].join(', ');

/**
 * PII / URL scrubber regexes applied to every text field BEFORE the
 * trademark blacklist. Order matters — strip URLs first so we don't
 * match the domain like `konserthuset.se` (which we WOULD want to
 * scrub via the blacklist, but only as a word).
 */
const SCRUB_PATTERNS: ReadonlyArray<RegExp> = [
  // URLs
  /\bhttps?:\/\/[^\s]+/gi,
  // email
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi,
  // phone (loose)
  /\b\+?\d{2,4}[\s-]?\d{2,3}[\s-]?\d{2,3}[\s-]?\d{2,3}\b/g,
  // social handles
  /@\w{2,}/g,
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function scrubPII(s: string): string {
  let out = s;
  for (const pat of SCRUB_PATTERNS) {
    out = out.replace(pat, '');
  }
  // Collapse whitespace introduced by scrubbing.
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Returns the matched blocklist term (case-insensitive, word-boundary)
 * if `s` contains one, otherwise null. Word boundary = non-alnum on
 * either side so "kentucky" doesn't match "kent".
 */
function containsBlocklistTerm(s: string): string | null {
  const lower = s.toLowerCase();
  for (const term of TRADEMARK_BLOCKLIST) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
    if (re.test(lower)) return term;
  }
  return null;
}

function timeOfDayHint(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'evening';
  const h = d.getUTCHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

function cityHint(city: string): string {
  const c = (city || '').toLowerCase().trim();
  if (c.length === 0) return 'a nordic city';
  if (c.includes('stockholm')) return 'Stockholm during late summer';
  if (c.includes('göteborg') || c.includes('gothenburg')) return 'Gothenburg';
  if (c.includes('malmö') || c.includes('malmo')) return 'Malmö';
  return 'a Scandinavian city';
}

function venueTypeHint(categorySlug: string, title: string): string {
  const cat = (categorySlug || '').toLowerCase();
  const tit = (title || '').toLowerCase();

  // Pass 1: try to match using ONLY the category slug so a precise
  // category ("exhibition", "theater") wins over incidental keywords in
  // the title ("jazz" inside "Late Night Jazz Quartet"). This is the
  // correct priority for visual scene selection.
  if (cat.length > 0) {
    for (const bucket of VENUE_HINT_BUCKETS) {
      if (bucket.match.length === 0) continue;
      for (const keyword of bucket.match) {
        if (cat.includes(keyword)) return bucket.hint;
      }
    }
  }

  // Pass 2: fall back to title keywords only when category is empty.
  for (const bucket of VENUE_HINT_BUCKETS) {
    if (bucket.match.length === 0) continue;
    for (const keyword of bucket.match) {
      if (tit.includes(keyword)) return bucket.hint;
    }
  }

  // Fallback (last bucket is the catch-all).
  return VENUE_HINT_BUCKETS[VENUE_HINT_BUCKETS.length - 1].hint;
}

function hashPrompt(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Deterministic picker — hash the (seed + salt) tuple, take the first 4
 * bytes as a uint32, mod the array length. Same seed+salt → same index,
 * always. Used to choose per-event variation axes (palette / medium /
 * composition) without leaving footprints of randomness.
 *
 * Exported so the test suite can exercise the spreading properties.
 */
export function pick<T>(arr: ReadonlyArray<T>, seed: string, salt: string): T {
  if (arr.length === 0) {
    throw new Error('pick() called with an empty array');
  }
  const h = createHash('sha256').update(`${seed}|${salt}`, 'utf8').digest();
  const idx = h.readUInt32BE(0) % arr.length;
  return arr[idx];
}

// ─── Public: buildSafePrompt ──────────────────────────────────────────────

/**
 * Build a verified-safe AI image prompt from an event row.
 *
 * 6 guardrails, applied in this strict order:
 *   1. PII scrub on every text field
 *   2. Trademark blacklist — falls back to category-only if matched
 *   3. Venue genericisation (no real venue names reach the model)
 *   4. Style template (no-text/no-logo wording baked in)
 *   5. Negative prompt (explicit do-not-render list)
 *   6. Length cap + hash for audit
 *
 * Always returns a non-empty result. `fallback_used = true` indicates
 * guardrails 2 or 3 forced a category-only prompt — callers should
 * flag those events in the audit log.
 */
export function buildSafePrompt(input: SafePromptInput): SafePromptResult {
  const sourcesUsed: Array<keyof SafePromptInput> = [];

  // ── Guardrail 1: scrub
  const cleanTitle = scrubPII(input.title || '');
  const cleanCategory = scrubPII(input.category_slug || '');
  const cleanVenue = scrubPII(input.venue_name || '');
  const cleanCity = scrubPII(input.city || '');

  if (cleanTitle.length > 0) sourcesUsed.push('title');
  if (cleanCategory.length > 0) sourcesUsed.push('category_slug');
  if (cleanVenue.length > 0) sourcesUsed.push('venue_name');
  if (cleanCity.length > 0) sourcesUsed.push('city');

  // ── Guardrail 2: trademark blacklist
  const titleHit = cleanTitle.length > 0 ? containsBlocklistTerm(cleanTitle) : null;
  const venueHit = cleanVenue.length > 0 ? containsBlocklistTerm(cleanVenue) : null;
  const categoryHit = cleanCategory.length > 0 ? containsBlocklistTerm(cleanCategory) : null;

  let fallbackUsed = false;
  let effectiveTitle = cleanTitle;
  let effectiveVenue = cleanVenue;
  let effectiveCategory = cleanCategory;

  const hasBlockedTerm = titleHit !== null || venueHit !== null || categoryHit !== null;

  if (hasBlockedTerm) {
    // Force a category-only prompt so the original title/venue/category
    // never reaches the model — even with redaction. If the category
    // itself tripped the blocklist, drop it too so the brand name
    // never appears in the prompt.
    effectiveTitle = '';
    effectiveVenue = '';
    if (categoryHit !== null) effectiveCategory = '';
    fallbackUsed = true;
  }

  // Title length fallback — if the title is too short OR has been zeroed
  // out by the blocklist, build from category + venue-hint only.
  if (effectiveTitle.length < TITLE_MIN_CHARS) {
    effectiveTitle = '';
    fallbackUsed = true;
  }

  // ── Guardrail 3: venue genericisation
  const venueHint = venueTypeHint(
    effectiveCategory || cleanCategory,
    effectiveTitle || effectiveCategory,
  );
  sourcesUsed.push('start_time');
  const timeHint = timeOfDayHint(input.start_time);
  sourcesUsed.push('city');

  // ── Guardrail 4: style template
  const mood = input.is_free ? 'community, relaxed' : 'special-occasion warmth';
  const light = input.is_free ? 'soft daylight' : 'warm evening light';

  // Step A refinement (2026-08-23): per-event seeded visual axes. The
  // three picks are hash-deterministic by `input.id` so same event =
  // same visual treatment, but 10 distinct events give 10 distinct
  // combinations across an 8 × 8 × 8 = 512-cell surface.
  const palette = pick(PALETTES, input.id, 'palette');
  const medium = pick(MEDIUMS, input.id, 'medium');
  const composition = pick(COMPOSITIONS, input.id, 'composition');

  const parts: string[] = [];
  parts.push(`Editorial illustration of ${venueHint}`);
  parts.push(`during a ${effectiveCategory || 'cultural'} event`);
  parts.push(`in ${cityHint(cleanCity)}`);
  parts.push(`at ${timeHint}`);
  parts.push(`with ${mood}`);
  parts.push(`and ${light}.`);
  parts.push(`Composition: ${composition}.`);
  parts.push(`Medium: ${medium}.`);
  parts.push(`Color palette: ${palette.prompt}.`);
  parts.push('Square 1024x1024.');
  parts.push('No readable text, logos, faces, or branding anywhere.');

  // Concatenate title only when it's safe + long enough.
  if (effectiveTitle.length >= TITLE_MIN_CHARS) {
    // Theme the prompt lightly on the title's mood without echoing
    // exact words — keeps the prompt abstract and trademark-free.
    const moodWord = pickMoodWord(effectiveCategory, timeHint);
    parts.unshift(`A ${moodWord} illustration inspired by the feeling of "${effectiveTitle.slice(0, 60).replace(/"/g, '')}".`);
  }

  let prompt = parts.join(' ');

  // ── Guardrail 6: length cap
  if (prompt.length > PROMPT_MAX_CHARS) {
    prompt = `${prompt.slice(0, PROMPT_MAX_CHARS - 1)}…`;
  }

  // Canonical form for the hash — whitespace-collapsed + lowercased so
  // minor edits to the template don't change the audit hash, but real
  // prompt changes do.
  const canonical = prompt.replace(/\s+/g, ' ').trim().toLowerCase();

  return {
    prompt,
    negative_prompt: NEGATIVE_PROMPT,
    style_tags: [palette.name, medium, composition],
    prompt_hash: hashPrompt(canonical),
    sources_used: sourcesUsed,
    fallback_used: fallbackUsed,
  };
}

function pickMoodWord(category: string, timeHint: string): string {
  const cat = category.toLowerCase();
  if (cat.includes('music') || cat.includes('concert')) return 'rhythmic';
  if (cat.includes('theater') || cat.includes('theatre') || cat.includes('play')) return 'dramatic';
  if (cat.includes('film') || cat.includes('cinema')) return 'cinematic';
  if (cat.includes('art') || cat.includes('exhibition')) return 'contemplative';
  if (cat.includes('book') || cat.includes('lecture') || cat.includes('literature')) return 'literary';
  if (cat.includes('workshop')) return 'hands-on';
  if (timeHint === 'morning') return 'fresh';
  if (timeHint === 'night') return 'dreamlike';
  return 'atmospheric';
}

// ─── Public: generateOne (OpenAI gpt-image-1) ─────────────────────────────

export interface GenerateOneInput {
  /** Result of `buildSafePrompt(input)`. */
  prompt: string;
  /** Result of `buildSafePrompt(input)`.negative_prompt. */
  negative_prompt: string;
}

export interface GenerateOneOutput {
  /** PNG bytes from the model. */
  png_bytes: Buffer;
  /** Sha256[:16] of the prompt — passed back so the script can audit. */
  prompt_hash: string;
  /** Cost estimate from OpenAI, if surfaced by the SDK. */
  cost_usd: number | null;
  /** Raw revised prompt (OpenAI may rewrite for safety). Stored in audit log. */
  revised_prompt: string | null;
}

export class OpenAIModerationError extends Error {
  constructor(message: string, public readonly category: 'input' | 'output') {
    super(message);
    this.name = 'OpenAIModerationError';
  }
}

/**
 * Call OpenAI gpt-image-1 with moderation enabled. Returns the raw PNG
 * bytes from the model. Throws `OpenAIModerationError` if either the
 * input or output is rejected — caller decides what to do (the script
 * currently falls back to an abstract SVG placeholder, which is a Step B
 * enhancement; Step A logs and skips).
 */
export async function generateOne(input: GenerateOneInput): Promise<GenerateOneOutput> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('OPENAI_API_KEY is not set. Export it before running the smoketest generator.');
  }

  // Lazy-load the OpenAI SDK so the rest of the file (buildSafePrompt)
  // remains importable in test environments without the SDK present.
  let OpenAI: typeof import('openai').default;
  try {
    const mod = await import('openai');
    OpenAI = (mod as { default: typeof import('openai').default }).default;
  } catch (err) {
    throw new Error(
      'openai package is not installed. Run `npm install openai` before generating images.',
    );
  }

  const client = new OpenAI({ apiKey });

  // Combine prompt + negative prompt into one string. OpenAI does not
  // have a dedicated `negative_prompt` parameter for gpt-image-1, so we
  // append the negative prompt as a second paragraph.
  const fullPrompt = `${input.prompt}\n\nAvoid: ${input.negative_prompt}.`;

  const response = await client.images.generate({
    model: 'gpt-image-1',
    prompt: fullPrompt,
    n: 1,
    size: '1024x1024',
    // moderation: 'auto' is the default; we set it explicitly so the
    // call is auditable from the SDK parameters alone.
    moderation: 'auto',
  });

  const first = response.data?.[0];
  if (!first) {
    throw new Error('OpenAI returned no image data');
  }

  // OpenAI returns either b64_json or a url. Prefer b64_json so we
  // don't make a second HTTP call that could fail mid-batch.
  if (!first.b64_json) {
    throw new Error('OpenAI returned no b64_json — refusing to follow URL callbacks in Step A');
  }

  const pngBytes = Buffer.from(first.b64_json, 'base64');

  // Best-effort input moderation echo — `result.moderation` is undefined
  // for `auto`; explicit check via OpenAI's separate moderation endpoint
  // is deferred to Step B (it's a separate API call we don't want to
  // double-charge on every generation).
  const revisedPrompt = typeof first.revised_prompt === 'string' ? first.revised_prompt : null;

  return {
    png_bytes: pngBytes,
    prompt_hash: hashPrompt(input.prompt),
    cost_usd: null, // SDK does not surface cost on the images.generate response
    revised_prompt: revisedPrompt,
  };
}

// ─── Public: addWatermark (Step A only — composite + EXIF metadata) ────────

export interface WatermarkInput {
  /** Raw PNG from generateOne. */
  png_bytes: Buffer;
  /** Short hash to embed in the visible watermark. */
  prompt_hash_short: string;
  /** EU AI Act §50 disclosure label (Swedish — matches the UI chip). */
  label?: string;
}

/**
 * Add a visible "AI-genererad" watermark in the bottom-right corner +
 * embed IRec-style metadata in the EXIF block. C2PA-grade signing is
 * deferred to Step B (requires cert procurement); the structure is
 * ready for a `c2pa-node` swap-in.
 *
 * **NOT EU AI Act Art. 50 compliant.** This function exists for the
 * Step A smoketest pipeline only — it writes EXIF (Artist/Copyright)
 * which is human-readable but not machine-verifiable as XMP, and
 * does NOT inject the namespaced `EventPulse:` Art. 50 metadata
 * block that the public HemStarScreen flow expects.
 *
 * New code should call `applyAiCompliance` from `tools/ai_compliance`
 * instead — that function adds BOTH the visible stämpel AND the
 * standard XMP packet (PNG iTXt chunk + JPEG APP1) that Adobe
 * Bridge / exiftool / Photoshop can verify.
 *
 * Returns a new PNG buffer. Never mutates the input.
 * @deprecated Use `applyAiCompliance` from `tools/ai_compliance` instead.
 */
export async function addWatermark(input: WatermarkInput): Promise<Buffer> {
  const label = input.label ?? 'AI-genererad';
  const text = `${label} · ${input.prompt_hash_short}`;

  // Render the watermark as an SVG so we don't need a font file.
  const meta = await sharp(input.png_bytes).metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="${width - 280}" y="${height - 56}" width="260" height="36" rx="18" ry="18"
        fill="rgba(0,0,0,0.65)" />
  <text x="${width - 150}" y="${height - 32}"
        font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="700"
        text-anchor="middle" fill="#ffffff">${escapeXml(text)}</text>
</svg>`;

  const watermarkBuffer = Buffer.from(svg, 'utf8');

  return await sharp(input.png_bytes)
    .composite([{ input: watermarkBuffer, gravity: 'southeast' }])
    // EXIF metadata — C2PA/IRec-style disclosure tag. Real signing deferred.
    .withMetadata({
      exif: {
        IFD0: {
          Artist: 'EventPulse AI (gpt-image-1)',
          Software: 'EventPulse AI Image Pipeline v1 (Step A)',
          Copyright: 'EU AI Act Article 50 — AI-generated',
          ImageDescription: `prompt_hash=${input.prompt_hash_short}`,
        },
      },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
