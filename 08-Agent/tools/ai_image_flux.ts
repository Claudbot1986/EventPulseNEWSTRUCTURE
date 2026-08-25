/**
 * 08-Agent/tools/ai_image_flux — Step A smoketest image generation via
 * Black Forest Labs Flux 2 klein (4B).
 *
 * Pure module (no IO except the HTTP calls themselves). Reuses the same
 * `GenerateOneInput` / `GenerateOneOutput` contracts as `ai_image.ts`.
 * Watermarking is NOT shared — both Flux and OpenAI smoketest scripts now
 * call `applyAiCompliance` from `tools/ai_compliance` directly so the
 * output is EU AI Act Art. 50 compliant (visible stämpel + XMP iTXt).
 *
 * Drop-in alternative to `generateOne()` from `tools/ai_image.ts` —
 * substantially cheaper per image than OpenAI gpt-image-1 but no native
 * moderation or C2PA metadata (the safe-prompt guardrails in
 * `buildSafePrompt` remain the first line of defense).
 *
 * API shape (BFL Flux 2):
 *   POST https://api.bfl.ai/v1/flux-2-klein-4b
 *     headers: { 'x-key': <BFL_API_KEY>, 'Content-Type': 'application/json' }
 *     body:    { prompt: string, width: number, height: number }
 *   → { id: string, polling_url: string }
 *   GET <polling_url>
 *     headers: { 'x-key': <BFL_API_KEY> }
 *   → { status: 'Ready' | 'Pending' | 'Rejected' | 'Failed' | 'Error',
 *        result?: { sample: string } }
 *   fetch(sample) → PNG bytes (signed URL, 10-minute expiry)
 *
 * Note: Flux Schnell has been deprecated; the cheapest current model
 * is Flux 2 [klein] 4B.
 */

import { createHash } from 'node:crypto';

import type { GenerateOneInput, GenerateOneOutput } from './ai_image';

// ─── Constants ────────────────────────────────────────────────────────────

const BFL_BASE = 'https://api.bfl.ai/v1';
const BFL_MODEL_PATH = '/flux-2-klein-4b';

const POLL_INTERVAL_MS = 500;
const POLL_MAX_ATTEMPTS = 60; // 30 s wall-clock
// Flux 2 [klein] 4B is the cheapest current BFL endpoint. Actual
// pricing is from your account dashboard; this is an estimate and is
// what we report in the audit manifest.
const FLUX_COST_USD = 0.003;

// ─── Errors ───────────────────────────────────────────────────────────────

export class BFLModerationError extends Error {
  constructor(message: string, public readonly stage: 'input' | 'output') {
    super(message);
    this.name = 'BFLModerationError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function redactKey(apiKey: string): string {
  if (apiKey.length <= 8) return '***';
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex').slice(0, 16);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Submit ───────────────────────────────────────────────────────────────

interface SubmitResponse {
  id: string;
  polling_url?: string;
}

interface SubmitResult {
  jobId: string;
  pollingUrl: string;
}

async function submitJob(
  apiKey: string,
  fullPrompt: string,
  width: number,
  height: number,
): Promise<SubmitResult> {
  const url = `${BFL_BASE}${BFL_MODEL_PATH}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-key': apiKey,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ prompt: fullPrompt, width, height }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `BFL submit failed: HTTP ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`,
    );
  }

  const data = (await response.json()) as Partial<SubmitResponse>;
  if (typeof data.id !== 'string' || data.id.length === 0) {
    throw new Error('BFL submit returned no job id');
  }
  if (typeof data.polling_url !== 'string' || data.polling_url.length === 0) {
    throw new Error('BFL submit returned no polling_url');
  }
  return { jobId: data.id, pollingUrl: data.polling_url };
}

// ─── Poll ─────────────────────────────────────────────────────────────────

interface ResultResponse {
  status: 'Pending' | 'Ready' | 'Rejected' | 'Failed' | 'Error' | string;
  result?: { sample?: string; seed?: number };
}

async function pollForResult(
  apiKey: string,
  pollingUrl: string,
  signal?: AbortSignal,
): Promise<ResultResponse> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) {
      throw new Error('BFL poll aborted');
    }
    const response = await fetch(pollingUrl, {
      method: 'GET',
      headers: {
        'x-key': apiKey,
        accept: 'application/json',
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `BFL poll failed: HTTP ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`,
      );
    }
    const data = (await response.json()) as ResultResponse;
    if (data.status === 'Ready') return data;
    if (data.status === 'Rejected') {
      throw new BFLModerationError('BFL rejected the prompt or output', 'input');
    }
    if (data.status === 'Failed' || data.status === 'Error') {
      throw new Error(`BFL job ended with status=${data.status}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`BFL poll timed out after ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
}

// ─── Fetch result image ───────────────────────────────────────────────────

async function fetchImageBytes(sampleUrl: string): Promise<Buffer> {
  // Sample URLs are signed and only valid for 10 minutes — fetch
  // immediately after Ready.
  const response = await fetch(sampleUrl);
  if (!response.ok) {
    throw new Error(`BFL image fetch failed: HTTP ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── Public: generateOneFlux ──────────────────────────────────────────────

/**
 * Generate one image via BFL Flux 2 [klein] 4B. Returns PNG bytes +
 * prompt hash. Throws `BFLModerationError` if BFL rejects the input or
 * output.
 *
 * Cost is hardcoded at $0.003/image — an estimate; the API does not
 * surface per-image cost in the response.
 */
export async function generateOneFlux(input: GenerateOneInput): Promise<GenerateOneOutput> {
  const apiKey = process.env.BFL_API_KEY;
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('BFL_API_KEY is not set. Export it before running the Flux smoketest generator.');
  }

  // Flux ignores "negative" instructions — we append them harmlessly so
  // the audit trail matches the OpenAI path. The prompt itself is what
  // matters to the model.
  const fullPrompt = `${input.prompt}\n\nAvoid: ${input.negative_prompt}.`;

  let submit: SubmitResult;
  try {
    submit = await submitJob(apiKey, fullPrompt, 1024, 1024);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown submit error';
    throw new Error(`BFL submit (key=${redactKey(apiKey)}): ${msg}`);
  }

  const result = await pollForResult(apiKey, submit.pollingUrl);
  const sampleUrl = result.result?.sample;
  if (typeof sampleUrl !== 'string' || sampleUrl.length === 0) {
    throw new Error('BFL returned Ready status with no sample URL');
  }

  const pngBytes = await fetchImageBytes(sampleUrl);

  return {
    png_bytes: pngBytes,
    prompt_hash: hashPrompt(input.prompt),
    cost_usd: FLUX_COST_USD,
    revised_prompt: null, // BFL does not rewrite prompts
  };
}