/**
 * Day/month names per language — structured data, not flat strings, so they
 * live outside the dictionaries. Arrays are indexed by Date.getDay()
 * (0 = Sunday) and Date.getMonth() (0 = January) exactly as the formatters
 * in App.js / MapScreen.js do today.
 *
 * Fallback order matches translate(): chosen language → en → sv.
 */

const sv = {
  daysShort: ['Sön', 'Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör'],
  daysFull: ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'],
  monthsShort: ['jan', 'feb', 'mars', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
  monthsFull: [
    'januari', 'februari', 'mars', 'april', 'maj', 'juni',
    'juli', 'augusti', 'september', 'oktober', 'november', 'december',
  ],
};

const en = {
  daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  daysFull: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  monthsFull: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
};

const de = {
  daysShort: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  daysFull: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
  monthsShort: ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Juni', 'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
  monthsFull: [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
  ],
};

const no = {
  daysShort: ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør'],
  daysFull: ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'],
  monthsShort: ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'],
  monthsFull: [
    'januar', 'februar', 'mars', 'april', 'mai', 'juni',
    'juli', 'august', 'september', 'oktober', 'november', 'desember',
  ],
};

const fi = {
  daysShort: ['Su', 'Ma', 'Ti', 'Ke', 'To', 'Pe', 'La'],
  daysFull: ['Sunnuntai', 'Maanantai', 'Tiistai', 'Keskiviikko', 'Torstai', 'Perjantai', 'Lauantai'],
  monthsShort: ['tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä', 'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu'],
  monthsFull: [
    'tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu',
    'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu',
  ],
};

const da = {
  daysShort: ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør'],
  daysFull: ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'],
  monthsShort: ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
  monthsFull: [
    'januar', 'februar', 'marts', 'april', 'maj', 'juni',
    'juli', 'august', 'september', 'oktober', 'november', 'december',
  ],
};

const nl = {
  daysShort: ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'],
  daysFull: ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'],
  monthsShort: ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
  monthsFull: [
    'januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december',
  ],
};

const fr = {
  daysShort: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'],
  daysFull: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
  monthsShort: ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'],
  monthsFull: [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ],
};

const zhHans = {
  daysShort: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  daysFull: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
  monthsShort: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  monthsFull: [
    '一月', '二月', '三月', '四月', '五月', '六月',
    '七月', '八月', '九月', '十月', '十一月', '十二月',
  ],
};

const it = {
  daysShort: ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'],
  daysFull: ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'],
  monthsShort: ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'],
  monthsFull: [
    'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
  ],
};

// Arabic day names (Språkstöd 2026-09-21). UAX #9:6 RLM / LRM-free; field
// arrays are pure data and rendered standalone, so bidi handling belongs to
// the surrounding UI text direction, not these constants.
const ar = {
  daysShort: ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'],
  daysFull: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  monthsShort: ['ينا', 'فبر', 'مار', 'أبر', 'ماي', 'يون', 'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'],
  monthsFull: [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ],
};

// Persian/Farsi (fa, Språkstöd 2026-09-21). Covers Iranian Persian and
// Afghan Dari as one fallback unit. Same bidi note as Arabic above.
const fa = {
  daysShort: ['یک', 'دو', 'سه', 'چه', 'پن', 'جم', 'شن'],
  daysFull: ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'],
  monthsShort: ['ژان', 'فور', 'مار', 'آور', 'مه', 'ژوئ', 'ژوئ', 'اوت', 'سپت', 'اکت', 'نوا', 'دسا'],
  monthsFull: [
    'ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن',
    'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر',
  ],
};

// Somali (so, Språkstöd 2026-09-21).
const so = {
  daysShort: ['Axd', 'Isn', 'Tal', 'Arb', 'Kha', 'Jim', 'Sab'],
  daysFull: ['Axad', 'Isniin', 'Talaado', 'Arbaco', 'Khamiis', 'Jimco', 'Sabti'],
  monthsShort: ['Kob', 'Lab', 'Sad', 'Afr', 'Sha', 'Lix', 'Tod', 'Sid', 'Sag', 'Tob', 'Nif', 'Lif'],
  monthsFull: [
    'Janaayo', 'Febraayo', 'Maarso', 'Abriil', 'May', 'Juun',
    'Luulyo', 'Agoosto', 'Sebtembar', 'Oktoobar', 'Nofembar', 'Desembar',
  ],
};

// Polish (pl, Språkstöd 2026-09-21).
const pl = {
  daysShort: ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'],
  daysFull: ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'],
  monthsShort: ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'],
  monthsFull: [
    'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
    'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
  ],
};

// Turkish (tr, Språkstöd 2026-09-21).
const tr = {
  daysShort: ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'],
  daysFull: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
  monthsShort: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
  monthsFull: [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
  ],
};

const DATE_NAMES = {
  sv,
  en,
  de,
  no,
  fi,
  da,
  nl,
  fr,
  'zh-Hans': zhHans,
  it,
  ar,
  fa,
  so,
  pl,
  tr,
};

/**
 * Names for the given language tag with the translate() fallback chain
 * (chosen → en → sv). Always returns a complete set.
 * @param {string} language
 */
export function dateNamesFor(language) {
  return DATE_NAMES[language] || DATE_NAMES.en || DATE_NAMES.sv;
}
