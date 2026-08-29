/**
 * 08-Agent/tools/ai_compliance — EU AI Act Art. 50 disclosure pipeline.
 *
 * Single source of truth for "turn raw model output into a compliant
 * published image":
 *   1. Synlig stämpel: orange "● AI"-pill, 200×48 px, 24 px inset från
 *      högerkant, top=740 (safe-zone inom cover-crop för alla kända
 *      UI-containrar). Synlig märkning (EU AI Act Art. 50 disclosure).
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
 * Positionering: 1024×1024 AI-bilder cover-croppas av UI-containrar med
 * aspect 1.39:1 (Utforska/AiImageScreen), 1.63:1 (Details) eller 1.69:1
 * (HomeScreen cardImage). Worst-case synlig y-range är 210-815, så
 * stämpeln placeras med `top=740` (slutar vid y=788, 27 px marginal
 * till HomeScreen-synlig-kant 815).
 */

import sharp from 'sharp';

// ── Visible watermark ──────────────────────────────────────────────────────
// 200×48 px pill, 24 px inset från högerkant, top=740 (safe-zone inom
// cover-crop för alla kända UI-containrar; se fil-docblock för beräkning).
// Bottenplatta 82% opacitet svart med orange kantlinje (EventPulse accent
// #FFB454). EU AI Act Art. 50 kräver "easily visible" märkning — 200×48
// på en 1024-bild = ~9 % av bildytan, klart läsbar även i 320 px
// thumbnail (~63×15 px).
//
// Texten är "AI" (kort form, full disclosure "AI-generated" finns kvar
// i XMP-metadata för maskinläsbar verifiering). Visuell disclosure är
// entydig via UI-chips och tooltips; pixel-stämpeln är komplementet som
// gör disclosure:n robust mot screenshot-cropping och UI-förändringar.

const AI_STAMP_SVG = `<svg width="280" height="48" viewBox="0 0 280 48" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="276" height="44" rx="22" ry="22"
        fill="rgba(15,15,18,0.82)"
        stroke="rgba(255,180,84,0.65)" stroke-width="1.5"/>
  <circle cx="26" cy="24" r="6" fill="#FFB454"/>
  <text x="44" y="31" font-family="Arial, sans-serif" font-size="18"
        font-weight="bold" fill="#FFFFFF" letter-spacing="0.5">AI-genererad</text>
</svg>`;

const AI_STAMP_BUFFER = Buffer.from(AI_STAMP_SVG);

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

function buildAiXmp({ model, prompt }: { model: string; prompt: string }): string {
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

export interface ApplyAiComplianceInput {
  /** Raw bytes from the model (PNG eller JPEG). Sharp identifierar formatet. */
  buffer: Buffer;
  /** Prompt-text som ska hamna i EventPulse:Prompt-fältet. */
  prompt: string;
  /** Modellnamn som ska hamna i EventPulse:Model + dc:creator. */
  model: string;
}

/**
 * Applicerar EU AI Act Art. 50-compliance på en bildbuffer:
 *   1. Synlig AI-stämpel i nedre höger hörn (200×48 pill, 24 px från
 *      högerkant, top=740 för att synas inom cover-crop i UI)
 *   2. XMP-metadata-injection (maskinläsbar, Photoshop/exiftool/Adobe
 *      Bridge kan verifiera)
 *
 * Returnerar NY PNG-buffer. Original-rörs inte.
 *
 * Ren lokal compute, ~10–50 ms per bild, ingen API-kostnad.
 */
export async function applyAiCompliance(input: ApplyAiComplianceInput): Promise<Buffer> {
  const xmp = buildAiXmp({ model: input.model, prompt: input.prompt });
  // Stämpelposition: 24 px inset från högerkanten, top=740 (safe-zone
  // inom cover-crop för alla kända UI-containrar; se fil-docblock för
  // härledning). Använd explicit left/top istället för gravity — Sharp's
  // gravity+offset-semantik placerar input UTANFÖR bilden när inset>0.
  const meta = await sharp(input.buffer).metadata();
  const W = meta.width ?? 1024;
  const H = meta.height ?? 1024;
  const inset = 24;
  const stampW = 280;   // "AI-genererad" text är bredare än "AI"
  const stampH = 48;
  // For non-1024-bilder, scale the safe-zone proportionally so the stamp
  // stays in the bottom-right quadrant of the cover-cropped area.
  const stampTop = H >= 1024 ? 740 : Math.round((H / 1024) * 740);
  const left = W - inset - stampW;
  const top = stampTop;
  // Sharp ignorerar `.withMetadata({xmp})` för PNG-utdata — bara EXIF skrivs
  // till eXIf-chunken. XMP paketeras manuellt som PNG iTXt-chunk efter Sharp.
  const stamped = await sharp(input.buffer)
    .composite([
      {
        input: AI_STAMP_BUFFER,
        left,
        top,
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
  return injectXmpIntoPng(stamped, xmp);
}

/**
 * Pixel-detect: returnerar true om AI-stämpeln sitter i safe-zone.
 * Används av verifieraren för att avgöra om en bild är stämplad.
 *
 * - Orange > 20 pixlar (FFB454 ± tolerans) — centrerad 6-px-radie-cirkel
 * - Mörk platta > 200 pixlar (rgba ~15,15,18 ± tolerans) — bottenplattan
 *
 * Region: 200×48 px, 24 px inset från högerkant, top=740 (safe-zone inom
 * cover-crop). Samma region som applyAiCompliance använder.
 */
export interface StampCheckResult {
  ok: boolean;
  orangeCount: number;
  darkPlateCount: number;
  pixels: number;
}

export async function checkAiStamp(buffer: Buffer): Promise<StampCheckResult> {
  const meta = await sharp(buffer).metadata();
  const W = meta.width ?? 1024;
  const H = meta.height ?? 1024;
  const stampW = 280;   // matchar applyAiCompliance — "AI-genererad"-bredd
  const stampH = 48;
  const inset = 24;
  const stampTop = H >= 1024 ? 740 : Math.round((H / 1024) * 740);
  const left = W - inset - stampW;
  const top = stampTop;

  const raw = await sharp(buffer)
    .extract({ left, top, width: stampW, height: stampH })
    .removeAlpha()
    .raw()
    .toBuffer();

  let orangeCount = 0;
  let darkPlateCount = 0;
  for (let i = 0; i < raw.length; i += 3) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    if (Math.abs(r - 255) <= 20 && Math.abs(g - 180) <= 25 && Math.abs(b - 84) <= 30) {
      orangeCount += 1;
    }
    if (r < 30 && g < 30 && b < 30) {
      darkPlateCount += 1;
    }
  }
  // Synlig stämpel = orange "●"-prick syns. darkPlate är bara informativ
  // (vissa scener är ljusa → dark kan vara 0 även med stämpel).
  const ok = orangeCount > 20;
  return { ok, orangeCount, darkPlateCount, pixels: stampW * stampH };
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
