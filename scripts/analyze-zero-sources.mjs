#!/usr/bin/env node
/**
 * analyze-zero-sources.mjs — orsaksutredning för nollrad-källor
 *
 * Läser den RIKTIGA C-gate-loggen (per-källa-attribuerad) och den RIKTIGA
 * databasen, och skriver en orsaksklass per källa till runtime/.
 *
 * Ingen extraktion sker här — bara analys av redan körd data.
 *
 * Kör:
 *   node scripts/analyze-zero-sources.mjs --log <p> --queue <p> --out <p>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), override: true, quiet: true });

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};

const LOG = arg('--log', path.join(ROOT, 'runtime/cgate-census64-2026-10-24.log'));
const QUEUE = arg('--queue', path.join(ROOT, 'runtime/postB-preC-queue.jsonl'));
const OUT = arg('--out', path.join(ROOT, 'runtime/zero-source-causes.json'));

// ---------------------------------------------------------------------------
// 1. Läs loggen
// ---------------------------------------------------------------------------

const logText = fs.readFileSync(LOG, 'utf8');
const logLines = logText.split('\n');

/** @type {Map<string, any>} */
const perSource = new Map();

function ensure(id) {
  if (!perSource.has(id)) {
    perSource.set(id, {
      sourceId: id,
      c0Winner: null,
      c0Candidates: null,
      c1: {},
      c2: {},
      c3Events: null,
      c3Usable: null,
      c3Methods: null,
      aiTried: false,
      aiEvents: null,
      nextCandidates: [],
      eventUrlUrls: [],
      eventUrlUsable: 0,
      declaredUrlFallback: null,
      routeSuggestion: null,
      exitReason: null,
    });
  }
  return perSource.get(id);
}

// Alla rader som gäller en specifik källa bär prefixet [sourceId].
for (const line of logLines) {
  const m = line.match(/^\[([a-z0-9-]+)\]\s+(.*)$/);
  if (!m) continue;
  const [, id, rest] = m;
  const s = ensure(id);

  let mm;
  if ((mm = rest.match(/^C0: (\d+) candidates, winner=(\S+)/))) {
    s.c0Candidates = Number(mm[1]);
    s.c0Winner = mm[2] === 'none' ? null : mm[2];
  } else if ((mm = rest.match(/^C1: likelyJsRendered=(\S+) verdict=(\S+) \(fetchable=(\S+)\)/))) {
    s.c1 = { likelyJsRendered: mm[1] === 'true', verdict: mm[2], fetchable: mm[3] === 'true' };
  } else if ((mm = rest.match(/^C2: verdict=(\S+) score=(\d+)/))) {
    s.c2 = { verdict: mm[1], score: Number(mm[2]) };
  } else if ((mm = rest.match(/^C3: (\d+) events via \[([^\]]*)\] — (\d+) med användbart datum/))) {
    s.c3Events = Number(mm[1]);
    s.c3Methods = mm[2];
    s.c3Usable = Number(mm[3]);
  } else if ((mm = rest.match(/^\[C3-AI\] AI extraction: (\d+) events \((\d+) med användbart datum\)/))) {
    s.aiTried = true;
    s.aiEvents = Number(mm[1]);
  } else if ((mm = rest.match(/^\[C3-AI\] AI extraction also returned 0 events/))) {
    s.aiTried = true;
    s.aiEvents = 0;
  } else if ((mm = rest.match(/^\[C1-DirectRoute\]/))) {
    s.routeSuggestion = 'D';
    s.exitReason = s.exitReason || 'C1_STRONG_JS_RENDER_D_SIGNAL';
  } else if ((mm = rest.match(/^\[C-EventUrl\] (\S+): \d+ sida\(r\) gav events, \d+ kandidat\(er\) testade, (\d+) nya sparbara/))) {
    s.eventUrlUrls.push(mm[1]);
    s.eventUrlUsable += Number(mm[2]);
  } else if ((mm = rest.match(/^\[C-Extract\] Wrote (\d+) events/))) {
    s.wroteEvents = Number(mm[1]);
  }
}

// [C-NextCandidate]-rader bär INTE prefix — de har källans id i texten.
for (const line of logLines) {
  let mm;
  if ((mm = line.match(/^\[C-NextCandidate\] ([a-z0-9-]+): ingen sparbara datum — testar (\S+): (\S+)/))) {
    const s = ensure(mm[1]);
    s.nextCandidates.push({ reason: mm[2], url: mm[3], result: null });
  } else if ((mm = line.match(/^\[C-NextCandidate\] (\S+): (\d+) events \((\d+) med användbart datum\) via \[([^\]]*)\]/))) {
    const entry = perSource.get(mm[1]);
    if (entry) {
      const last = entry.nextCandidates[entry.nextCandidates.length - 1];
      if (last && last.url === mm[1]) {
        last.result = { events: Number(mm[2]), usable: Number(mm[3]), methods: mm[4] };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Läs kön (vilka källor som ingick i körningen)
// ---------------------------------------------------------------------------

const queued = fs
  .readFileSync(QUEUE, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l).sourceId);

// ---------------------------------------------------------------------------
// 3. Databasen — rader per källa
// ---------------------------------------------------------------------------

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas i .env');
  process.exit(2);
}
const sb = createClient(url, key);

const counts = new Map();
const PAGE = 1000;
let totalRows = 0;
for (let offset = 0; ; offset += PAGE) {
  // Ordning på id är obligatorisk — utan .order() kan PostgREST leverera
  // samma rad på två sidor och hoppa över en annan. Antalet stämmer då
  // fortfarande, men fördelningen per källa blir fel.
  const { data, error } = await sb
    .from('events')
    .select('source')
    .order('id', { ascending: true })
    .range(offset, offset + PAGE - 1);
  if (error) {
    console.error('DB-fel:', error.message);
    process.exit(2);
  }
  for (const row of data ?? []) counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
  totalRows += (data ?? []).length;
  if ((data ?? []).length < PAGE) break;
}

// ---------------------------------------------------------------------------
// 4. Klassificera orsak
// ---------------------------------------------------------------------------

/**
 * Orsaksklasser — varje klass ska peka på en konkret åtgärd.
 * unknown_förbjuds: en källa utan orsak är inte en färdig utredning.
 */
function classify(id, log, dbRows) {
  // Effektivt utfall: C3-vinnaren, eller den senaste lyckade fallback-kandidaten
  // (fallbacken ERSÄTTER raderna, så den gäller om den lyckades).
  const fallbackOk = (log.nextCandidates ?? []).filter((c) => (c.result?.usable ?? 0) > 0);
  const effectiveUsable = fallbackOk.length > 0
    ? fallbackOk[fallbackOk.length - 1].result.usable
    : log.c3Usable;
  const usable = effectiveUsable ?? null;
  const declaredFallback = (log.nextCandidates ?? []).find((c) => c.reason === 'declared-url');
  const declaredOk = declaredFallback?.result?.usable > 0;

  if (dbRows > 0) {
    return { cause: 'redan_i_databasen', action: 'none', detail: `${dbRows} rader i DB` };
  }

  // JS-renderad värd. C1 avbröt innan C3 kördes, så "ingen C3-rad" är här
  // INTE ett saknat spår — det är ett definierat utfall. Därför kontrolleras
  // detta FÖRE kontrollen på saknade C3-rader.
  const isJsRendered = log.routeSuggestion === 'D' || log.c1?.likelyJsRendered === true;
  if (isJsRendered) {
    if ((log.eventUrlUsable ?? 0) > 0) {
      return {
        cause: 'extraherad_men_inte_importerad',
        action: 'importera',
        detail: `${log.eventUrlUsable} sparbara rader från event-URL:erna men 0 i DB`,
      };
    }
    return {
      cause: 'js_renderad',
      action: 'D-gate',
      detail:
        (log.eventUrlUrls?.length ?? 0) > 0
          ? `C1 hittade JS-render-signal; ${log.eventUrlUrls.length} event-URL(er) gav inga sparbara rader → D-renderGate`
          : 'C1 hittade JS-render-signal → ska gå till D-renderGate',
    };
  }

  if (usable === null) {
    return {
      cause: 'saknar_koerad_spår',
      action: 'kora_igen',
      detail: 'ingen C3-rad i loggen — källan kördes inte eller avbröts',
    };
  }
  if (usable > 0) {
    return {
      cause: 'extraherad_men_inte_importerad',
      action: 'importera',
      detail: `${usable} rader med sparbart datum i loggen men 0 i DB`,
    };
  }
  if (declaredOk) {
    return {
      cause: 'vinnare_utan_datum',
      action: 'kora_om',
      detail: 'källans egen URL gav datum men C0-vinnaren stod kvar',
    };
  }
  if (log.c0Winner === null) {
    return {
      cause: 'inga_kandidater',
      action: 'handuell',
      detail: 'C0 hittade ingen sida med event-densitet på Swedish-mönstren',
    };
  }
  return {
    cause: 'sidor_utan_event_densitet',
    action: 'handuell',
    detail: `vinnare ${log.c0Winner} gav ${log.c3Events ?? 0} events utan sparbart datum`,
  };
}

const results = [];
for (const id of queued) {
  const log = perSource.get(id) ?? { sourceId: id };
  const dbRows = counts.get(id) ?? 0;
  const { cause, action, detail } = classify(id, log, dbRows);
  const fallbackOk = (log.nextCandidates ?? []).filter((c) => (c.result?.usable ?? 0) > 0);
  const effectiveUsable = fallbackOk.length > 0
    ? fallbackOk[fallbackOk.length - 1].result.usable
    : log.c3Usable;
  results.push({
    sourceId: id,
    cause,
    action,
    detail,
    dbRows,
    log: {
      c0Winner: log.c0Winner ?? null,
      c1: log.c1 ?? {},
      c2: log.c2 ?? {},
      c3Events: log.c3Events ?? null,
      c3Usable: log.c3Usable ?? null,
      effectiveUsable: effectiveUsable ?? null,
      aiTried: log.aiTried ?? false,
      nextCandidates: log.nextCandidates ?? [],
      eventUrlUrls: log.eventUrlUrls ?? [],
      eventUrlUsable: log.eventUrlUsable ?? 0,
    },
  });
}

const summary = {};
for (const r of results) summary[r.cause] = (summary[r.cause] ?? 0) + 1;
const out = {
  generatedAt: new Date().toISOString(),
  logFile: path.relative(ROOT, LOG),
  queueFile: path.relative(ROOT, QUEUE),
  totalRowsInDb: totalRows,
  queuedSources: queued.length,
  sourcesWithLogTrace: results.filter(
    (r) =>
      r.log.c3Usable !== null ||
      r.log.c0Winner !== null ||
      (r.log.eventUrlUrls?.length ?? 0) > 0,
  ).length,
  summary,
  results,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

console.log(`Källa: ${LOG}`);
console.log(`Kön: ${queued.length} källor, spår i loggen: ${out.sourcesWithLogTrace}`);
console.log(`Rader i DB: ${totalRows}`);
console.log('Orsaksfördelning:');
for (const [cause, n] of Object.entries(summary).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${cause}`);
}
console.log(`\nSkrev ${path.relative(ROOT, OUT)}`);

const unknown = results.filter((r) => r.cause === 'saknar_koerad_spår' || r.cause === 'sidor_utan_event_densitet');
if (unknown.length) {
  console.log(`\nKräver manuell åtgärd (${unknown.length}):`);
  for (const r of unknown) console.log(`  ${r.sourceId} — ${r.detail}`);
}
