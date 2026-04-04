/**
 * Ollama AI Provider Configuration
 * Model: minimax-m2.7:cloud
 * Endpoint: http://127.0.0.1:11434/v1 (OpenAI-compatible)
 */

// Load .env from project root (simple approach)
import * as dotenv from 'dotenv';
dotenv.config({ path: '/Users/claudgashi/EventPulse-recovery/clawdbot2/project/00EVENTPULSEFINALDESTINATION/.env', override: true });

export const AI_CONFIG = {
  provider: 'ollama' as const,
  model: 'minimax-m2.7:cloud',
  // Ollama local endpoint (OpenAI-compatible)
  baseUrl: 'http://127.0.0.1:11434/v1',
  apiKey: 'ollama', // Ollama doesn't need real API key
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
