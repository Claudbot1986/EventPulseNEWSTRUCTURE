/**
 * Site-specific adapter registry
 *
 * Each adapter is an isolated module that handles extraction quirks for
 * ONE specific source. Per CLAUDE.md Generalization Protection Rule, these
 * adapters must NOT influence C0/C1/C2 — they run as a priority step before
 * the universal extractor heuristics, only when the URL matches.
 *
 * To add a new adapter:
 *   1. Create a file in this directory (e.g. `mysource.ts`)
 *   2. Export `matches(url: string): boolean` and `extract(html, url, source)`
 *   3. Add it to the ADAPTERS array below
 *   4. Add tests in `mysource.test.ts`
 */
import * as intiman from './intiman';
import * as arkdes from './arkdes';
import * as folkoperan from './folkoperan';
import * as chinaTeatern from './china-teatern';
import * as eventbriteStockholm from './eventbriteStockholm';
import * as visitstockholm from './visitstockholm';
import * as billettoStockholm from './billettoStockholm';
import * as biljettshop from './biljettshop';
import * as momentsapp from './momentsapp';
import * as zita from './zita';
import * as nalen from './nalen';
import * as cafeopera from './cafeopera';
import * as historiskaMuseet from './historiskaMuseet';
import * as livrustkammaren from './livrustkammaren';
import * as pingstkyrkan from './pingstkyrkan';
import * as stockholmJazz from './stockholmJazz';
import * as teaterGaleasen from './teaterGaleasen';
import * as hammarby from './hammarby';
import * as ifkStockholm from './ifkStockholm';
import * as riksarkivet from './riksarkivet';
import * as kultur1 from './kultur1';
import * as kungstradgarden from './kungstradgarden';
import * as kammaren from './kammaren';
import * as ladan from './ladan';
import * as waldemarsudde from './waldemarsudde';
import * as vasalund from './vasalund';
import type { ParsedEvent } from '../schema';

export interface SiteAdapter {
  name: string;
  matches: (url: string) => boolean;
  extract: (
    html: string,
    url: string,
    source?: string
  ) => { showUrls: string[]; events: ParsedEvent[]; method: string };
  /**
   * Adaptern är AUKTORITATIV för sin sajt: om den matchar och hittar
   * inget, så är "inget" det rätta svaret — universalheuristiken får
   * inte fylla på med något annat.
   *
   * Varför flaggan finns (2026-10-24, mätt på två orelaterade domäner):
   *
   *   folkoperan.se — adaptern ger 0 events på rot-sidan, men universal-
   *     heuristiken ger 30 RIKTIGA events ("Jag är Ulla Winblad",
   *     "Nietzsche kontra Wagner"). Här är fallbacken värdefull.
   *   ladansthlm.se — adaptern ger korrekt 0 events (sajten publicerar
   *     inga daterade evenemang), men universalheuristiken hittar
   *     ÖPPETTIDER ("Tisdag - Torsdag 17:00-23:00") och tillverkar ett
   *     falskt event: "Vad är Lådan?", 2026-10-27 17:00.
   *
   * En gemensam regel ("adaptern vinner alltid") skulle alltså förlora 30
   * riktiga folkoperan-events — negativ kontroll på att blankettregeln är
   * FEL. Därför är flaggan opt-in per adapter, och bara sajter där
   * universalheuristiken faktiskt skadar sätter den.
   *
   * Per CLAUDE.md Generalization Protection Rule: detta är en
   * source-adapter-fråga, inte en C0/C1/C2-ändring. Ingen
   * upptäcktsheuristik rörs.
   */
  authoritative?: boolean;
}

export const ADAPTERS: SiteAdapter[] = [
  {
    name: 'intiman',
    matches: intiman.matches,
    extract: intiman.extract,
  },
  {
    name: 'arkdes',
    matches: arkdes.matches,
    extract: arkdes.extract,
  },
  {
    name: 'folkoperan',
    matches: folkoperan.matches,
    extract: folkoperan.extract,
  },
  {
    name: 'china-teatern',
    matches: chinaTeatern.matches,
    extract: chinaTeatern.extract,
  },
  {
    name: 'eventbriteStockholm',
    matches: eventbriteStockholm.matches,
    extract: eventbriteStockholm.extract,
  },
  {
    name: 'visitstockholm',
    matches: visitstockholm.matches,
    extract: visitstockholm.extract,
  },
  {
    name: 'billettoStockholm',
    matches: billettoStockholm.matches,
    extract: billettoStockholm.extract,
  },
  {
    name: 'biljettshop',
    matches: biljettshop.matches,
    extract: biljettshop.extract,
  },
  {
    name: 'momentsapp',
    matches: momentsapp.matches,
    extract: momentsapp.extract,
  },
  {
    name: 'zita',
    matches: zita.matches,
    extract: zita.extract,
  },
  {
    name: 'nalen',
    matches: nalen.matches,
    extract: nalen.extract,
  },
  // 2026-10-24 — de 13 JS-renderade källorna som C-gatens universella
  // extraktor inte kunde plocka något ur (mätt: raw=0 usable=0 på fem av dem).
  // Varje adapter är isolerad i sin egen modul per Generalization Protection
  // Rule — ingen av dem påverkar C0/C1/C2.
  {
    name: 'cafeopera',
    matches: cafeopera.matches,
    extract: cafeopera.extract,
  },
  {
    name: 'historiskaMuseet',
    matches: historiskaMuseet.matches,
    extract: historiskaMuseet.extract,
  },
  {
    name: 'livrustkammaren',
    matches: livrustkammaren.matches,
    extract: livrustkammaren.extract,
  },
  {
    name: 'pingstkyrkan',
    matches: pingstkyrkan.matches,
    extract: pingstkyrkan.extract,
  },
  {
    name: 'stockholmJazz',
    matches: stockholmJazz.matches,
    extract: stockholmJazz.extract,
  },
  {
    name: 'teaterGaleasen',
    matches: teaterGaleasen.matches,
    extract: teaterGaleasen.extract,
  },
  // 2026-10-24 — nästa omgång nollradskällor. Varje adapter mätt mot den
  // riktiga sajten (se modulens header för mätvärdena) och isolerad från
  // C0/C1/C2 enligt Generalization Protection Rule.
  {
    name: 'hammarby',
    matches: hammarby.matches,
    extract: hammarby.extract,
  },
  {
    name: 'ifkStockholm',
    matches: ifkStockholm.matches,
    extract: ifkStockholm.extract,
  },
  {
    name: 'riksarkivet',
    matches: riksarkivet.matches,
    extract: riksarkivet.extract,
  },
  {
    name: 'kultur1',
    matches: kultur1.matches,
    extract: kultur1.extract,
  },
  {
    name: 'kungstradgarden',
    matches: kungstradgarden.matches,
    extract: kungstradgarden.extract,
  },
  {
    name: 'kammaren',
    matches: kammaren.matches,
    extract: kammaren.extract,
  },
  {
    name: 'ladan',
    matches: ladan.matches,
    extract: ladan.extract,
    // Mätt 2026-10-24: universalheuristiken gör ett falskt event av
    // "Tisdag - Torsdag 17:00-23:00" ("Vad är Lådan?", 2026-10-27 17:00).
    // Lådan publicerar inga daterade evenemang, så "inget" är svaret.
    authoritative: true,
  },
  {
    name: 'vasalund',
    matches: vasalund.matches,
    extract: vasalund.extract,
  },
  // 2026-10-24 — waldemarsudde.se ligger bakom SiteGround:s sgcaptcha-vägg
  // (vanlig hämtning → HTTP 202 + captcha-redirect) och listningen laddas via
  // AJAX (0 datum i den renderade HTML:en). WordPress har en egen post-typ
  // "activity" vars datum står i löptexten. Adaptern läser WP-REST-JSON:en
  // och bevisar året ur veckodagen. Se modulens header för mätvärdena.
  {
    name: 'waldemarsudde',
    matches: waldemarsudde.matches,
    extract: waldemarsudde.extract,
  },
];

export function runAdapters(
  html: string,
  url: string,
  source?: string
): { adapter: string; showUrls: string[]; events: ParsedEvent[]; authoritative: boolean } | null {
  // 2026-10-24 — adapter som matchade men hittade inget ska RAPPORTERAS,
  // inte försvinna. Utan detta kan ingen kallare skilja på "ingen adapter
  // äger den här URL:en" och "sajtens egen läsare säger att det är tomt".
  // Den skillnaden är hela grunden för regeln "källan lever men har inget"
  // (se run-dynamic-pool.ts, exitReason SITE_ADAPTER_EMPTY).
  let emptyMatch: string | null = null;

  for (const adapter of ADAPTERS) {
    if (!adapter.matches(url)) continue;
    const result = adapter.extract(html, url, source);
    if (result.showUrls.length > 0 || result.events.length > 0) {
      return {
        adapter: adapter.name,
        showUrls: result.showUrls,
        events: result.events,
        authoritative: adapter.authoritative === true,
      };
    }
    // Adaptern matchade men hittade inget. Är den auktoritativ för sin
    // sajt är "inget" det rätta svaret — universalheuristiken får inte
    // fylla på (se SiteAdapter.authoritative).
    if (adapter.authoritative === true) {
      return { adapter: adapter.name, showUrls: [], events: [], authoritative: true };
    }
    // Annars: spara den första tomma träffen och fortsätt — en sann
    // event-adapter kan äga samma URL. Om ingen hittar något returneras
    // den tomma träffen i slutet av loopen.
    if (!emptyMatch) emptyMatch = adapter.name;
  }

  if (emptyMatch) {
    return { adapter: emptyMatch, showUrls: [], events: [], authoritative: false };
  }
  return null;
}
