/**
 * BFL-generator/lib/zoom-prompter.ts
 *
 * Genererar BFL/MiniMax-prompter med TVÅ dimensionella axlar:
 *   1. 10 zoomdjup (EC → AER, från extrem närbild till ovanifrån-vy)
 *   2. 3 poser × 3 ljus = 9 sub-varianter per zoom
 *
 * Producerar 10 × 9 = 90 unika kombinationer per cluster_tag, cachelagrade
 * i tmp_image_corpus/<cat>_zoom_prompts.json. Första anrop per (tag, kombination)
 * går via M3 (MiniMax-M3) — efterföljande läs från disk.
 *
 * Returnerar samma BuiltPrompt-shape som cluster-prompter.ts så att
 * bfl-zoom-batch.ts kan behandla resultatet likadant.
 *
 * Beroenden: cluster-prompter.ts (använder M3_ENDPOINT/M3_MODEL/M3_TEMP)
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const M3_ENDPOINT = 'https://api.minimax.io/v1/chat/completions';
const M3_MODEL = 'MiniMax-M3';

// === ZOOM-TAXONOMY (10 nivåer) ============================================
export interface ZoomLevel {
  id: string;
  name: string;
  slug: string;          // filnamn-vänlig (lowercase, dash-separated)
  distance: string;
  focal: string;
  frame: string;
  example: string;
}

export const ZOOM_LEVELS: ZoomLevel[] = [
  { id: 'EC',  name: 'Extreme close-up', slug: 'extreme-closeup',
    distance: 'very close', focal: '85-135mm',
    frame: 'Fragment (hands, fabric, prop detail)',
    example: 'fingers gripping a microphone stand' },
  { id: 'CU',  name: 'Close-up', slug: 'closeup',
    distance: 'close', focal: '50-85mm',
    frame: 'Face/head + immediate context',
    example: 'a singer leaning into the mic, profile only' },
  { id: 'MCU', name: 'Medium close-up', slug: 'medium-closeup',
    distance: 'close-mid', focal: '35-50mm',
    frame: 'Head + shoulders (single subject)',
    example: 'lead performer head-and-shoulders, side light' },
  { id: 'MED', name: 'Medium', slug: 'medium',
    distance: 'mid', focal: '28-35mm',
    frame: 'Single person waist-up',
    example: 'actor from waist up on stage, hands visible' },
  { id: 'MLS', name: 'Medium-long', slug: 'medium-long',
    distance: 'mid-far', focal: '24-28mm',
    frame: 'Full single body',
    example: 'performer full body on stage, ground visible' },
  { id: 'LS',  name: 'Long / Wide', slug: 'long-wide',
    distance: 'far', focal: '18-24mm',
    frame: '3-4 subjects visible',
    example: 'three musicians on stage visible' },
  { id: 'WIDE',name: 'Wide', slug: 'wide',
    distance: 'far', focal: '14-18mm',
    frame: 'Whole stage + first rows',
    example: 'whole stage with first row of audience' },
  { id: 'XW',  name: 'Very wide', slug: 'very-wide',
    distance: 'very far', focal: '10-14mm',
    frame: 'Whole venue + scale',
    example: 'entire concert hall from balcony' },
  { id: 'EST', name: 'Establishing', slug: 'establishing',
    distance: 'extreme far', focal: '24-35mm',
    frame: 'Exterior + venue + city context',
    example: 'venue exterior with Stockholm skyline behind' },
  { id: 'AER', name: 'Aerial', slug: 'aerial',
    distance: 'top-down', focal: '50mm-equiv',
    frame: 'Top-down / overhead view',
    example: 'overhead of crowd from balcony, geometric' },
];

/**
 * Viktad zoom-fördelning: XW/EST/AER får 25% vardera, resterande 7 zoom delar 25%.
 * Användarens foto-redaktionella preferens 2026-10-21: vill ha mer wide/establishing/
 * aerial, mindre close-up. Verifierat med weighted distribution + largest-remainder.
 */
export const ZOOM_WEIGHTS: Record<string, number> = {
  EC: 1 / 28,     // 0.0357
  CU: 1 / 28,
  MCU: 1 / 28,
  MED: 1 / 28,
  MLS: 1 / 28,
  LS: 1 / 28,
  WIDE: 1 / 28,
  XW: 0.25,
  EST: 0.25,
  AER: 0.25,
};
// summan: 7×(1/28) + 3×0.25 = 0.25 + 0.75 = 1.0 ✓

// === HUMAN-READABLE SUB-VARIATION =========================================
export const POSES = ['still', 'dynamic', 'silhouette'] as const;
export const POSE_SLUG: Record<typeof POSES[number], string> = {
  still: 'still',
  dynamic: 'dynamic',
  silhouette: 'silhouette',
};

export const LIGHTS = ['warm tungsten', 'cool daylight', 'mixed'] as const;
export const LIGHT_SLUG: Record<typeof LIGHTS[number], string> = {
  'warm tungsten': 'warm-tungsten',
  'cool daylight': 'cool-daylight',
  'mixed': 'mixed',
};

// === SUB-VARIATION ========================================================
// (POSES, LIGHTS, Pose, Light redan exporterade ovan)

/**
 * Bygger ett filnamn-prefix som är LÄSBART: zoom_<cat>_<zoom-slug>_<pose-slug>_<light-slug>_<runTag>_<idx>
 * Exempel: zoom_music_extreme-closeup_dynamic_warm-tungsten_859b-64up_000
 */
export function buildFilenamePrefix(
  cat: string,
  zoomId: string,
  pose: typeof POSES[number],
  light: typeof LIGHTS[number],
  runTag: string,
  idx: number,
): string {
  const z = ZOOM_LEVELS.find((zz) => zz.id === zoomId);
  if (!z) throw new Error(`unknown zoomId: ${zoomId}`);
  const zSlug = z.slug;
  const pSlug = POSE_SLUG[pose];
  const lSlug = LIGHT_SLUG[light];
  return `zoom_${cat}_${zSlug}_${pSlug}_${lSlug}_${runTag}_${String(idx).padStart(3, '0')}`;
}

// === SUB-VARIATION ========================================================
// (POSES, LIGHTS, Pose, Light redan exporterade ovan)
export type Pose = typeof POSES[number];
export type Light = typeof LIGHTS[number];

export interface Combo {
  zoomId: ZoomLevel['id'];
  pose: Pose;
  light: Light;
}

/**
 * Viktad fördelning per zoom-nivå enligt ZOOM_WEIGHTS (XW/EST/AER prioriteras).
 * För count=10 → XW=3, EST=3, AER=3, EC=1 (largest-remainder).
 * För count=30 → XW=8, EST=8, AER=7 + 1 per övrig zoom-nivå.
 * Inom varje zoom-nivå varieras pose+light cykliskt (round-robin per zoom).
 */
function distributeZoomSlots(count: number, zooms: ZoomLevel[]): Map<string, number> {
  const out = new Map<string, number>();
  if (count <= 0 || zooms.length === 0) return out;
  const weights = zooms.map((z) => ZOOM_WEIGHTS[z.id] ?? 0);
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight === 0) {
    // fallback: jämn fördelning om weights saknas
    const per = Math.floor(count / zooms.length);
    const rem = count - per * zooms.length;
    zooms.forEach((z, i) => out.set(z.id, per + (i < rem ? 1 : 0)));
    return out;
  }
  const raw = zooms.map((z, i) => ({
    id: z.id,
    exact: (count * weights[i]) / totalWeight,
  }));
  const floor = raw.map((r) => ({ id: r.id, slots: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let used = floor.reduce((s, r) => s + r.slots, 0);
  const need = count - used;
  // Largest remainder fill
  floor.sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < need && i < floor.length; i++) floor[i].slots++;
  for (const f of floor) out.set(f.id, f.slots);
  return out;
}

/**
 * Bygger count unika (zoom, pose, light)-kombinationer viktade mot ZOOM_WEIGHTS.
 * Wide/establishing/aerial (XW/EST/AER) prioriteras enligt editorial-fotoönskemål.
 */
export function buildRoundRobin(
  count: number,
  poses: Pose[],
  lights: Light[],
  zooms: ZoomLevel[],
): Array<{ combo: Combo; z: ZoomLevel; intraIdx: number }> {
  const out: Array<{ combo: Combo; z: ZoomLevel; intraIdx: number }> = [];
  if (count <= 0 || zooms.length === 0) return out;
  const slots = distributeZoomSlots(count, zooms);
  for (let zIdx = 0; zIdx < zooms.length; zIdx++) {
    const z = zooms[zIdx];
    const take = slots.get(z.id) ?? 0;
    for (let i = 0; i < take; i++) {
      // Offset så pose/light inte upprepas identiskt mellan närliggande zooms
      const pose = poses[(i + zIdx) % poses.length];
      const light = lights[(i + zIdx * 2) % lights.length];
      out.push({
        combo: { zoomId: z.id, pose, light },
        z,
        intraIdx: i,
      });
    }
  }
  return out;
}

// === PROMPT-SHAPE (samma som BuiltPrompt i cluster-prompter.ts) ============
export interface BuiltZoomPrompt {
  category: string;
  cluster_tag: string;
  zoomId: ZoomLevel['id'];
  zoomName: string;
  focal: string;
  pose: Pose;
  light: Light;
  prompt: string;
  model: string;
  cached: boolean;
}

const SAFETY_SUFFIX = 'no weapons, no knives, no blood, no gloves, no hands holding objects, no close-up faces of minors, no violence, child-safe imagery, family-friendly, no bodies lying down, no death scenes, no funeral scenes';

function buildPromptTemplate(category: string, tag: string, zoom: ZoomLevel, pose: Pose, light: Light): string {
  // För EST (establishing) och AER (aerial) krävs EXTREMT tydliga
  // composition-instruktioner — MiniMax tender att defaulta till "intimate
  // close-up" även när vi säger wide shot. Vi använder foto-referenser
  // och upprepade fraser för att tvinga rätt komposition.
  const isWideShot = zoom.id === 'EST' || zoom.id === 'AER' || zoom.id === 'XW' || zoom.id === 'WIDE';

  const basePrompt = `Du skriver BFL/MiniMax-bildprompter för evenemangsbilder (Stockholm).
Kategori: ${category}
Kluster: ${tag}
Zoomnivå: ${zoom.id} — ${zoom.name} (${zoom.focal}, ${zoom.frame})

Skriv EN kort bildprompt (max 40 ord) som visuellt representerar "${tag}" inom "${category}" med följande krav:
- Komposition enligt zoomnivån (${zoom.frame})
- Position/rörelse: ${pose}
- Ljus: ${light}
- Sättet ska kännas Stockholm-redaktionellt, varmt men inte för polerat
- Inga ansikten i förgrunden
- Ingen läsbar text, inga skyltar, inga logotyper, inga baner, inga affischer i bilden.
  Skriv uttryckligen ut de orden "no text, no signage, no logos, no banners" i den engelska prompten.
  (BUG-FIX 2026-10-28: tidigare rad ("Inga ansikten i förgrunden, inga läsbar text i bilden")
  översattes av M3 till "no foreground faces, readable text or logos" — negationen tappades
  och MiniMax ritade nonsenstext på bannrar. 4 av 60 bilder föll på detta i mätning 2026-10-28.)
- Inga varumärken
- Avsluta med en mood-setting mening ("..., Editorial style, ${light} tones")

Svara BARA med prompttexten. Inget annat.`;

  if (zoom.id === 'EST') {
    return basePrompt + `

VIKTIGT FÖR ESTABLISHING SHOT:
- Bred exteriör vy, byggnaden/lokalen synlig i sin helhet framför Stockholms skyline
- Små människor (eller inga) i förgrunden — fokus är ARKITEKTUR + PLATS
- INGA close-ups av ansikten eller instrument
- Ingen skylt ovanför en dörr, ingen text på fasaden, ingen etikett på fönster —
  fasaden ska vara helt ren och utan märkningar. (BUG-FIX 2026-10-28: MiniMax
  sätter en skylt över varje entré "because a venue entrance needs a sign" —
  mätt 2026-10-28: prompten hade redan "no signage" men bilden fick ändå
  nonsenstexten "ΛƎᗡИHƆƎИΛ ɄƧ ᒪIT" över dörren.)
- Tänk "architectural photography" — Consertgebouw, Sydney Opera House, Berwaldhallen
- Solen ska vara synlig eller antydd (gul timme eller mulet dagsljus)
- Exempel: "Berwaldhallen exterior at golden hour, snow-dusted entrance steps, Stockholm skyline behind, no people in foreground, Editorial style, cool daylight tones"`;
  }

  if (zoom.id === 'AER') {
    return basePrompt + `

VIKTIGT FÖR AERIAL / TOP-DOWN:
- Vy rakt ovanifrån, "bird's eye" eller "drone shot"
- Publik/Scen sedd uppifrån — rader, cirklar, geometriska mönster synliga
- INGA close-ups, INGA ansikten
- Tänk "Google Maps satellite" eller "crowd from balcony"
- Ljus kommer uppifrån, jämn belysning
- Exempel: "Top-down view of concert audience from balcony, geometric pattern of seats and heads, stage visible below with warm spotlights, Editorial style, mixed tones"`;
  }

  if (isWideShot) {
    return basePrompt + `

VIKTIGT FÖR WIDE SHOT:
- Hela scenen/lokalen synlig, INTE close-up
- Avstånd till motiv är STORT (10-30 meter)
- Ingen close-up av händer/ansikten — fokus är SCENKÄNSLA
- Publik eller åskådare synliga i bakgrunden`;
  }

  return basePrompt;
}

function mockZoomPrompt(category: string, tag: string, z: ZoomLevel, pose: Pose, light: Light): string {
  return `${z.name} (${z.focal}) of a Stockholm ${category} scene representing ${tag}, ${pose} pose, ${light} lighting, ${z.frame}. Editorial style, ${light} mood. ${SAFETY_SUFFIX}`;
}

function getApiKey(): string | null {
  return process.env.MINIMAX_API_KEY || null;
}

async function callM3(category: string, tag: string, z: ZoomLevel, pose: Pose, light: Light): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('no MINIMAX_API_KEY');
  const res = await fetch(M3_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: M3_MODEL,
      messages: [{ role: 'user', content: buildPromptTemplate(category, tag, z, pose, light) }],
      temperature: 0.7,
      // BUG-FIX 2026-10-28: 1500 var för lågt. MiniMax-M3 kör extended thinking
      // i samma content-fält, så tankeblocket åter budgeten och svaret blev
      // "tomt efter think-strip" → tyst mock-fallback med generiska prompts.
      // 4000 räcker för tanke + svar (mätt: reasoning_tokens 136, svar 198).
      max_tokens: 4000,
    }),
    // BUG-FIX 2026-10-28: utan timeout hängde en M3-request och låste hela
    // workern (processen stod i uv__io_poll med 0% CPU). 60s per anrop.
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`M3 HTTP ${res.status}`);
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  let content = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!content) throw new Error('M3 tomt svar');
  // M3 med extended thinking returnerar <think>...</think> följt av faktiskt svar.
  // Strippa allt från första <think> till och med första matchande </think>.
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Om flera tankeblock finns, ta sista kvarvarande stycket (ofta svaret).
  // Om svaret är på flera rader, ta sista icke-tomma raden om det ser ut som en prompt.
  if (content.length === 0) throw new Error('M3 tomt efter think-strip');
  // Hård cap till 1200 tecken för att inte spränga MiniMax image-01:s 1500-char gräns
  // (utrymme för safety-suffixen).
  if (content.length > 1200) content = content.slice(0, 1200);
  const hasSafety = /child.safe|safe.*imagery|no weapons/i.test(content);
  return hasSafety ? content : `${content} ${SAFETY_SUFFIX}`;
}

// === CACHE-LAGRING ========================================================
export interface ZoomPromptCache {
  category: string;
  generated_at: string;
  model: string;
  items: BuiltZoomPrompt[];
}

export function cachePath(category: string, rootDir: string): string {
  return join(rootDir, 'tmp_image_corpus', `${category}_zoom_prompts.json`);
}

function readCache(category: string, rootDir: string): ZoomPromptCache | null {
  const p = cachePath(category, rootDir);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')) as ZoomPromptCache; }
  catch { return null; }
}

function writeCache(category: string, rootDir: string, items: BuiltZoomPrompt[]): ZoomPromptCache {
  // BUG-FIX 2026-10-28: skriv inte över. Varje anrop till buildZoomPrompts har
  // en egen zoomFilter, så en "skriv bara den här körningens items"-semantik
  // raderade cache-raderna för de övriga shot-nivåerna (community gick 26 → 21
  // items) och tvingade om M3-anrop för redan betalda prompts.
  // Nu slås befintliga items ihop med de nya (nyckel: tag::zoom::pose::light).
  const existing = readCache(category, rootDir);
  const key = (it: BuiltZoomPrompt) => `${it.cluster_tag}::${it.zoomId}::${it.pose}::${it.light}`;
  const merged = new Map<string, BuiltZoomPrompt>();
  for (const it of existing?.items ?? []) merged.set(key(it), it);
  for (const it of items) merged.set(key(it), it);
  const cache: ZoomPromptCache = {
    category,
    generated_at: new Date().toISOString(),
    model: M3_MODEL,
    items: [...merged.values()],
  };
  const p = cachePath(category, rootDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cache, null, 2));
  return cache;
}

// === HUVUDFUNKTION ========================================================
export interface ZoomBuildInput {
  category: string;
  tagFrequency: Record<string, number>;
  /** Hur många prompts som ska returneras totalt. Viktas mot tagFrequency. */
  count: number;
  /** Filter för att bara använda specifika zoom-IDn (default: alla 10). */
  zoomFilter?: ZoomLevel['id'][];
  /** Filter för specifika poses (default: alla 3). */
  poseFilter?: Pose[];
  /** Filter för specifika ljus (default: alla 3). */
  lightFilter?: Light[];
  /** Root-katalog för cache (default: cwd). */
  rootDir?: string;
  /** Concurrency för M3-anrop. */
  maxConcurrency?: number;
}

/**
 * Bygger count unika prompts med zoom-variation. Viktar mot tagFrequency
 * (samma princip som cluster-prompter.ts). Återanvänder cache när möjligt.
 *
 * Returnerar prompts i [category, cluster_tag, zoomId, pose, light]-ordning,
 * varje prompt en distinkt kombination.
 */
export async function buildZoomPrompts(input: ZoomBuildInput): Promise<BuiltZoomPrompt[]> {
  const rootDir = input.rootDir ?? process.cwd();
  const useMock = !getApiKey() || process.env.MOCK_PROMPTS === '1';
  const zoomPool = input.zoomFilter && input.zoomFilter.length > 0
    ? ZOOM_LEVELS.filter((z) => input.zoomFilter!.includes(z.id))
    : ZOOM_LEVELS;
  const posePool = input.poseFilter && input.poseFilter.length > 0 ? input.poseFilter : [...POSES];
  const lightPool = input.lightFilter && input.lightFilter.length > 0 ? input.lightFilter : [...LIGHTS];

  // Bygg pool av (tag, combo) par. tag viktat mot tagFrequency.
  // Round-robin per zoom: varje zoom-nivå får count/zoomCount slots (jämnt),
  // med varierad pose/light inom varje zoom. För count=20 och 10 zoom = 2/zoom.
  const tags = Object.keys(input.tagFrequency);
  if (tags.length === 0) return [];

  // Viktad fördelning: hur många "slots" per tag?
  // Använder samma proportionella princip som cluster-prompter.ts distributePrompts.
  const slotByTag = distributeSlots(tags, input.tagFrequency, input.count);

  // Bygg round-robin-listan EN gång — men ROTERA start-position baserat på
  // (category + tag) så att olika tags/categories får olika start-kombinationer.
  // Detta undviker att ALLA tags alltid missar samma första kombination.
  const fullSeq = buildRoundRobin(90, [...posePool], [...lightPool], zoomPool);
  // Offset = hash av category + tag (deterministiskt)
  const tagOffset = (tag: string): number => {
    let h = 0;
    const s = `${input.category}|${tag}`;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 90;
  };
  // Slumpa startposition per (category, tag) så körning 2 INTE får samma 5 som körning 1
  // när state var fullt för de första.
  const seedRand = (input.category.length * 7 + (input.tagFrequency[Object.keys(input.tagFrequency)[0]] ?? 0)) % 90;
  const rrByTag = new Map<string, Array<{ combo: Combo; z: ZoomLevel; intraIdx: number }>>();
  for (const tag of Object.keys(input.tagFrequency)) {
    const off = (tagOffset(tag) + seedRand) % 90;
    const sliced: typeof fullSeq = [];
    for (let i = 0; i < input.count; i++) {
      sliced.push(fullSeq[(off + i) % 90]);
    }
    rrByTag.set(tag, sliced);
  }

  // Bygg combo-lista per tag (varierar cykliskt genom round-robin-sekvensen)
  const cache = readCache(input.category, rootDir);
  const cacheKey = (tag: string, zid: string, pose: Pose, light: Light) =>
    `${tag}::${zid}::${pose}::${light}`;
  const cached = new Map<string, BuiltZoomPrompt>();
  if (cache) {
    for (const it of cache.items) {
      cached.set(cacheKey(it.cluster_tag, it.zoomId, it.pose, it.light), it);
    }
  }

  // Generera alla (tag, combo)-par som ska produceras
  const wanted: Array<{ tag: string; combo: Combo; z: ZoomLevel }> = [];
  for (const { tag, slots } of slotByTag) {
    const seq = rrByTag.get(tag) ?? fullSeq;
    for (let i = 0; i < slots; i++) {
      const slot = seq[i % seq.length];
      wanted.push({ tag, combo: slot.combo, z: slot.z });
    }
  }

  // Hämta från cache eller anropa M3
  const concurrency = input.maxConcurrency ?? 7;
  const out: BuiltZoomPrompt[] = [];
  let cursor = 0;
  const useMockFlag = useMock;

  async function worker(): Promise<void> {
    while (cursor < wanted.length) {
      const idx = cursor++;
      const { tag, combo, z } = wanted[idx];
      const key = cacheKey(tag, z.id, combo.pose, combo.light);
      const hit = cached.get(key);
      if (hit) {
        out.push(hit);
        continue;
      }
      try {
        const prompt = useMockFlag
          ? mockZoomPrompt(input.category, tag, z, combo.pose, combo.light)
          : await callM3(input.category, tag, z, combo.pose, combo.light);
        out.push({
          category: input.category,
          cluster_tag: tag,
          zoomId: z.id,
          zoomName: z.name,
          focal: z.focal,
          pose: combo.pose,
          light: combo.light,
          prompt,
          model: useMockFlag ? 'mock' : M3_MODEL,
          cached: false,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'okänt';
        console.warn(`[zoom-prompter] ${tag}/${z.id}/${combo.pose}/${combo.light}: ${msg} → mock fallback`);
        const prompt = mockZoomPrompt(input.category, tag, z, combo.pose, combo.light);
        out.push({
          category: input.category,
          cluster_tag: tag,
          zoomId: z.id,
          zoomName: z.name,
          focal: z.focal,
          pose: combo.pose,
          light: combo.light,
          prompt,
          model: 'mock-fallback',
          cached: false,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  // Uppdatera cache
  writeCache(input.category, rootDir, out);
  return out;
}

function expandCombos(poses: Pose[], lights: Light[], zooms: ZoomLevel[]): Combo[] {
  const out: Combo[] = [];
  for (const z of zooms) for (const p of poses) for (const l of lights) {
    out.push({ zoomId: z.id, pose: p, light: l });
  }
  return out;
}

function distributeSlots(
  tags: string[],
  tagFrequency: Record<string, number>,
  totalSlots: number,
): Array<{ tag: string; slots: number }> {
  const totalWeight = tags.reduce((s, t) => s + (tagFrequency[t] ?? 0), 0);
  if (totalWeight === 0 || totalSlots === 0) return [];
  const raw = tags.map((tag) => ({
    tag,
    weight: tagFrequency[tag] ?? 0,
    exact: (totalSlots * (tagFrequency[tag] ?? 0)) / totalWeight,
  }));
  // Largest remainder
  const floor = raw.map((r) => ({ tag: r.tag, slots: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let used = floor.reduce((s, r) => s + r.slots, 0);
  const need = totalSlots - used;
  floor.sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < need && i < floor.length; i++) floor[i].slots++;
  return floor.filter((r) => r.slots > 0).map(({ tag, slots }) => ({ tag, slots }));
}