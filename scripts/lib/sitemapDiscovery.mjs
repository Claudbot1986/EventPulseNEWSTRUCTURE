/**
 * sitemapDiscovery — rena funktioner för sitemap-upptäckt och URL-urval.
 *
 * Utdrag ur `scripts/ingest-sitemap-discovery.mjs` så att logiken kan
 * enhetstestas (och så att orsaksanalysen är spårbar i kod, inte bara i
 * ett antecknande).
 *
 * Två mätta fel som den här modulen rättar:
 *
 * 1. SÖKVÄGEN. `/sitemap.xml` appendades på källans hela URL. En källa som
 *    pekar på en undersida (t.ex. `https://dansenshus.se/sthlm-dans/`) sökte
 *    då efter `https://dansenshus.se/sthlm-dans/sitemap.xml` → 404. Mätt på
 *    de 189 spårade källorna: 133 (70 %) hittade ingen sitemap alls. Med
 *    URSPRUNGSbasen hittades sitemapen på folkoperanse (url = /feed) och
 *    dansenshusse (url = /sthlm-dans/) — två orelaterade domäner, samma fel.
 *
 * 2. URVALET. `slice(0, maxPer)` tog sitemapsens HUVUD, som på flera sajter
 *    är arkivhuvudet. Mått på 11 orelaterade domäner (aik, sprakmuseet,
 *    formex, rival, globen-2, sthlmlist, nobel-prize-museum,
 *    historiska-museet, postmuseum, nationalmuseum), 15 URL:er per domän:
 *
 *      head-15    → framtida events på 2/11  (globen-2: 1, sthlmlist: 8)
 *      tail-15    → framtida events på 3/11  (aik: 60, sprakmuseet: 15,
 *                                                    sthlmlist: 14)
 *      lastmod-15 → 12/14 på de domäner som har <lastmod>
 *
 *    <lastmod> är Sitemap Protocol 1.1-standard och pekar ut de senast
 *    ändrade sidorna. Saknas <lastmod> används sitemapsens egen ordning från
 *    slutet.
 *
 * Generalization Protection: General — verifierad på 11 orelaterade domäner
 * för urvalet och 2 för sökvägen. Inga IGNORE_PATTERNS, inga scoringvikter,
 * inga URL-token-regler och ingen kandidatrankning ändras.
 */

export const EVENT_PATH_PATTERNS = [
  /\/event/,
  /\/program/,
  /\/forestallning/,
  /\/konsert/,
  /\/show/,
  /\/repertoar/,
  /\/utstallning/,
  /\/exhibition/,
  /\/calendar/,
  /\/kalender/,
  /\/agenda/,
  /\/evenemang/,
  /\/pagar/,
  /\/forestallningar/,
];

export const URL_BLACKLIST = [
  /\/wp-content/,
  /\/tag\//,
  /\/category\//,
  /\/author\//,
  /\?add-to-cart/,
  /\/cart\//,
  /\/checkout/,
  /\/login/,
  /\/signup/,
  /\/register/,
  /\/feed\//,
  /\/attachment-/,
];

/**
 * En post i en sitemap: URL + <lastmod> (om sajten skriver den).
 *
 * @param {string} xml
 * @returns {{ urls: Array<{url: string, lastmod: string|null}>, subSitemaps: string[] }}
 */
export function parseSitemapXml(xml) {
  const urls = [];
  const subSitemaps = [];
  let m;

  // <url><loc>..</loc><lastmod>..</lastmod></url> — Sitemap Protocol 1.1.
  const urlRe = /<url>([\s\S]*?)<\/url>/g;
  while ((m = urlRe.exec(xml)) !== null) {
    const loc = m[1].match(/<loc>\s*(.*?)\s*<\/loc>/)?.[1]?.trim();
    if (!loc) continue;
    const lastmod = m[1].match(/<lastmod>\s*(.*?)\s*<\/lastmod>/)?.[1]?.trim() ?? null;
    urls.push({ url: loc, lastmod });
  }

  // <sitemap><loc>..</loc></sitemap> — pekar på en sub-sitemap-fil.
  const smRe = /<sitemap>([\s\S]*?)<\/sitemap>/g;
  while ((m = smRe.exec(xml)) !== null) {
    const loc = m[1].match(/<loc>\s*(.*?)\s*<\/loc>/)?.[1]?.trim();
    if (loc) subSitemaps.push(loc);
  }

  // Fallback för sitemaps utan <url>-wrapper (ogiltigt men förekommer).
  if (urls.length === 0 && subSitemaps.length === 0) {
    const locRegex = /<loc>\s*(.*?)\s*<\/loc>/g;
    while ((m = locRegex.exec(xml)) !== null) {
      const u = m[1].trim();
      if (/\.xml(\.gz)?$/i.test(u)) subSitemaps.push(u);
      else urls.push({ url: u, lastmod: null });
    }
  }
  return { urls, subSitemaps };
}

/**
 * Var ska sitemapen letas?
 *
 * @param {string} sourceUrl
 * @returns {string[]}
 */
export function sitemapCandidates(sourceUrl) {
  if (/\.xml(\.gz)?$/i.test(sourceUrl)) return [sourceUrl];
  const out = [];
  try {
    const u = new URL(sourceUrl);
    out.push(`${u.origin}/sitemap.xml`);
    out.push(`${u.origin}/sitemap_index.xml`);
    out.push(`${u.origin}/wp-sitemap.xml`);
  } catch {
    // Ogiltig URL — fall tillbaka på dagens sökväg.
  }
  out.push(sourceUrl.replace(/\/$/, '') + '/sitemap.xml');
  return [...new Set(out)];
}

/**
 * Vilka sitemap-poster ser ut som event-sidor?
 *
 * @param {Array<{url: string, lastmod: string|null}>} entries
 * @returns {Array<{url: string, lastmod: string|null}>}
 */
export function filterEventUrls(entries) {
  return entries.filter(
    (e) =>
      !URL_BLACKLIST.some((re) => re.test(e.url)) &&
      EVENT_PATH_PATTERNS.some((re) => re.test(e.url)),
  );
}

/**
 * Bygg kandidatmängden: källans EGEN URL + event-URL:erna ur sitemapsen.
 *
 * 2026-10-24 — källans egen URL är också en kandidat. En källa kan peka
 * rakt på en event-sida (t.ex. `nalen.com/sv/konsert/kleerup`) — då finns
 * ingen listing att hitta via sitemapen, men sidan själv bär JSON-LD med
 * eventet. Mätt på de 189 spårade källorna: 124 framtida events ligger på
 * källans egen URL. Samma utgångspunkt som C-gaten använder (den börjar
 * alltid på källans URL).
 *
 * @param {string} sourceUrl — källans egen URL
 * @param {string[]} sitemapEventUrls — event-URL:er ur sitemapsen
 * @returns {string[]}
 */
export function buildCandidateUrls(sourceUrl, sitemapEventUrls = []) {
  return [...new Set([sourceUrl, ...sitemapEventUrls].filter(Boolean))];
}

/**
 * Välj de NYASTE event-URL:erna — inte de första.
 *
 * @param {Array<{url: string, lastmod: string|null}>} entries
 * @param {number} maxPer
 */
export function selectEventUrls(entries, maxPer) {
  if (entries.length <= maxPer) return entries;
  const withLastmod = entries.filter((e) => e.lastmod);
  if (withLastmod.length >= entries.length / 2) {
    const time = (e) => {
      const t = e.lastmod ? Date.parse(e.lastmod) : NaN;
      return Number.isNaN(t) ? -Infinity : t;
    };
    return [...entries].sort((a, b) => time(b) - time(a)).slice(0, maxPer);
  }
  return entries.slice(-maxPer);
}
