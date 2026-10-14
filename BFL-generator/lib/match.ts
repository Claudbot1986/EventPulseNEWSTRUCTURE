/**
 * lib/match.ts
 *
 * Hittar bästa bilden i image_library för ett givet event.
 *
 * Flöde:
 *   1. M3 läser event-beskrivning → 4 svenska taggar
 *   2. Sök image_library där cluster_tags && eventTags (Postgres array overlap)
 *   3. Score = antal överlappande taggar
 *   4. Bäst match inom samma kategori vinner
 *   5. Om ingen träff → returnera null (caller beslutar fallback)
 *
 * Säkerhet:
 *   - API-nyckel från MINIMAX_API_KEY
 *   - Om nyckel saknas: tom tag-lista (caller får fallback)
 */

const M3_ENDPOINT = 'https://api.minimax.io/v1/text/chatcompletion_v2';
const M3_MODEL = 'MiniMax-M3';

export interface MatchInput {
  event_id: string;
  category_slug: string;
  raw_description: string | null;
  /** Max antal kandidater att returnera. Default 1. */
  limit?: number;
}

export interface LibraryImage {
  id: string;
  storage_path: string;
  public_url: string;
  category_slug: string | null;
  cluster_tags: string[];
  rating: number | null;
  times_used: number;
}

export interface MatchResult {
  event_id: string;
  event_tags: string[];
  candidates: Array<LibraryImage & { overlap: number }>;
  best: LibraryImage | null;
  source: 'minimax' | 'empty' | 'no-key';
}

const TAG_PROMPT = (category: string, description: string): string => `Du matchar evenemang i Stockholm till AI-genererade bilder i ett bildbibliotek.

Kategori: ${category}
Evenemangs-beskrivning: """${description}"""

Ge 3-5 korta SÖK-TAGGAR (svenska, lowercase, 1-2 ord) som bäst beskriver det VISUELLA innehållet i beskrivningen. Taggarna ska vara sådana som troligen matchar bildbibliotekets kluster-taggar (typ "hårdrock", "gitarr", "mörk scen", "symfoniorkester", "monolog", "fars", "utställning", "workshop", etc).

Svara BARA med en JSON-array. Exempel: ["hårdrock","elgitarr","mörk scen"]`;

function getApiKey(): string | null {
  return process.env.MINIMAX_API_KEY || null;
}

async function callM3Tags(description: string, category: string): Promise<string[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const res = await fetch(M3_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: M3_MODEL,
      messages: [{ role: 'user', content: TAG_PROMPT(category, description) }],
      temperature: 0.2,
      max_tokens: 1500,
    }),
  });

  if (!res.ok) return [];
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return [];

  const match = content.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is string => typeof t === 'string')
      .map(t => t.toLowerCase().trim())
      .filter(t => t.length > 0 && t.length < 30)
      .slice(0, 5);
  } catch {
    return [];
  }
}

function getSupabaseCreds(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

async function searchLibrary(category: string, tags: string[]): Promise<LibraryImage[]> {
  const creds = getSupabaseCreds();
  if (!creds || tags.length === 0) return [];

  // Bygg OR: varje tagg blir en egen cs-gren (contains single-element array).
  // PostgREST's overlap-operator (ov.) kan inte användas i or()-gren — det
  // är bara en fristående filter. Vi använder cs (contains) på en 1-element-array
  // per gren, vilket ger samma semantik: "någon av taggarna finns i cluster_tags".
  // 2026-10-12: filtrera bort taggar med PostgREST-array-syntax-tecken
  // (mellanslag, komma, klammerparenteser) — de ger HTTP 400. Matchningen
  // fungerar fortfarande på de giltiga taggarna.
  const safeTags = tags.filter((t) => !/[\s,{}"]/.test(t));
  if (safeTags.length === 0) return [];
  const orClause = safeTags.map(t => `cluster_tags.cs.{"${t.replace(/"/g, '\\"')}"}`).join(',');

  const url = `${creds.url}/rest/v1/image_library?category_slug=eq.${encodeURIComponent(category)}&or=(${encodeURIComponent(orClause)})&select=id,storage_path,public_url,category_slug,cluster_tags,rating,times_used&order=times_used.asc&limit=20`;

  const res = await fetch(url, {
    headers: { apikey: creds.key, Authorization: `Bearer ${creds.key}` },
  });

  if (!res.ok) {
    console.warn(`[match] image_library query misslyckades: HTTP ${res.status}`);
    return [];
  }
  return res.json() as Promise<LibraryImage[]>;
}

function scoreAndRank(candidates: LibraryImage[], eventTags: string[]): Array<LibraryImage & { overlap: number }> {
  const eventTagSet = new Set(eventTags);
  return candidates
    .map(img => {
      const overlap = (img.cluster_tags ?? []).filter(t => eventTagSet.has(t)).length;
      return Object.assign({}, img, { overlap });
    })
    .filter(c => c.overlap > 0)
    .sort((a, b) => {
      // Primärt: flest överlappande taggar
      if (b.overlap !== a.overlap) return b.overlap - a.overlap;
      // Sekundärt: lägst times_used (rotation)
      return (a.times_used ?? 0) - (b.times_used ?? 0);
    });
}

/**
 * Huvudfunktion: hitta bästa bild för ett event.
 */
export async function findImageForEvent(input: MatchInput): Promise<MatchResult> {
  const { event_id, category_slug, raw_description } = input;
  const limit = input.limit ?? 1;

  const description = (raw_description || '').trim();

  if (!description) {
    return { event_id, event_tags: [], candidates: [], best: null, source: 'empty' };
  }

  if (!getApiKey()) {
    return { event_id, event_tags: [], candidates: [], best: null, source: 'no-key' };
  }

  const tags = await callM3Tags(description, category_slug);
  if (tags.length === 0) {
    return { event_id, event_tags: [], candidates: [], best: null, source: 'empty' };
  }

  const candidates = await searchLibrary(category_slug, tags);
  const ranked = scoreAndRank(candidates, tags);
  const best = ranked.length > 0 ? ranked[0] : null;

  return {
    event_id,
    event_tags: tags,
    candidates: ranked.slice(0, limit),
    best,
    source: 'minimax',
  };
}

/**
 * Batch-version: matcha många events parallellt (max 5 åt gången).
 */
export async function findImagesForEvents(inputs: MatchInput[]): Promise<MatchResult[]> {
  const concurrency = 5;
  const results: MatchResult[] = new Array(inputs.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < inputs.length) {
      const idx = cursor++;
      results[idx] = await findImageForEvent(inputs[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()));
  return results;
}
