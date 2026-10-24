/**
 * sourceEntryUrls.ts — källspecifika ingångs-URL:er för D-gaten.
 *
 * Bakgrund (2026-10-24). momentsapp:s kalendersidor är **datumlåsta**:
 *
 *   /events/stockholm/kalender/2026-10-04
 *
 * Ett sådant URL är en ögonblicksbild från discovery-tidpunkten. Mätt med
 * D-gatens riktiga renderPage (ScrapingBee premium-only, 2026-10-24) och
 * momentsapp-adaptern:
 *
 *   /kalender/2026-10-04 →  71 events, ALLA i det förflutna (0 importerade)
 *   /kalender/2026-10-24 → 126 events, 1 dag  (2026-10-24)
 *   /kalender/2026-10-31 →  69 events, 1 dag
 *   /kalender/2026-10    →   0 events (148 kB — en DAG-LÄNKA, inte event)
 *   /kalender            →   0 events (index: bara länkar till dagar)
 *   /kalender/2026-11    → 1904 events, 30 dagar (2026-11-01 … 2026-11-30)
 *   /kalender/2026-12    →  847 events, 30 dagar (2026-12-01 … 2026-12-31)
 *
 * Tre lärdomar ur mätningen:
 *
 * 1. En månadsvy M täcker **exakt månad M** i Europe/Stockholm — inte
 *    [M−1 sista dag … M sista dag]. November-vyn börjar 2026-11-01, inte
 *    2026-10-31. (Den tidigare hypotesen i den här filen var fel; mätningen
 *    ovan är källan.)
 * 2. Månadsvyn för den **innevarande** månaden innehåller inga events — bara
 *    länkar till dagarna. Därför måste innevarande månad hämtas dag för dag.
 * 3. Dagsidor ger ~126 events per render, månadsvyer ~800–1900 per render.
 *    Månadsvyn ger alltså ~10× fler events per credit.
 *
 * Utan detta pekade källans URL på en ögonblicksbild, och D-gaten skrev
 * 71 events som alla var i det förflutna — importen hoppade över dem med
 * "passerat datum" och källan landade i databasen med 0 events.
 *
 * Varför detta ligger här och inte i C-lagret: CLAUDE.md:s Generalization
 * Protection Rule säger att ett mönster från en enda sajt inte får styra
 * C0/C1/C2 — där gäller "använd source adapter, source-specific config".
 * Detta är exakt source-specific config, och det är avsiktligt isolerat så
 * att ingen universell logik påverkas. Extraheringen av korten ligger i
 * `02-Ingestion/F-eventExtraction/adapters/momentsapp.ts`.
 *
 * Varje post MÅSTE ha ett mätbart bevis i `evidence`. Ett påstående utan
 * mätning är inte godkänt som skäl.
 */

/** Hur många månadsvyer framåt som hämtas. 2 månader ≈ 2 750 events per körning. */
const MONTH_VIEWS_AHEAD = 2;

/**
 * Hur många dagar av innevarande månad som hämtas per körning.
 *
 * Fönstret glider: varje natt börjar det på "idag". Eftersom events som
 * väl importerats ligger kvar i databasen tappar inget — bara den dags
 * händelse förloras om man bara fångar den 0 dagar före. Fönstret på 7
 * dagar ger 7 dagars förvarning, vilket är rimligt för en personlig
 * eventagent, och håller nattkostnaden till 2 + 7 = 9 renderar.
 */
const DAY_LOOKAHEAD_DAYS = 7;

export interface SourceEntryUrlResolver {
  /** sourceId i sources/*.jsonl */
  sourceId: string;
  /** Mätbart bevis (kommando + utfall). */
  evidence: string;
  /**
   * Returnerar de URL:er D-gaten ska rendera, i prioritetsordning.
   * Tom array = "ingen särskild hantering" (använd källans egen URL).
   */
  resolve(sourceUrl: string, now?: Date): string[];
}

/** Datum (YYYY-MM-DD) i Europe/Stockholm. */
function stockholmDay(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value),
    month: Number(parts.find((p) => p.type === 'month')?.value),
    day: Number(parts.find((p) => p.type === 'day')?.value),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Antal dagar igiven månad (0-indxerad månad). */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

const RESOLVERS: SourceEntryUrlResolver[] = [
  {
    sourceId: 'waldemarsudde',
    evidence:
      'Mätt 2026-10-24 mot den riktiga sajten. (1) Bot-vägg: vanlig hämtning av ' +
      'waldemarsudde.se svarar HTTP 202 med <meta http-equiv="refresh" ' +
      'content="0;/.well-known/sgcaptcha/?r=…"> — ScrapingBees premium-proxy går förbi. ' +
      '(2) Listningssidan /aktiviteter/ renderar 153 kB men innehåller NOLL datum — ' +
      'korten laddas via AJAX. (3) WordPress har egen post-typ "activity" ' +
      '(rest_base "activity"); datumet står i content.rendered som löptext, inte i acf. ' +
      '(4) Mätt via ScrapingBee static-only (10 credits/sida): REST-API:et ger 598 poster ' +
      'i 6 sidor à 100. (5) Adaptermätning på de 500 nyaste posterna: sida 1 ' +
      '(publicerad 2026-04-27..2026-09-16) ger 85 poster med datum och 15 FRAMTIDA ' +
      'events; sida 2 (2025-06-18..2026-04-27), 3, 4 och 5 ger 0 framtida events. ' +
      'Sida 1 räcker alltså och kostar EN render per körning.',
    resolve(sourceUrl) {
      if (!/waldemarsudde\.se/i.test(sourceUrl)) return [];
      // _fields håller payloaden liten: utan dem är svaret 1 156 793 B och
      // sidan 6 timeout:ade; med dem ~330 kB per sida.
      return [
        'https://waldemarsudde.se/wp-json/wp/v2/activity?per_page=100&_fields=id,link,title,date,content',
      ];
    },
  },
  {
    sourceId: 'momentsapp-stockholm',
    evidence:
      'Mätt 2026-10-24 (D-gatens renderPage med ScrapingBee premium-only, ' +
      'extrahering via momentsapp-adaptern): /kalender/2026-10-24 → 126 events, ' +
      '1 dag; /kalender/2026-10 → 0 events (148 kB, dag-länka); /kalender → 0 events; ' +
      '/kalender/2026-11 → 1904 events (2026-11-01…2026-11-30); ' +
      '/kalender/2026-12 → 847 events (2026-12-01…2026-12-31). ' +
      'Universellextractorn gav 4 resp. 41 träffar med skräptitlar/-datum på samma sidor.',
    resolve(sourceUrl, now = new Date()) {
      if (!/momentsapp\.no/i.test(sourceUrl)) return [];
      const base = sourceUrl.replace(/\/kalender\/\d{4}-\d{2}(-\d{2})?.*$/i, '/kalender');

      const { year, month, day } = stockholmDay(now);
      const monthIndex = month - 1;
      const totalDays = daysInMonth(year, monthIndex);

      // 1) Månadsvyer för de närmaste månaderna framåt — ger flest events
      //    per credit (~10× fler än en dagsida).
      const monthViews: string[] = [];
      for (let ahead = 1; ahead <= MONTH_VIEWS_AHEAD; ahead++) {
        const total = year * 12 + monthIndex + ahead;
        const viewYear = Math.floor(total / 12);
        const viewMonth = (total % 12) + 1;
        monthViews.push(`${base}/${viewYear}-${pad(viewMonth)}`);
      }

      // 2) Kvarvarande dagar i innevarande månad — månadsvyn täcker dem inte
      //    (mätning: /kalender/2026-10 ger 0 events).
      const dayPages: string[] = [];
      const lastDay = Math.min(totalDays, day + DAY_LOOKAHEAD_DAYS - 1);
      for (let d = day; d <= lastDay; d++) {
        dayPages.push(`${base}/${year}-${pad(month)}-${pad(d)}`);
      }

      // Månadsvyer först: de ger flest events per credit. D-gaten kapar
      // listan på maxPages, så de får inte sitta sist.
      return [...monthViews, ...dayPages];
    },
  },
];

/**
 * Returnerar ingångs-URL:er för en källa, eller null om källan inte har
 * någon särskild hantering (då används källans egen URL).
 */
export function resolveEntryUrls(
  sourceId: string,
  sourceUrl: string,
  now?: Date
): string[] | null {
  const resolver = RESOLVERS.find((r) => r.sourceId === sourceId);
  if (!resolver) return null;
  const urls = resolver.resolve(sourceUrl, now);
  return urls.length > 0 ? urls : null;
}
