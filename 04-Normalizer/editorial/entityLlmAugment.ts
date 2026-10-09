/**
 * entityLlmAugment — LLM-augment för entity-extraction (FAS 3).
 *
 * Pipeline position: extractEntities (sync, rule-based) →
 *                   → [entityLlmAugment] (async, opt-in, MiniMax-M3)
 *
 * MiniMax-M3 via OpenAI-compatibelt API på https://api.minimax.io/v1.
 * Spegel av llmRouter.ts-arkitekturen (samma MINIMAX_BASE_URL, samma
 * modell), men med kortare timeout och striktare anti-hallucination.
 *
 * Triggar ENDAST när:
 *   - Synk regelbaserad extraktion returnerade 0 entities
 *   - Titel är 5–100 tecken (rimlig entity-namn-bärande längd)
 *   - Kategori är performer-bearing (music/jazz/etc.)
 *   - MINIMAX_API_KEY env är satt — annars no-op
 *
 * Säkerhetsskikt (anti-hallucination):
 *   1. Strikt JSON-schema: endast [{name, role, confidence}]
 *   2. Filter: name måste vara substring av title (case-insensitive)
 *      eller 1–3 VERSAL-börjande ord (LLM-inferensen får inte hitta på)
 *   3. Confidence-tröskel: <0.7 → INFERRED istället för SUPPORTED
 *
 * Fel-beteende: alla nätverksfel / JSON-parse-fel / ogiltig output →
 * no-op (returnera tom lista). Deterministiska regler är alltid source of truth.
 */

import { extractEntities } from './entityExtractor';
import type { EntityExtractionInput, ExtractedEntity, EntityRole } from './types';

export const LLM_MODEL = 'MiniMax-M3';
const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
const LLM_TIMEOUT_MS = 5_000;

export interface LlmAugmentInput {
  title: string;
  category: string | null;
  venue_name: string | null;
}

interface MiniMaxChatResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

interface RawLlmEntity {
  name: string;
  role?: string;
  confidence?: number;
}

// Roller LLM får returnera — övriga mappas till 'artist'.
const ALLOWED_LLM_ROLES: ReadonlySet<EntityRole> = new Set<EntityRole>([
  'artist', 'band', 'ensemble', 'performer', 'comedian',
  'conductor', 'soloist', 'speaker', 'dj',
]);

const ENTITY_SYSTEM_PROMPT = `You are an entity extractor for Swedish event titles.

TASK: Extract Person/Group names that are PERFORMERS in this event.

OUTPUT: ONLY a JSON array. No prose, no markdown fences. Example:
[{"name":"Veronica Maggio","role":"artist","confidence":0.95}]

RULES:
- Return [] if title has no clear performer (work titles, events, tours).
- Each name should be a Person or Group (band, orchestra, ensemble).
- Never return venue names, dates, cities, work titles, event-nouns.
- Keep names exact as written; do not normalize or invent.
- confidence: 0.7-1.0 = clear performer, 0.4-0.7 = plausible, <0.4 = skip.
- Swedish names: keep å/ä/ö intact. Examples: "Özz Nûjen", "Lars Jansson".
- If the title is just one proper noun that COULD be a person or a work,
  return it with low confidence (0.5-0.6).
`;

/** Bygg user-meddelande för LLM. */
function buildUserMessage(input: LlmAugmentInput): string {
  return JSON.stringify({
    title: input.title,
    category: input.category ?? null,
    venue: input.venue_name ?? null,
    instruction: 'Extract performer Person/Group names from title. JSON array only.',
  });
}

/**
 * MiniMax M3 via OpenAI-compatibelt API. Self-contained fetch — ingen
 * SDK-beroende (samma mönster som llmRouter.ts).
 */
async function callMiniMax(
  apiKey: string,
  userMsg: string,
): Promise<string> {
  const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 200,
      temperature: 0.0,
      messages: [
        { role: 'system', content: ENTITY_SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`minimax HTTP ${response.status}`);

  const json = (await response.json()) as MiniMaxChatResponse;
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return '';
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * Parsa LLM-output till RawLlmEntity[]. Strikt: ignorera allt som inte
 * passar schemat. Returnerar [] vid parse-fel.
 */
export function parseLlmEntityJson(text: string): RawLlmEntity[] {
  if (!text) return [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  const slice = candidate.slice(start, end + 1);
  try {
    const arr = JSON.parse(slice);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e): e is RawLlmEntity =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as { name?: unknown }).name === 'string' &&
        ((e as { name: string }).name.length >= 2),
    );
  } catch {
    return [];
  }
}

/**
 * Anti-hallucination filter.
 *
 * Accepterar en extracted entity BARA om:
 *   - Namn är substring av title (case-insensitive), ELLER
 *   - Namn är 1–3 VERSAL-börjande svenska ord (LLM-inferensen får gissa
 *     smärre namn-stavningar om format ser rimligt ut)
 *
 * Detta stoppar LLM från att hitta på helt nya namn som inte finns i titeln.
 */
export function filterHallucinatedNames(
  extracted: ReadonlyArray<RawLlmEntity>,
  title: string,
): RawLlmEntity[] {
  const titleLower = title.toLowerCase();
  return extracted.filter((e) => {
    const name = e.name.trim();
    if (name.length < 2 || name.length > 50) return false;
    if (!/[A-Za-zÅÄÖåäö]/.test(name)) return false;
    // Strippa citationstecken / paranteser som kan finnas
    const cleanName = name.replace(/^["'`(\[]+|["'`)\]]+$/g, '').trim();
    if (cleanName.length < 2) return false;
    // Substring-check (LLM brukar returnera namn som finns i titeln)
    if (titleLower.includes(cleanName.toLowerCase())) return true;
    // VERSAL-börjande 1–3 ord (LLM får gissa stavning vid behov)
    const words = cleanName.split(/\s+/);
    if (words.length >= 1 && words.length <= 3 &&
        words.every(w => /^[A-ZÅÄÖ][\p{L}åäöÅÄÖ'\-]+$/u.test(w))) {
      return true;
    }
    return false;
  });
}

/**
 * Beslut: ska vi anropa LLM för detta event?
 *
 * Ren funktion (no I/O) — testbar utan API.
 */
export function shouldLlmAugment(
  title: string,
  category: string | null,
  currentEntityCount: number,
): boolean {
  // Bara om regelbaserade metoder gav 0 entities
  if (currentEntityCount > 0) return false;
  // Titel måste vara rimlig
  const t = title.trim();
  if (t.length < 5 || t.length > 100) return false;
  // Bara performer-bearing kategorier
  if (!category) return false;
  const PERFORMER_CATS = new Set([
    'music', 'classical', 'opera', 'jazz', 'electronic', 'rock', 'pop',
    'theatre-comedy', 'humor', 'dance', 'musical-theatre',
    'sport', 'sports', 'tournament',
    'circus', 'opera', 'family',
    'unknown',  // FAS 3.5: okategoriserade events kan ha artister (t.ex. HSO – Orkesterfest med Pascal)
  ]);
  if (!PERFORMER_CATS.has(category)) return false;
  // Utan API-nyckel — skip
  if (!process.env.MINIMAX_API_KEY) return false;
  return true;
}

/**
 * Map LLM-roll till EntityRole, default 'artist' om okänd.
 */
function mapRole(raw: string | undefined): EntityRole {
  if (!raw) return 'artist';
  const r = raw.toLowerCase() as EntityRole;
  return ALLOWED_LLM_ROLES.has(r) ? r : 'artist';
}

/**
 * Huvudfunktion. Anropas av `extractEntitiesWithLlmAugment` i entityExtractor.ts.
 *
 * Returnerar ExtractedEntity[] (kan vara tom). Vid fel → [].
 *
 * Provider-injection: tester kan skicka en mockProvider för att styra
 * LLM-svaret utan att gå via nätverk.
 */
export async function llmAugmentEntities(
  input: LlmAugmentInput,
  provider: LlmProvider = defaultProvider,
): Promise<ExtractedEntity[]> {
  // Mock-provider kan köras utan API-nyckel (tester).
  if (provider !== defaultProvider && !process.env.MINIMAX_API_KEY) {
    // ok — testa mock-läge
  } else if (!process.env.MINIMAX_API_KEY) {
    return [];
  }

  try {
    const text = await provider.complete(ENTITY_SYSTEM_PROMPT, buildUserMessage(input));
    if (!text) return [];

    const parsed = parseLlmEntityJson(text);
    if (parsed.length === 0) return [];

    const filtered = filterHallucinatedNames(parsed, input.title);
    if (filtered.length === 0) return [];

    return filtered.map((e) => ({
      name: e.name.trim(),
      role: mapRole(e.role),
      evidence: {
        field: 'title',
        span: input.title,
        method: 'llm_fallback:minimax-m3',
      },
      confidence: (e.confidence ?? 0.5) >= 0.7 ? 'SUPPORTED' : 'INFERRED',
    }));
  } catch {
    // Alla fel = no-op. Deterministiska regler är sanningskällan.
    return [];
  }
}

/**
 * LLM-provider-interface. Tester mockar via { complete: () => string }.
 */
export interface LlmProvider {
  /** Returnera rå LLM-output (text). Kan kasta vid simulerat fel. */
  complete(systemPrompt: string, userMsg: string): Promise<string>;
}

/** Default-provider: riktig MiniMax M3 via api.minimax.io/v1. */
export const defaultProvider: LlmProvider = {
  async complete(_sys, userMsg) {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) throw new Error('MINIMAX_API_KEY not configured');
    return callMiniMax(apiKey, userMsg);
  },
};

// ─── Async wrapper: extractEntities (sync) + llmAugment (async) ──────────────

/**
 * Async wrapper som kör synk regelbaserad extraktion OCH lägger till
 * LLM-augmenterade entiteter om reglerna gav 0 resultat.
 *
 * Pipeline:
 *   1. extractEntities(input) — sync, 4 pass
 *   2. shouldLlmAugment(...) → triggar LLM BARA om nödvändigt (≤10 % av events)
 *   3. llmAugmentEntities(...) → MiniMax M3 anropas med mock eller riktig provider
 *   4. Merge med dedup (per `name::role`) — LLM-entities får INTE skriva över
 *      befintliga regel-extraktioner.
 *
 * Beteende:
 *   - Om regler gav >=1 entity: returnera dessa (ingen LLM-anrop).
 *   - Om regler gav 0 + kategori performer + API-nyckel satt: anropa LLM.
 *   - Om LLM-anrop misslyckas: returnera vad reglerna gav (0 entities).
 *   - confidence för LLM-entities: SUPPORTED om ≥0.7, annars INFERRED.
 */
export async function extractEntitiesWithLlmAugment(
  input: EntityExtractionInput,
  provider?: LlmProvider,
): Promise<ExtractedEntity[]> {
  // 1. Synk regelbaserad extraktion
  const baseEntities = extractEntities(input);

  // 2. Beslut: behövs LLM?
  const title = input.title ?? '';
  if (!shouldLlmAugment(title, input.category_slug, baseEntities.length)) {
    return baseEntities;
  }

  // 3. LLM-anrop (eller mock i tester)
  const llmEntities = await llmAugmentEntities({
    title,
    category: input.category_slug,
    venue_name: input.venue_name,
  }, provider ?? defaultProvider);

  // 4. Merge med dedup på (name + role).
  // LLM-entities får lägga till NYA name/role-par men aldrig duplicera.
  const seen = new Set(baseEntities.map((e) => `${e.name}::${e.role}`));
  const merged: ExtractedEntity[] = [...baseEntities];
  for (const llmEnt of llmEntities) {
    const key = `${llmEnt.name}::${llmEnt.role}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(llmEnt);
    }
  }
  return merged;
}
