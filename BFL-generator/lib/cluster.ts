/**
 * lib/cluster.ts
 *
 * Klustrar råa event-beskrivningar med MiniMax-M3 (multimodal LLM).
 *
 * Indata:  { event_id, raw_description, category_slug }
 * Utdata:  { event_id, tags: string[] }    // 1-3 kluster-taggar
 *
 * Indata-fallback (om raw_description är null/tom):
 *   1. description_sv
 *   2. eventpulse_summary
 *   3. "" (tom sträng → returnera [])
 *
 * Säkerhet:
 *   - API-nyckel läses från MINIMAX_API_KEY, exponeras ALDRIG i loggar/utdata.
 *   - Om nyckel saknas → mock-läge (returnerar []), tydligt flaggat.
 *   - Om nätverksfel → throw med generiskt meddelande (nyckel aldrig i meddelande).
 *
 * Modell: minimax/minimax-m3 via OpenRouter (https://openrouter.ai/api/v1/chat/completions).
 */

export interface ClusterInput {
  event_id: string;
  raw_description: string | null;
  category_slug: string;
}

export interface ClusterResult {
  event_id: string;
  tags: string[];
  /** Tomt om mock-läge eller om M3 inte kunde svara. */
  source: 'mock' | 'minimax' | 'empty';
}

const PROMPT = (category: string, description: string): string => `Du är en assistent som hjälper till att kategorisera evenemang i Stockholm för bildgenerering.

Kategori: ${category}
Beskrivning: """${description}"""

Ge 1-3 korta KLUSTER-TAGGAR (svenska, lowercase, 1-2 ord vardera) som beskriver evenemangets visuella innehåll — typ "hårdrock", "pop", "jazz", "symfoniorkester", "monolog", "fars", "utställning", "workshop", "löpning", "fotboll", "standup", "matlagning", etc. Taggarna ska baseras på FAKTISKT INNEHÅLL i beskrivningen, inte gissa.

Svara BARA med en JSON-array, inget annat. Exempel: ["hårdrock","elgitarr"]

Om beskrivningen är tom eller inte ger visuell signal: []`;

/**
 * Läser MINIMAX_API_KEY från env. Returnerar null om saknas.
 * Användaren har uttryckligen auktoriserat användning av denna nyckel.
 */
function getApiKey(): string | null {
  return process.env.MINIMAX_API_KEY || null;
}

/**
 * Anropar M3 via OpenRouter. Kastar vid nätverksfel eller ogiltigt svar.
 */
async function callMinimax(description: string, category: string): Promise<string[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('MINIMAX_API_KEY saknas');
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://eventpulse.local',
      'X-Title': 'EventPulse BFL-generator',
    },
    body: JSON.stringify({
      model: 'minimax/minimax-m3',
      messages: [
        { role: 'user', content: PROMPT(category, description) },
      ],
      temperature: 0.2,
      max_tokens: 60,
    }),
  });

  if (!res.ok) {
    throw new Error(`M3-anrop misslyckades: HTTP ${res.status}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('M3-anrop returnerade tomt svar');
  }

  // Parsa JSON-array ur svaret. M3 kan ibland returnera text runt JSON.
  const match = content.match(/\[[\s\S]*?\]/);
  if (!match) {
    return [];
  }
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is string => typeof t === 'string')
      .map(t => t.toLowerCase().trim())
      .filter(t => t.length > 0 && t.length < 30)
      .slice(0, 3);
  } catch {
    return [];
  }
}

/**
 * Klustra ett enskilt event.
 *
 * Beteende:
 *   - Om MINIMAX_API_KEY saknas → mock-läge, returnerar [] med source='mock'.
 *   - Om beskrivning tom → returnerar [] med source='empty'.
 *   - Annars anropas M3, svaret parsas, tags normaliseras (lowercase, max 30 tecken, max 3 st).
 */
export async function clusterEvent(input: ClusterInput): Promise<ClusterResult> {
  const { event_id, raw_description, category_slug } = input;

  const description = (raw_description || '').trim();
  if (!description) {
    return { event_id, tags: [], source: 'empty' };
  }

  if (!getApiKey()) {
    // Mock-läge: tydligt, aldrig tyst.
    return { event_id, tags: [], source: 'mock' };
  }

  try {
    const tags = await callMinimax(description, category_slug);
    return { event_id, tags, source: 'minimax' };
  } catch (err) {
    // Logga endast typen av fel, aldrig nyckeln eller hela felmeddelandet om det kan innehålla känsligt.
    const msg = err instanceof Error ? err.message : 'okänt fel';
    // Filtrera bort allt som kan innehålla nyckeln (sker inte normalt, men försiktighet).
    const safeMsg = msg.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***');
    console.warn(`[cluster] ${event_id}: ${safeMsg}`);
    return { event_id, tags: [], source: 'empty' };
  }
}

/**
 * Klustrar många events parallellt (max 5 åt gången för att inte bränna M3-kvot).
 */
export async function clusterBatch(
  inputs: ClusterInput[],
  options: { concurrency?: number } = {},
): Promise<ClusterResult[]> {
  const concurrency = options.concurrency ?? 5;
  const results: ClusterResult[] = new Array(inputs.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < inputs.length) {
      const idx = cursor++;
      results[idx] = await clusterEvent(inputs[idx]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()),
  );

  return results;
}