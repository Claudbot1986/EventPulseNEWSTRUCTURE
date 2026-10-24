/**
 * Klass-token som betyder "rubrik" — och underrubrik som INTE gör det.
 *
 * VARFÖR (2026-10-25): extraktorn hittar titlar med `[class*="title"]`.
 * Men CSS-väljaren `[class*="title"]` matchar ÄVEN varje klass som
 * innehåller strängen "title" — och det gör bland annat
 * "subtitle", "subTitle", "hero-video__subtitle" och
 * "post-carousel__item-subtitle".
 *
 * Följden på berwaldhallen.se:
 *
 *   <h3 class="Blurb__heading">
 *     <a href="…/streetstardanceschoolchallenge2026-14-16-ar">
 *       Streetstar Dance School Challenge 2026
 *       <span class="Blurb__subtitle"> — Next Generation 14–16 år</span>
 *     </a>
 *   </h3>
 *
 * C3 letar efter ett eget titelelement INUTI ankaret. "Blurb__subtitle"
 * matchar `[class*="title"]` och ligger först i dokumentordningen — så
 * underrubriken blev evenemangets namn. 20 av berwaldhallens rader fick
 * titeln "— Next Generation 14–16 år" i stället för konsertens namn.
 *
 * BEVIS FÖR GENERAL (Generalization Protection Rule): samma klassmönster
 * finns på sju ORELATERADE domäner (uppmätta 2026-10-25 över 112
 * aktiva källor):
 *
 *   berwaldhallen.se         Blurb__subtitle
 *   berwaldhallen-tixly.se   Blurb__subtitle
 *   concerts50.com           subtitle2
 *   nobelprizemuseum.se      hero-video__subtitle
 *   modernamuseet.se         post-carousel__item-subtitle
 *                             article__meta-item--subtitle
 *                             wp-block-sage-card-link__subtitle
 *   scalateatern.se          subtitle
 *   svt.se                   svt-news-header__mobile-sub-link-subtitle
 *                             RelatedLinkTeaser__subTitle___yWnZC
 *                             LatestBroadcast__subTitle___D5wBO
 *
 * Det är HTML-kontraktet "klassnamn med 'subtitle' betyder underrubrik",
 * inte ett sitedomänproblem. Negativ kontroll: riktiga titlar ("title",
 * "event-title", "post__title", "Blurb__heading") påverkas inte.
 */

/**
 * En klass-token räknas som rubrik-token om den innehåller "title" eller
 * "heading" OCH inte innehåller "subtitle".
 *
 * "subTitle" skrivs med stor T i vissa designsystem — jämförelsen är
 * därför skiftlägesokänslig. "post-title post-subtitle" har en rubrik-token
 * som INTE är underrubrik ("post-title") och räknas därför som rubrik.
 */
export function classTokenIsTitleish(token: string): boolean {
  const t = token.toLowerCase();
  if (t.includes('subtitle')) return false;
  return t.includes('title') || t.includes('heading');
}

/**
 * Bär elementet en dedikerad rubrik-markering?
 *
 * Element utan klass räknas som rubrik — de kan bara ha matchats av
 * h1–h6 eller av en data-*-selektor.
 */
export function elementHasTitleishClass(el: unknown): boolean {
  const cls = String((el as { attribs?: { class?: string } })?.attribs?.class ?? '');
  const tokens = cls.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.some(classTokenIsTitleish);
}

/**
 * Är elementet en rubrik (h1–h6)? Sådana är alltid rubriker, oavsett
 * klass — en h2 med klassen "text-2xl font-bold" är fortfarande en rubrik.
 */
export function isHeadingTag(el: unknown): boolean {
  const tag = String((el as { tagName?: string; name?: string })?.tagName ?? (el as { name?: string })?.name ?? '');
  return /^h[1-6]$/i.test(tag);
}

/**
 * Ska elementet räknas som en titel-markering?
 *
 * Rubriker (h1–h6) räknas alltid. Övriga element måste ha en
 * rubrik-token i klassen — "Blurb__subtitle" har inte det.
 */
export function isTitleMarking(el: unknown): boolean {
  if (isHeadingTag(el)) return true;
  return elementHasTitleishClass(el);
}
