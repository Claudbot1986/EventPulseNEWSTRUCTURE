/**
 * autoGenServer.js — Server-side BFL image generation for EventPulse.
 *
 * Håller BFL_API_KEY och SUPABASE_SERVICE_ROLE_KEY server-side
 * (klienten ska INTE ha tillgång till dessa).
 *
 * Endpoints:
 *   GET  /health                    → { ok: true }
 *   POST /generate-image-for-event  → generates ONE image for a given event,
 *                                     uploads to Supabase Storage,
 *                                     updates events.image_url.
 *                                     Body: { event: { id, title_sv, venue_name,
 *                                      category_slug, ... } }
 *                                     Returns: { ok, imageUrl, prompt, error? }
 *
 * Run:  node asterisk/autoGenServer.js
 * Port: 7790 (avoids 7777 supervisor, 7778 analytics, 8788 mobile, 8081 metro)
 */

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

// ── Load root .env (server-side) ────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = resolve(__dirname, '../../.env');

try {
  const envText = readFileSync(ENV_PATH, 'utf8');
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch (err) {
  console.warn('[autoGen] could not load .env from', ENV_PATH, err.message);
}

// AI-bilder lagras ALLTID i `ai-generated/` under event-posters-bucketen.
// Mappnamnet är medvetet valt — det gör att storage-listan själv visar att
// alla filer är AI-genererade (och EU AI Act Art. 50-stämplade). Inga
// originalbilder får ligga här. Inga blandmappar.
export const AI_IMAGE_FOLDER = 'ai-generated';
export const AI_IMAGE_LICENSE = 'ai-generated';
export const AI_IMAGE_ATTRIBUTION = 'AI-generated image (EU AI Act Art. 50)';

const PORT = Number(process.env.AUTOGEN_PORT || 7790);
const BFL_API_KEY = process.env.BFL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.AUTOGEN_BUCKET || 'event-posters';

if (!BFL_API_KEY) {
  console.error('[autoGen] FATAL: BFL_API_KEY missing in .env');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[autoGen] FATAL: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const BFL_BASE = 'https://api.bfl.ai/v1';
const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = 90_000;

// ── Anonymisering + stil (samma policy som klient-sidan prompts.js) ────────
// Delad logik mellan klient och server — vi duplicerar hellre än att dra
// in klient-prompt-build i Node-kontext (den är React-Native-specifik).

const VENUE_GENERICIZERS = [
  { match: /konserthuset/i, replace: 'a Stockholm concert hall' },
  { match: /stockholm concert/i, replace: 'a Stockholm concert hall' },
  { match: /debaser/i, replace: 'a Stockholm music club' },
  { match: /strindbergs?/i, replace: 'a Stockholm intimate theater' },
  { match: /stampen/i, replace: 'a Stockholm jazz club' },
  { match: /kulturhuset(?:stadsteatern)?/i, replace: 'a Stockholm cultural center' },
  { match: /malmö?\s*live|malmolive/i, replace: 'a Malmö concert venue' },
  { match: /scandinavium/i, replace: 'a Gothenburg arena' },
  { match: /tele2|globen|avicii arena/i, replace: 'a Stockholm arena' },
  { match: /junibacken/i, replace: "a Stockholm children's museum" },
  { match: /dramaten|kungliga dramatiska/i, replace: 'a Stockholm dramatic theater' },
  { match: /cirkus|cirkus(?:teatern)?/i, replace: 'a Stockholm variety theater' },
];

function anonymizeVenue(name) {
  if (!name || typeof name !== 'string') return 'a Stockholm event venue';
  for (const { match, replace } of VENUE_GENERICIZERS) {
    if (match.test(name)) return replace;
  }
  return 'a Stockholm event venue';
}

/**
 * Resolve venue name from an event row.
 * Schema: events.venue_id (UUID) → venues.name
 * Falls back to `venue_name` if present (legacy schema).
 */
function getVenueName(event) {
  return event?.venues?.name || event?.venue_name || event?.venue || null;
}

/**
 * CATEGORY_SCENES — visuella scen-beskrivningar per kategori.
 *
 * Detta är INTE anonymisering — det är TVÄRTOM, en KONKRET visuell scen som
 * BFL Flux kan rendera direkt. Användaren bad 2026-08-24 om att "huvudfokuset
 * på eventet ska porträtteras": Örgryte → fotboll, Moderna Museet → konst.
 *
 * Inkluderar både standard-slugs (sports, exhibition, music) OCH
 * produktionsdata-slugs (community, art-exhibitions, culture) som finns i
 * `events.category_slug` idag (verifierat via Supabase REST 2026-08-24).
 */
const CATEGORY_SCENES = {
  // ── Sports
  sports:  'a football match in a stadium with players in action on green grass under dramatic sky',
  idrott:  'a football match in a stadium with players in action on green grass under dramatic sky',
  fotboll: 'a football match in a stadium with players in action on green grass under dramatic sky',
  // ── Art / exhibition
  exhibition:        'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  'art-exhibitions': 'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  konst:             'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  utställning:       'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  galleri:           'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  art:               'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  arts:              'a bright art gallery interior with paintings and sculptures on white walls under soft skylight',
  // ── Music / concert
  music:    'a concert stage with musicians performing under dramatic stage lights, instruments visible, audience in silhouette',
  konsert:  'a concert stage with musicians performing under dramatic stage lights, instruments visible, audience in silhouette',
  // ── Theater
  theater:  'a theater stage with dramatic lighting, performers mid-scene, ornate curtain in background',
  teater:   'a theater stage with dramatic lighting, performers mid-scene, ornate curtain in background',
  föreställning: 'a theater stage with dramatic lighting, performers mid-scene, ornate curtain in background',
  // ── Family
  family: 'a bright family-friendly indoor scene, colorful workshop with creative materials, warm atmosphere',
  barn:   'a bright family-friendly indoor scene, colorful workshop with creative materials, warm atmosphere',
  kids:   'a bright family-friendly indoor scene, colorful workshop with creative materials, warm atmosphere',
  // ── Nightlife
  nightlife: 'a nightclub interior with colored stage lights, DJ booth, dance floor with movement, energetic atmosphere',
  nattliv:   'a nightclub interior with colored stage lights, DJ booth, dance floor with movement, energetic atmosphere',
  club:      'a nightclub interior with colored stage lights, DJ booth, dance floor with movement, energetic atmosphere',
  // ── Food
  food: 'a restaurant setting with plated dishes on a wooden table, warm ambient lighting, dining atmosphere',
  mat:  'a restaurant setting with plated dishes on a wooden table, warm ambient lighting, dining atmosphere',
  // ── Festival
  festival: 'an outdoor summer festival with stage and crowd, colorful flags and tents, sunny sky',
  // ── Produktionsdata-fallbacks (verifierat från Supabase 2026-08-24)
  // community kunde INTE vara "outdoor gathering in city square" — tre av tio
  // bilder blev då "människor utomhus bland byggnader" oavsett eventets
  // verkliga innehåll. Bytt till abstraherad inomhus-komposition 2026-08-25.
  community: 'an abstract editorial composition with soft atmospheric lighting, no specific setting, no people',
  culture:   'a cultural venue interior with artistic atmosphere, soft museum-style lighting',
  // ── Default
  default: 'an abstract editorial composition with soft atmospheric lighting, no specific setting, no people',
};

// ── Venue-specifika scener (PRIORITY över category_slug) ────────────────────
// Användaren bad 2026-08-25 om att "huvudfokus ska styra bilden":
//   - Textilmuseet → textil/textilkonst (INTE generiskt museum)
//   - Nationalmuseum → museum + design-fokus (utställning "Design for Life")
//   - Moderna Museet → modernistiskt konstmuseum
//   - Liljevalchs → samtidskonstgalleri
//   - Cecilia Hillström Gallery → litet galleri
// Dessa matchas mot venue_name.lowercase() och vinner över category.
const VENUE_SCENES = [
  { match: /textil/i, scene: 'a textile museum interior with woven fabrics, threads, looms, fabric swatches and textile art on display, soft warm lighting' },
  { match: /nationalmuseum/i, scene: 'a national museum interior with curated design objects, mid-century furniture, sketches, design process materials and craft pieces, elegant gallery lighting' },
  { match: /moderna museet/i, scene: 'a modernist art museum interior with bold contemporary paintings and sculptures, dramatic skylights, clean white walls' },
  { match: /liljevalchs/i, scene: 'a contemporary art gallery interior with large-scale paintings, vivid colors, modern exhibition lighting' },
  { match: /cecilia hillstr/i, scene: 'a small intimate art gallery interior with carefully arranged paintings on neutral walls, focused spotlights' },
  { match: /ois\b|\u00f6is\b|\u00f6rgryte/i, scene: 'a football match scene on a green grass pitch, players in action, dramatic stadium atmosphere' },
];

function getVenueScene(venueName) {
  if (!venueName || typeof venueName !== 'string') return null;
  const v = venueName.toLowerCase();
  for (const { match, scene } of VENUE_SCENES) {
    if (match.test(v)) return scene;
  }
  return null;
}

/**
 * Venue-aware hint: ger kort kontextuell fras baserat på venue-namn.
 * INTE anonymisering (vi vill INTE dölja att Moderna Museet är ett konstmuseum).
 * Användaren vill att "huvudfokuset" ska styra bilden, och venue-namnet är en
 * stark ledtråd om vad slags evenemang det är.
 */
function getVenueHint(venueName) {
  if (!venueName || typeof venueName !== 'string') return '';
  const v = venueName.toLowerCase();
  if (/museet|gallery|galleri/.test(v))          return 'At a Stockholm art museum. ';
  if (/arena|stadium/.test(v))                    return 'At a sports arena. ';
  if (/stadion/.test(v))                          return 'At a stadium. ';
  if (/konserthus|concert hall/.test(v))          return 'At a concert hall. ';
  if (/teatern|dramaten|opera/.test(v))           return 'At a theater. ';
  if (/arena|stadion|stadium/.test(v))            return 'At a sports venue. ';
  return '';
}

/**
 * Fallback för kategori när category_slug är generisk ("community", "culture")
 * eller null: sök i titeln efter svenska/engelska nyckelord.
 * Användaren bad 2026-08-24 om "huvudgrejen i eventet" — titeln kan ge det
 * även om kategorin är fel/avsaknad.
 */
function extractCategoryFallback(title) {
  if (!title || typeof title !== 'string') return null;
  const t = title.toLowerCase();
  // Word-boundaries för att undvika falska positiva (t.ex. "desinformation"
  // innehåller "mat" → felaktig food-matchning utan \b).
  if (/\b(idrott|fotboll|sport|match)\b/.test(t))                          return 'sports';
  if (/\b(utställning|utstallning|konst|galleri|museum|exhibition|surrealism|design)\b/.test(t)) return 'exhibition';
  if (/\b(konsert|concert|musik|music)\b/.test(t))                         return 'music';
  if (/\b(teater|theater|föreställning|forestallning|pjäs|pjas)\b/.test(t)) return 'theater';
  if (/\b(barn|family|kids)\b/.test(t))                                    return 'family';
  if (/\b(nattliv|night|club)\b/.test(t))                                  return 'nightlife';
  if (/\b(mat|food|restaurang)\b/.test(t))                                 return 'food';
  if (/\bfestival\b/.test(t))                                              return 'festival';
  return null;
}

/**
 * Bygger auto-prompt kategori-driven istället för titel-driven.
 *
 * Användaren klagade 2026-08-24 på att:
 *   - Örgryte (fotbollsklubb) → kvinna i folkdräkt
 *   - Moderna Museet (konstutställning) → grotta med vattenfall
 * Orsak: gamla versionen tog titeln bokstavligt ("literally depicts the title")
 * och Flux hittade på symboliska tolkningar.
 *
 * NY STRATEGI (verifierat via REST 2026-08-24):
 *   1. category_slug → konkret visuell scen (PRIMÄR driver)
 *   2. venue_name → kort kontextuell hint ("At a Stockholm art museum")
 *   3. title_sv → kort hint (max 60 chars), INTE bokstavlig avbildning
 *   4. description_sv (om finns) → stödkontext
 *   5. Om category_slug är generisk (community/culture) eller null →
 *      sök kategori-nyckelord i titeln (extractCategoryFallback)
 */
function buildAutoPrompt(event) {
  const title = (event?.title_sv || event?.title || '').trim();
  const titleShort = title.slice(0, 60);

  const venueName = event?.venues?.name || event?.venue_name || '';
  const venueHint = getVenueHint(venueName);

  // 1. Venue-specifik scene vinner över category_slug (PRIORITY)
  //    Textilmuseet → textil, Nationalmuseum → design, etc.
  let scene = getVenueScene(venueName);

  // 2. Annars: category_slug
  if (!scene) {
    let category = (event?.category_slug || '').toLowerCase();
    // Fallback: om generisk/saknas, sök i titeln
    if (!category || GENERIC_CATEGORIES.has(category)) {
      const titleFallback = extractCategoryFallback(title);
      if (titleFallback) category = titleFallback;
    }
    scene = CATEGORY_SCENES[category] || CATEGORY_SCENES.default;
  }

  return (
    `${venueHint}Editorial photograph of ${scene}. ` +
    `Photographic style, vivid natural colors, soft natural lighting, cinematic depth of field. ` +
    `Mobile event thumbnail, square aspect. ` +
    `CRITICAL NEGATIVE PROMPT — ZERO TEXT ABSOLUTE: absolutely no readable text of any kind. ` +
    `No words, no letters, no numbers, no calligraphy, no typography, no signs, no banners, no labels, no logos, no watermarks, no UI text. ` +
    `No posters, no billboards, no flyers, no book covers, no t-shirt text, no newspaper print, no magazine covers. ` +
    `Even partial fragments of letters, half-formed words, or stylized text marks are forbidden. ` +
    `No recognizable brand names, no trademarks, no logos, no symbols. ` +
    `No recognizable architecture or identifiable landmarks (no Stockholm City Hall, no Globen, no specific buildings). ` +
    `NEVER show people outdoors among buildings, plazas, or city streets — this is a recurring problem. ` +
    `Prefer indoor, abstract, or close-up subject-focused compositions. ` +
    `If people appear they must be small in frame, full-body, in action, or in silhouette — never close-up portraits of faces. ` +
    `Clean, text-free, logo-free, abstract editorial photograph only. `
  );
}

const GENERIC_CATEGORIES = new Set(['community', 'culture', 'event', 'default', '']);

// ── EU AI Act §50 compliance ─────────────────────────────────────────────────
// Synlig stämpel + maskinläsbar XMP-metadata. Båda krävs formellt; vi gör
// båda för att täcka "synlig märkning" OCH "machine-readable format".
//
// Stämpeln: 240×64 px "● AI-generated"-pill i nedre höger hörn. Storleken
// (~15 % av en 1024-bild) gör den "easily visible" enligt EU AI Act Art. 50.
// Bottenplatta: 82% opacitet svart med orange kantlinje (matchar
// EventPulse-färgschema: accent #FFB454). Synlig men inte i vägen för motivet.

const AI_STAMP_SVG = `<svg width="240" height="64" viewBox="0 0 240 64" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="236" height="60" rx="30" ry="30"
        fill="rgba(15,15,18,0.82)"
        stroke="rgba(255,180,84,0.65)" stroke-width="1.5"/>
  <circle cx="34" cy="32" r="8" fill="#FFB454"/>
  <text x="56" y="40" font-family="Arial, sans-serif" font-size="22"
        font-weight="bold" fill="#FFFFFF" letter-spacing="0.5">AI-generated</text>
</svg>`;

const AI_STAMP_BUFFER = Buffer.from(AI_STAMP_SVG);

/**
 * Bygger XMP-paket med AI-generering-markering. Maskinläsbar — alla
 * vanliga metadata-läsare (exiftool, Photoshop, Adobe Bridge) ser fälten.
 *
 * Fält:
 *   dc:rights        → "AI-generated image (EU AI Act Art. 50)"
 *   dc:creator       → "EventPulse/flux-dev"
 *   xmp:CreatorTool  → "EventPulse/autoGenServer"
 *   xmp:CreateDate   → ISO nu
 *   EventPulse:AIGenerated   → "true"
 *   EventPulse:Model         → "flux-dev"
 *   EventPulse:Policy        → "EU-AI-Act-Art-50"
 *   EventPulse:GeneratedAt   → ISO nu
 */
function buildAiXmp({ model, prompt }) {
  const now = new Date().toISOString();
  const safePrompt = (prompt || '').replace(/[<&>]/g, '').slice(0, 500);
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="EventPulse/1.0">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"
                     xmlns:xmp="http://ns.adobe.com/xap/1.0/"
                     xmlns:EventPulse="eventpulse:meta/1.0/"
                     xmp:CreatorTool="EventPulse/autoGenServer"
                     xmp:CreateDate="${now}"
                     xmp:MetadataDate="${now}">
      <dc:rights>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">AI-generated image (EU AI Act Art. 50)</rdf:li>
        </rdf:Alt>
      </dc:rights>
      <dc:creator>
        <rdf:Seq>
          <rdf:li>EventPulse/${model}</rdf:li>
        </rdf:Seq>
      </dc:creator>
      <EventPulse:AIGenerated>true</EventPulse:AIGenerated>
      <EventPulse:Model>${model}</EventPulse:Model>
      <EventPulse:Policy>EU-AI-Act-Art-50</EventPulse:Policy>
      <EventPulse:GeneratedAt>${now}</EventPulse:GeneratedAt>
      <EventPulse:Prompt>${safePrompt}</EventPulse:Prompt>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Applicerar EU AI Act §50-compliance på en bildbuffer:
 *   1. Synlig AI-stämpel i nedre höger hörn (24px inset)
 *   2. XMP-metadata-injection (maskinläsbar)
 *
 * Returnerar NY PNG-buffer. Original-rörs inte.
 *
 * Ren lokal compute, ~10-50ms per bild, ingen API-kostnad.
 */
async function applyAiCompliance(buffer, { prompt, model = 'flux-dev' } = {}) {
  const xmp = buildAiXmp({ model, prompt });
  // Stämpelposition: 24 px inset från SE-kanten (1024×1024). Använd
  // explicit left/top istället för gravity — Sharp's gravity+offset-
  // semantik placerar input UTANFÖR bilden när inset>0 (offset
  // adderas till gravity-ankaret som redan ÄR kanten).
  const W = 1024;
  const H = 1024;
  const inset = 24;
  const stampW = 240;
  const stampH = 64;
  const left = W - inset - stampW;
  const top = H - inset - stampH;
  return sharp(buffer)
    .composite([
      {
        input: AI_STAMP_BUFFER,
        left,
        top,
      },
    ])
    .withMetadata({
      exif: {},
      xmp,
    })
    .png()
    .toBuffer();
}

/**
 * Dedup-nyckel: samma event-koncept (titel + venue) får samma bild.
 * Normaliserar: trim, lower-case, kollapsa whitespace.
 * Används för att återkommande events (t.ex. samma konsert på olika datum)
 * delar bild.
 */
function dedupKey(event) {
  const t = (event?.title_sv || event?.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const v = (getVenueName(event) || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${t}::${v}`;
}

/**
 * Storage-path baserad på dedupKey — samma koncept = samma fil.
 * Tar bort otillåtna tecken för Supabase Storage path.
 */
function dedupPath(key) {
  // key = "konsert::konserthuset" → "konsert-konserthuset"
  return key.replace(/::/g, '-').replace(/[^a-z0-9\-]/g, '').slice(0, 200);
}

// ── BFL Flux schnell ───────────────────────────────────────────────────────

/**
 * Custom error som signalerar "no credits" från BFL.
 * Användaren bad 2026-08-25 om att UI ska visa "no credits BFL - recharge"
 * när BFL-kredit är slut. Detta error kastas av generateFluxSchnell när
 * vi identifierar 402 / 429 med kredit-relaterad text i svaret.
 *
 * Workern mappar detta error → image_generation_status='no_credits' (workern
 * pausar alla pending-jobb tills manuell re-charge).
 */
export class BFLNoCreditsError extends Error {
  constructor(message, status, bodyText) {
    super(message);
    this.name = 'BFLNoCreditsError';
    this.status = status;
    this.bodyText = bodyText;
  }
}

/**
 * Klassificerar ett BFL-fel som credit-relaterat eller ej.
 * BFL returnerar 402 Payment Required eller 429 med text som nämner
 * "credit", "balance", "quota", "billing", "payment".
 */
function isBflCreditError(status, bodyText) {
  if (status === 402) return true;
  const t = (bodyText || '').toLowerCase();
  return /credit|balance|quota|billing|payment|insufficient|exhausted/.test(t);
}

async function generateFluxSchnell(prompt) {
  // 1. Submit — BFL Flux Dev (Flux 1 Dev, bättre på negativa prompts än klein-4b)
  // Användaren bad 2026-08-24 om "INGEN TEXT" och konkret stil — flux-2-klein-4b
  // (4B params) ignorerar "no text"-instruktioner. flux-dev är nästa steg som
  // fortfarande är relativt billigt och faktiskt följer negativen.
  //
  // seed: tidsstämpel per regeneration — ger variation mellan körningar även
  // för samma (titel, venue) dedup-nyckel. Användbart när vi itererar prompten.
  const seed = Date.now() & 0x7fffffff;
  const submitRes = await fetch(`${BFL_BASE}/flux-dev`, {
    method: 'POST',
    headers: {
      'x-key': BFL_API_KEY,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ prompt, width: 1024, height: 1024, steps: 28, seed }),
  });
  if (!submitRes.ok) {
    const errText = await submitRes.text();
    if (isBflCreditError(submitRes.status, errText)) {
      throw new BFLNoCreditsError(
        `BFL no credits: ${submitRes.status} ${errText.slice(0, 200)}`,
        submitRes.status,
        errText,
      );
    }
    throw new Error(`BFL submit ${submitRes.status}: ${errText.slice(0, 200)}`);
  }
  const { id, polling_url } = await submitRes.json();
  if (!polling_url) throw new Error('BFL submit returned no polling_url');

  // 2. Poll
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(polling_url, {
      headers: { 'x-key': BFL_API_KEY, accept: 'application/json' },
    });
    if (!pollRes.ok) {
      const pollErrText = await pollRes.text().catch(() => '');
      if (isBflCreditError(pollRes.status, pollErrText)) {
        throw new BFLNoCreditsError(
          `BFL no credits (poll): ${pollRes.status} ${pollErrText.slice(0, 200)}`,
          pollRes.status,
          pollErrText,
        );
      }
      throw new Error(`BFL poll ${pollRes.status}: ${pollErrText.slice(0, 200)}`);
    }
    const data = await pollRes.json();
    if (data.status === 'Ready') {
      const imgRes = await fetch(data.result.sample);
      if (!imgRes.ok) throw new Error(`BFL image fetch ${imgRes.status}`);
      const arrayBuf = await imgRes.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return {
        b64: btoa(binary),
        mime: 'image/png',
        seed: data.result?.seed ?? null,
        id,
      };
    }
    if (data.status === 'Failed' || data.status === 'Error' || data.status === 'Rejected') {
      const detail = JSON.stringify(data).slice(0, 300);
      if (isBflCreditError(data.status === 'Rejected' ? 402 : 500, detail)) {
        throw new BFLNoCreditsError(
          `BFL no credits: status=${data.status} ${detail}`,
          402,
          detail,
        );
      }
      throw new Error(`BFL generation failed: ${data.status} ${detail}`);
    }
  }
  throw new Error(`BFL timed out after ${TIMEOUT_MS / 1000}s`);
}

// ── Supabase Storage upload + DB update ─────────────────────────────────────

/**
 * Laddar upp base64-bild till Storage och uppdaterar ALLA event-rader
 * i `eventIds` med samma image_url + AI-compliance-metadata. Idempotent (upsert).
 *
 * Path: `events/{storagePath}.png` där storagePath = dedupPath(dedupKey)
 * → samma event-koncept får samma fil, inga dubletter.
 *
 * Pipeline:
 *   1. applyAiCompliance (Sharp: stamp + XMP)
 *   2. Upload till Storage
 *   3. Update events med image_url + 5 image-tracking-kolumner
 */
async function uploadAndPersistAll(eventIds, b64, mime, storagePath, prompt, model = 'flux-dev') {
  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    throw new Error('uploadAndPersistAll: eventIds is empty');
  }
  const originalBuffer = Buffer.from(b64, 'base64');
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  // AI-bilder hamnar ALLTID under ai-generated/ — samma mappnamn som
  // AI_IMAGE_FOLDER-konstanten. Validerat vid runtime att vi inte råkar
  // skriva till events/ (legacy-sökväg).
  const path = `${AI_IMAGE_FOLDER}/${storagePath}.${ext}`;
  if (!path.startsWith(`${AI_IMAGE_FOLDER}/`)) {
    throw new Error(`Refusing to upload to non-AI path: ${path}`);
  }

  // 1. EU AI Act §50 — synlig stämpel + XMP-metadata (lokal Sharp, ~10-50ms)
  const compliantBuffer = await applyAiCompliance(originalBuffer, { prompt, model });

  // 2. Upload to Storage (upsert — idempotent)
  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, compliantBuffer, {
      contentType: mime,
      upsert: true,
      cacheControl: '31536000', // 1 year
    });
  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

  // 3. Get public URL
  const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const imageUrl = pub?.publicUrl;
  if (!imageUrl) throw new Error('No public URL returned for uploaded image');

  // 4. Update ALLA event-rader med image_url + compliance-tracking
  const generatedAt = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('events')
    .update({
      image_url: imageUrl,
      image_license: AI_IMAGE_LICENSE,
      image_attribution: AI_IMAGE_ATTRIBUTION,
      image_ai_generated: true,
      image_prompt: prompt,
      image_model: model,
      image_generated_at: generatedAt,
      image_generation_status: 'completed',
    })
    .in('id', eventIds);
  if (updateErr) throw new Error(`events update failed: ${updateErr.message}`);

  return imageUrl;
}

// ── HTTP server ─────────────────────────────────────────────────────────────

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        req.destroy();
        rejectBody(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      if (!data) return resolveBody({});
      try { resolveBody(JSON.parse(data)); }
      catch (e) { rejectBody(new Error('Invalid JSON body')); }
    });
    req.on('error', rejectBody);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'autoGenServer',
      bucket: STORAGE_BUCKET,
      bflKeyPresent: Boolean(BFL_API_KEY),
    });
  }

  // ── Proxy: return first N published events (asterisk page can't reach
  // Supabase directly because RLS blocks anon SELECT on `events`).
  // Default N=3 (användaren bad om 3 den 2026-08-24).
  if (req.method === 'GET' && url.pathname === '/events-first') {
    const limit = Math.max(1, Math.min(20, Number(url.searchParams.get('limit')) || 10));
    try {
      const { data: rows, error: fetchErr } = await supabase
        .from('events')
        .select('id, title_sv, title_en, start_time, image_url, venues(name)')
        .eq('status', 'published')
        .order('start_time', { ascending: true })
        .limit(limit);
      if (fetchErr) throw new Error(fetchErr.message);
      const events = (rows || []).map((row) => ({
        id: row.id,
        title: row.title_sv || row.title_en || null,
        title_sv: row.title_sv,
        title_en: row.title_en,
        start_time: row.start_time,
        image_url: row.image_url || null,
        venue_name: row.venues?.name || null,
      }));
      return sendJson(res, 200, { ok: true, count: events.length, events });
    } catch (err) {
      console.error('[autoGen] /events-first FAILED:', err.message);
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/generate-image-for-event') {
    let body;
    try { body = await readJsonBody(req); }
    catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }

    const event = body?.event;
    if (!event || !event.id) {
      return sendJson(res, 400, { ok: false, error: 'body.event.id is required' });
    }

    const prompt = buildAutoPrompt(event);
    console.log(`[autoGen] event=${event.id} title=${event.title_sv || event.title || '?'}`);
    console.log(`[autoGen] prompt=${prompt.slice(0, 120)}...`);

    try {
      const { b64, mime, seed } = await generateFluxSchnell(prompt);
      const key = dedupKey(event);
      const storagePath = dedupPath(key);
      const imageUrl = await uploadAndPersistAll([event.id], b64, mime, storagePath, prompt);
      console.log(`[autoGen] event=${event.id} done url=${imageUrl}`);
      return sendJson(res, 200, {
        ok: true,
        eventId: event.id,
        imageUrl,
        prompt,
        seed,
      });
    } catch (err) {
      console.error(`[autoGen] event=${event.id} FAILED:`, err.message);
      return sendJson(res, 500, {
        ok: false,
        eventId: event.id,
        error: err.message,
        prompt,
      });
    }
  }

  // ── Batch-endpoint: hämta första N events, dedup-gruppera, generera per grupp ──
  if (req.method === 'POST' && url.pathname === '/generate-for-first') {
    const limit = Math.max(1, Math.min(20, Number(url.searchParams.get('limit')) || 10));
    console.log(`[autoGen] /generate-for-first?limit=${limit} start`);
    try {
      // 1. Hämta första N events från Supabase
      // Schema: events.venue_id (UUID) → venues.name. Använd relationell select.
      const { data: rows, error: fetchErr } = await supabase
        .from('events')
        .select('id, title_sv, title_en, description_sv, description_en, category_slug, venues(name)')
        .eq('status', 'published')
        .order('start_time', { ascending: true })
        .limit(limit);
      if (fetchErr) throw new Error(`Supabase fetch failed: ${fetchErr.message}`);
      if (!rows || rows.length === 0) {
        return sendJson(res, 200, { ok: true, totalFetched: 0, groups: [] });
      }
      console.log(`[autoGen] fetched ${rows.length} events`);

      // 2. Normalisera fält + dedup-gruppera
      const groupsMap = new Map(); // key → { ids: [], representative: row }
      for (const row of rows) {
        const event = {
          id: row.id,
          title_sv: row.title_sv,
          title_en: row.title_en,
          description_sv: row.description_sv,
          description_en: row.description_en,
          venues: row.venues,
          category_slug: row.category_slug,
        };
        const key = dedupKey(event);
        if (!groupsMap.has(key)) {
          groupsMap.set(key, { key, ids: [], representative: event });
        }
        groupsMap.get(key).ids.push(row.id);
      }
      const groups = Array.from(groupsMap.values());
      console.log(`[autoGen] dedup → ${groups.length} unika grupper (av ${rows.length} events)`);

      // 3. Generera EN bild per grupp
      const results = [];
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const ev = g.representative;
        console.log(`[autoGen] [${i + 1}/${groups.length}] group key="${g.key}" (${g.ids.length} event(s))`);
        try {
          const prompt = buildAutoPrompt(ev);
          console.log(`[autoGen]   prompt=${prompt.slice(0, 120)}...`);
          const { b64, mime } = await generateFluxSchnell(prompt);
          const storagePath = dedupPath(g.key);
          const imageUrl = await uploadAndPersistAll(g.ids, b64, mime, storagePath, prompt);
          console.log(`[autoGen]   done url=${imageUrl}`);
          results.push({
            ok: true,
            key: g.key,
            eventIds: g.ids,
            title: ev.title_sv || ev.title_en || '?',
            venue: getVenueName(ev),
            imageUrl,
            storagePath,
            prompt,
          });
        } catch (err) {
          console.error(`[autoGen]   group="${g.key}" FAILED:`, err.message);
          results.push({
            ok: false,
            key: g.key,
            eventIds: g.ids,
            title: ev.title_sv || ev.title_en || '?',
            venue: getVenueName(ev),
            error: err.message,
          });
        }
      }

      const okCount = results.filter((r) => r.ok).length;
      const failCount = results.length - okCount;
      console.log(`[autoGen] /generate-for-first done: ${okCount} ok, ${failCount} failed`);

      return sendJson(res, 200, {
        ok: true,
        limit,
        totalFetched: rows.length,
        uniqueGroups: groups.length,
        okCount,
        failCount,
        groups: results,
      });
    } catch (err) {
      console.error('[autoGen] /generate-for-first FAILED:', err.message);
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  // ── Batch-endpoint: ta emot en lista events (från worker / backfill-script) ──
  // Dedup-grupperar efter title_sv+venue_name, genererar EN bild per grupp,
  // uppdaterar ALLA events i gruppen med samma image_url.
  //
  // Body: { events: [{ id, title_sv, title_en, description_sv, description_en,
  //                     venues?: {name}, venue_name?, category_slug? }] }
  // Returns: { ok, results: [{ key, eventIds, imageUrl, storagePath, prompt }],
  //            totalGroups, okCount, failCount }
  if (req.method === 'POST' && url.pathname === '/generate-for-batch') {
    let body;
    try { body = await readJsonBody(req); }
    catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }

    const events = Array.isArray(body?.events) ? body.events : [];
    if (events.length === 0) {
      return sendJson(res, 200, { ok: true, totalGroups: 0, results: [] });
    }
    // Validera obligatoriska fält
    for (const e of events) {
      if (!e?.id) {
        return sendJson(res, 400, { ok: false, error: 'every event needs id' });
      }
    }

    console.log(`[autoGen] /generate-for-batch start: ${events.length} events`);

    // Dedup-gruppera efter (title_sv + venue_name)
    const groupsMap = new Map();
    for (const ev of events) {
      const key = dedupKey(ev);
      if (!groupsMap.has(key)) {
        groupsMap.set(key, { key, ids: [], representative: ev });
      }
      groupsMap.get(key).ids.push(ev.id);
    }
    const groups = Array.from(groupsMap.values());
    console.log(`[autoGen] dedup → ${groups.length} unika grupper (av ${events.length} events)`);

    const results = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const ev = g.representative;
      console.log(`[autoGen] [${i + 1}/${groups.length}] group key="${g.key}" (${g.ids.length} event(s))`);
      try {
        const prompt = buildAutoPrompt(ev);
        const { b64, mime } = await generateFluxSchnell(prompt);
        const storagePath = dedupPath(g.key);
        const imageUrl = await uploadAndPersistAll(g.ids, b64, mime, storagePath, prompt);
        console.log(`[autoGen]   done url=${imageUrl}`);
        results.push({
          ok: true,
          key: g.key,
          eventIds: g.ids,
          title: ev.title_sv || ev.title_en || '?',
          venue: getVenueName(ev),
          imageUrl,
          storagePath: `${AI_IMAGE_FOLDER}/${storagePath}.png`,
          prompt,
        });
      } catch (err) {
        console.error(`[autoGen]   group="${g.key}" FAILED:`, err.message);
        results.push({
          ok: false,
          key: g.key,
          eventIds: g.ids,
          title: ev.title_sv || ev.title_en || '?',
          venue: getVenueName(ev),
          error: err.message,
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    console.log(`[autoGen] /generate-for-batch done: ${okCount} ok, ${failCount} failed`);

    return sendJson(res, 200, {
      ok: true,
      totalGroups: groups.length,
      okCount,
      failCount,
      results,
    });
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[autoGen] listening on http://localhost:${PORT}`);
  console.log(`[autoGen] bucket=${STORAGE_BUCKET} supabase=${SUPABASE_URL}`);
});

server.on('error', (err) => {
  console.error('[autoGen] server error:', err);
  process.exit(1);
});
