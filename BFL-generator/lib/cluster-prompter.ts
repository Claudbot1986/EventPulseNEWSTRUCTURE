/**
 * lib/cluster-prompter.ts
 *
 * Bygger N unika BFL-prompter baserat på kluster-sammanfattning.
 * Varje prompt får ett "minne" (cluster_tags) som sparas på bilden i image_library.
 *
 * Indata:
 *   - category: kategori-slug
 *   - tagFrequency: Record<string, number> (från tmp/cluster_*.json)
 *   - count: antal prompter vi vill ha
 *   - maxConcurrency: batchstorlek för M3-anrop
 *
 * Utdata:
 *   - prompts: Array<{ prompt: string, cluster_tags: string[], weight: number }>
 *
 * Viktfördelning:
 *   - Sortera kluster-taggar efter frekvens (fallande)
 *   - Tilldela N prompter proportionellt mot frekvens
 *   - Lägsta frekvensen får minst 1 (aldrig 0)
 *
 * Säkerhet:
 *   - API-nyckel läses från MINIMAX_API_KEY
 *   - Vid fel: returnera mock-prompter (deterministiskt) så pipeline kan fortsätta
 */

const M3_ENDPOINT = 'https://api.minimax.io/v1/text/chatcompletion_v2';
const M3_MODEL = 'MiniMax-M3';

export interface PromptBuildInput {
  category: string;
  tagFrequency: Record<string, number>;
  count: number;
  maxConcurrency?: number;
}

export interface BuiltPrompt {
  prompt: string;
  cluster_tags: string[];
  weight: number;
}

const SAFETY_SUFFIX = 'no weapons, no knives, no blood, no gloves, no hands holding objects, no close-up faces of minors, no violence, child-safe imagery, family-friendly, no bodies lying down, no death scenes, no funeral scenes';

const PROMPT_TEMPLATE = (category: string, cluster: string): string => `Du skriver BFL Flux Pro 1.1-prompter för evenemangsbilder (Stockholm).

Kategori: ${category}
Kluster: ${cluster}

Skriv EN kort bildprompt (max 35 ord) som visuellt representerar "${cluster}" inom "${category}".
- Sättet ska kännas Stockholm-redaktionellt (bred komposition, varmt ljus, lite rå yta).
- Inga ansikten i förgrunden, inga läsbar text i bilden, inga varumärken.
- Sluta med en mood-setting mening ("...", Editorial style, warm tones).

Svara BARA med prompttexten. Inget annat.`;

function getApiKey(): string | null {
  return process.env.MINIMAX_API_KEY || null;
}

/**
 * Viktar kluster → antal prompts (2026-10-12: proportionell mot events-frekvens).
 *  - Största kluster får flest bilder, proportionellt mot antal events
 *  - Minsta kluster får minst 1 bild
 *  - Totalen matchar `count` exakt (efter avrundningskorrigering)
 */
function distributePrompts(tagFrequency: Record<string, number>, count: number): Array<{ tag: string; weight: number }> {
  const tags = Object.entries(tagFrequency).sort((a, b) => b[1] - a[1]);
  if (tags.length === 0 || count <= 0) return [];

  const totalEvents = tags.reduce((s, [, n]) => s + n, 0);
  if (totalEvents === 0) return [];

  // Om count < antal kluster, ge varje 1 (eller 0 om vi har färre bilder än kluster)
  if (count <= tags.length) {
    return tags.slice(0, count).map(([tag]) => ({ tag, weight: 1 }));
  }

  // Fördela proportionellt: varje kluster får sin andel av count
  // Formel: weight = max(1, round((events_i / totalEvents) * count))
  const result: Array<{ tag: string; weight: number }> = tags.map(([tag, n]) => ({
    tag,
    weight: Math.max(1, Math.round((n / totalEvents) * count)),
  }));

  // Sortera fallande på events för att kunna justera rätt
  result.sort((a, b) => (tagFrequency[b.tag] ?? 0) - (tagFrequency[a.tag] ?? 0));

  // Justera avrundning: om summan != count, skala de största
  let sum = result.reduce((s, r) => s + r.weight, 0);
  if (sum !== count && result.length > 0) {
    const diff = count - sum;
    if (diff > 0) {
      // Ge mer till de största
      for (let i = 0; i < diff; i++) result[i % result.length].weight += 1;
    } else {
      // Ta från de minsta (slutet av listan)
      for (let i = 0; i < -diff; i++) result[result.length - 1 - (i % result.length)].weight -= 1;
    }
  }

  return result;
}

async function callM3(category: string, cluster: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('no key');

  const res = await fetch(M3_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: M3_MODEL,
      messages: [{ role: 'user', content: PROMPT_TEMPLATE(category, cluster) }],
      temperature: 0.7,
      max_tokens: 1500,
    }),
  });

  if (!res.ok) throw new Error(`M3 HTTP ${res.status}`);
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('M3 tomt svar');

  // Lägg till safety-suffix om M3 inte redan inkluderar det
  const hasSafety = /child.safe|safe.*imagery|no weapons/i.test(content);
  return hasSafety ? content : `${content} ${SAFETY_SUFFIX}`;
}

function mockPrompt(category: string, cluster: string): string {
  return `Wide editorial photograph of a Stockholm ${category} scene representing ${cluster}. Warm tones, soft natural light, no people in foreground, no text, no death imagery, family-friendly atmosphere. Editorial style, ${cluster} mood, cinematic composition. ${SAFETY_SUFFIX}`;
}

/**
 * Huvudfunktion: bygg count unika BFL-prompter baserat på tagFrequency.
 * M3 anropas parallellt för varje unik kluster-tagg (inte per prompt-instans,
 * eftersom samma kluster ger liknande prompts — vi duplicerar efteråt).
 */
export async function buildPrompts(input: PromptBuildInput): Promise<BuiltPrompt[]> {
  const { category, tagFrequency, count } = input;
  const distribution = distributePrompts(tagFrequency, count);
  if (distribution.length === 0) return [];

  const concurrency = input.maxConcurrency ?? 7;
  // 2026-10-13: MOCK_PROMPTS=1 hoppar över M3 och använder mock-prompts direkt.
  // M3 är långsam + returnerar ofta tomt content → onödigt slöseri med tid.
  const useMock = !getApiKey() || process.env.MOCK_PROMPTS === '1';

  // Hämta prompt per unik tag (M3 anropas 1 gång per tag, inte per vikt-instans)
  const tagToPrompt = new Map<string, string>();
  const uniqueTags = distribution.map(d => d.tag);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < uniqueTags.length) {
      const idx = cursor++;
      const tag = uniqueTags[idx];
      if (tagToPrompt.has(tag)) continue;
      try {
        if (useMock) {
          tagToPrompt.set(tag, mockPrompt(category, tag));
        } else {
          tagToPrompt.set(tag, await callM3(category, tag));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'okänt';
        console.warn(`[cluster-prompter] ${tag}: ${msg} → mock fallback`);
        tagToPrompt.set(tag, mockPrompt(category, tag));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueTags.length) }, () => worker()));

  // Expandera till count prompter enligt viktfördelning
  const out: BuiltPrompt[] = [];
  let rep = 0;
  for (const { tag, weight } of distribution) {
    const basePrompt = tagToPrompt.get(tag) ?? mockPrompt(category, tag);
    for (let i = 0; i < weight; i++) {
      out.push({
        prompt: basePrompt,
        cluster_tags: [tag],
        weight: weight,
      });
      rep++;
    }
  }

  return out;
}
