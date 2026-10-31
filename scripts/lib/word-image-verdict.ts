/**
 * scripts/lib/word-image-verdict.ts — gemensam granskningslogik för
 * ordbilderna. Används av BÅDE generatorn (scripts/word_image_gen.ts) och
 * gaten (scripts/verify-word-images.ts) så att de aldrig kan glida isär.
 *
 * Granskningen ställer fyra frågor om en faktisk bildfil:
 *   match           — visar bilden ordet?
 *   appropriate     — är bilden lämplig för ett offentligt evenemangskort?
 *   text            — finns läsbar eller förvansad text i bilden?
 *   foreground_face — står ett ansikte i förgrunden?
 *
 * De två sista kommer från promptens egna regler ("no text, no signage",
 * "no foreground faces"). En bild som visar rätt sak men har en neonskylt
 * med nonsenstext är inte användbar i appen.
 */

import { readFileSync } from 'node:fs';

export const MINIMAX_BASE = 'https://api.minimax.io/v1';
export const M3_MODEL = 'minimax-M3';

export const VERIFY_SYSTEM = `Du granskar en AI-genererad evenemangskortbild för EventPulse (Stockholm).

FRÅGA 1: visar bilden det ord som efterfrågas?
FRÅGA 2: är bilden lämplig för ett offentligt evenemangskort?
FRÅGA 3: finns det läsbar eller förvansad text i bilden?
FRÅGA 4: står det ett ansikte i förgrunden?

Svara ENDAST med ett JSON-objekt i exakt denna form:
{"match":<true|false>,"confidence":<0.0-1.0>,"shows":"<vad bilden faktiskt visar, max 12 ord>","reason":"<max 15 ord>","appropriate":<true|false>,"appropriateness_note":"<max 12 ord>","text":"<none|garbled|readable>","foreground_face":<true|false>}

Regler för "match":
- match=true endast om bilden tydligt visar DET efterfrågade ordets INNEBÖRD.
- TOLKA ORDET SOM BETYDELSE, INTE SOM TEXT. Du ska inte leta efter bokstävernas
  form i bilden — ingen bild har något ord tryckt på sig. Fråga "skulle en
  svensk förstå att det här är en bild av DET?" Så gäller:
  • "is" (ishockey) → en isbana med skridskor ÄR en bild av is.
  • "tour" → en turnébuss med människor, eller en scenväntande publik ÄR en
    bild av en turné.
  • "mässa" → bås och besökare i en hall ÄR en bild av en mässa.
  • "klädkammare" → en garderob med rockar ÄR en bild av klädkammare.
  • "väder" (om man ser himmel och moln) osv.
- TITLARNA ÄR FACIT. De är hämtade från den riktiga källan och de visar vad
  evenemangen faktiskt är. Om ordets betydelse i dessa titlar skiljer sig från
  den vanliga betydelsen av ordet, gäller TITLARNA. Exempel: är titeln
  "Så tuktas en argbigga" ska bilden visa en trut/fågel — inte en person som
  bråkar. En bild som stämmer med ordets vanliga betydelse men INTE med
  titlarna är fel (match=false).
- match=false endast om bilden visar en HELT ANNAN aktivitet, sak eller
  situation — inte bara en variant, en miljö eller ett tillfälle av ordet.
  En närbild av en fotbollsmatch ÄR match=true för ordet "match".
- ORD SOM ÄR BÅDE VANLIGT ORD OCH EVENEMANGSNAMN: räcker det med den
  GENERELLA formen. "motorbaletten" → en klassikbilstur i en gata ÄR en
  bild av motorbaletten. "expo" → en mässa med bås och besökare ÄR en bild
  av expo. Kräv inte att bilden föreställer exakt en viss organiserad
  tävling eller ett visst evenemang med just det namnet — kortet ska visa
  VAD det är, inte vilket evenemang det är.
- match=false också om bilden är för generisk för ordet (t.ex. ett tomt rum
  för ordet "julbord").
- confidence = hur säker du är på ditt svar (0.0–1.0).
- "shows" ska beskriva vad du faktiskt ser, även när match=false.

Regler för "appropriate":
- appropriate=false om någon person är naken, visar blotta bröst, har badkläder som visar för mycket, eller om bilden är sexuellt suggestiv.
- appropriate=true om personerna är klädda (badrock, handdukar, badkläder) eller om det inte finns personer i bilden.
- Detta är ett OFFENTLIGT evenemangskort i en allmän app — inga nakenbilder.

Regler för "text":
- "none" = ingen text alls.
- "garbled" = det finns tecken som försöker vara text men är nonsens.
- "readable" = faktisk läsbar text (skyltar, neon, logotyper, banners).
- Prompten säger uttryckligen "no text, no signage, no logos, no banners" — bilder med text bryter mot den.
- IGNORERA AI Act-stämpeln "AI-genererad" i bildens nedre vänstra hörn. Den sätts på av
  compliance-skiktet ETER att bilden genererats och är inte en del av det
  genererade motivet. Räkna den alltså inte som text.

Regler för "foreground_face":
- true endast om ett ansikte DOMINERAR bilden — ett porträtt där ansiktet fyller
  stora delen av ramen.
- false om ansikten bara syns som en del av en grupp- eller miljöbild (t.ex. personer
  i en bastu, en promenad, en marknad). Det är eftersträvansat att miljön syns.
- Prompten säger "no foreground faces" i meningen "ingen närbild av ett ansikte".

Ingen extra text.`;

export interface WordVerdict {
  match: boolean;
  confidence: number;
  shows: string;
  reason: string;
  appropriate: boolean;
  appropriateness_note: string;
  text: 'none' | 'garbled' | 'readable';
  foreground_face: boolean;
}

/** Bilden klarar gaten? */
export function verdictPasses(v: WordVerdict | null): boolean {
  return !!v && v.match === true && v.appropriate === true
    && v.text === 'none' && v.foreground_face === false;
}

/** Kortfattad orsak till varför en bild föll. */
export function verdictReason(v: WordVerdict | null): string {
  if (!v) return 'ingen granskning';
  const why: string[] = [];
  if (!v.match) why.push(`visar "${v.shows}" i stället för ordet`);
  if (!v.appropriate) why.push(`olämplig: ${v.appropriateness_note}`);
  if (v.text !== 'none') why.push(`text i bilden: ${v.text}`);
  if (v.foreground_face) why.push('ansikte i förgrunden');
  return why.join('; ') || 'ok';
}

export async function verifyImageFile(
  file: string,
  word: string,
  meaning: string,
  apiKey: string,
  titles: string[] = [],
): Promise<WordVerdict | null> {
  const buf = readFileSync(file);
  const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
  const titleBlock = titles.length
    ? `\nTitlar som innehåller ordet (FACIT — de visar vad evenemangen faktiskt är):\n${titles.slice(0, 4).map((t) => `- ${t}`).join('\n')}\n`
    : '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${MINIMAX_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: M3_MODEL,
          messages: [
            { role: 'system', content: VERIFY_SYSTEM },
            { role: 'user', content: [
              {
                type: 'text',
                text: `Efterfrågat ord: "${word}"\nBetydelse: ${meaning}\n${titleBlock}\n`
                  + '1) Visar bilden detta?\n2) Är bilden lämplig för ett offentligt evenemangskort?\n'
                  + '3) Finns det text i bilden?\n4) Står det ett ansikte i förgrunden?',
              },
              { type: 'image_url', image_url: { url: dataUrl } },
            ] },
          ],
          max_tokens: 900, temperature: 0, thinking: { type: 'disabled' },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      let c: string = j?.choices?.[0]?.message?.content ?? '';
      c = c.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const s = c.indexOf('{'); const e = c.lastIndexOf('}');
      if (s === -1 || e === -1) throw new Error('ingen JSON');
      const o = JSON.parse(c.slice(s, e + 1));
      const text: WordVerdict['text'] =
        o.text === 'readable' || o.text === 'garbled' ? o.text : 'none';
      return {
        match: o.match === true,
        confidence: typeof o.confidence === 'number' ? o.confidence : 0,
        shows: String(o.shows ?? ''),
        reason: String(o.reason ?? ''),
        appropriate: o.appropriate !== false,
        appropriateness_note: String(o.appropriateness_note ?? ''),
        text,
        foreground_face: o.foreground_face === true,
      };
    } catch (err) {
      if (attempt === 2) return null;
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(1.6, attempt)));
    }
  }
  return null;
}
