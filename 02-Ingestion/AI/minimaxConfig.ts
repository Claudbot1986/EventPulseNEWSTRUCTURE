/**
 * MiniMax AI Provider Configuration (direct API, no Ollama proxy)
 * Model: MiniMax-M2.7
 * Endpoint: https://api.minimax.io/v1 (OpenAI-compatible)
 * Key: MINIMAX_API_KEY from project-root .env (verified 200 OK on /v1/models 2026-09-05)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

export const AI_CONFIG = {
  provider: 'minimax' as const,
  model: 'MiniMax-M2.7',
  // MiniMax direct endpoint (OpenAI-compatible)
  baseUrl: 'https://api.minimax.io/v1',
  apiKey: process.env.MINIMAX_API_KEY,
  // Generation parameters
  maxTokens: 4096,
  temperature: 0.1, // Low temperature for consistent extraction
};

/**
 * Call MiniMax API with a prompt
 */
export async function callMinimax(
  prompt: string,
  options: {
    system?: string;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<string> {
  const { apiKey, baseUrl, maxTokens, temperature } = AI_CONFIG;

  if (!apiKey) {
    throw new Error('MINIMAX_API_KEY not configured');
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: AI_CONFIG.model,
      messages: [
        ...(options.system ? [{ role: 'system' as const, content: options.system }] : []),
        { role: 'user' as const, content: prompt },
      ],
      temperature: options.temperature ?? temperature,
      max_tokens: options.maxTokens ?? maxTokens,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`MiniMax API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content || '';
}
