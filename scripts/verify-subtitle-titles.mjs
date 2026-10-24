#!/usr/bin/env node
/**
 * verify-subtitle-titles.mjs — bevis för att underrubrik inte är en titel (2026-10-25).
 *
 * VARFÖR: extraktorn hittar titlar med `[class*="title"]`. CSS-väljaren
 * matchar varje klass som INNEHÅLLER strängen "title" — och det gör även
 * "subtitle", "subTitle", "hero-video__subtitle".
 *
 * På berwaldhallen.se:
 *
 *   <h3 class="Blurb__heading">
 *     <a href="…/streetstardanceschoolchallenge2026-14-16-ar">
 *       Streetstar Dance School Challenge 2026
 *       <span class="Blurb__subtitle"> — Next Generation 14–16 år</span>
 *     </a>
 *   </h3>
 *
 * Underrubriken matchade `[class*="title"]` och låg först i
 * dokumentordningen — så 20 rader fick underrubriken som evenemangets namn
 * i stället för konsertens titel.
 *
 * Gaten har tre delar:
 *   1. LEVDAG — berwaldhallen.se hämtas LIVE och extraktorn körs på den.
 *      Rätt svar: ingen rad har en titel som börjar med "—", och
 *      Streetstar-raden har hela konsertnamnet.
 *   2. SYNTHETISK POSITIV — samma markup som live, inbäddad: titeln ska
 *      vara hela rubriken, inte underrubriken.
 *   3. NEGATIV KONTROLL — en vanlig titelklass ("event-title") ska FORTFARANDE
 *      ge en titel. Om fixen varit för aggressiv skulle den här fångas.
 *
 * `--negative-control` muterar en KOPIA av extraktorn tillbaka till
 * före-fix-beteendet och kräver att samma kontroller då FAIL:ar. Annars
 * bevisar gaten ingenting — en gate som aldrig kan falla är inte en gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTRACTOR_DIR = path.join(ROOT, '02-Ingestion', 'F-eventExtraction');
const EXTRACTOR_PATH = path.join(EXTRACTOR_DIR, 'universal-extractor.ts');
const NEGCTL_PATH = path.join(EXTRACTOR_DIR, '__negctl-subtitle-extractor.ts');

const BERWALDHALLEN_URL = 'https://www.berwaldhallen.se';
const STREETSTAR_URL_PART = 'streetstardanceschoolchallenge2026-14-16-ar';
const UNDERRUBRIK_MARK = '—';

/**
 * Mutationer som återställer före-fix-beteendet: "underrubrik räknas som
 * titel". Varje mönster måste matcha EXAKT det angivna antalet ställen —
 * annars vore kopian inte före-fix-koden.
 */
const MUTATIONS = [
  {
    name: 'C3-ownTitle',
    from: 'const $ownTitle = findTitleMarkings($, $a).first();',
    to: 'const $ownTitle = $a.find(TITLE_ELEMENT_SELECTORS).first();',
    count: 1,
  },
  {
    name: 'C3-cardTitle',
    from: 'const $cardTitle = findTitleMarkings($, $card).first();',
    to: 'const $cardTitle = $card.find(TITLE_ELEMENT_SELECTORS).first();',
    count: 1,
  },
  {
    name: 'C3-ownTitles',
    from: 'findTitleMarkings($, $a).each((_: any, el: any) => {',
    to: '$a.find(TITLE_ELEMENT_SELECTORS).each((_: any, el: any) => {',
    count: 1,
  },
  {
    name: 'C1-C2-classSelector',
    from: "      const classSelector = sel === '[class*=\"title\"]' || sel === '[class*=\"heading\"]';\n",
    to: '',
    count: 2,
  },
  {
    name: 'C1-C2-filter',
    from: '        if (classSelector && !elementHasTitleishClass(el)) return;\n',
    to: '',
    count: 2,
  },
];

/** Bygger en före-fix-kopia av extraktorn. Returnerar sökvägen. */
function buildPrefixCopy() {
  const source = fs.readFileSync(EXTRACTOR_PATH, 'utf8');
  let mutated = source;
  for (const m of MUTATIONS) {
    const parts = mutated.split(m.from);
    if (parts.length - 1 !== m.count) {
      throw new Error(
        `mutationen för ${m.name} träffar ${parts.length - 1} ställen (förväntat ${m.count}) — ` +
          `kopian skulle inte vara före-fix-koden`,
      );
    }
    mutated = parts.join(m.to);
  }
  fs.writeFileSync(NEGCTL_PATH, mutated, 'utf8');
  return NEGCTL_PATH;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/** Real markup från berwaldhallen.se (2026-10-25). */
const BERWALDHALLEN_HTML = `<!doctype html>
<html lang="sv">
<body>
  <ul class="Post-list">
    <li class="Blurb Blurb--default">
      <div class="Production-details__runs" aria-label="Pågår"><span>29 oktober</span></div>
      <h3 class="Blurb__heading">
        <a class="Blurb__cta" href="/konsert/streetstardanceschoolchallenge2026-14-16-ar">Streetstar Dance School Challenge 2026<span class="Blurb__subtitle"> — Next Generation 14–16 år</span></a>
      </h3>
    </li>
  </ul>
</body>
</html>`;

/** En vanlig titelklass — får INTE påverkas av fixen. */
const PLAIN_TITLE_HTML = `<!doctype html>
<html lang="sv">
<body>
  <div class="event-card">
    <h2 class="event-title">Sjungande vänner</h2>
    <time datetime="2026-11-07">7 november</time>
    <a href="/konsert/kvart/">Sjungande vänner</a>
  </div>
</body>
</html>`;

/** Kör de tre kontrollerna mot en given extraktor. */
async function runChecks(extractorPath) {
  const { extractEvents } = await import(extractorPath);
  const localFailures = [];

  // 1. LEVDAG: berwaldhallen.se
  let liveTitle = '';
  let liveDate = '';
  let liveRows = 0;
  try {
    const html = await fetchHtml(BERWALDHALLEN_URL);
    const result = extractEvents(html, 'berwaldhallen', BERWALDHALLEN_URL);
    liveRows = result.events.length;
    const underrubrikRader = result.events.filter((e) =>
      String(e.title ?? '').trim().startsWith(UNDERRUBRIK_MARK),
    );
    if (underrubrikRader.length > 0) {
      localFailures.push(
        `live: ${underrubrikRader.length} av ${result.events.length} rader har en underrubrik som titel ` +
          `(t.ex. "${String(underrubrikRader[0].title).slice(0, 40)}")`,
      );
    }
    const evt = result.events.find((e) => String(e.url ?? '').includes(STREETSTAR_URL_PART));
    if (!evt) {
      localFailures.push(`live: ingen rad med url ${STREETSTAR_URL_PART} i ${result.events.length} rader`);
    } else {
      liveTitle = String(evt.title ?? '');
      liveDate = String(evt.date ?? '');
      if (!liveTitle.includes('Streetstar Dance School Challenge 2026')) {
        localFailures.push(`live: titeln blev "${liveTitle}" (förväntat innehålla konsertnamnet)`);
      }
    }
  } catch (e) {
    localFailures.push(`live: hämtning/extraction kastade: ${e.message}`);
  }

  // 2. SYNTHETISK POSITIV: hela rubriken, inte underrubriken
  const posResult = extractEvents(BERWALDHALLEN_HTML, 'berwaldhallen', 'https://www.berwaldhallen.se/');
  const posEvent = posResult.events.find((e) =>
    String(e.url ?? '').includes(STREETSTAR_URL_PART),
  );
  if (!posEvent) {
    localFailures.push(`positiv: ingen rad hittades (${posResult.events.length} rader)`);
  } else if (!String(posEvent.title).includes('Streetstar Dance School Challenge 2026')) {
    localFailures.push(`positiv: titeln blev "${posEvent.title}" (underrubriken läste igen)`);
  }

  // 3. NEGATIV KONTROLL: vanliga titelklasser ska fortfarande fungera
  const plainResult = extractEvents(PLAIN_TITLE_HTML, 'example-venue', 'https://example.se/');
  const plainEvent = plainResult.events.find((e) => String(e.url ?? '').includes('/kvart/'));
  if (!plainEvent) {
    localFailures.push(`negativ: ingen rad för "event-title" (${plainResult.events.length} rader)`);
  } else if (!String(plainEvent.title).includes('Sjungande vänner')) {
    localFailures.push(`negativ: titeln blev "${plainEvent.title}" (fixen är för aggressiv)`);
  }

  return { localFailures, liveTitle, liveDate, liveRows };
}

// ── Läge 1: negativ kontroll (före-fix-kopia MÅSTE fail:a) ─────────────────
if (process.argv.includes('--negative-control')) {
  let copyPath = null;
  try {
    copyPath = buildPrefixCopy();
    const { localFailures } = await runChecks(copyPath);
    if (localFailures.length === 0) {
      console.error(
        'sb-negativkontroll: FAIL före-fix-kopian PASS:ar kontrollerna — gaten mäter ingenting',
      );
      process.exit(1);
    }
    console.log(
      `sb-negativkontroll: före-fix-kopia FAIL:ar som väntat (${localFailures.length} kontroller) pass`,
    );
  } catch (e) {
    console.error(`sb-negativkontroll: FAIL ${e.message}`);
    process.exit(1);
  } finally {
    if (copyPath) fs.rmSync(copyPath, { force: true });
  }
  process.exit(0);
}

// ── Läge 2: vanlig kontroll mot den riktiga extraktorn ────────────────────
const { localFailures, liveTitle, liveDate, liveRows } = await runChecks(EXTRACTOR_PATH);
if (localFailures.length > 0) {
  console.error(`sb: FAIL ${localFailures.join(' | ')}`);
  process.exit(1);
}
console.log(
  `sb: live berwaldhallen rader=${liveRows} streetstar="${String(liveTitle).slice(0, 45)}" ${liveDate} kontroller=3 pass`,
);
