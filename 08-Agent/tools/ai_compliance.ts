/**
 * 08-Agent/tools/ai_compliance — EU AI Act Art. 50 disclosure pipeline.
 *
 * Single source of truth for "turn raw model output into a compliant
 * published image":
 *   1. Synlig stämpel: orange "● AI-genererad"-pill, 150×36 px, 10 px inset
 *      från vänsterkant, 20 px ovanför bottenkanten. Synlig märkning
 *      (EU AI Act Art. 50 disclosure).
 *   2. XMP-metadata: `EventPulse:` namespaced fält för maskinläsbar
 *      verifiering (Photoshop, exiftool, Adobe Bridge).
 *
 * Används av:
 *   - autoGenServer.js (server-side Flux pipeline, har inline-kopia som
 *     hålls i synk manuellt — DELAD logik, INTE delad modul eftersom
 *     autoGenServer är en fristående Node-script utan TS-build)
 *   - scripts/restyle_existing_ai_images.ts (re-stämpla befintliga)
 *   - scripts/generate_ai_image_smoketest.ts (gpt-image-1-vägen)
 *
 * Ren funktion. Inga nätverksanrop. Inga Supabase-anrop. Tar emot en
 * PNG/JPEG-buffer och returnerar en NY buffer (Sharp är immutable).
 *
 * Idempotent på input-nivå: samma (buffer, prompt, model) → samma output.
 * (XMP-tidstämpel blir olika mellan körningar — det är meningen, det är
 * när stämplingen skedde.)
 *
 * Positionering (2026-10-08, användarbeslut): tight hörnpill i nedre
 * vänstra hörnet istället för fullbred bottenstripe. Anledning:
 * stämplingen ska vara diskret men läsbar, inte ta onöjedybar bildyta.
 *
 * Säkerhetsregel: stämpla ALDRIG en redan stämplad bild. Arbetsflödet
 * är alltid: rå bild i `local_image_library/` → KOPIERA till
 * `local_image_library_stamped/` → stämpla kopian. På det sättet
 * finns det alltid en ostämplad originalreferens för diff-verifiering.
 */

import sharp from 'sharp';

// ── Visible watermark ──────────────────────────────────────────────────────
// Tight hörnpill 150×36 px, placerad 10 px från vänsterkant, 20 px
// ovanför bottenkanten (användarbeslut 2026-10-08). Bottenplatta 65%
// opacitet svart med orange kantlinje (EventPulse accent #FFB454).
// Orange prick + vit "AI-genererad" text, textskugga för läsbarhet mot
// ljusa motiv.
//
// EU AI Act Art. 50 kräver "easily visible" märkning. 150×36 på en
// 1024-bild = ~5 % av bildytan — klart läsbar i AppStore-thumbnail
// (~47×11 px). Mindre än tidigare 200×48-pill och 1024×64-fullbred
// stripe (användaren: "stampen är för stor").
//
// Pixelmått: librsvg-render av "AI-genererad" i 16 px Arial bold = ~113 px
// textbredd + 14 px prick-sektion + 2×11 px marginal = 150 px.
//
// Vid cover-crop i UI-containrar kan hörnpillen beskäras — det är OK
// eftersom (a) XMP-disclosure:n finns kvar maskinläsbart, och (b)
// UI-chips + dev-banner kompletterar disclosure:n.
const AI_STAMP_W = 150;
const AI_STAMP_H = 36;
const AI_STAMP_SVG = `<svg width="${AI_STAMP_W}" height="${AI_STAMP_H}" viewBox="0 0 ${AI_STAMP_W} ${AI_STAMP_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="textShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="0.8"/>
      <feOffset dx="0" dy="1" result="offsetblur"/>
      <feComponentTransfer>
        <feFuncA type="linear" slope="0.65"/>
      </feComponentTransfer>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect x="0.75" y="0.75" width="${AI_STAMP_W - 1.5}" height="${AI_STAMP_H - 1.5}" rx="6" ry="6"
        fill="rgba(15,15,18,0.65)"
        stroke="#FFB454" stroke-opacity="0.55" stroke-width="1"/>
  <circle cx="16" cy="18" r="5" fill="#FFB454" fill-opacity="0.85"/>
  <text x="28" y="24" font-family="Arial, sans-serif" font-size="16"
        font-weight="bold" fill="#FFFFFF" fill-opacity="0.92"
        letter-spacing="0.3"
        filter="url(#textShadow)">AI-genererad</text>
</svg>`;

const AI_STAMP_BUFFER = Buffer.from(AI_STAMP_SVG);

// ── Legacy 240×64 SE-pill (bfl2/3/4-design, 2026-08-25 → 2026-10-08) ──────
// 240×64 px pill i nedre högra hörnet (SE), 24 px inset. Samma SVG som
// autoGenServer.js inline-kopia använde fram till 2026-10-08. Replikerad
// härmed för att bfl5+-bilder ska få identisk design med de befintliga
// bfl2/3/4-bilderna i produktion. "AI-generated" (engelska, EU-förordningens
// exakta terminologi) istället för "AI-genererad" (svenska UI-översättning).
// Fullt rundad platta (rx=30) — 82% opacitet svart, orange #FFB454-kant 1.5px,
// orange prick r=8.
const AI_STAMP_SVG_LEGACY = `<svg width="240" height="64" viewBox="0 0 240 64" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="236" height="60" rx="30" ry="30"
        fill="rgba(15,15,18,0.82)"
        stroke="rgba(255,180,84,0.65)" stroke-width="1.5"/>
  <circle cx="34" cy="32" r="8" fill="#FFB454"/>
  <text x="56" y="40" font-family="Arial, sans-serif" font-size="22"
        font-weight="bold" fill="#FFFFFF" letter-spacing="0.5">AI-generated</text>
</svg>`;

const AI_STAMP_BUFFER_LEGACY = Buffer.from(AI_STAMP_SVG_LEGACY);

// ── XMP metadata packet ───────────────────────────────────────────────────
// Standard `xpacket begin/end`-inramning. Namespaced fält under
// `EventPulse:`-prefix för att inte kollidera med andra namespaces.
//
// Fält:
//   dc:rights        → "AI-generated image (EU AI Act Art. 50)"
//   dc:creator       → "EventPulse/<model>"
//   xmp:CreatorTool  → "EventPulse/autoGenServer"
//   xmp:CreateDate   → ISO nu
//   EventPulse:AIGenerated   → "true"
//   EventPulse:Model         → <model>
//   EventPulse:Policy        → "EU-AI-Act-Art-50"
//   EventPulse:GeneratedAt   → ISO nu
//   EventPulse:Prompt        → <prompt, max 500 chars, escapeade>

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildAiXmp({ model, prompt }: { model: string; prompt: string }): string {
  const now = new Date().toISOString();
  const safePrompt = (prompt || '').replace(/[<&>]/g, '').slice(0, 500);
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="EventPulse/1.0">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"
                     xmlns:xmp="http://ns.adobe.com/xap/1.0/"
                     xmlns:EventPulse="eventpulse:meta/1.0/"
                     xmp:CreatorTool="EventPulse/ai_compliance"
                     xmp:CreateDate="${now}"
                     xmp:MetadataDate="${now}">
      <dc:rights>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">AI-generated image (EU AI Act Art. 50)</rdf:li>
        </rdf:Alt>
      </dc:rights>
      <dc:creator>
        <rdf:Seq>
          <rdf:li>EventPulse/${escapeXml(model)}</rdf:li>
        </rdf:Seq>
      </dc:creator>
      <EventPulse:AIGenerated>true</EventPulse:AIGenerated>
      <EventPulse:Model>${escapeXml(model)}</EventPulse:Model>
      <EventPulse:Policy>EU-AI-Act-Art-50</EventPulse:Policy>
      <EventPulse:GeneratedAt>${now}</EventPulse:GeneratedAt>
      <EventPulse:Prompt>${safePrompt}</EventPulse:Prompt>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

// ── PNG iTXt chunk parser & injector ───────────────────────────────────────
//
// PNG iTXt-chunk format (https://www.w3.org/TR/PNG/#11iTXt):
//   4-byte length (BE)
//   "iTXt"        (4 bytes)
//   keyword        (1-79 bytes, null-terminated; "XML:com.adobe.xmp" = XMP)
//   compression    (1 byte: 0=none, 1=zlib)
//   compression-method (1 byte, ignored when compression=0)
//   language       (null-terminated, can be empty)
//   translated-keyword (null-terminated, can be empty)
//   text           (raw or zlib-deflated depending on compression flag)
//
// Vi klarar både okomprimerad (0) och zlib-komprimerad (1).
//
// Varför egen injector: Sharp 0.32+ ignorerar `.withMetadata({xmp})` helt för
// PNG-utdata (den skriver bara EXIF till eXIf-chunken). XMP stöds bara för
// JPEG i Sharp. För att PNG ska kunna bära maskinläsbar Art. 50-disclosure
// behöver vi skriva iTXt-chunken själva efter Sharp är klar.

import * as zlib from 'node:zlib';

// CRC32 (PNG-spec, polynomial 0xedb88320, init 0xffffffff, xor 0xffffffff).
// Används av PNG för chunk-CRCs. Ren tabell-version, ~256 byte tabell.
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Build a single iTXt chunk (length prefix + type + data + CRC). */
function buildITxtChunk(keyword: string, text: string, lang = '', translatedKw = ''): Buffer {
  if (keyword.length > 79) throw new Error(`iTXt keyword too long: ${keyword.length}`);
  const parts: Buffer[] = [];
  parts.push(Buffer.from(keyword, 'latin1'));
  parts.push(Buffer.from([0]));                // keyword terminator
  parts.push(Buffer.from([0]));                // compression flag (0 = none)
  parts.push(Buffer.from([0]));                // compression method (ignored)
  parts.push(Buffer.from(lang, 'utf8'));       // language
  parts.push(Buffer.from([0]));                // language terminator
  parts.push(Buffer.from(translatedKw, 'utf8'));// translated keyword
  parts.push(Buffer.from([0]));                // translated-kw terminator
  parts.push(Buffer.from(text, 'utf8'));       // XMP payload (UTF-8)
  const data = Buffer.concat(parts);
  const type = Buffer.from('iTXt', 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([type, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, type, data, crc]);
}

/**
 * Inject an XMP packet as an iTXt chunk into a PNG buffer. Inserts
 * immediately after IHDR so PNG readers encounter XMP early. The
 * resulting buffer is still a valid PNG: existing chunks + IHDR are
 * preserved verbatim.
 *
 * Idempotent: if an `XML:com.adobe.xmp` iTXt chunk already exists it is
 * replaced (latest call wins).
 */
function injectXmpIntoPng(png: Buffer, xmp: string): Buffer {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('injectXmpIntoPng: not a PNG buffer');
  }
  const out: Buffer[] = [png.subarray(0, 8)];
  let offset = 8;
  let inserted = false;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('latin1');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > png.length) break;
    const isXmpITxt =
      type === 'iTXt' &&
      (() => {
        const data = png.subarray(dataStart, dataEnd);
        const nul = data.indexOf(0);
        return nul > 0 && data.subarray(0, nul).toString('latin1') === 'XML:com.adobe.xmp';
      })();
    if (isXmpITxt) {
      // Skip the existing XMP iTXt chunk — we'll inject a fresh one.
      offset = crcEnd;
      inserted = true;
      continue;
    }
    out.push(png.subarray(offset, crcEnd));
    // Insert new XMP right after IHDR (and before IDAT, per PNG spec
    // chunk-ordering conventions).
    if (type === 'IHDR' && !inserted) {
      out.push(buildITxtChunk('XML:com.adobe.xmp', xmp));
      inserted = true;
    }
    offset = crcEnd;
    if (type === 'IEND') break;
  }
  if (!inserted) {
    // Edge case: PNG had no IHDR (shouldn't happen) or injection failed.
    // Fall back to appending before IEND if it exists, else at the end.
    out.push(buildITxtChunk('XML:com.adobe.xmp', xmp));
  }
  return Buffer.concat(out);
}

/** Read XMP from a PNG iTXt or tEXt chunk. */
interface PngXmpResult {
  found: boolean;
  text: string;
  source: 'png-itxt' | 'png-ascii' | null;
}

function readPngXmp(buffer: Buffer): PngXmpResult {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { found: false, text: '', source: null };
  }
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.subarray(offset, offset + 4).toString('latin1');
    offset += 4;
    if (offset + length > buffer.length) break;
    const data = buffer.subarray(offset, offset + length);
    offset += length + 4; // skip CRC

    if (type === 'iTXt') {
      const nul = data.indexOf(0);
      if (nul < 0) continue;
      const keyword = data.subarray(0, nul).toString('latin1');
      if (keyword !== 'XML:com.adobe.xmp') continue;
      let cursor = nul + 1;
      const compressionFlag = data[cursor++];
      if (compressionFlag === 1) cursor += 1;
      const langEnd = data.indexOf(0, cursor);
      if (langEnd < 0) continue;
      cursor = langEnd + 1;
      const tkEnd = data.indexOf(0, cursor);
      if (tkEnd < 0) continue;
      cursor = tkEnd + 1;
      const textBuf = data.subarray(cursor);
      const text =
        compressionFlag === 1 ? zlib.inflateSync(textBuf).toString('utf8') : textBuf.toString('utf8');
      return { found: true, text, source: 'png-itxt' };
    }

    if (type === 'tEXt') {
      const nul = data.indexOf(0);
      if (nul < 0) continue;
      const keyword = data.subarray(0, nul).toString('latin1');
      if (keyword !== 'XML:com.adobe.xmp') continue;
      return { found: true, text: data.subarray(nul + 1).toString('latin1'), source: 'png-itxt' };
    }
  }
  return { found: false, text: '', source: null };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Vilket nedre hörn stämpeln placeras i.
 *
 * `bottom-left` är standard (användarbeslut 2026-10-08). Strikt
 * hörnpill i nedre vänstra hörnet, 10 px från vänsterkant, 20 px
 * ovanför bottenkanten.
 */
export type StampPosition = 'bottom-right' | 'bottom-left';

// 2026-10-08: Tight hörnpill 150×36 px. För andra bildstorlekar skalas
// proportionellt så förhållandet 36/1024 bibehålls, dock minst 24 px hög.
const STAMP_H = AI_STAMP_H;        // 36 px
const STAMP_W = AI_STAMP_W;        // 150 px
const STAMP_LEFT_INSET = 10;       // px från vänsterkant
const STAMP_BOTTOM_INSET = 20;     // px ovanför bottenkant

// Legacy bfl2/3/4-design (2026-08-25 → 2026-10-08): 240×64 SE-pill med
// 24 px inset. Skalas INTE — samma absoluta pixelmått oavsett
// bildstorlek, så marginalen mot kanten växer proportionellt på små bilder.
const LEGACY_STAMP_W = 240;
const LEGACY_STAMP_H = 64;
const LEGACY_STAMP_INSET = 24;

interface StampBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Var stämpeln hamnar för en given bildstorlek.
 *
 * `bottom-left` (default): tight hörnpill 150×36 px, 10 px från vänster,
 * 20 px ovanför botten. Skalas proportionellt för små bilder.
 *
 * `bottom-right`: legacy 240×64 SE-pill med 24 px inset (bfl2/3/4-design).
 * Absoluta pixelmått — skalas inte.
 *
 * `applyAiCompliance` och `checkAiStamp` MÅSTE använda samma funktion,
 * annars letar verifieringen på fel ställe.
 */
function stampBox(W: number, H: number, position: StampPosition): StampBox {
  if (position === 'bottom-right') {
    return {
      left: W - LEGACY_STAMP_INSET - LEGACY_STAMP_W,
      top: H - LEGACY_STAMP_INSET - LEGACY_STAMP_H,
      width: LEGACY_STAMP_W,
      height: LEGACY_STAMP_H,
    };
  }
  // bottom-left (default)
  const scale = H >= 1024 ? 1 : H / 1024;
  const height = Math.max(24, Math.round(STAMP_H * scale));
  const width = Math.round(STAMP_W * scale);
  const leftInset = Math.round(STAMP_LEFT_INSET * scale);
  const bottomInset = Math.round(STAMP_BOTTOM_INSET * scale);
  return { left: leftInset, top: H - height - bottomInset, width, height };
}

export interface ApplyAiComplianceInput {
  /** Raw bytes from the model (PNG eller JPEG). Sharp identifierar formatet. */
  buffer: Buffer;
  /** Prompt-text som ska hamna i EventPulse:Prompt-fältet. */
  prompt: string;
  /** Modellnamn som ska hamna i EventPulse:Model + dc:creator. */
  model: string;
  /**
   * Hörn att placera stämpeln i. Default `bottom-left`.
   */
  position?: StampPosition;
}

/**
 * Applicerar EU AI Act Art. 50-compliance på en bildbuffer:
 *   1. Synlig AI-stämpel i valt nedre hörn (202×48 tight pill, 24 px inset,
 *      top=740 för att synas inom cover-crop i UI)
 *   2. XMP-metadata-injection (maskinläsbar, Photoshop/exiftool/Adobe
 *      Bridge kan verifiera)
 *
 * Returnerar NY PNG-buffer. Original-rörs inte.
 *
 * Ren lokal compute, ~10–50 ms per bild, ingen API-kostnad.
 */
export async function applyAiCompliance(input: ApplyAiComplianceInput): Promise<Buffer> {
  const xmp = buildAiXmp({ model: input.model, prompt: input.prompt });
  // Explicit left/top istället för gravity — Sharp's gravity+offset-semantik
  // placerar input UTANFÖR bilden när inset>0.
  const meta = await sharp(input.buffer).metadata();
  const W = meta.width ?? 1024;
  const H = meta.height ?? 1024;
  const position = input.position ?? 'bottom-left';
  const { left, top } = stampBox(W, H, position);
  // Välj SVG baserat på position: bottom-right → legacy 240×64,
  // bottom-left → ny 150×36 hörnpill. `checkAiStamp` använder samma
  // stampBox() för att hitta rätt region.
  const stampBuffer = position === 'bottom-right' ? AI_STAMP_BUFFER_LEGACY : AI_STAMP_BUFFER;
  // Sharp ignorerar `.withMetadata({xmp})` för PNG-utdata — bara EXIF skrivs
  // till eXIf-chunken. XMP paketeras manuellt som PNG iTXt-chunk efter Sharp.
  const stamped = await sharp(input.buffer)
    .composite([{ input: stampBuffer, left, top }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  return injectXmpIntoPng(stamped, xmp);
}

/**
 * Verifierar att AI-stämpeln finns i safe-zone.
 *
 * Två metoder, i fallande bevisstyrka:
 *
 * **`diff`** — när `reference` (det ostämplade originalet) skickas med.
 * Stämpelregionen jämförs pixel för pixel mellan original och resultat.
 * Stämpeln täcker hela regionen med minst 0.20 alpha, så nästan varje
 * pixel måste ha ändrats. Det bevisar att något faktiskt komponerats på
 * rätt plats, oberoende av motiv och av stämpelns färgsättning.
 *
 * **`xmp`** — när originalet saknas. Då kontrolleras den maskinläsbara
 * disclosure:n i stället.
 *
 * Varför inte färgdetektering: fram till 2026-08-30 letade den här
 * funktionen efter pixlar nära `#FFB454`. Det slutade fungera när
 * stämpelns delar gjordes genomskinliga (platta 0.20, kant 0.45, prick
 * och text 0.60) — den alfa-blandade accenten landar var som helst mellan
 * motivets färg och `#FFB454`. Ett bredare "varm orange"-kriterium
 * testades och gav **9 falska positiva av 25** ostämplade original;
 * affischer med varm scenbelysning är oskiljbara från stämpeln på färg
 * allena. Metoden övergavs därför helt.
 *
 * `orangeCount` finns kvar som informativt mått men styr inte `ok`.
 *
 * För bevis på att stämpeln är synlig i den *renderade* vyn — vilket är
 * en annan fråga än om den finns i filen — används
 * `scripts/verify_utforska_star.py`.
 *
 * Region: 150×36 px hörnpill, 10 px från vänsterkant, 20 px ovanför
 * bottenkanten. Samma region som applyAiCompliance använder — båda går
 * via `stampBox`, så de kan inte glida isär.
 */
export interface StampCheckResult {
  ok: boolean;
  /** Vilken metod som avgjorde `ok`. */
  method: 'diff' | 'xmp';
  /** Andel ändrade pixlar i stämpelregionen. Endast för `diff`. */
  changedRatio: number | null;
  /** Informativt: pixlar med accentfärgens karaktär. Styr inte `ok`. */
  orangeCount: number;
  darkPlateCount: number;
  pixels: number;
}

/**
 * Minsta andel av stämpelns *opaka* pixlar som måste ha ändrats.
 *
 * Mätningen begränsas till stämpelns kant, prick och text (alpha ≥ 0.4).
 * Bottenplattan är medvetet utesluten: vid 0.20 alpha över ett mörkt
 * motiv ändras pixlarna med 1–2 nivåer, vilket drunknar i
 * PNG-kvantiseringen. Ett mått som räknar hela regionen blir därför
 * innehållsberoende — mörka affischer gav 0.19–0.31 och ljusa 0.89–0.92,
 * med samma korrekt applicerade stämpel.
 *
 * 2026-10-08: sänkt till 0.16 för den nya 150×36-hörnpillen. Bulk-stämpning
 * på 398 bilder visade:
 *   - korrekt applicerad hörnpill på ljus bild: changedRatio 0.30–0.45
 *   - korrekt applicerad hörnpill på mörk bild (t.ex. dans-scen med
 *     svart underkant): changedRatio 0.12–0.16
 *   - ostämplad original: changedRatio 0.00–0.05
 * Threshold 0.10 fångar även mörka motiv (0.12) och utesluter ostämplade.
 */
const STAMP_CHANGED_RATIO_THRESHOLD = 0.10;

/** Minsta kanalskillnad för att en pixel ska räknas som ändrad. */
const PIXEL_DIFF_EPSILON = 6;

/** Alpha-golv för vilka stämpelpixlar som ingår i differentialmätningen. */
const STAMP_MASK_ALPHA_FLOOR = 102;   // 0.4 × 255

/**
 * Index (i RGB-triplett-steg) för stämpelns opaka pixlar. Härleds ur
 * SVG:ns egen alfakanal, så masken följer automatiskt med när stämpelns
 * design ändras.
 */
let stampMaskCache: number[] | null = null;

async function getStampMask(): Promise<number[]> {
  if (stampMaskCache) return stampMaskCache;
  const { data, info } = await sharp(AI_STAMP_BUFFER)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask: number[] = [];
  const channels = info.channels;
  for (let p = 0; p < info.width * info.height; p++) {
    const alpha = data[p * channels + (channels - 1)];
    if (alpha >= STAMP_MASK_ALPHA_FLOOR) mask.push(p * 3);
  }
  stampMaskCache = mask;
  return mask;
}

/** Informativt mått: bär pixeln accentfärgens karaktär? */
function isAccentOrange(r: number, g: number, b: number): boolean {
  return r > 120 && r - b >= 45 && r - g >= 15 && r >= g && g >= b;
}

async function extractStampRegion(
  buffer: Buffer,
  position: StampPosition,
): Promise<{ raw: Buffer; width: number; height: number }> {
  const meta = await sharp(buffer).metadata();
  const W = meta.width ?? 1024;
  const H = meta.height ?? 1024;
  const { left, top, width, height } = stampBox(W, H, position);
  const raw = await sharp(buffer)
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer();
  return { raw, width, height };
}

export async function checkAiStamp(
  buffer: Buffer,
  position: StampPosition = 'bottom-left',
  reference?: Buffer,
): Promise<StampCheckResult> {
  const { raw, width, height } = await extractStampRegion(buffer, position);
  const pixels = width * height;

  let orangeCount = 0;
  let darkPlateCount = 0;
  for (let i = 0; i < raw.length; i += 3) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    if (isAccentOrange(r, g, b)) orangeCount += 1;
    if (r < 30 && g < 30 && b < 30) darkPlateCount += 1;
  }

  if (reference) {
    const ref = await extractStampRegion(reference, position);
    if (ref.raw.length !== raw.length) {
      throw new Error(
        `reference stamp region size mismatch: ${ref.raw.length} vs ${raw.length}`,
      );
    }
    let changed = 0;
    const mask = await getStampMask();
    for (const i of mask) {
      if (
        Math.abs(raw[i] - ref.raw[i]) > PIXEL_DIFF_EPSILON ||
        Math.abs(raw[i + 1] - ref.raw[i + 1]) > PIXEL_DIFF_EPSILON ||
        Math.abs(raw[i + 2] - ref.raw[i + 2]) > PIXEL_DIFF_EPSILON
      ) {
        changed += 1;
      }
    }
    const changedRatio = mask.length > 0 ? changed / mask.length : 0;
    return {
      ok: changedRatio > STAMP_CHANGED_RATIO_THRESHOLD,
      method: 'diff',
      changedRatio,
      orangeCount,
      darkPlateCount,
      pixels,
    };
  }

  const xmp = parseXmp(buffer);
  return {
    ok: xmp.found && xmp.hasAiGenerated,
    method: 'xmp',
    changedRatio: null,
    orangeCount,
    darkPlateCount,
    pixels,
  };
}

/**
 * Parse XMP från en PNG- eller JPEG-buffer. JPEG lagrar XMP i APP1 (FFE1)
 * segmentet; PNG lagrar den som ASCII i fil-flödet.
 *
 * Returnerar null om inget XMP hittas, eller ett objekt med de
 * verifieringsbara fälten.
 */
export interface XmpCheckResult {
  found: boolean;
  hasAiGenerated: boolean;
  hasPolicy: boolean;
  hasModel: boolean;
  hasGeneratedAt: boolean;
  hasPrompt: boolean;
  prompt: string | null;
  model: string | null;
  generatedAt: string | null;
  creatorTool: string | null;
  rightsMentionsAi: boolean;
  source: 'png-itxt' | 'png-ascii' | 'jpeg-app1' | null;
}

export function parseXmp(buffer: Buffer): XmpCheckResult {
  const empty: XmpCheckResult = {
    found: false,
    hasAiGenerated: false,
    hasPolicy: false,
    hasModel: false,
    hasGeneratedAt: false,
    hasPrompt: false,
    prompt: null,
    model: null,
    generatedAt: null,
    creatorTool: null,
    rightsMentionsAi: false,
    source: null,
  };

  // Pass 0: PNG iTXt-chunk (Sharp skriver XMP hit när vi använder
  // .withMetadata({xmp: '...'}).png()). Detta är den moderna vägen
  // och täcker bilder producerade av applyAiCompliance().
  const pngXmp = readPngXmp(buffer);
  let block: string | null = null;
  let source: 'png-ascii' | 'jpeg-app1' | 'png-itxt' | null = null;
  if (pngXmp.found) {
    block = pngXmp.text;
    source = 'png-itxt';
  }

  // Pass 1: legacy PNG-ascii (inline <?xpacket begin...end>) — om någon
  // pipeline skulle skriva XMP som raw ASCII istället för iTXt-chunk.
  if (!block) {
    const text = buffer.toString('latin1');
    const xpacketIdx = text.indexOf('<?xpacket begin');
    if (xpacketIdx >= 0) {
      const xpacketEnd = text.indexOf('<?xpacket end="w"?>', xpacketIdx);
      if (xpacketEnd >= 0) {
        block = text.slice(xpacketIdx, xpacketEnd + '<?xpacket end="w"?>'.length);
        source = 'png-ascii';
      }
    }
  }

  // Pass 2: JPEG — APP1-segment med XMP-namespace.
  if (!block) {
    const text = buffer.toString('latin1');
    const xpacketStart = text.indexOf('http://ns.adobe.com/xap/1.0/');
    if (xpacketStart >= 0) {
      const headerEnd = xpacketStart + 'http://ns.adobe.com/xap/1.0/'.length;
      const bodyStart = text.indexOf('<?xpacket begin', headerEnd);
      if (bodyStart >= 0) {
        const bodyEnd = text.indexOf('<?xpacket end="w"?>', bodyStart);
        if (bodyEnd >= 0) {
          block = text.slice(bodyStart, bodyEnd + '<?xpacket end="w"?>'.length);
          source = 'jpeg-app1';
        }
      }
    }
  }

  if (!block) return empty;

  const re = (key: string) => {
    const m = block!.match(new RegExp(`<${key}>([\\s\\S]*?)</${key}>`, 'i'));
    if (!m) return null;
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  };

  const creatorTool = re('xmp:CreatorTool');
  const model = re('EventPulse:Model');
  const generatedAt = re('EventPulse:GeneratedAt');
  const prompt = re('EventPulse:Prompt');
  const rights = re('dc:rights') || '';

  return {
    found: true,
    hasAiGenerated: /<EventPulse:AIGenerated>\s*true\s*<\/EventPulse:AIGenerated>/i.test(block),
    hasPolicy: /<EventPulse:Policy>\s*(EU-AI-Act-Art-50|EU AI Act Art\.? 50)\s*<\/EventPulse:Policy>/i.test(block),
    hasModel: !!model,
    hasGeneratedAt: !!generatedAt,
    hasPrompt: !!prompt,
    prompt,
    model,
    generatedAt,
    creatorTool,
    rightsMentionsAi: /AI[\- ]generated/i.test(rights),
    source,
  };
}
