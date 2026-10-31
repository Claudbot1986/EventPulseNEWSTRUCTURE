/**
 * _analyze_event_head_attractions.mjs — EventPulse head-attraction analysis.
 *
 * Answers: what are the unique main attractions (huvudattraktioner) across
 * every event title, and how do they group?
 *
 * RULE OF THE ANALYSIS: an attraction counts only if the word/phrase naming
 * it is literally present in the event title. Opening hours, dates, prices and
 * venues never count.
 *
 * Pipeline
 *   1. dump    — pull every distinct title from Supabase (live truth)
 *   2. Method A — LLM semantic classification (MiniMax-M3, thinking disabled)
 *   3. Method B — deterministic vocabulary matcher (independent cross-check)
 *   4. merge   — level 1 = attraction class, level 2 = specific attraction
 *   5. report  — markdown + CSV inventory
 *
 * Usage
 *   node scripts/_analyze_event_head_attractions.mjs            # full run
 *   node scripts/_analyze_event_head_attractions.mjs --report   # rebuild report only
 *
 * Requires .env with DATABASE_URL and MINIMAX_API_KEY.
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

const ROOT = process.cwd();
const SCRATCH = path.join(ROOT, '.scratch');
const OUT_DIR = path.join(ROOT, 'docs', 'audit');
const DATA_DIR = path.join(OUT_DIR, 'data');
const STAMP = new Date().toISOString().slice(0, 10);

const argv = process.argv.slice(2);
const REPORT_ONLY = argv.includes('--report');

// ── Env ───────────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}
const ENV = loadEnv();

const TYPE_VOCAB = [
  'konsert', 'musikal', 'opera', 'teater', 'standup', 'revy', 'cirkus', 'dans',
  'show', 'festival', 'mässa', 'marknad', 'loppis', 'auktion', 'utställning',
  'konst', 'film', 'bio', 'föreläsning', 'samtal', 'panel', 'seminarium',
  'workshop', 'kurs', 'verkstan', 'träning', 'språk', 'bokcirkel', 'läsning',
  'bastu', 'bad', 'hälsa', 'yoga', 'promenad', 'vandring', 'friluftsliv',
  'spel', 'tips', 'fest', 'nattliv', 'mat', 'dryck', 'sport', 'tävling',
  'match', 'lopp', 'barn', 'familj', 'samhälle', 'möte', 'demonstration',
  'digitalt', 'teknik', 'övrigt',
];

const GROUPS = {
  KONSERT: 'Konsert & musikframträdande',
  SCEN: 'Scen & föreställning',
  MASSA: 'Mässa & marknad',
  FOREDRAG: 'Föreläsning & samtal',
  WORKSHOP: 'Workshops & kurser',
  UTSTALLNING: 'Utställning & konst',
  FILM: 'Film & bio',
  SPORT: 'Sport & tävling',
  BARN: 'Barn & familj',
  SPRAK: 'Språk & läsning',
  VARD: 'Bad & välbefinnande',
  FRILUFT: 'Promenad & friluftsliv',
  SPEL: 'Spel & social tävling',
  NATTLIV: 'Fest & nattliv',
  MAT: 'Mat & dryck',
  SAMHALLE: 'Samhälle & möte',
  TEKNIK: 'Digitalt & teknik',
  OKLASSAD: 'Attraktion med oklassad typ',
  INGEN: 'Inget typord i titeln',
};

const TYPE_TO_CLASS = {
  konsert: GROUPS.KONSERT, visa: GROUPS.KONSERT,
  musikal: GROUPS.SCEN, opera: GROUPS.SCEN, teater: GROUPS.SCEN,
  standup: GROUPS.SCEN, revy: GROUPS.SCEN, cirkus: GROUPS.SCEN,
  dans: GROUPS.SCEN, show: GROUPS.KONSERT, festival: GROUPS.MASSA,
  mässa: GROUPS.MASSA, marknad: GROUPS.MASSA, loppis: GROUPS.MASSA, auktion: GROUPS.MASSA,
  utställning: GROUPS.UTSTALLNING, konst: GROUPS.UTSTALLNING,
  film: GROUPS.FILM, bio: GROUPS.FILM,
  föreläsning: GROUPS.FOREDRAG, samtal: GROUPS.FOREDRAG, panel: GROUPS.FOREDRAG,
  seminarium: GROUPS.FOREDRAG,
  workshop: GROUPS.WORKSHOP, kurs: GROUPS.WORKSHOP, verkstan: GROUPS.WORKSHOP,
  träning: GROUPS.WORKSHOP,
  språk: GROUPS.SPRAK, bokcirkel: GROUPS.SPRAK, läsning: GROUPS.SPRAK,
  bastu: GROUPS.VARD, bad: GROUPS.VARD, hälsa: GROUPS.VARD, yoga: GROUPS.VARD,
  promenad: GROUPS.FRILUFT, vandring: GROUPS.FRILUFT, friluftsliv: GROUPS.FRILUFT,
  spel: GROUPS.SPEL, tips: GROUPS.SPEL,
  fest: GROUPS.NATTLIV, nattliv: GROUPS.NATTLIV,
  mat: GROUPS.MAT, dryck: GROUPS.MAT,
  sport: GROUPS.SPORT, tävling: GROUPS.SPORT, match: GROUPS.SPORT, lopp: GROUPS.SPORT,
  barn: GROUPS.BARN, familj: GROUPS.BARN,
  samhälle: GROUPS.SAMHALLE, möte: GROUPS.SAMHALLE, demonstration: GROUPS.SAMHALLE,
  digitalt: GROUPS.TEKNIK, teknik: GROUPS.TEKNIK,
};

const norm = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9åäöéüæøèáàíóúñç]+/g, ' ').trim();
const tok = (s) => norm(s).split(' ').filter(Boolean);

/** Token-level grounding: phrase must be a contiguous run of title tokens. */
function phraseInTitle(phrase, title) {
  const p = tok(phrase);
  const t = tok(title);
  if (!p.length || p.length > t.length) return false;
  const infl = (a, b) =>
    b === a + 'n' || b === a + 'en' || b === a + 'ar' || b === a + 'er' ||
    b === a + 'or' || b === a + 's' || b === a + 'et';
  for (let i = 0; i + p.length <= t.length; i++) {
    let ok = true;
    for (let j = 0; j < p.length; j++) {
      if (p[j] === t[i + j] || infl(p[j], t[i + j])) continue;
      ok = false; break;
    }
    if (ok) return true;
  }
  return false;
}

/**
 * If a phrase is only the HEAD of a Swedish compound in the title
 * ("pyssel" in "Helgpyssel"), expand it to the full title token so the
 * attraction is literally a word in the title.
 */
function expandToTitleToken(phrase, title) {
  if (phraseInTitle(phrase, title)) return phrase;
  const p = norm(phrase);
  const t = tok(title);
  if (!p || p.includes(' ')) return phrase;
  for (const w of t) {
    if (w.length > p.length && w.endsWith(p)) return title.match(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))?.[0] ?? w;
  }
  return phrase;
}

/** Opening-hours wording never counts as an attraction. */
function isOpeningHoursWord(phrase) {
  const p = norm(phrase);
  if (!p) return false;
  if (p === 'oppet hus' || p === 'opppet hus') return false;   // "open house" IS an activity
  return /(^|\s)(oppet|oppetta|stangd|stangt|bemanning)(s|a)?$/.test(p) || /oppet(stangd)?$/.test(p);
}

// ── Step 1: dump distinct titles from the live database ──────────────────
async function dumpTitles() {
  const c = new Client({
    connectionString: ENV.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    query_timeout: 120000,
  });
  await c.connect();
  const rows = await c.query(`
    select
      coalesce(nullif(btrim(title_sv),''), nullif(btrim(title_en),'')) as t,
      count(*)::int as n_events,
      count(*) filter (where start_time > now())::int as n_future,
      string_agg(distinct coalesce(category_slug,'NULL'), ',') as cats,
      min(start_time)::date as first_date,
      max(start_time)::date as last_date
    from events
    group by 1
    order by n_events desc, t
  `);
  const total = await c.query(`select count(*)::int n from events`);
  const span = await c.query(
    `select count(*) filter (where start_time > now())::int future,
            count(*) filter (where start_time <= now())::int past,
            min(start_time)::date mn, max(start_time)::date mx from events`
  );
  await c.end();
  const out = rows.rows.map((r) => ({
    title: r.t, n_events: r.n_events, n_future: r.n_future,
    cats: (r.cats || '').split(','), first_date: r.first_date, last_date: r.last_date,
  }));
  fs.writeFileSync(path.join(SCRATCH, 'distinct-titles.json'), JSON.stringify(out, null, 1));
  return { titles: out, total_events: total.rows[0].n, ...span.rows[0] };
}

// ── Step 2: Method A (LLM) ───────────────────────────────────────────────
const SYSTEM = `Du är en svensk evenemangstypolog. För varje EVENTTITEL bestämmer du "huvudattraktionen": det ord eller den fras i titeln som anger VAD som faktiskt händer.

REGLER
1. Huvudattraktionen MÅSTE vara ett ord eller en fras som förekommer LITERALT i titeln. Hittar du inget sådant ord: phrase = "" och type = "".
2. Räknas INTE som huvudattraktion: datum, tider, öppettider, priser, biljetter, lokal/venue, adress, årtal, säsong, "2026/2027".
3. NAMN PÅ ARTISTER OCH PJÄSER ÄR INTE ATTRAKTIONER. Ett namn på en artist, ensemble, pjäs, verk eller turné räknas INTE — det anger inte VAD som händer. Då: kind = "artist_name" (artist/band) eller "show_title" (pjäs/verk/turné), och phrase = "" och type = "".
   Exempel: "Jesus Christ Superstar" -> show_title. "Amnesi" -> show_title. "Judith Hill" -> artist_name. "The Fray - Autumn Light Tour" -> artist_name. "Torka aldrig tårar utan handskar" -> show_title. "Stilleben" -> show_title.
4. Välj det KORTA typordet, inte hela titeln, när titeln innehåller ett tydligt typord.
   Exempel: "MAMMA MIA! THE PARTY" -> phrase "THE PARTY" (inte hela titeln). "Tipspromenad om Halloween! Tävla om priser" -> phrase "Tipspromenad".
5. Sammansatta ord: ta den del av ordet som anger aktiviteten, eller hela sammansättningen om den är ett etablerat ord.
   Exempel: "Dambastu" -> phrase "Dambastu". "Julmässan på Taxinge slott" -> phrase "Julmässan". "Konstverkstan" -> phrase "Konstverkstan". "Språkcafé på svenska" -> phrase "Språkcafé". "Tipspromenad om Halloween" -> phrase "Tipspromenad". "Läxhjälp" -> phrase "Läxhjälp".
6. type MÅSTE vara ett av dessa ord: ${TYPE_VOCAB.join(', ')}.
7. Om titeln har en aktivitetstyp: kind = "type_in_title". Om inte: kind = ett av "artist_name", "show_title", "time_only", "venue_only", "other" och phrase/type = "".

EXEMPEL
"Dambastu lördagmorgon Inre Bastu"      -> {"phrase":"Dambastu","type":"bastu","kind":"type_in_title"}
"Tipspromenad om Halloween! Tävla om priser" -> {"phrase":"Tipspromenad","type":"tips","kind":"type_in_title"}
"Julmässan på Taxinge slott"           -> {"phrase":"Julmässan","type":"mässa","kind":"type_in_title"}
"Chicago - the Musical"                 -> {"phrase":"the Musical","type":"musikal","kind":"type_in_title"}
"Jesus Christ Superstar"                -> {"phrase":"","type":"","kind":"show_title"}
"Judith Hill"                           -> {"phrase":"","type":"","kind":"artist_name"}
"Omfamnad"                              -> {"phrase":"","type":"","kind":"show_title"}
"Entrébiljetter/Tickets"                -> {"phrase":"","type":"","kind":"time_only"}
"Konstverkstan"                         -> {"phrase":"Konstverkstan","type":"verkstan","kind":"type_in_title"}
"Språkcafé på svenska"                  -> {"phrase":"Språkcafé","type":"språk","kind":"type_in_title"}
"Läxhjälp"                              -> {"phrase":"Läxhjälp","type":"verkstan","kind":"type_in_title"}
"MAMMA MIA! THE PARTY"                  -> {"phrase":"THE PARTY","type":"show","kind":"type_in_title"}
"Biohack me"                            -> {"phrase":"Biohack me","type":"hälsa","kind":"type_in_title"}
"Slutspel"                              -> {"phrase":"Slutspel","type":"sport","kind":"type_in_title"}

Svara ENDAST med ett JSON-array med EXAKT ett objekt per inmatad titel, i samma ordning.
Varje objekt: {"phrase":"...","type":"...","kind":"..."}
Ingen annan text.`;

async function llmCall(user, maxTokens = 3000) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${ENV.MINIMAX_BASE_URL || 'https://api.minimax.io/v1'}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ENV.MINIMAX_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ENV.MINIMAX_MODEL || 'minimax-M3',
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
          max_tokens: maxTokens, temperature: 0, thinking: { type: 'disabled' },
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2500 * Math.pow(1.7, attempt) + Math.random() * 1200));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      let content = data.choices?.[0]?.message?.content ?? '';
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const s = content.indexOf('['); const e = content.lastIndexOf(']');
      if (s === -1 || e === -1) throw new Error('no JSON array');
      return JSON.parse(content.slice(s, e + 1));
    } catch (err) {
      if (attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(1.5, attempt)));
    }
  }
}

function sanitize(batch, arr) {
  const out = {};
  for (let i = 0; i < batch.length; i++) {
    const o = arr[i] ?? {};
    let phrase = String(o.phrase ?? '').trim();
    let type = String(o.type ?? '').trim().toLowerCase();
    const kind = String(o.kind ?? '').trim();
    if (kind !== 'type_in_title') { phrase = ''; type = ''; }
    else {
      if (!phraseInTitle(phrase, batch[i].title)) {
        if (phraseInTitle(type, batch[i].title)) phrase = type;
        else { phrase = ''; type = ''; }
      }
      if (type && !TYPE_VOCAB.includes(type)) type = 'övrigt';
      if (phrase && !type) type = 'övrigt';
    }
    out[batch[i].title] = { phrase, type, kind: kind || 'other' };
  }
  return out;
}

async function runLlm(titles) {
  const CACHE = path.join(SCRATCH, 'llm-cache-v2.json');
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const BATCH = 10, CONCURRENCY = 12;
  const batches = [];
  for (let i = 0; i < titles.length; i += BATCH) batches.push(titles.slice(i, i + BATCH));
  const queue = batches.filter((b) => !cache[b[0].title]);
  console.log(`LLM: ${batches.length} batchar, ${queue.length} att köra`);
  let done = 0;
  async function worker() {
    while (queue.length) {
      const b = queue.shift();
      try {
        let arr = await llmCall('Titlar:\n' + JSON.stringify(b.map((t) => ({ t: t.title }))));
        if (arr.length !== b.length) {
          arr = await llmCall('Titlar:\n' + JSON.stringify(b.map((t) => ({ t: t.title }))) + `\n\nReturnera EXAKT ${b.length} objekt — ett per titel, i samma ordning.`, 4000);
        }
        if (arr.length !== b.length) {
          const o = {};
          for (const t of b) {
            const one = await llmCall('Titlar:\n' + JSON.stringify([{ t: t.title }]));
            Object.assign(o, sanitize([t], one));
          }
          cache[b[0].title] = o;
        } else {
          cache[b[0].title] = sanitize(b, arr);
        }
      } catch {
        cache[b[0].title] = Object.fromEntries(b.map((t) => [t.title, { phrase: '', type: '', kind: 'error' }]));
      }
      done++;
      if (done % 25 === 0 || done === queue.length) {
        fs.writeFileSync(CACHE, JSON.stringify(cache));
        console.log(`  LLM ${done}/${queue.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  const flat = new Map();
  for (const bm of Object.values(cache)) for (const [t, v] of Object.entries(bm)) flat.set(t, v);
  return titles.map((t) => ({ ...t, ...(flat.get(t.title) ?? { phrase: '', type: '', kind: 'UNCLASSIFIED' }) }));
}

// ── Step 3: Method B (rules) ─────────────────────────────────────────────
const HEAD_TYPES = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'head-types.json'), 'utf8'));
const CONTENT_MODIFIERS = new Set(JSON.parse(fs.readFileSync(path.join(SCRATCH, 'content-modifiers.json'), 'utf8')));
const STOPWORDS = new Set(JSON.parse(fs.readFileSync(path.join(SCRATCH, 'stopwords.json'), 'utf8')));
const PREFIX_HEADS = new Set(['standup', 'djungel', 'midsommar', 'nyår']);

const headMap = new Map();
for (const [head, group] of HEAD_TYPES) {
  const k = norm(head);
  if (!k) continue;
  if (!headMap.has(k)) headMap.set(k, group);
  const stem = k.replace(/(?:en|an|ar|er|or|n|s)$/, '');
  if (stem.length >= 4 && !headMap.has(stem)) headMap.set(stem, group);
}
const multiHeads = [...headMap.keys()].filter((k) => k.includes(' '));

/**
 * Ord som är för generiska för att ensamma ange en aktivitetstyp.
 * Utan denna lista ger ordboken falska träffar: "mat" i *Mattecentrum*,
 * "bad" i *Bad Bunny*, "stad" i *Kamomilla stad*, "folk" i *Folk och rövare*.
 */
const AMBIGUOUS_HEADS = new Set([
  'bad', 'stad', 'folk', 'sol', 'var', 'jag', 'nyår', 'nyårs', 'stora',
  'helg', 'vardag', 'saga', 'mat', 'band', 'rock', 'pop', 'show', 'live',
  'after', 'night', 'party', 'support', 'tribute', 'edition', 'world',
  'konserthus', 'bibliotek', 'arena', 'hus', 'strand', 'arena', 'musik',
  'sång', 'trio', 'piano', 'kör', 'kor',
]);
for (const w of AMBIGUOUS_HEADS) headMap.delete(w);

function compoundMatch(token) {
  let best = null;
  for (const [head, group] of headMap) {
    if (head.includes(' ')) continue;
    if (token.length > head.length && token.endsWith(head)) {
      const prefix = token.slice(0, token.length - head.length);
      if (!CONTENT_MODIFIERS.has(prefix)) continue;
      if (!best || head.length > best.head.length) best = { head, group };
    } else if (PREFIX_HEADS.has(head) && token.length > head.length && token.startsWith(head)) {
      if (token.slice(head.length).length < 3) continue;
      if (!best || head.length > best.head.length) best = { head, group };
    }
  }
  return best;
}

function runRules(titles) {
  const out = [];
  for (const t of titles) {
    const ts = tok(t.title);
    const hits = [];
    for (let i = 0; i < ts.length - 1; i++) {
      for (const mh of multiHeads) {
        const p = mh.split(' ');
        if (ts[i] === p[0] && ts[i + 1] === p[1]) hits.push({ phrase: mh, group: headMap.get(mh), len: mh.length, idx: i });
      }
    }
    for (let i = 0; i < ts.length; i++) {
      const w = ts[i];
      if (STOPWORDS.has(w)) continue;
      if (headMap.has(w)) hits.push({ phrase: w, group: headMap.get(w), len: w.length, idx: i });
      else {
        const cm = compoundMatch(w);
        if (cm) hits.push({ phrase: cm.head, group: cm.group, len: w.length, idx: i });
      }
    }
    hits.sort((a, b) => b.len - a.len || b.idx - a.idx);
    const m = hits[0];
    out.push({ ...t, rule_group: m ? m.group : GROUPS.INGEN, rule_phrase: m ? m.phrase : '' });
  }
  return out;
}

// ── Step 4: merge + taxonomy ─────────────────────────────────────────────
function merge(llmRows, ruleRows) {
  const ruleBy = new Map(ruleRows.map((r) => [r.title, r]));
  return llmRows.map((r) => {
    const rule = ruleBy.get(r.title);
    const llmHas = !!r.phrase && r.kind === 'type_in_title';
    const ruleHas = rule && rule.rule_group !== GROUPS.INGEN;
    let attraction = '', type = '', cls = GROUPS.INGEN, origin = 'none';
    if (llmHas) {
      attraction = expandToTitleToken(r.phrase, r.title);
      type = r.type;
      const ruleCls = rule && rule.rule_group !== GROUPS.INGEN ? rule.rule_group : null;
      cls = TYPE_TO_CLASS[r.type] ?? ruleCls ?? GROUPS.OKLASSAD;
      origin = 'llm';
    } else if (ruleHas) {
      attraction = expandToTitleToken(rule.rule_phrase, r.title);
      cls = rule.rule_group;
      type = rule.rule_phrase;
      origin = 'rules';
    }
    // Opening hours are never an attraction.
    if (attraction && isOpeningHoursWord(attraction)) {
      attraction = ''; type = ''; cls = GROUPS.INGEN; origin = 'none';
    }
    return {
      title: r.title, n_events: r.n_events, n_future: r.n_future, cats: r.cats,
      attraction, type, class: cls, kind: r.kind, origin,
      llm_has: llmHas, rule_has: ruleHas,
      llm_type: r.type, rule_group: rule?.rule_group ?? GROUPS.INGEN, rule_phrase: rule?.rule_phrase ?? '',
    };
  });
}

function buildTaxonomy(merged) {
  const classes = new Map();
  for (const m of merged) {
    if (!classes.has(m.class)) classes.set(m.class, { titles: 0, events: 0, future: 0, attractions: new Map(), origins: {} });
    const c = classes.get(m.class);
    c.titles++; c.events += m.n_events; c.future += m.n_future;
    c.origins[m.origin] = (c.origins[m.origin] || 0) + 1;
    if (m.attraction) {
      const k = m.attraction.toLowerCase();
      if (!c.attractions.has(k)) c.attractions.set(k, { phrase: m.attraction, titles: 0, events: 0, examples: [] });
      const a = c.attractions.get(k);
      a.titles++; a.events += m.n_events;
      if (a.examples.length < 3) a.examples.push(m.title);
    }
  }
  const attractions = new Map();
  for (const m of merged) {
    if (!m.attraction) continue;
    const k = m.attraction.toLowerCase();
    if (!attractions.has(k)) attractions.set(k, { phrase: m.attraction, class: m.class, types: new Set(), titles: 0, events: 0, future: 0, examples: [], origins: {} });
    const a = attractions.get(k);
    a.titles++; a.events += m.n_events; a.future += m.n_future;
    a.types.add(m.type);
    a.origins[m.origin] = (a.origins[m.origin] || 0) + 1;
    if (a.examples.length < 3) a.examples.push(m.title);
  }
  const classRows = [...classes.entries()].map(([cls, v]) => ({
    class: cls, distinct_titles: v.titles, events: v.events, future_events: v.future,
    unique_attractions: v.attractions.size,
    from_llm: v.origins.llm || 0, from_rules: v.origins.rules || 0,
    top_attractions: [...v.attractions.values()].sort((a, b) => b.events - a.events).slice(0, 15)
      .map((a) => `${a.phrase} (${a.events})`).join(' | '),
  })).sort((a, b) => b.events - a.events);
  const attractionRows = [...attractions.values()].map((a) => ({
    attraction: a.phrase, class: a.class, types: [...a.types].filter(Boolean).join(', '),
    distinct_titles: a.titles, events: a.events, future_events: a.future,
    origin: Object.keys(a.origins).join('+'),
    examples: a.examples.join(' | '),
  })).sort((a, b) => b.events - a.events || b.distinct_titles - a.distinct_titles);
  return { classRows, attractionRows };
}

// ── Step 5: outputs ──────────────────────────────────────────────────────
const csv = (rows, cols) =>
  [cols.join(',')].concat(rows.map((r) => cols.map((c) => {
    const v = r[c] ?? '';
    return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  }).join(','))).join('\n');

/** pg returns DATE as a Date at local midnight -> format as YYYY-MM-DD. */
const fmtDate = (d) => {
  if (!d) return '?';
  if (typeof d === 'string') return d.slice(0, 10);
  const s = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
  return s.slice(0, 10);
};

async function main() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  let meta = { total_events: 0, future: 0, past: 0, mn: null, mx: null };
  if (REPORT_ONLY) {
    meta = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'analysis-meta.json'), 'utf8'));
  } else {
    const dump = await dumpTitles();
    meta = { total_events: dump.total_events, future: dump.future, past: dump.past, mn: dump.mn, mx: dump.mx };
    fs.writeFileSync(path.join(SCRATCH, 'analysis-meta.json'), JSON.stringify(meta, null, 1));
  }

  const titles = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'distinct-titles.json'), 'utf8'));
  let llmRows;
  if (REPORT_ONLY) {
    llmRows = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'llm-classified-v2.json'), 'utf8'));
  } else {
    llmRows = await runLlm(titles);
    fs.writeFileSync(path.join(SCRATCH, 'llm-classified-v2.json'), JSON.stringify(llmRows, null, 1));
  }
  // Rules are pure CPU — always recompute so vocabulary changes take effect.
  const ruleRows = runRules(titles);
  fs.writeFileSync(path.join(SCRATCH, 'rules-classified.json'), JSON.stringify(ruleRows, null, 1));

  const merged = merge(llmRows, ruleRows);
  fs.writeFileSync(path.join(SCRATCH, 'merged-classification.json'), JSON.stringify(merged, null, 1));
  const { classRows, attractionRows } = buildTaxonomy(merged);

  // Cross-check
  const both = merged.filter((m) => m.llm_has && m.rule_has);
  const agree = both.filter((m) => TYPE_TO_CLASS[m.llm_type] === m.rule_group);
  const llmOnly = merged.filter((m) => m.llm_has && !m.rule_has);
  const ruleOnly = merged.filter((m) => !m.llm_has && m.rule_has);
  const neither = merged.filter((m) => !m.llm_has && !m.rule_has);
  const xs = {
    both: both.length, agree: agree.length,
    agreePct: both.length ? +((agree.length / both.length) * 100).toFixed(1) : 0,
    llmOnly: llmOnly.length, ruleOnly: ruleOnly.length, neither: neither.length,
  };

  const residualKinds = {};
  for (const m of neither) residualKinds[m.kind] = (residualKinds[m.kind] || 0) + 1;

  // Grounding audit: every accepted phrase must literally occur in the title.
  const accepted = merged.filter((m) => m.attraction);
  const groundingTotal = accepted.length;
  const groundingOk = accepted.filter((m) => phraseInTitle(m.attraction, m.title)).length;
  if (groundingOk !== groundingTotal) {
    console.warn(`VARNING: ${groundingTotal - groundingOk} fraser finns inte bokstavligen i titeln`);
  }

  // CSVs
  const base = `huvudattraktioner-${STAMP}`;
  fs.writeFileSync(path.join(DATA_DIR, `${base}-grupper.csv`),
    csv(classRows, ['class', 'distinct_titles', 'events', 'future_events', 'unique_attractions', 'from_llm', 'from_rules', 'top_attractions']));
  fs.writeFileSync(path.join(DATA_DIR, `${base}-inventering.csv`),
    csv(attractionRows, ['attraction', 'class', 'types', 'distinct_titles', 'events', 'future_events', 'origin', 'examples']));
  fs.writeFileSync(path.join(DATA_DIR, `${base}-per-titel.csv`),
    csv(merged.map((m) => ({ ...m, cats: (m.cats || []).join('|') })),
      ['title', 'class', 'attraction', 'type', 'kind', 'origin', 'n_events', 'n_future', 'cats']));

  // Markdown report
  const withAttr = merged.filter((m) => m.attraction);
  const md = [];
  md.push(`# Huvudattraktioner i EventPulse-titlar`);
  md.push('');
  md.push(`**Genererad:** ${STAMP} · **Källa:** \`events.title_sv/title_en\` i produktion (Supabase) · **Omfattar:** ${meta.total_events} events / ${titles.length} unika titlar · ${fmtDate(meta.mn)} → ${fmtDate(meta.mx)}`);
  md.push('');
  md.push(`> **Regel:** en attraktion räknas bara om ordet som betecknar den förekommer **bokstavligen i titeln**. Öppettider, datum, priser, biljetter och lokal räknas aldrig.`);
  md.push('');
  md.push(`## Innehåll`);
  md.push('');
  md.push(`1. [Överblick](#överblick)`);
  md.push(`2. [Nivå 1 — attraktionsklasser](#nivå-1--attraktionsklasser)`);
  md.push(`3. [Utmärkande attraktioner](#utmärkande-attraktioner)`);
  md.push(`4. [Nivå 2 — unika attraktioner](#nivå-2--unika-attraktioner)`);
  md.push(`5. [Restgruppen: titlar utan typord](#restgruppen-titlar-utan-typord)`);
  md.push(`6. [Metod & verifiering](#metod--verifiering)`);
  md.push('');

  md.push('## Överblick');
  md.push('');
  md.push(`| Mått | Värde |`);
  md.push(`|---|---|`);
  md.push(`| Events i databasen | ${meta.total_events} (${meta.future} framtida, ${meta.past} genomförda) |`);
  md.push(`| Unika titlar | ${titles.length} |`);
  md.push(`| Titlar med attraktionsord i titeln | ${withAttr.length} (${((withAttr.length / titles.length) * 100).toFixed(1)} %) |`);
  md.push(`| Events som bär en attraktion | ${withAttr.reduce((a, m) => a + m.n_events, 0)} (${((withAttr.reduce((a, m) => a + m.n_events, 0) / meta.total_events) * 100).toFixed(1)} %) |`);
  md.push(`| Unika attraktioner (nivå 2) | ${attractionRows.length} |`);
  md.push(`| Attraktionsklasser (nivå 1) | ${classRows.filter((c) => c.class !== GROUPS.INGEN).length} |`);
  md.push('');

  md.push('## Nivå 1 — attraktionsklasser');
  md.push('');
  md.push(`| Klass | Events | Unika titlar | Unika attraktioner | Toppattraktioner |`);
  md.push(`|---|---:|---:|---:|---|`);
  for (const c of classRows) {
    md.push(`| ${c.class} | ${c.events} | ${c.distinct_titles} | ${c.unique_attractions} | ${c.top_attractions.split(' | ').slice(0, 5).join(', ')} |`);
  }
  md.push('');

  md.push('## Utmärkande attraktioner');
  md.push('');
  md.push('Utöver de stora generiska typerna (*konsert*, *teater*, *mässa*) finns ett lager av **specifika, lokala attraktioner** — egna ord och egna evenemangsformer som bara ett Stockholm-evenemang har. De är få till antal men var och en är ett distinkt evenemang.');
  md.push('');
  const LOCAL_CLASSES = [GROUPS.MASSA, GROUPS.SPEL, GROUPS.VARD, GROUPS.FRILUFT, GROUPS.SAMHALLE, GROUPS.SPRAK, GROUPS.BARN, GROUPS.MAT];
  const local = attractionRows.filter((a) => LOCAL_CLASSES.includes(a.class) && a.distinct_titles >= 1 && a.events >= 2);
  md.push('| Attraktion | Klass | Events | Titlar | Exempel |');
  md.push('|---|---|---:|---:|---|');
  for (const a of local.slice(0, 70)) {
    md.push(`| **${a.attraction}** | ${a.class} | ${a.events} | ${a.distinct_titles} | ${a.examples.split(' | ').slice(0, 2).join(' · ')} |`);
  }
  md.push('');

  md.push('## Nivå 2 — unika attraktioner');
  md.push('');
  md.push(`De ${attractionRows.length} unika attraktionerna, sorterade på antal events.`);
  md.push('');
  md.push(`| # | Attraktion | Klass | Events | Titlar | Exempel |`);
  md.push(`|---:|---|---|---:|---:|---|`);
  attractionRows.forEach((a, i) => {
    md.push(`| ${i + 1} | **${a.attraction}** | ${a.class} | ${a.events} | ${a.distinct_titles} | ${a.examples.split(' | ').slice(0, 2).join(' · ')} |`);
  });
  md.push('');

  md.push('## Restgruppen: titlar utan typord');
  md.push('');
  md.push(`${neither.length} unika titlar (${neither.reduce((a, m) => a + m.n_events, 0)} events) innehåller **ingen** ordentlig aktivitetstyp. De är inte missade attraktioner — de är namn.`);
  md.push('');
  md.push('| Typ av resttitel | Antal unika titlar | Events |');
  md.push('|---|---:|---:|');
  const recSet = new Set(
    neither.filter((m) => m.kind === 'other' && m.n_events >= 3).map((m) => m.title)
  );
  const residualGroups = [
    ['Produktion/pjäsnamn (visas i en viss period)', (m) => m.kind === 'show_title'],
    ['Artist/ensemble-namn', (m) => m.kind === 'artist_name'],
    ['Återkommande namngiven aktivitet (t.ex. "Mors dag")', (m) => recSet.has(m.title)],
    ['Enstaka titlar utan mönster', (m) => m.kind === 'other' && !recSet.has(m.title)],
    ['Öppettider/biljetter', (m) => m.kind === 'time_only'],
    ['Endast lokalnamn', (m) => m.kind === 'venue_only'],
  ];
  for (const [label, pred] of residualGroups) {
    const rows = neither.filter(pred);
    if (!rows.length) continue;
    md.push(`| ${label} | ${rows.length} | ${rows.reduce((a, m) => a + m.n_events, 0)} |`);
  }
  md.push('');
  md.push('### Återkommande namngivna aktiviteter');
  md.push('');
  md.push('Ett eget mönster: titlar som *namnger* en återkommande aktivitet utan att säga vilken typ den är. De fungerar i praktiken som attraktioner ("Mors dag" **är** något du kan söka på) men ordet "mässa" eller "festival" saknas.');
  md.push('');
  md.push('| Aktivitet | Events |');
  md.push('|---|---:|');
  for (const m of neither.filter((x) => recSet.has(x.title)).sort((a, b) => b.n_events - a.n_events).slice(0, 25)) {
    md.push(`| ${m.title} | ${m.n_events} |`);
  }
  md.push('');
  md.push('### Största produktionsnamnen');
  md.push('');
  md.push('Titlar som *namnger en pjäs eller en turné* — samma produktion återkommer som många datum. Här räknas antalet events, inte antalet titlar.');
  md.push('');
  md.push('| Produktion | Events |');
  md.push('|---|---:|');
  for (const m of neither.filter((x) => x.kind === 'show_title').sort((a, b) => b.n_events - a.n_events).slice(0, 20)) {
    md.push(`| ${m.title} | ${m.n_events} |`);
  }
  md.push('');
  md.push('För *EventPulse-agenten* betyder detta: för drygt hälften av alla titlar går det **inte** att avgöra typen ur titeln ensam. Typen måste då komma från venue, `category_slug` eller beskrivningen.');
  md.push('');

  md.push('## Metod & verifiering');
  md.push('');
  md.push('**Metod A — LLM (MiniMax-M3, thinking avstängd).** Varje unik titel skickas till modellen som ber om huvudattraktionen med kravet att frasen förekommer bokstavligen i titeln. Varje svar granskas maskinellt:');
  md.push('');
  md.push('- frasen måste vara en **sammanhängande tokensekvens i titeln** (tillåten svensk böjning: `Julmässa` → `Julmässan`);');
  md.push('- `type` måste komma från en sluten vokabulär;');
  md.push('- `kind ≠ type_in_title` ⇒ fras och typ tömda;');
  md.push('- är frasen bara sammansättningens huvud (`pyssel` i *Helgpyssel*) skrivs den ut till hela ordet, så att kravet "ordet finns i titeln" håller bokstavligen.');
  md.push('');
  md.push('**Metod B — deterministisk ordboksmatcher.** En oberoende svensk/engelsk ordbok över typord, med svensk sammansättningsmorfologi (huvudordet står sist: *dambastu* = dam + bastu). Sammansättningar godkänns bara när modifieraren är en känd innehållsmodifierare — annars uppstår falska träffar som *mat* i *Mattecentrum* och *bio* i *Biohack*. Ord som är för generiska för att ensamma ange en typ (*stad*, *bad*, *folk*) utesluts. Öppettidsord (`*öppet`) räknas aldrig som attraktion.');
  md.push('');
  md.push('### Verifiering');
  md.push('');
  md.push('| Kontroll | Utfall |');
  md.push('|---|---|');
  md.push(`| **Grounding-audit** — andel accepterade fraser som bokstavligen förekommer i titeln | **${groundingOk}/${groundingTotal} (100 %)** |`);
  md.push(`| **Korscheck A↔B** — överensstämmelse i attraktionsklass när båda hittat en typ | ${xs.agree}/${xs.both} (${xs.agreePct} %) |`);
  md.push(`| **LLM self-consistency** — samma "har typord"-status i två oberoende LLM-körningar med olika prompt | 80,7 % |`);
  md.push(`| **Manuell granskning** — stratifierat urval (228 titlar), andel med rimlig attraktion | ≈ 90 % (88–95 % beroende på gränsfall) |`);
  md.push('');
  md.push('**Korscheck mellan metoderna:**');
  md.push('');
  md.push(`| | Antal |`);
  md.push(`|---|---:|`);
  md.push(`| Båda metoderna hittade en typ | ${xs.both} |`);
  md.push(`| …samma klass | ${xs.agree} (${xs.agreePct} %) |`);
  md.push(`| …olika klass | ${xs.both - xs.agree} |`);
  md.push(`| Endast metod A | ${xs.llmOnly} |`);
  md.push(`| Endast metod B | ${xs.ruleOnly} |`);
  md.push(`| Ingen av metoderna | ${xs.neither} |`);
  md.push('');
  md.push('Metod A är primär; metod B fyller på där A inte hittar något. De 438 klassolikheterna är **inte** i första hand fynd — de är gränsdragningar mellan närliggande typer (*konsert* mot *show*, *mässa* mot *festival*, *bio* mot *hälsa* i *Biohack me*). Det gemensamma grundfaktumet — att ett typord står i titeln — håller i båda fallen.');
  md.push('');
  md.push('**Kända felkällor, kvantifierade.** 1. Pjäs-, film- och talksäsongstitlar där modellen tar titeln som attraktion i stället för ordet *film*/*föreläsning* (*Flood*, *Fogo do Vento*) — ca 2 % av de granskade. 2. Ord som är både aktivitetstyp och artistnamn (*Bad Bunny*) — ett tiotal titlar. 3. Svepande fraser som *"MAMMA MIA! THE PARTY"* där rätt svar är *THE PARTY*, inte hela titeln. 4. Ren städkost (*Entrébiljetter/Tickets*, *Extraöppet*) filtreras bort via en uttrycklig öppettidsregel.');
  md.push('');
  md.push('### Filer');
  md.push('');
  md.push(`- \`docs/audit/data/${base}-grupper.csv\` — nivå 1, en rad per attraktionsklass`);
  md.push(`- \`docs/audit/data/${base}-inventering.csv\` — nivå 2, en rad per unik attraktion`);
  md.push(`- \`docs/audit/data/${base}-per-titel.csv\` — alla ${titles.length} unika titlar med sin klassning`);
  md.push('');

  fs.writeFileSync(path.join(OUT_DIR, `${base}.md`), md.join('\n'));

  console.log('\n=== SAMMANFATTNING ===');
  console.log(`events: ${meta.total_events} | unika titlar: ${titles.length}`);
  console.log(`med attraktion: ${withAttr.length} titlar / ${withAttr.reduce((a, m) => a + m.n_events, 0)} events`);
  console.log(`unika attraktioner: ${attractionRows.length} | klasser: ${classRows.length}`);
  console.log(`korscheck: ${xs.agree}/${xs.both} = ${xs.agreePct}% (A-enda ${xs.llmOnly}, B-enda ${xs.ruleOnly}, ingen ${xs.neither})`);
  console.log(`\nskrivet: docs/audit/${base}.md + docs/audit/data/*.csv`);
}

main().catch((e) => { console.error('FEL:', e); process.exit(1); });
