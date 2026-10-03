/**
 * stripHtml — robust HTML-stripper för descriptions från ingestion-källor
 * (främst spelning.se som kommer in via events_public med rå `<p>...</p>`-taggar).
 *
 * 2026-10-03 — spelning.se-exporter innehåller ofta HTML-taggar i
 * description_sv/description_en (t.ex. Robert Wells: "<p>Efter en
 * succéartad...</p><p>Från starten...</p>"). Utan strip syns "</p>" rakt
 * i UI:t. Denna helper sanerar texten men bevarar läsbarhet:
 *   • Block-taggar (`</p>`, `</div>`, `</li>`, `</h1>`...) → dubbel newline
 *     (= paragraf-brytning i RN-Text)
 *   • `<br>` → enkel newline
 *   • Övriga taggar (inkl. attribut) → tas bort helt
 *   • HTML-entiteter (&amp;, &#x27;, &auml;, ...) → avkodas till Unicode
 *   • Multipla whitespace-newlines → kollapsas
 *
 * Pure function, ingen React/JSX — användbar i både UI och tester.
 *
 * @param {string|null|undefined} html
 * @returns {string|null} ren text, eller null om input var tom/null
 */
export function stripHtml(html) {
  if (html == null) return null;
  if (typeof html !== 'string') return null;
  if (html.length === 0) return '';

  let s = html;

  // 1. Avkoda numeriska HTML-entiteter FÖRST (innan vi rör taggar).
  //    Hanterar &#123; och &#x7B; → tecken. Detta fångar Unicode-punkt-tecken
  //    (&#x2013; = –, &#x27; = ') som spelning.se ofta använder.
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const code = parseInt(hex, 16);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
    try {
      return String.fromCodePoint(code);
    } catch (_) {
      return '';
    }
  });
  s = s.replace(/&#(\d+);/g, (_, dec) => {
    const code = parseInt(dec, 10);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
    try {
      return String.fromCodePoint(code);
    } catch (_) {
      return '';
    }
  });

  // 2. Namngivna HTML-entiteter (de vanligaste). Vi tar inte hela
  //    HTML-specifikationen — bara de vi sett i praktiken (spelning.se +
  //    andra aggregatorer). Ordningen är viktig: &amp; sist så vi inte
  //    dubbel-avkodar.
  const NAMED_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    laquo: '«',
    raquo: '»',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”',
    copy: '©',
    reg: '®',
    trade: '™',
    // Svenska/accented (vanligt i spelning.se-importer)
    auml: 'ä',
    ouml: 'ö',
    Auml: 'Ä',
    Ouml: 'Ö',
    aring: 'å',
    Aring: 'Å',
    euml: 'ë',
    iuml: 'ï',
    Euml: 'Ë',
    Iuml: 'Ï',
    szlig: 'ß',
    agrave: 'à',
    aacute: 'á',
    acirc: 'â',
    atilde: 'ã',
    egrave: 'è',
    eacute: 'é',
    ecirc: 'ê',
    igrave: 'ì',
    iacute: 'í',
    icirc: 'î',
    ograve: 'ò',
    oacute: 'ó',
    ocirc: 'ô',
    otilde: 'õ',
    ugrave: 'ù',
    uacute: 'ú',
    ucirc: 'û',
    yacute: 'ý',
    ntilde: 'ñ',
    Ntilde: 'Ñ',
    ccedil: 'ç',
    Ccedil: 'Ç',
  };
  s = s.replace(/&([a-zA-Z]+);/g, (full, name) => {
    if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)) {
      return NAMED_ENTITIES[name];
    }
    // Okänd entity — lämna orörd så vi inte korrumperar data.
    return full;
  });

  // 3. Block-taggar (som normalt avslutar en paragraf) → dubbel newline.
  //    </p>, </div>, </li>, </h1>-</h6>, </tr>, </section>, etc.
  s = s.replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|td|th|section|article|header|footer|nav|aside|main|blockquote|pre|figure|figcaption|dl|dd|dt)\s*>/gi, '\n\n');

  // 4. <br> och <hr> → enkel newline.
  s = s.replace(/<\s*br\s*\/?>/gi, '\n');
  s = s.replace(/<\s*hr\s*\/?>/gi, '\n');

  // 5. Öppnings-blocktaggar (utan attribut-tolkning) → nollställs
  //    (vi behöver inte extra newline — stängningstaggen ger den).
  s = s.replace(/<\s*(p|div|li|ul|ol|h[1-6]|tr|td|th|section|article|header|footer|nav|aside|main|blockquote|pre|figure|figcaption|dl|dd|dt)\b[^>]*>/gi, '');

  // 6. Resterande taggar (inline + öppna) → tas bort helt.
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');

  // 7. Resterande HTML-karaktärer som kan ha smugit igenom (skydd mot
  //    trasiga entiteter eller trasiga taggar som skapar extra < / >).
  //    Vi tillåter dem bara om de matchar NAMED_ENTITIES → redan klart.

  // 8. Whitespace-normalisering:
  //    • Tab/CR → space
  //    • Multipla spaces → ett space
  //    • Multipla newlines → max 2 (paragraf-brytning bevaras)
  //    • Trim i början/slut
  s = s
    .replace(/[\t\r]/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return s;
}

export const __test__ = {
  NAMED_ENTITIES: Object.keys({ auml: 1, ouml: 1 }).length, // sanity
};