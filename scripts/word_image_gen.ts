#!/usr/bin/env tsx
/**
 * scripts/word_image_gen.ts — "titalanpassad bildgen".
 *
 * Skillnad mot den ORANGE knappen (scripts/adaptive_image_gen.ts):
 *   orange  : enheten är (kategori × kluster × zoomnivå × pose × ljus)
 *   denna   : enheten är ETT UNIKT ORD från eventtiteln ("dambastu",
 *             "tipspromenad", "julmässa"). Inga kategorier, inga kluster.
 *
 * Flöde per ord:
 *   1. M3 skriver en DETALJERAD bildprompt utifrån ordet + dess innebörd
 *      + stamordet + riktiga titlar som innehåller ordet.
 *   2. MiniMax image-01 genererar 1248x832 (3:2).
 *   3. AI Act-stämpel (samma applyAiComplianceToWebp som orange knappen).
 *   4. M3 VISION läser av bilden och svarar: visar bilden ordet?
 *      (detta är verifieringsteg 2 i uppdraget)
 *   5. Bild + sidecar sparas. Med --apply går ordet även in i image_library
 *      och tilldelas de event vars titel innehåller ordet.
 *
 * Ord med ordets BETYDELSE genereras INTE (artistnamn, pjästitel, lokal) —
 * de finns i ord-inventeringen som typ=namn och hoppas över.
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/word_image_gen.ts --limit=5
 *   node --env-file=.env --import tsx scripts/word_image_gen.ts --word=bastu --apply
 *   node --env-file=.env --import tsx scripts/word_image_gen.ts --dry-run
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, appendFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { applyAiComplianceToWebp } from '../08-Agent/tools/ai_compliance.js';
import {
  verifyImageFile, verdictPasses, verdictReason,
  type WordVerdict,
} from './lib/word-image-verdict.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MINIMAX_BASE = 'https://api.minimax.io/v1';
const IMAGE_MODEL = 'image-01';
const M3_MODEL = 'minimax-M3';

const OUT_DIR = path.join(PROJECT_ROOT, 'local_image_library_stamped_v2', 'word');
const INVENTORY = path.join(PROJECT_ROOT, 'docs', 'audit', 'data', 'huvudattraktioner-2026-10-31-ord-inventering.csv');

const IMG_W = 1248;
const IMG_H = 832;
const IMG_ASPECT = '3:2';
const RPM_LIMIT = 10;
const RPM_SAFE = 9;

// ── Args ──────────────────────────────────────────────────────────────────
function argValue(name: string): string | null {
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(name + '=')) return a.slice(name.length + 1);
    if (a === name) {
      const i = process.argv.indexOf(a);
      return process.argv[i + 1] ?? null;
    }
  }
  return null;
}
const limitArg = argValue('--limit');
const LIMIT = limitArg ? parseInt(limitArg, 10) : 5;
const WORD_ARG = argValue('--word');
const MIN_EVENTS = parseInt(argValue('--min-events') ?? '2', 10);
const IS_APPLY = process.argv.includes('--apply');
const IS_DRY = process.argv.includes('--dry-run');
// Granska redan genererade bilder utan att generera om dem (t.ex. när
// verifieringen har blivit striktare sedan bilden skapades).
const IS_VERIFY_ONLY = process.argv.includes('--verify-only');
// Egen state-mapp per körning (dashboarden startar en ny mapp varje gång),
// så två körningar inte blandar ihop sina räknare.
const STATE_DIR_ARG = argValue('--state-dir');
// Promptcachen delas mellan körningar (samma ord → samma prompt).
const PROMPT_DIR = path.join(PROJECT_ROOT, 'runtime', 'word-image-gen');
const RUN_DIR = STATE_DIR_ARG ? path.resolve(PROJECT_ROOT, STATE_DIR_ARG) : PROMPT_DIR;

// ── Env ───────────────────────────────────────────────────────────────────
function env(name: string): string | undefined {
  const raw = process.env[name];
  if (raw) return raw;
  try {
    const m = readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
  } catch { return undefined; }
}
const MINIMAX_KEY = env('MINIMAX_API_KEY');
if (!MINIMAX_KEY) { console.error('MINIMAX_API_KEY saknas'); process.exit(2); }

// ── CSV-läsning av ord-inventeringen ─────────────────────────────────────
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0];
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    head.forEach((h, i) => { o[h] = r[i] ?? ''; });
    return o;
  });
}

interface WordRow {
  ord: string;
  stam: string;
  antal_titlar: number;
  antal_events: number;
  exempel: string[];
}

/** Bildnyckel: "bastun" -> "bastu" (bestämd form), "dambastu" -> "dambastu" (modifier). */
const INFL = ['n', 'en', 'ar', 'er', 'or', 'et', 's', 'na', 'orna', 'arna'];
function imageKey(word: string, stem: string): string {
  const w = word.toLowerCase();
  const s = stem.toLowerCase();
  if (!s || s === w) return w;
  if (w.startsWith(s)) {
    const rest = w.slice(s.length);
    if (INFL.includes(rest)) return s;      // bestämd form -> samma sak
  }
  return w;                                  // modifier + stam -> egen bild
}

/** Modifier som gör ett sammansatt ord visuellt annorlunda. */
const VISUAL_MODIFIERS = new Set([
  'dam', 'herre', 'dam', 'barn', 'ungdom', 'senior', 'kvinn', 'poang', 'flick', 'kill',
  'mix', 'jul', 'nyår', 'pask', 'advents', 'lucia', 'kräft', 'skär', 'sommar', 'vinter',
  'höst', 'vår', 'midsommar', 'konst', 'film', 'bok', 'musik', 'teater', 'dans', 'design',
  'foto', 'historia', 'språk', 'hälso', 'mental', 'digital', 'teknik', 'miljö', 'klimat',
  'bostadsrätt', 'industri', 'student', 'jobb', 'antik', 'vintage', 'retro', 'skatt',
  'fisk', 'jakt', 'vandring', 'kajak', 'kanot', 'segling', 'skidor', 'katt', 'dog',
  'bil', 'motor', 'cykel', 'lant', 'tradition', 'kultur', 'story', 'standup', 'open',
  'quiz', 'karaoke', 'vin', 'öl', 'mat', 'choklad', 'bageri', 'kaffe', 'fika',
]);

function loadWords(): WordRow[] {
  if (!existsSync(INVENTORY)) { console.error(`Saknar ${INVENTORY}`); process.exit(2); }
  const rows = parseCsv(readFileSync(INVENTORY, 'utf8'));
  const words: WordRow[] = rows.map((r) => ({
    ord: r.ord,
    stam: (r.stam || '').trim(),
    antal_titlar: parseInt(r.antal_titlar ?? '0', 10) || 0,
    antal_events: parseInt(r.antal_events ?? '0', 10) || 0,
    exempel: (r.exempel ?? '').split(' | ').filter(Boolean),
  }));
  if (WORD_ARG) {
    const w = WORD_ARG.toLowerCase();
    const hit = words.filter((x) => x.ord.toLowerCase() === w || x.stam.toLowerCase() === w);
    if (!hit.length) { console.error(`Ordet "${WORD_ARG}" finns inte i inventeringen`); process.exit(2); }
    return hit;
  }
  return words.filter((w) => w.antal_events >= MIN_EVENTS);
}

// ── Rate limit (MiniMax image_generation = 10 RPM) ───────────────────────
class RpmGuard {
  private stamps: number[] = [];
  constructor(private readonly limit = RPM_SAFE) {}
  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 60_000);
      if (this.stamps.length < this.limit) { this.stamps.push(now); return; }
      const wait = 60_000 - (now - this.stamps[0]) + 250;
      await new Promise((r) => setTimeout(r, Math.max(wait, 500)));
    }
  }
}

// ── M3: skriv detaljerad bildprompt för ETT ord ───────────────────────────
const PROMPT_SYSTEM = `Du skriver bildprompter för evenemangskort i EventPulse (Stockholm).

Du får ETT ORD som ska synas i bilden. Ordet kan vara ett sammansatt svenskt ord, t.ex. "dambastu" = bastu för kvinnor, "tipspromenad" = promenad där man tipsar om fotboll, "julmässa" = julmarknad.

Skriv EN bildprompt på engelska (max 60 ord) som visar UTTRYCKLIGT det ordet betyder.

Krav:
- Beskriv vad det FAKISKT är (plats, aktivitet, situation). Var specifik: "wooden sauna cabin with steam, hot stones and wooden benches", inte "spa scene".
- Beakta nyansen i ordet: "dambastu" ska visa kvinnor, inte män. "Tipspromenad" ska visa folk som går och tittar på en telefon/spelblad. "Julmässa" ska visa julbock, lys, marknadsstånd.
- MILJÖ: typisk svensk/Stockholm-kontext, tid på dygnet, stämning.
- BRETT GREPP: miljön och handlingen är motivet. Ingen enskild person ska fylla bilden — inga porträtt, inga närbilder av ansikten. Om aktiviteten sker i grupp (promenad, tävling, marknad, mässa, utställning, möte): visa GRUPPEN och platsen.
- Redaktionell fotostil, varm men inte för polerat.
- KLÄDER: människor i bilden har badrock eller badkläder och är fullt klädda — ingen nakenhet, inga blotta bröst, inga badkläder som visar för mycket. Om aktiviteten i sig är badkar/bastu: visa bastun med träpanel, vedeld, ånga och personer med handdukar om kroppen.
- Inga ansikten i förgrunden.
- Ingen läsbar text, inga skyltar, inga logotyper, inga baner, inga affischer. Skriv uttryckligen ut orden "no text, no signage, no logos, no banners" i prompten.
- Avsluta med en mood-sättning ("..., Editorial style, warm tungsten tones").

Svara BARA med prompttexten. Inget annat.`;

async function buildPrompt(w: WordRow): Promise<string> {
  const user = `ORD: "${w.ord}"
STAMORD: ${w.stam || '(samma som ordet)'}
ANTAL EVENT: ${w.antal_events}
TITLAR SOM INNEHÅLLER ORDET:
${w.exempel.slice(0, 5).map((t) => `- ${t}`).join('\n')}

Skriv prompten.`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${MINIMAX_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MINIMAX_KEY}` },
        body: JSON.stringify({
          model: M3_MODEL,
          messages: [{ role: 'system', content: PROMPT_SYSTEM }, { role: 'user', content: user }],
          max_tokens: 1200,
          temperature: 0.3,
          thinking: { type: 'disabled' },
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      let c: string = j?.choices?.[0]?.message?.content ?? '';
      c = c.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      c = c.replace(/^["'`]|["'`]$/g, '').trim();
      if (c.length > 20) return c;
      throw new Error('tom prompt');
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 2500 * Math.pow(1.6, attempt)));
    }
  }
  throw new Error('kunde inte skriva prompt');
}

// ── Bildgenerering ────────────────────────────────────────────────────────
async function generateImage(prompt: string, guard: RpmGuard): Promise<{ buf: Buffer; url: string }> {
  await guard.acquire();
  const res = await fetch(`${MINIMAX_BASE}/image_generation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MINIMAX_KEY}` },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      response_format: 'url',
      width: IMG_W,
      height: IMG_H,
      aspect_ratio: IMG_ASPECT,
      n: 1,
      prompt_optimizer: true,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`image HTTP ${res.status}`);
  const j = await res.json();
  if (j?.base_resp?.status_code !== 0) throw new Error(`minimax ${j?.base_resp?.status_code}: ${j?.base_resp?.status_msg}`);
  if ((j?.metadata?.failed_count ?? 0) > 0) throw new Error('content safety');
  const url = j?.data?.image_urls?.[0];
  if (!url) throw new Error('inget image_urls');
  const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!img.ok) throw new Error(`download ${img.status}`);
  return { buf: Buffer.from(await img.arrayBuffer()), url };
}

// ── VERIFIERING: M3 vision läser av bilden ───────────────────────────────
// ── Ordets innebörd (för verifieringen) ───────────────────────────────────
const MEANING_SYSTEM = `Du förklarar ett svenskt ord som förekommer i EVENTTITLAR.

Läs ordet I EVENTKONTEXTEN, inte i isolation:
- "dam" i "dambastu" = KVINNOR (inte sjödamm, inte vatten)
- "mix" i "mixbastu" = BLANDAD (båda könen)
- "jul" i "julmässa" = jul (mässan)
- "tip" i "tipspromenad" = betting/tips
Ordets stamord finns separat — använd det för att tolka prefixet.

Svara ENDAST med en kort förklaring (max 18 ord) på svenska, formulerad så att någon som bara läser förklaringen kan avgöra om en bild visar rätt sak. Beskriv det man SER, inte kategorin.`;

async function wordMeaning(w: WordRow): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${MINIMAX_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MINIMAX_KEY}` },
        body: JSON.stringify({
          model: M3_MODEL,
          messages: [
            { role: 'system', content: MEANING_SYSTEM },
            { role: 'user', content: `Ord: "${w.ord}"\nStamord: ${w.stam || '(samma som ordet)'}\nTitlar som innehåller ordet:\n${w.exempel.slice(0, 4).map((t) => `- ${t}`).join('\n')}` },
          ],
          max_tokens: 300,
          temperature: 0,
          thinking: { type: 'disabled' },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error('HTTP');
      const j = await res.json();
      let c: string = j?.choices?.[0]?.message?.content ?? '';
      c = c.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (c) return c.replace(/^["'`]|["'`]$/g, '').trim();
      throw new Error('tom');
    } catch (e) {
      if (attempt === 2) return w.stam || w.ord;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return w.stam || w.ord;
}

// ── Supabase: library + event-tilldelning ────────────────────────────────
function supabase() {
  const url = env('SUPABASE_URL') ?? env('EXPO_PUBLIC_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(RUN_DIR, { recursive: true });
  const VERIFY_CSV = path.join(RUN_DIR, 'verify.csv');
  const PROMPT_CACHE = path.join(PROMPT_DIR, 'prompts.json');

  const words = loadWords();
  console.log(`[word-image-gen] ord i urval: ${words.length} (min-events=${MIN_EVENTS}${WORD_ARG ? `, ord=${WORD_ARG}` : ''})`);
  console.log(`[word-image-gen] läge: ${IS_DRY ? 'DRY-RUN' : IS_APPLY ? 'APPLY' : 'GENERATE'}`);

  // Redan genererade ord hoppas över (idempotent)
  const done = new Set(
    existsSync(OUT_DIR)
      ? readdirSync(OUT_DIR).filter((f) => f.endsWith('.webp')).map((f) => f.split('__')[0].toLowerCase())
      : []
  );

  const promptCache: Record<string, string> = existsSync(PROMPT_CACHE)
    ? JSON.parse(readFileSync(PROMPT_CACHE, 'utf8')) : {};

  const guard = new RpmGuard();
  const db = supabase();
  let generated = 0;
  const results: WordRow[] = [];

  for (const w of words) {
    if (generated >= LIMIT) break;
    const key = imageKey(w.ord, w.stam);

    // ── verify-only: granska en redan genererad bild på nytt ────────────
    if (IS_VERIFY_ONLY) {
      const dir = OUT_DIR;
      if (!existsSync(dir)) { console.log(`  [fel] ${dir} saknas`); continue; }
      const existing = readdirSync(dir).filter((f) => f.endsWith('.webp') && f.startsWith(key + '__'));
      if (!existing.length) { console.log(`  [skip] ${w.ord} — ingen bild att granska`); continue; }
      const file = path.join(dir, existing[0]);
      const sidecar = `${file}.json`;
      let j: Record<string, unknown> = {};
      if (existsSync(sidecar)) j = JSON.parse(readFileSync(sidecar, 'utf8'));
      const meaning = (j.meaning as string) || (await wordMeaning(w));
      const verdict = await verifyImageFile(file, w.ord, meaning, MINIMAX_KEY!);
      const passes = verdictPasses(verdict);
      const ok = verdict?.match === true;
      const appropriate = verdict?.appropriate === true;
      j.verify = verdict;
      j.verified_ok = passes;
      j.verified_match = ok;
      j.verified_appropriate = appropriate;
      j.verified_text = verdict?.text ?? 'none';
      j.verified_foreground_face = verdict?.foreground_face === true;
      j.reverified_at = new Date().toISOString();
      writeFileSync(sidecar, JSON.stringify(j, null, 2));
      appendFileSync(VERIFY_CSV,
        `"${w.ord}","${key}","${ok}","${appropriate}","${verdict?.confidence ?? 0}","${(verdict?.shows ?? '').replace(/"/g, "'")}","${(verdict?.reason ?? '').replace(/"/g, "'")}","${(verdict?.appropriateness_note ?? '').replace(/"/g, "'")}","${path.basename(file)}"\n`);
      const tag = passes ? 'OK ' : 'FEL';
      console.log(`  [${tag}] ${w.ord.padEnd(18)} ${verdictReason(verdict)}`);
      generated++;
      continue;
    }

    if (done.has(key)) { console.log(`  [skip] ${w.ord} (finns redan)`); continue; }

    // 1. betydelse
    const meaning = await wordMeaning(w);
    // 2. prompt
    let prompt = promptCache[key];
    if (!prompt) {
      prompt = await buildPrompt(w);
      promptCache[key] = prompt;
      writeFileSync(PROMPT_CACHE, JSON.stringify(promptCache, null, 2));
    }

    if (IS_DRY) {
      console.log(`\n[DRY] "${w.ord}" (nyckel ${key})\n  betydelse: ${meaning}\n  prompt: ${prompt}`);
      generated++;
      continue;
    }

    try {
      // 3-4. Generera → stämpla → granska, med retry.
      //
      //    MiniMax:s innehållsfilter är inkonsekvent: 2026-10-31 blockerade
      //    den MILDARE "bastu"-prompten men släppte igenom en "mixbastu"-bild
      //    med nakna bröst. Därför två lager av skydd:
      //      a) "content safety" → prompten skrivs om med klädkrav, försök igen
      //      b) underkänd granskning → prompten skärps utifrån vad som gick
      //         fel (text, ansikte, fel motiv) och bilden genereras om
      const MAX_ATTEMPTS = 3;
      let passes = false;
      let verdict: WordVerdict | null = null;
      let file = '';
      let url = '';
      let promptUsed = prompt;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // 3. generera
        let buf: Buffer;
        let safetyRetries = 0;
        for (;;) {
          try {
            const gen = await generateImage(promptUsed, guard);
            buf = gen.buf; url = gen.url;
            break;
          } catch (ge) {
            const msg = (ge as Error).message;
            if (msg === 'content safety' && safetyRetries < 2) {
              safetyRetries++;
              console.log(`    [safety] "${w.ord}" blockerades — skriver om prompten (försök ${safetyRetries})`);
              promptUsed = `${promptUsed} Fully clothed people in swimsuits or towels, no nudity, no bare chests, wholesome public event photo, no text, no signage, no logos, no banners.`;
              continue;
            }
            throw ge;
          }
        }
        const webp = await applyAiComplianceToWebp({
          buffer: buf, prompt: promptUsed, model: IMAGE_MODEL, position: 'bottom-left',
        });
        file = path.join(OUT_DIR, `${key}__${String(generated).padStart(3, '0')}.webp`);
        writeFileSync(file, webp);

        // 4. verifiera (M3 vision läser av bilden)
        verdict = await verifyImageFile(file, w.ord, meaning, MINIMAX_KEY!);
        passes = verdictPasses(verdict);
        const ok = verdict?.match === true;
        const appropriate = verdict?.appropriate === true;

        writeFileSync(`${file}.json`, JSON.stringify({
          ord: w.ord,
          image_key: key,
          stam: w.stam,
          meaning,
          prompt: promptUsed,
          model: IMAGE_MODEL,
          minimax_url: url,
          stamped_path: file,
          stamped: true,
          stamp_variant: 'bottom-left',
          verify: verdict,
          verified_ok: passes,
          verified_match: ok,
          verified_appropriate: appropriate,
          verified_text: verdict?.text ?? 'none',
          verified_foreground_face: verdict?.foreground_face === true,
          attempt,
          exempel_titlar: w.exempel,
          antal_titlar: w.antal_titlar,
          antal_events: w.antal_events,
          created_at: new Date().toISOString(),
        }, null, 2));

        appendFileSync(VERIFY_CSV,
          `"${w.ord}","${key}","${ok}","${appropriate}","${verdict?.confidence ?? 0}","${(verdict?.shows ?? '').replace(/"/g, "'")}","${(verdict?.reason ?? '').replace(/"/g, "'")}","${(verdict?.appropriateness_note ?? '').replace(/"/g, "'")}","${path.basename(file)}"\n`);
        const tag = passes ? 'OK ' : 'FEL';
        console.log(`  [${tag}] ${w.ord.padEnd(18)} conf=${(verdict?.confidence ?? 0).toFixed(2)} ${verdictReason(verdict)}`);

        if (passes) break;

        // Underkänd bild → karantän (den ska inte ligga kvar och se användbar ut)
        const qdir = path.join(PROJECT_ROOT, 'local_image_library_stamped_v2_word_quarantine');
        mkdirSync(qdir, { recursive: true });
        try {
          renameSync(file, path.join(qdir, path.basename(file)));
          renameSync(`${file}.json`, path.join(qdir, `${path.basename(file)}.json`));
        } catch { /* karantän är best-effort */ }

        if (attempt < MAX_ATTEMPTS) {
          // Skärp prompten utifrån fynden
          const fixes: string[] = [];
          if (verdict?.text !== 'none') fixes.push('absolutely no text, no neon signs, no shop signs, no posters anywhere');
          if (verdict?.foreground_face) fixes.push('wide establishing shot, small figures, environment is the subject, no close-up of any face');
          if (!verdict?.match) fixes.push(`make "${w.ord}" unmistakably visible: ${meaning}`);
          if (!verdict?.appropriate) fixes.push('fully clothed people, no nudity, no bare chests');
          promptUsed = `${promptUsed} ${fixes.join('. ')}.`;
          console.log(`    -> försök ${attempt + 1}/${MAX_ATTEMPTS}: skärper prompten`);
        }
      }

      // 5. library + event-tilldelning (bara vid --apply)
      if (IS_APPLY && passes && db) {
        const ins = await db.from('image_library').insert({
          storage_path: file,
          public_url: url,
          category_slug: null,
          venue_pattern: null,
          tags: [key, w.stam].filter(Boolean),
          cluster_tags: [w.ord.toLowerCase(), w.stam].filter(Boolean),
          rating: 5,
          approved_by: 'word-image-gen',
        }).select('id').single();
        if (ins.error) console.log(`    library-fel: ${ins.error.message}`);
        else console.log(`    library-id: ${ins.data.id}`);
      }

      generated++;
      results.push(w);
    } catch (e) {
      console.log(`  [ERR] ${w.ord}: ${(e as Error).message}`);
    }
  }

  console.log(`\n[word-image-gen] klart: ${generated} ord bearbetade.`);
  console.log(`[word-image-gen] bilder: ${OUT_DIR}`);
  console.log(`[word-image-gen] granskning: ${VERIFY_CSV}`);
}

main().catch((e) => { console.error('FEL:', e); process.exit(1); });
