/**
 * editorialWriter.ts — genererar EditorialDraft från Profile + EventPulse-data.
 *
 * Pipeline-steg 4 av 6 i EventPulse Editorial Description Engine (P7).
 *
 * VIKTIGT: Writer får BARA WriterSafeInputs (Profile + event-data + style guide).
 * Source-text når aldrig hit (textualFirewall.ts garanterar det).
 *
 * LLM-abstraktion: EditorialLlmClient interface. OpenAI är primär (OpenAI-rad 1
 * OK enligt API-nyckelstatus 2026-09-20). Anthropic var sönder vid samma test
 * — används inte. För tester finns en MockLlmClient.
 *
 * Steg 4/15 i P7 Definition of Done.
 */

import type { EditorialDraft, WriterSafeInputs } from './types';

// ─── LLM-klient-abstraktion ──────────────────────────────────────────────────

export interface LlmGenerateArgs {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmClient {
  readonly name: string;
  generate(args: LlmGenerateArgs): Promise<string>;
}

// ─── OpenAI-klient ──────────────────────────────────────────────────────────

export interface OpenAIClientConfig {
  apiKey: string;
  defaultModel?: string;
  baseUrl?: string;
}

export class OpenAILlmClient implements LlmClient {
  readonly name = 'openai';
  private apiKey: string;
  private defaultModel: string;
  private baseUrl: string;

  constructor(config: OpenAIClientConfig) {
    this.apiKey = config.apiKey;
    this.defaultModel = config.defaultModel ?? 'gpt-4o-mini';
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
  }

  async generate(args: LlmGenerateArgs): Promise<string> {
    const model = args.model ?? this.defaultModel;
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: args.systemPrompt },
          { role: 'user', content: args.userPrompt },
        ],
        max_tokens: args.maxTokens ?? 300,
        temperature: args.temperature ?? 0.7,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content ?? '';
    return text.trim();
  }
}

// ─── Mock-klient (för tester) ────────────────────────────────────────────────

export class MockLlmClient implements LlmClient {
  readonly name = 'mock';
  private canned: string | ((args: LlmGenerateArgs) => string);

  constructor(canned: string | ((args: LlmGenerateArgs) => string)) {
    this.canned = canned;
  }

  async generate(args: LlmGenerateArgs): Promise<string> {
    if (typeof this.canned === 'function') return this.canned(args);
    return this.canned;
  }
}

// ─── Writer-system prompt ────────────────────────────────────────────────────

/**
 * System-prompt som skickas till Writer.
 *
 * Innehåller säkerhetsregler + stilistisk vägledning. Byggs deterministiskt
 * från STYLE_GUIDE + Profile.
 */
function buildSystemPrompt(styleGuide: string): string {
  return `Du är redaktiverande skribent för ett Stockholm-eventmagasin.

REGLER (följ alltid):
1. Skriv BARA från informationen i Profilen och evenemangs-datan som ges.
2. Hitta ALDRIG på artister, verk, teman, datum, tider eller påståenden som inte finns.
3. Skriv ALDRIG ut pris, datum eller tid i den löpande texten (UI visar det separat).
4. Inga emojis. Inga hashtags. Inga "Boka nu!"-uppmaningar.
5. Om Profilen är tunn, skriv kortare och mer allmänt hellre än att gissa.

STILISTIK:
${styleGuide}

OUTPUTFORMAT:
- Returnera ENDAST själva beskrivningstexten.
- Inget preamble, inga rubriker, inga listor.
- 2–3 meningar på svenska.`;
}

/**
 * User-prompt som skickas till Writer.
 *
 * Innehåller Profile + EventPulse-data (BARA WriterSafeInputs, inget annat).
 */
function buildUserPrompt(inputs: WriterSafeInputs): string {
  const profile = inputs.profile;
  const e = inputs.event;

  const lines: string[] = [];

  lines.push('PROFIL:');
  lines.push(`- event_type: ${profile.event_type}`);
  if (profile.event_format) lines.push(`- event_format: ${profile.event_format}`);
  if (profile.performers.length) lines.push(`- performers: ${profile.performers.join(', ')}`);
  if (profile.support_acts?.length) lines.push(`- support_acts: ${profile.support_acts.join(', ')}`);
  if (profile.ensemble) lines.push(`- ensemble: ${profile.ensemble}`);
  if (profile.genres.length) lines.push(`- genres: ${profile.genres.join(', ')}`);
  if (profile.subgenres?.length) lines.push(`- subgenres: ${profile.subgenres.join(', ')}`);
  if (profile.content.length) lines.push(`- content: ${profile.content.join(', ')}`);
  if (profile.themes?.length) lines.push(`- themes: ${profile.themes.join(', ')}`);
  if (profile.concept) lines.push(`- concept: ${profile.concept}`);
  if (profile.experience_characteristics.length) lines.push(`- experience_characteristics: ${profile.experience_characteristics.join(', ')}`);
  if (profile.performance_style) lines.push(`- performance_style: ${profile.performance_style}`);
  if (profile.audience_participation?.length) lines.push(`- audience_participation: ${profile.audience_participation.join(', ')}`);
  if (profile.target_audience?.length) lines.push(`- target_audience: ${profile.target_audience.join(', ')}`);
  if (profile.age_context) lines.push(`- age_context: ${profile.age_context}`);
  if (profile.duration_minutes != null) lines.push(`- duration_minutes: ${profile.duration_minutes}`);
  if (profile.setting) lines.push(`- setting: ${profile.setting}`);
  if (profile.practical_information?.length) lines.push(`- practical_information: ${profile.practical_information.join(', ')}`);
  if (profile.family_characteristics?.length) lines.push(`- family_characteristics: ${profile.family_characteristics.join(', ')}`);

  lines.push('');
  lines.push('EVENEMANG:');
  lines.push(`- titel: ${e.title}`);
  lines.push(`- start_time: ${e.start_time}`);
  if (e.venue_name) lines.push(`- venue_name: ${e.venue_name}`);
  if (e.city) lines.push(`- city: ${e.city}`);
  if (e.price_min_sek != null) lines.push(`- price_min_sek: ${e.price_min_sek}`);
  lines.push(`- is_free: ${e.is_free}`);
  if (e.language) lines.push(`- language: ${e.language}`);

  return lines.join('\n');
}

// ─── Writer-huvudfunktion ───────────────────────────────────────────────────

const PROMPT_VERSION = 'editorial-writer/v1';

export interface EditorialWriterInput {
  inputs: WriterSafeInputs;
  llm: LlmClient;
  model?: string;
  seed?: string;
}

export async function writeEditorialDescription(input: EditorialWriterInput): Promise<EditorialDraft> {
  const { inputs, llm, seed } = input;
  const model = input.model ?? (llm instanceof OpenAILlmClient ? (llm as OpenAILlmClient)['defaultModel'] : 'unknown');

  const systemPrompt = buildSystemPrompt(inputs.style_guide);
  const userPrompt = buildUserPrompt(inputs);

  const text = await llm.generate({
    systemPrompt,
    userPrompt,
    model,
    maxTokens: 300,
    temperature: 0.7,
  });

  const word_count = text.split(/\s+/).filter(Boolean).length;

  return {
    text: text.trim(),
    word_count,
    info_level: 'MEDIUM', // uppdateras av factuality/independence senare
    meta: {
      model,
      prompt_version: PROMPT_VERSION,
      seed,
      generated_at: new Date().toISOString(),
    },
  };
}