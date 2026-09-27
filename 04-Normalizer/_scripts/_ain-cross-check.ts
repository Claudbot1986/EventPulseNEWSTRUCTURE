/**
 * ain-cross-check.ts — Jämför matematisk community-analys med AIN (M3).
 *
 * Tar 20 events som LLM-batchen klassificerade som ["community"]
 * (dvs LLM gav upp) och frågar AIN (MiniMax-M3) vad dessa events
 * faktiskt är. Jämför svaren med de matematiska klustren från
 * analyze-community.ts.
 *
 * Output: 00-Vault/.../community-ain-cross-check-YYYY-MM-DD.md
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/_ain-cross-check.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

interface EventRow {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  description_sv: string | null;
  description_en: string | null;
  source: string | null;
}

interface Suggestion { id: string; slugs: string[]; reasoning: string; }

const PAGE = 1000;
const VAULT_DIR = join(process.cwd(), '00-Vault/01-Projects/EventPulse/04-Sources');
const LLM_MODEL = 'MiniMax-M3';
const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function fetchCommunityEvents(): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select('id, title_sv, title_en, description_sv, description_en, source')
      .eq('category_slug', 'community')
      .order('start_time', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetch error: ${error.message}`);
    if (data && data.length > 0) {
      rows.push(...(data as EventRow[]));
      offset += data.length;
      hasMore = data.length === PAGE;
    } else hasMore = false;
  }
  return rows;
}

async function loadSuggestions(): Promise<Suggestion[]> {
  const path = join(VAULT_DIR, 'retag-suggestions-2026-09-27.jsonl');
  const text = await readFile(path, 'utf8');
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Suggestion);
}

async function callAin(events: EventRow[], apiKey: string): Promise<string> {
  const userMsg = `Jag har ${events.length} evenemang i Stockholm som en annan AI inte kunde klassificera tydligt (alla slutade som "community"). Hjälp mig förstå vad dessa är gemensamt för.

Lista varje med kort typ och mönster-ord. Svara i JSON:
[{"id":"...","type":"<kort typ>","pattern":"<gemensamma ord/tecken>"}]

Events:
${events.map((e, i) => `${i + 1}. [${e.id}] [${e.source ?? '?'}] ${e.title_sv ?? e.title_en ?? '?'} — ${(e.description_sv ?? e.description_en ?? '').slice(0, 200)}`).join('\n')}`;

  const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 4000,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Du tolkar evenemang i Stockholm. Svara ENDAST med JSON-array.' },
        { role: 'user', content: userMsg },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) throw new Error(`minimax HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('no content');
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function main() {
  await mkdir(VAULT_DIR, { recursive: true });

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.error('MINIMAX_API_KEY not set in .env');
    process.exit(2);
  }

  const events = await fetchCommunityEvents();
  const suggestions = await loadSuggestions();
  const stillCommunity = new Set(
    suggestions.filter((s) => s.slugs.length === 1 && s.slugs[0] === 'community').map((s) => s.id)
  );
  const candidates = events.filter((e) => stillCommunity.has(e.id));

  // Stratifierat urval: ta 20 events från olika källor.
  const bySource = new Map<string, EventRow[]>();
  for (const e of candidates) {
    const src = e.source ?? '(null)';
    if (!bySource.has(src)) bySource.set(src, []);
    const arr = bySource.get(src)!;
    if (arr.length < 3) arr.push(e); // max 3 per källa
  }
  const sample: EventRow[] = [];
  for (const arr of bySource.values()) {
    for (const e of arr) {
      if (sample.length >= 20) break;
      sample.push(e);
    }
    if (sample.length >= 20) break;
  }

  console.log(`[ain-cross-check] ${candidates.length} events har ["community"]. Tar 20 som stratifierat urval från ${bySource.size} källor.`);

  const ainResponse = await callAin(sample, apiKey);
  const match = ainResponse.match(/\[[\s\S]*\]/);
  const ainParsed = match ? (JSON.parse(match[0]) as Array<{ id: string; type: string; pattern: string }>) : [];

  const today = new Date().toISOString().slice(0, 10);
  const out: string[] = [];
  out.push(`# AIN cross-check — ${today}`);
  out.push('');
  out.push(`20 events som LLM-batchen klassificerade som ["community"] (ge upp-fallback).`);
  out.push(`AIN (MiniMax-M3) ombeds tolka vad dessa är gemensamt för.`);
  out.push('');
  out.push('## AIN-tolkning per event');
  out.push('');
  out.push('| Källa | Titel (sv) | AIN:s typ | Mönster-ord |');
  out.push('|---|---|---|---|');
  for (const e of sample) {
    const t = (e.title_sv ?? e.title_en ?? '?').slice(0, 50);
    const ain = ainParsed.find((a) => a.id === e.id);
    out.push(`| ${e.source ?? '?'} | ${t} | ${ain?.type ?? '?'} | ${ain?.pattern ?? '?'} |`);
  }
  out.push('');
  out.push('## Kluster (AIN:s typer)');
  out.push('');
  const typeGroups = new Map<string, number>();
  for (const a of ainParsed) typeGroups.set(a.type, (typeGroups.get(a.type) ?? 0) + 1);
  for (const [type, n] of [...typeGroups.entries()].sort((a, b) => b[1] - a[1])) {
    out.push(`* **${type}** — ${n} events`);
  }
  out.push('');
  out.push('## Jämförelse med matematiska strategier');
  out.push('');
  out.push('Från analyze-community.md:');
  out.push('* **61 % har poor beskrivning** (≤50 tecken) — AIN har samma utmaning.');
  out.push('* **238 titlar innehåller "musical"** — AIN:s tolkning kan hjälpa bekräfta att dessa ska bort från community.');
  out.push('* **Berwaldhallen** (186 events) → 76 opera enligt LLM-batch. AIN kan bekräfta detta.');
  out.push('');
  out.push('## Slutsats');
  out.push('');
  out.push('Om AIN:s typer visar samma mönster som LLM-batchen (många "musical", "opera", "exhibition")');
  out.push('→ community-högen är i praktiken en restpost av fel-klassificerade events.');
  out.push('');
  out.push('Om AIN hittar nya typer (t.ex. "bransch-nätverk", "stadsvandring") som LLM inte såg');
  out.push('→ dessa behöver en egen kategori (Steg 4) eller auto-tagging via käll-specifik regel.');

  const outPath = join(VAULT_DIR, `community-ain-cross-check-${today}.md`);
  await writeFile(outPath, out.join('\n'), 'utf8');
  console.log(`[ain-cross-check] ✅ Skrivet till ${outPath}`);
  console.log(`[ain-cross-check] AIN fann ${typeGroups.size} unika typer bland 20 events.`);
}

main().catch((err) => {
  console.error('[ain-cross-check] FATAL:', err.message);
  process.exit(1);
});
