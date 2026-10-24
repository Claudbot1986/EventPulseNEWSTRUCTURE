#!/usr/bin/env node
/**
 * fold-host-sources.mjs — vik ihop källor som pekar på samma värd.
 *
 * Bakgrund (2026-10-24). Discovery skapade en egen `candidate-<hash>-<slug>`
 * -källa för varje URL på en domän som redan fanns som källa. Men samma
 * fel fanns även utan discovery: källregistret hade 31 värdar med flera
 * käll-id (operan.se × 9, modernamuseet.se × 6, kulturhusetstadsteatern.se
 * × 4 …), totalt 56 extra käll-id.
 *
 * Följden:
 *   - samma evenemang låg under flera source-namn (4093 extra rader, 24 %)
 *   - 19 av 48 nollrad-källor hade sina events i DB under ett tvillingnamn
 *   - C-gaten körde samma värd 9 gånger med olika URL:er
 *
 * Lösningen är samma som för kandidaterna: en värd = EN källa. Övriga URL:er
 * på samma värd blir `metadata.eventUrls` på värdkällan, och C-gaten
 * extraherar dem för sig.
 *
 * Detta skript:
 *   1. grupperar källfilerna per värd (hostname, www borttaget)
 *   2. väljer en överlevande källa per värd
 *   3. lägger övriga URL:er som `metadata.eventUrls` på överlevande
 *   4. räknar om identiteten för ALLA rader i gruppen under den överlevande
 *      källans id (se "Identitet" nedan) och tar bort rader som blir
 *      dubbletter
 *   5. slår ihop extraherade artefakter, städar köerna och raderar filer
 *
 * ─── Identitet (mätt 2026-10-24, inte antaget) ───────────────────────────
 *
 * Normalizer'n räknar hashen så här (04-Normalizer/normalizer.ts:458):
 *
 *   source_id finns  →  sha256(`${source}::${source_id}`)
 *   annars          →  sha256(`${source}::${title}::${start_time}`)
 *
 * Mått på riktiga data:
 *   - 259 av 302 flyttade rader hade hashen `sha256(source::titel::start)`
 *     där start = `2026-10-26T17:00:00.000Z` (ISO med millisekunder).
 *   - 15 rader hade `+00:00`-varianten, 2 rader hade source_id-formeln,
 *     1 rader datum-formen, 25 var omätbara (titel skriven om efter att
 *     hashen räknades, eller importerad via sitemap-sökvägen som har en
 *     egen hashform).
 *   - `source_id` går INTE att jämföra mellan källor: extractor.ts:704
 *     genererar den som `${source}-${hash}` där hashen räknas på
 *     `${source}:${titel}:${datum}` — källans namn ingår alltså i hashen.
 *
 * Efter vikningen körs källan igen genom C-gaten, som producerar rader
 * UTAN source_id (C-artefakterna har varken `id` eller `source_id`) och med
 * start i `.000Z`-form (toIsoStartTime i usableEvents.ts:28). Därför får
 * varje rad i gruppen:
 *
 *   source      = överlevande källans id
 *   source_id   = null   (C-vägen sätter ingen source_id)
 *   dedup_hash  = sha256(`${source}::${titel}::${start.000Z}`)
 *
 * Det är exakt hashen nästa körning räknar ut — annars skulle varje rad
 * bli en dubblett nästa gång källan körs.
 *
 * Dubbletter avgörs på SEMANTISK identitet (normaliserad titel + starttid),
 * inte på dedup_hash: många rader har en stale hash (titel-ändringar har
 * skrivit om title_sv efter att hashen sattes), så hashmatchning ger falska
 * dubbletter.
 *
 * Kör:
 *   node scripts/fold-host-sources.mjs            # dry-run (inga ändringar)
 *   node scripts/fold-host-sources.mjs --apply    # utför
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), override: true });

const APPLY = process.argv.includes('--apply');
const SOURCES_DIR = path.join(ROOT, 'sources');
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const C_EXTRACTED_DIR = path.join(ROOT, '03-Queue', '03-extractedevents', 'C');
const QUEUE_FILE = path.join(RUNTIME_DIR, 'postB-preC-queue.jsonl');
const STATUS_FILE = path.join(RUNTIME_DIR, 'sources_status.jsonl');

// ---------------------------------------------------------------------------
// Hjälpfunktioner
// ---------------------------------------------------------------------------

function readSource(id) {
  const file = path.join(SOURCES_DIR, `${id}.jsonl`);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Källfiler MÅSTE vara en rad — radbaserade läsare parsar bara första raden. */
function writeSource(source) {
  fs.writeFileSync(path.join(SOURCES_DIR, `${source.id}.jsonl`), `${JSON.stringify(source)}\n`, 'utf8');
}

function canonicalUrl(url) {
  const parsed = new URL(url.trim());
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  parsed.hash = '';
  if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

/** Värd-nyckel: hostname utan www-prefix. */
function hostKey(url) {
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Samma formel som 04-Normalizer/normalizer.ts buildDedupHash. */
function buildDedupHash(source, sourceId) {
  return createHash('sha256').update(`${source}::${sourceId}`).digest('hex');
}

/**
 * Semantisk identitet för en DB-rad — det som avgör OM TVÅ RADER ÄR
 * SAMA EVENEMANG.
 *
 * Samma identitet som `scripts/dedupe-within-source.mjs` använder för rader
 * utan source_id: (normaliserad titel, starttid).
 */
function semanticKey(row) {
  const title = String(row.title_sv ?? row.title_en ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `tst:${title}|${row.start_time ?? ''}`;
}

/**
 * Ny identitet för en rad under den överlevande källan.
 *
 * Två former, beroende på vad nästa körning kommer att skriva:
 *
 *  A) Raden har en source_id som INTE är prefixad med det gamla källnamnet.
 *     Då är det källans EGET externa id — mätt på riktiga data:
 *     "30463-2027-01-28-1800" (folkoperan), "kh-116961" (kulturhuset),
 *     "Z698xZq2Z1AYfdfA" (ticketmaster), "43299551-buffalo-traffic-jam-at-nalen-
 *     stacken" (songkick), "match-aik-innebandy-…" (aik). Sådana id beror
 *     inte på källans namn, så nästa körning producerar samma id — hashen
 *     måste räknas på id:t: sha256(`${S}::${source_id}`).
 *
 *  B) Annars (ingen source_id, eller en som är prefixad med det gamla
 *     källnamnet — t.ex. "konserthuset-kxw8ef" från extractor.ts
 *     generateEventId, där hashen räknas på `${source}:${titel}:${datum}`)
 *     → nästa körning går via C-gaten, som producerar rader UTAN source_id
 *     och med start i `.000Z`-form:
 *     sha256(`${S}::${titel}::${start.000Z}`).
 *
 * Template literal ger "null" för null start_time, precis som normalizer'n
 * gör (`${raw.title}::${raw.start_time}`).
 */
function keepsOwnSourceId(row) {
  if (!row.source_id) return false;
  return !row.source_id.startsWith(`${row.source}-`);
}

function newIdentity(survivorId, row) {
  if (keepsOwnSourceId(row)) {
    return { sourceId: row.source_id, hash: buildDedupHash(survivorId, row.source_id) };
  }
  const title = row.title_sv ?? row.title_en ?? '';
  const start = String(row.start_time ?? '').replace(/\+00:00$/, '.000Z');
  return { sourceId: null, hash: buildDedupHash(survivorId, `${title}::${start}`) };
}

/** Komplettpoäng — samma mätare som scripts/dedupe-within-source.mjs. */
function completenessScore(r) {
  let s = 0;
  if (r.description_sv) s += 3;
  if (r.description_en) s += 2;
  if (r.venue_id) s += 3;
  if (r.category_slug) s += 1;
  if (r.ticket_url) s += 1;
  if (r.image_url) s += 2;
  if (r.lat != null && r.lng != null) s += 1;
  if (r.price_min_sek != null) s += 1;
  if (r.end_time) s += 1;
  return s;
}

/**
 * Vinnare i en dubblettgrupp — samma ordning som dedupe-within-source.mjs:
 * komplettpoäng → färskast sedd → äldsta skapad → id.
 */
function chooseWinner(rows) {
  return [...rows].sort((a, b) => {
    const sa = completenessScore(a);
    const sb = completenessScore(b);
    if (sa !== sb) return sb - sa;
    const la = String(a.last_seen_at ?? '');
    const lb = String(b.last_seen_at ?? '');
    if (la !== lb) return lb.localeCompare(la);
    const ca = String(a.created_at ?? '');
    const cb = String(b.created_at ?? '');
    if (ca !== cb) return ca.localeCompare(cb);
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

/** Samma identitet som C-gatens eventIdentity. */
function eventIdentity(ev) {
  const title = String(ev.title ?? ev.title_sv ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const date = String(ev.date ?? '').trim();
  const time = String(ev.time ?? '').trim();
  const start = String(ev.start_time ?? '').trim();
  return `${title}|${date}|${time}|${start}`;
}

// ---------------------------------------------------------------------------
// 1. Läs källregistret och gruppera per värd
// ---------------------------------------------------------------------------

const files = fs.readdirSync(SOURCES_DIR).filter((f) => f.endsWith('.jsonl'));
const sources = [];
for (const file of files) {
  const id = file.replace(/\.jsonl$/, '');
  const record = readSource(id);
  if (!record) {
    console.error(`VARNING: ${id} kunde inte läsas — hoppar över`);
    continue;
  }
  const host = hostKey(record.url);
  if (!host) {
    console.error(`VARNING: ${id} har ogiltig url "${record.url}" — hoppar över`);
    continue;
  }
  sources.push({
    id,
    record,
    host,
    isCandidate: id.startsWith('candidate-'),
    hasAdapter: typeof record.metadata?.sourceAdapter === 'string',
    eventUrls: Array.isArray(record.metadata?.eventUrls) ? record.metadata.eventUrls : [],
  });
}

const groups = new Map();
for (const source of sources) {
  if (!groups.has(source.host)) groups.set(source.host, []);
  groups.get(source.host).push(source);
}
const multi = [...groups.entries()].filter(([, members]) => members.length > 1);

// ---------------------------------------------------------------------------
// 2. Databasen — rader per källa
// ---------------------------------------------------------------------------

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas i .env');
  process.exit(2);
}
const sb = createClient(url, key);

const ROW_COLUMNS =
  'id,source,source_id,title_sv,title_en,start_time,dedup_hash,ticket_url,' +
  'created_at,last_seen_at,description_sv,description_en,venue_id,category_slug,' +
  'image_url,lat,lng,price_min_sek,end_time';

const rowsBySource = new Map();
const allRows = [];
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await sb
    .from('events')
    .select(ROW_COLUMNS)
    .order('id', { ascending: true })
    .range(offset, offset + 999);
  if (error) {
    console.error('DB-fel:', error.message);
    process.exit(2);
  }
  for (const row of data ?? []) {
    if (!rowsBySource.has(row.source)) rowsBySource.set(row.source, []);
    rowsBySource.get(row.source).push(row);
    allRows.push(row);
  }
  if ((data ?? []).length < 1000) break;
}

/** Alla dedup_hash som redan finns i DB — för att hitta kollisioner. */
const existingHashes = new Map();
for (const row of allRows) {
  if (row.dedup_hash && !existingHashes.has(row.dedup_hash)) existingHashes.set(row.dedup_hash, row.id);
}

// ---------------------------------------------------------------------------
// 3. Välj överlevande källa per värd
// ---------------------------------------------------------------------------

/**
 * Överlevande = den källa som bäst representerar värdet:
 *   1. en källa med egen adapter (adaptern definierar källans hämtning)
 *   2. annars en icke-candidate-källa — `candidate-*` är discovery-skapade
 *      kopior av en URL som redan fanns, de ska aldrig överleva
 *   3. annars den som äger flest DB-rader (måttbart bevis på att URL:en gav events)
 *   4. tiebreak: grundare URL (kortare sökväg), kortare id, alfabetiskt
 */
function pathDepth(record) {
  try {
    const parsed = new URL(record.url);
    return parsed.pathname.split('/').filter(Boolean).length;
  } catch {
    return 99;
  }
}

function pickSurvivor(members) {
  return [...members].sort((a, b) => {
    if (a.hasAdapter !== b.hasAdapter) return a.hasAdapter ? -1 : 1;
    if (a.isCandidate !== b.isCandidate) return a.isCandidate ? 1 : -1;
    const aRows = (rowsBySource.get(a.id) ?? []).length;
    const bRows = (rowsBySource.get(b.id) ?? []).length;
    if (aRows !== bRows) return bRows - aRows;
    const aDepth = pathDepth(a.record);
    const bDepth = pathDepth(b.record);
    if (aDepth !== bDepth) return aDepth - bDepth;
    if (a.id.length !== b.id.length) return a.id.length - b.id.length;
    return a.id.localeCompare(b.id);
  })[0];
}

// ---------------------------------------------------------------------------
// 4. Planera
// ---------------------------------------------------------------------------

const plan = {
  hosts: 0,
  membersFolded: 0,
  urlsAttached: 0,
  rowsMoved: 0,
  rowsRenamed: 0,
  rowsDeletedAsDuplicate: 0,
  rowsHashCollisions: 0,
  filesRemoved: 0,
  artifactsMerged: 0,
  queueEntriesRewritten: 0,
  statusRowsRemoved: 0,
};

const hostPlans = [];

for (const [host, members] of multi) {
  const survivor = pickSurvivor(members);
  const folded = members.filter((m) => m.id !== survivor.id);

  // URL:er som ska bli event-URL:er på överlevande.
  const survivorOwn = (() => {
    try {
      return canonicalUrl(survivor.record.url);
    } catch {
      return null;
    }
  })();
  const existing = survivor.eventUrls.map((u) => {
    try {
      return canonicalUrl(u);
    } catch {
      return u;
    }
  });
  const newUrls = [];
  for (const member of folded) {
    let canonical;
    try {
      canonical = canonicalUrl(member.record.url);
    } catch {
      continue;
    }
    if (canonical === survivorOwn) continue; // samma URL som värdets egen
    if (existing.includes(canonical) || newUrls.includes(canonical)) continue;
    existing.push(canonical);
    newUrls.push(member.record.url);
  }

  // Alla rader i gruppen — överlevande + vikta källor.
  const groupRows = [];
  for (const member of members) {
    for (const row of rowsBySource.get(member.id) ?? []) groupRows.push(row);
  }

  // Dubbletter: samma evenemang. Två kriterier, och de räknas ihop:
  //
  //   - samma (normaliserad titel, starttid) → samma evenemang
  //   - samma source_id → samma evenemang, och efter vikningen skulle de
  //     dessutom krocka på idx_events_source_source_id_uniq eftersom de
  //     hamnar under samma källa
  //
  // Raderna grupperas därför med union-find över båda nycklarna.
  const parent = new Map();
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const row of groupRows) parent.set(row.id, row.id);

  const bySid = new Map();
  for (const row of groupRows) {
    if (!row.source_id) continue;
    if (bySid.has(row.source_id)) union(bySid.get(row.source_id), row.id);
    else bySid.set(row.source_id, row.id);
  }
  const byTst = new Map();
  for (const row of groupRows) {
    const k = semanticKey(row);
    if (byTst.has(k)) union(byTst.get(k), row.id);
    else byTst.set(k, row.id);
  }

  const clusters = new Map();
  for (const row of groupRows) {
    const root = find(row.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(row);
  }

  const rowsKept = [];
  const rowsDeleted = [];
  for (const [, group] of clusters) {
    if (group.length === 1) {
      rowsKept.push(group[0]);
      continue;
    }
    const winner = chooseWinner(group);
    rowsKept.push(winner);
    for (const row of group) if (row.id !== winner.id) rowsDeleted.push(row);
  }

  // Ny identitet under den överlevande källan.
  //
  // Två sorters kollisioner måste hanteras:
  //
  //  1. Slutlig kollision — två rader i gruppen får samma nya hash. Kan
  //     inte hända: semanticKey skiljer på (titel, start), och hashen räknas
  //     på exakt samma fält. Men kontrollen ligger kvar som vakt.
  //
  //  2. Övergångskollision — rad A:s nya hash är i nuläget B:s gamla hash.
  //     B uppdateras också, men om A uppdateras först stötar skrivningen mot
  //     idx_events_dedup_hash_uniq. Sådana rader flyttas till ett tillfälligt
  //     hash först (fas 1), sedan sätts slutgiltiga hasher (fas 2).
  const rowsMoved = [];
  const rowsRenamed = [];
  let hashCollisions = 0;

  const groupRowIds = new Set(groupRows.map((r) => r.id));

  const pending = [];
  const seenNewHash = new Map();
  const seenSid = new Map();
  let sidCollisions = 0;

  for (const row of rowsKept) {
    const { sourceId, hash: newHash } = newIdentity(survivor.id, row);

    if (seenNewHash.has(newHash)) {
      hashCollisions += 1; // slutlig kollision — raden lämnas orörd
      continue;
    }
    seenNewHash.set(newHash, row.id);

    const owner = existingHashes.get(newHash);
    if (owner && !groupRowIds.has(owner)) {
      hashCollisions += 1; // kollision med en rad utanför gruppen
      continue;
    }

    // (source, source_id) måste vara unikt efter vikningen — alla rader i
    // gruppen hamnar under samma källa. Rader med samma source_id slås ihop
    // ovan (union-find), men en rad som behåller sitt source_id kan krocka
    // med en annan rads NYA source_id.
    if (sourceId) {
      const sidKey = `${survivor.id}::${sourceId}`;
      if (seenSid.has(sidKey)) {
        sidCollisions += 1;
        continue;
      }
      seenSid.set(sidKey, row.id);
    }

    pending.push({ row, newHash, sourceId });

    if (row.source !== survivor.id) {
      rowsMoved.push({ row, newHash, sourceId });
    } else if (row.dedup_hash !== newHash || row.source_id !== sourceId) {
      rowsRenamed.push({ row, newHash, sourceId });
    }
  }

  // Rader vars GAMLA hash ska tas över av en annan rad. Den som håller  // värdet måste släppa det först — annars stöter skrivningen mot
  // idx_events_dedup_hash_uniq. Dessa rader får ett tillfälligt hash först.
  const claimedBy = new Map();
  for (const { row, newHash } of pending) {
    if (!claimedBy.has(newHash)) claimedBy.set(newHash, row.id);
  }
  const needsTempHash = rowsKept.filter((row) => {
    if (!row.dedup_hash) return false;
    const claimant = claimedBy.get(row.dedup_hash);
    return claimant && claimant !== row.id;
  });

  // (source, source_id) kontrolleras ovan, i identitetsloopen.

  hostPlans.push({
    host,
    survivor,
    folded,
    newUrls,
    rowsMoved,
    rowsRenamed,
    rowsDeleted,
    needsTempHash,
    hashCollisions,
    sidCollisions,
  });
}

// ---------------------------------------------------------------------------
// 5. Redovisa
// ---------------------------------------------------------------------------

console.log(`Värdar med flera källor: ${hostPlans.length}\n`);
for (const p of hostPlans) {
  console.log(
    `  ${p.host.padEnd(30)} överlever: ${p.survivor.id.padEnd(34)} ` +
      `(${p.folded.length} viks, ${p.newUrls.length} URL:er, ` +
      `${p.rowsMoved.length} rader flyttas, ${p.rowsRenamed.length} hasher räknas om, ` +
      `${p.rowsDeleted.length} dubbletter bort` +
      (p.hashCollisions ? `, ${p.hashCollisions} hash-kollisioner` : '') +
      (p.sidCollisions ? `, ${p.sidCollisions} source_id-kollisioner` : '') +
      `)`,
  );
}

const totalMoved = hostPlans.reduce((n, p) => n + p.rowsMoved.length, 0);
const totalRenamed = hostPlans.reduce((n, p) => n + p.rowsRenamed.length, 0);
const totalDeleted = hostPlans.reduce((n, p) => n + p.rowsDeleted.length, 0);
const totalCollisions = hostPlans.reduce((n, p) => n + p.hashCollisions, 0);

console.log(
  `\nPlan: ${hostPlans.length} värdar, ` +
    `${hostPlans.reduce((n, p) => n + p.folded.length, 0)} käll-id viks, ` +
    `${hostPlans.reduce((n, p) => n + p.newUrls.length, 0)} event-URL:er läggs till, ` +
    `${totalMoved} rader byter källa, ${totalRenamed} hasher räknas om, ` +
    `${totalDeleted} dubbletter tas bort, ${totalCollisions} kollISIONER (lämnas orörda).\n`,
);

if (totalCollisions > 0) {
  console.log('KOLLISIONER — lista:');
  for (const p of hostPlans.filter((x) => x.hashCollisions > 0)) {
    console.log(`  ${p.host} → ${p.survivor.id}: ${p.hashCollisions}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// 5b. Flygförkontroll — slutlig DB-tillstånd mot unika indexen
// ---------------------------------------------------------------------------
/**
 * Simulera slutläget: varje rad får sin slutliga identitet, och inga två
 * rader får samma dedup_hash eller samma (source, source_id).
 *
 * Utan denna kontroll kan --apply skriva ett tillstånd som rör vid
 * idx_events_dedup_hash_uniq eller idx_events_source_source_id_uniq,
 * vilket gör att apply-fasen failar halvvägs och lämnar DB:n i ett
 * halvfört tillstånd. Kontrollen körs även i dry-run.
 */
const affected = new Set();
const finalState = [];
for (const p of hostPlans) {
  for (const { row, newHash, sourceId } of [...p.rowsMoved, ...p.rowsRenamed]) {
    affected.add(row.id);
    finalState.push({
      id: row.id,
      source: p.survivor.id,
      sourceId: sourceId ?? null,
      newHash,
    });
  }
  for (const row of p.rowsDeleted) affected.add(row.id);
}
const problems = [];
const finalHashes = new Map();
const finalSids = new Map();
for (const s of finalState) {
  if (s.newHash) {
    if (finalHashes.has(s.newHash)) {
      problems.push(`dubblett-hash ${s.newHash.slice(0, 12)} (rad ${s.id} och ${finalHashes.get(s.newHash)})`);
    } else {
      finalHashes.set(s.newHash, s.id);
    }
  }
  if (s.sourceId) {
    const key = `${s.source}::${s.sourceId}`;
    if (finalSids.has(key)) {
      problems.push(`dubblett source_id ${key} (rad ${s.id} och ${finalSids.get(key)})`);
    } else {
      finalSids.set(key, s.id);
    }
  }
}
// Rader utanför gruppen som ligger kvar med sin hash — deras hash får inte
// krocka med en ny hash i slutläget.
for (const row of allRows) {
  if (affected.has(row.id)) continue;
  if (!row.dedup_hash) continue;
  if (finalHashes.has(row.dedup_hash)) {
    problems.push(
      `hash ${row.dedup_hash.slice(0, 12)} krockar med rad utanför gruppen (rad ${row.id})`,
    );
  }
}
// Räkna bara varje problem en gång.
const uniqueProblems = [...new Set(problems)];
if (uniqueProblems.length > 0) {
  console.log(`FLYGKONTROLL MISSLYCKADES — ${uniqueProblems.length} problem:`);
  for (const p of uniqueProblems.slice(0, 20)) console.log(`  ${p}`);
  if (uniqueProblems.length > 20) console.log(`  … och ${uniqueProblems.length - 20} till`);
  console.log('\nInga ändringar gjorda.');
  process.exit(1);
}
console.log(
  `Flygkontroll OK: ${finalState.length} rader får ny identitet, ` +
    `inga hash- eller source_id-kollisioner i slutläget.\n`,
);

if (!APPLY) {
  console.log('DRY-RUN — inga ändringar gjorda. Kör med --apply för att utföra.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 6. Utför
// ---------------------------------------------------------------------------

// 6a. Event-URL:er på värdkällorna
// Idempotent: en URL som redan sitter på källen läggs inte till igen,
// så en avbruten körning kan återupptas utan dubblering.
for (const p of hostPlans) {
  if (p.newUrls.length === 0) continue;
  const host = readSource(p.survivor.id);
  if (!host) continue;
  const metadata = { ...(host.metadata ?? {}) };
  const existing = Array.isArray(metadata.eventUrls) ? metadata.eventUrls : [];
  const merged = [...existing];
  for (const url of p.newUrls) {
    if (merged.includes(url)) continue;
    merged.push(url);
    plan.urlsAttached += 1;
  }
  metadata.eventUrls = merged;
  writeSource({ ...host, metadata });
}

// 6b. DB-rader
for (const p of hostPlans) {
  for (const row of p.rowsDeleted) {
    const { error } = await sb.from('events').delete().eq('id', row.id);
    if (error) {
      console.error(`Kunde inte radera ${row.id}: ${error.message}`);
      process.exit(2);
    }
    plan.rowsDeletedAsDuplicate += 1;
  }

  // Fas 1 — rader vars nya hash ännu hålls av en annan rad flyttas till ett
  // tillfälligt hash, så att fas 2 inte stöter mot unika indexet.
  for (const row of p.needsTempHash) {
    const { error } = await sb
      .from('events')
      .update({ dedup_hash: `tmp-fold-${row.id}` })
      .eq('id', row.id);
    if (error) {
      console.error(`Kunde inte sätta tillfälligt hash på ${row.id}: ${error.message}`);
      process.exit(2);
    }
  }

  // Fas 2 — slutlig identitet.
  for (const { row, newHash, sourceId } of [...p.rowsMoved, ...p.rowsRenamed]) {
    const { error } = await sb
      .from('events')
      .update({ source: p.survivor.id, source_id: sourceId, dedup_hash: newHash })
      .eq('id', row.id);
    if (error) {
      console.error(`Kunde inte uppdatera ${row.id}: ${error.message}`);
      process.exit(2);
    }
    if (p.rowsMoved.some((m) => m.row.id === row.id)) plan.rowsMoved += 1;
    else plan.rowsRenamed += 1;
  }
  plan.rowsHashCollisions += p.hashCollisions;
}

// 6c. Artefakter — kandidatens C-utdata slås ihop med värdens
for (const p of hostPlans) {
  for (const member of p.folded) {
    const memberArtifact = path.join(C_EXTRACTED_DIR, `${member.id}.jsonl`);
    if (!fs.existsSync(memberArtifact)) continue;
    const hostArtifact = path.join(C_EXTRACTED_DIR, `${p.survivor.id}.jsonl`);
    const hostRows = fs.existsSync(hostArtifact)
      ? fs.readFileSync(hostArtifact, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
    const seen = new Set(hostRows.map(eventIdentity));
    const merged = [...hostRows];
    for (const line of fs.readFileSync(memberArtifact, 'utf8').split('\n').filter(Boolean)) {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const id = eventIdentity(row);
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(row);
    }
    fs.writeFileSync(hostArtifact, merged.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    fs.rmSync(memberArtifact);
    plan.artifactsMerged += 1;
  }
}

// 6d. Källfiler för de vikta käll-id:na raderas
for (const p of hostPlans) {
  for (const member of p.folded) {
    const file = path.join(SOURCES_DIR, `${member.id}.jsonl`);
    if (fs.existsSync(file)) {
      fs.rmSync(file);
      plan.filesRemoved += 1;
    }
  }
  plan.membersFolded += p.folded.length;
}

// 6e. Köerna städas — vikta käll-id ersätts med värdens
const memberToHost = new Map();
for (const p of hostPlans) {
  for (const member of p.folded) memberToHost.set(member.id, p.survivor.id);
}

if (fs.existsSync(QUEUE_FILE)) {
  const lines = fs.readFileSync(QUEUE_FILE, 'utf8').split('\n').filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const host = memberToHost.get(entry.sourceId);
    const sourceId = host ?? entry.sourceId;
    if (seen.has(sourceId)) {
      plan.queueEntriesRewritten += 1;
      continue;
    }
    seen.add(sourceId);
    out.push(JSON.stringify(host ? { ...entry, sourceId: host } : entry));
    if (host) plan.queueEntriesRewritten += 1;
  }
  fs.writeFileSync(QUEUE_FILE, out.join('\n') + '\n', 'utf8');
}

// 6f. Källstatus — vikta käll-id tas bort, värdens rad behålls
if (fs.existsSync(STATUS_FILE)) {
  const lines = fs.readFileSync(STATUS_FILE, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      out.push(line);
      continue;
    }
    if (memberToHost.has(entry.sourceId)) {
      plan.statusRowsRemoved += 1;
      continue;
    }
    out.push(line);
  }
  fs.writeFileSync(STATUS_FILE, out.join('\n') + '\n', 'utf8');
}

console.log(
  `KLART: ${plan.membersFolded} käll-id vikta, ${plan.urlsAttached} event-URL:er, ` +
    `${plan.rowsMoved} rader bytte källa, ${plan.rowsRenamed} hasher räknades om, ` +
    `${plan.rowsDeletedAsDuplicate} dubbletter borttagna ` +
    `(${plan.rowsHashCollisions} kollisioner), ${plan.filesRemoved} filer raderade, ` +
    `${plan.artifactsMerged} artefakter sammanslagna, ${plan.queueEntriesRewritten} köposter omskrivna, ` +
    `${plan.statusRowsRemoved} statusrader borttagna.`,
);
