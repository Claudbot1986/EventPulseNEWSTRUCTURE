/**
 * config.ts — runtime configuration for the EventPulse Prompt Compiler (mission §50/§51/§64/§65).
 *
 * Reads environment variables and exposes a typed `Config` object.
 *
 * Environment variables (all optional):
 *   EVENTPULSE_PROMPT_COMPILER    0|1          default: 1  (set 0 to bypass the entire pipeline)
 *   EVENTPULSE_PROMPT_MODE        off|deterministic|hybrid  default: deterministic
 *                                                          (LLM-assisted classifier not yet implemented)
 *   EVENTPULSE_PROMPT_DEBUG       0|1          default: 0  (write last-* debug artifacts)
 *   EVENTPULSE_PROMPT_LLM         0|1          default: 0  (opt-in LLM-assisted classifier)
 *   EVENTPULSE_PROMPT_TIMEOUT_MS  number       default: 1500  (per-hook timeout, fail-open)
 *   EVENTPULSE_PROMPT_MAX_TOKENS  number       default: 1500  (cap on injected mission text)
 *   EVENTPULSE_PROMPT_RUNTIME_DIR path          default: .eventpulse-agent/runtime
 *   EVENTPULSE_PROMPT_ACTIVE      0|1          internal recursive-hook guard (set by router)
 *
 * Defaults favor safety and reliability: deterministic only, fail-open, no LLM call,
 * bounded latency. Per mission §51.
 */

export type CompilerMode = 'off' | 'deterministic' | 'hybrid';

export interface Config {
  enabled: boolean;
  mode: CompilerMode;
  debug: boolean;
  llmEnabled: boolean;
  timeoutMs: number;
  maxTokens: number;
  runtimeDir: string;
  active: boolean;
  logLevel: 'quiet' | 'normal' | 'debug';
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

function envNum(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function envMode(name: string, fallback: CompilerMode): CompilerMode {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'deterministic' || raw === 'hybrid') return raw;
  return fallback;
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const debug = envBool('EVENTPULSE_PROMPT_DEBUG', false);
  const llmEnabled = envBool('EVENTPULSE_PROMPT_LLM', false);
  cached = {
    enabled: envBool('EVENTPULSE_PROMPT_COMPILER', true),
    mode: envMode('EVENTPULSE_PROMPT_MODE', 'deterministic'),
    debug,
    llmEnabled,
    timeoutMs: envNum('EVENTPULSE_PROMPT_TIMEOUT_MS', 1500, 100, 30000),
    maxTokens: envNum('EVENTPULSE_PROMPT_MAX_TOKENS', 1500, 200, 8000),
    runtimeDir: (process.env.EVENTPULSE_PROMPT_RUNTIME_DIR ?? '.eventpulse-agent/runtime').trim() || '.eventpulse-agent/runtime',
    active: envBool('EVENTPULSE_PROMPT_ACTIVE', false),
    logLevel: debug ? 'debug' : 'normal',
  };
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
}

export function isEffectivelyEnabled(): boolean {
  const c = loadConfig();
  return c.enabled && c.mode !== 'off';
}

export function shouldRunLLMClassifier(): boolean {
  const c = loadConfig();
  return c.llmEnabled && c.mode === 'hybrid' && c.enabled && c.mode !== 'off';
}