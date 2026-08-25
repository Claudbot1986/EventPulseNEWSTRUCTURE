/**
 * BFL (Black Forest Labs) Flux.1 [schnell] client.
 *
 * Workflow:
 *   1. POST submit -> { id, polling_url }
 *   2. GET polling_url every 1.5s until status === 'Ready'
 *   3. Download result.sample to local cache, read as base64
 *
 * Cost: ~$0.003 per 1024x1024 image.
 * License: Apache 2.0 (suitable for production use).
 *
 * SECURITY: API key in client = dev-only. Move to 08-Agent/server.ts before production.
 */

import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';

const BFL_API_KEY =
  process.env.EXPO_PUBLIC_BFL_API_KEY ||
  Constants.expoConfig?.extra?.bflApiKey;

const BASE = 'https://api.bfl.ai/v1';
const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = 90_000;

if (!BFL_API_KEY) {
  console.warn('[BFL] EXPO_PUBLIC_BFL_API_KEY saknas — anrop kommer att misslyckas.');
}

export async function generateFluxSchnell(prompt, options = {}) {
  const { width = 1024, height = 1024, steps = 4, seed } = options;

  // 1. Submit
  const submitRes = await fetch(`${BASE}/flux-schnell`, {
    method: 'POST',
    headers: {
      'x-key': BFL_API_KEY,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      prompt,
      width,
      height,
      steps,
      ...(seed !== undefined ? { seed } : {}),
    }),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`BFL submit ${submitRes.status}: ${errText.slice(0, 200)}`);
  }

  const { id, polling_url } = await submitRes.json();
  if (!polling_url) {
    throw new Error('BFL submit misslyckades: ingen polling_url i svar');
  }

  // 2. Poll
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    const pollRes = await fetch(polling_url, {
      headers: {
        'x-key': BFL_API_KEY,
        accept: 'application/json',
      },
    });

    if (!pollRes.ok) {
      throw new Error(`BFL poll ${pollRes.status}`);
    }

    const data = await pollRes.json();

    if (data.status === 'Ready') {
      // 3. Download as base64 via expo-file-system (avoids Buffer polyfill)
      const cachePath = `${FileSystem.cacheDirectory}flux-${id}.png`;
      const dl = await FileSystem.downloadAsync(data.result.sample, cachePath);
      const b64 = await FileSystem.readAsStringAsync(dl.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Clean up local cache file — keep only base64 in memory
      await FileSystem.deleteAsync(cachePath, { idempotent: true });

      return {
        id,
        b64,
        seed: data.result?.seed ?? null,
        prompt,
      };
    }

    if (data.status === 'Failed' || data.status === 'Error') {
      throw new Error(`BFL generation failed: ${data.status} — ${JSON.stringify(data.result || {})}`);
    }
    // Otherwise: status is 'Pending' or 'Processing' — continue polling
  }

  throw new Error(`BFL generation timed out efter ${TIMEOUT_MS / 1000}s`);
}