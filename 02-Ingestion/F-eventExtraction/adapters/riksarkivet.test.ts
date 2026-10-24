/**
 * Riksarkivet-adapterns tester.
 *
 * Fixturen är klippt ur den RIKTIGA markupen (2026-10-24):
 * - LISTING: tre `/kalendarium`-kort ur den renderade listan
 *   (24 kort mätta i webbläsaren).
 * - DETAIL: `/evenemang/arkivens-dag-i-taby` med publiceringsdatum,
 *   evenemangsdatum, tidsfönster, plats, arrangör och lead-text.
 */
import { describe, it, expect } from 'vitest';
import { matches, parseListing, parseDetail, extract } from './riksarkivet';

const LISTING = `
<div class="grid content-start rounded-lg text-sm shadow-bevel-sm relative overflow-hidden @container/hyphenation bg-gray-200"><div class="row-start-2 row-span-1 px-4 py-4 space-y-2"><h3 class="h4-md sm:h4-lg mt-0 sm:mt-0 mb-0 sm:mb-0"><a data-link-type="internal" class="no-underline" href="/evenemang/utstallning-fotografier-fran-fackskolan-for-huslig-ekonomi">Utställning: Fotografier från Fackskolan för huslig ekonomi</a></h3><dl class="flex flex-wrap gap-x-[2ch] text-gray-500 text-xs"><div class="flex items-center gap-[.66ch]"><dt class="flex items-center gap-[.5ch] font-semibold"><span class="icon flex-none text-deep-blue" style="mask-image: url(&quot;/_next/static/media/calendar.2277526z5-zfv.svg&quot;);"></span><span class="sr-only">Datum:</span></dt><dd class=""><span><time datetime="2026-01-01/2026-12-30">1 januari&ndash;30 december 2026</time></span></dd></div><div class="flex items-center gap-[.66ch]"><dt class="flex items-center gap-[.5ch] font-semibold"><span class="icon flex-none text-deep-blue" style="mask-image: url(&quot;/_next/static/media/place.2lfkh89l6g1k6.svg&quot;);"></span><span class="sr-only">Plats:</span></dt><dd class="">Uppsala</dd></div></dl></div><div class="row-start-1 row-span-1 mb-2 aspect-video bg-gray-300 object-cover" data-carousel-item="true"><img alt="Kvinna som provsmakar en köttbulle" loading="lazy" width="1216" height="846" srcset="/_next/image?url=https%3A%2F%2Fcmsprodut.ra.se%2Fwp-content%2Fuploads%2F2025%2F06%2Futstallning_uppsala_foto_ur_fackskolan_for_huslig_ekonomi.jpg&amp;w=1920&amp;q=75 1x" src="/_next/image?url=https%3A%2F%2Fcmsprodut.ra.se%2Fwp-content%2Fuploads%2F2025%2F06%2Futstallning_uppsala_foto_ur_fackskolan_for_huslig_ekonomi.jpg&amp;w=3840&amp;q=75"></div><div aria-hidden="true" class="absolute top-0 left-0 m-4"><time class="grid size-[52px] auto-rows-max content-center rounded-full bg-white text-center" datetime="10-24"><span class="font-bold text-[25px] leading-[24px]">24</span><span class="font-bold text-[10px] uppercase leading-[18px] tracking-wide">okt</span></time></div><div class="prose prose-sm sm:prose-md row-start-3 row-span-1 px-4 pb-4"><p>Undervisning i huslig ekonomi blev vanlig på olika håll i Europa under slutet av 1800-talet. I Uppsala grundades en fackskola för ändamålet. Här utbildades kvinnor inom den familjenära ekonomin</p></div></div>
<div class="grid content-start rounded-lg text-sm shadow-bevel-sm relative overflow-hidden @container/hyphenation bg-gray-200"><div class="row-start-2 row-span-1 px-4 py-4 space-y-2"><h3 class="h4-md sm:h4-lg mt-0 sm:mt-0 mb-0 sm:mb-0"><a data-link-type="internal" class="no-underline" href="/evenemang/utstallning-judiskt-liv-i-ostergotland-och-smaland">Utställning: Judiskt liv i Östergötland och Småland &ndash; arkiven berättar</a></h3><dl class="flex flex-wrap gap-x-[2ch] text-gray-500 text-xs"><div class="flex items-center gap-[.66ch]"><dt class="flex items-center gap-[.5ch] font-semibold"><span class="icon flex-none text-deep-blue" style="mask-image: url(&quot;/_next/static/media/calendar.2277526z5-zfv.svg&quot;);"></span><span class="sr-only">Datum:</span></dt><dd class=""><span><time datetime="2025-07-01/2026-12-30">1 juli 2025&ndash;30 december 2026</time></span></dd></div><div class="flex items-center gap-[.66ch]"><dt class="flex items-center gap-[.5ch] font-semibold"><span class="icon flex-none text-deep-blue" style="mask-image: url(&quot;/_next/static/media/place.2lfkh89l6g1k6.svg&quot;);"></span><span class="sr-only">Plats:</span></dt><dd class="">Vadstena</dd></div></dl></div><div aria-hidden="true" class="absolute top-0 left-0 m-4"><time class="grid size-[52px] auto-rows-max content-center rounded-full bg-white text-center" datetime="10-24"><span class="font-bold text-[25px] leading-[24px]">24</span><span class="font-bold text-[10px] uppercase leading-[18px] tracking-wide">okt</span></time></div><div class="prose prose-sm sm:prose-md row-start-3 row-span-1 px-4 pb-4"><p>Med utgångspunkt i arkivhandlingar skildrar denna utställning judiskt församlingsliv och entreprenörskap i Östergötland och Småland under 1700- 1800- och 1900-talen.</p></div></div>
<div class="grid content-start rounded-lg text-sm shadow-bevel-sm relative overflow-hidden @container/hyphenation bg-gray-200"><div class="row-start-2 row-span-1 px-4 py-4 space-y-2"><h3 class="h4-md sm:h4-lg mt-0 sm:mt-0 mb-0 sm:mb-0"><a data-link-type="internal" class="no-underline" href="/evenemang/utstallning-staten-knackar-pa">Utställning: Staten knackar på</a></h3><dl class="flex flex-wrap gap-x-[2ch] text-gray-500 text-xs"><div class="flex items-center gap-[.66ch]"><dt class="flex items-center gap-[.5ch] font-semibold"><span class="icon flex-none text-deep-blue" style="mask-image: url(&quot;/_next/static/media/calendar.2277526z5-zfv.svg&quot;);"></span><span class="sr-only">Datum:</span></dt><dd class=""><span><time datetime="2026-04-13/2026-12-04">13 april&ndash;4 december 2026</time></span></dd></div><div class="flex items-center gap-[.66ch]"><dt class="flex items-center gap-[.5ch] font-semibold"><span class="icon flex-none text-deep-blue" style="mask-image: url(&quot;/_next/static/media/place.2lfkh89l6g1k6.svg&quot;);"></span><span class="sr-only">Plats:</span></dt><dd class="">Lund</dd></div></dl></div><div class="prose prose-sm sm:prose-md row-start-3 row-span-1 px-4 pb-4"><p>Välkommen till utställningen Staten knackar på &ndash; En undersökning av bostadsvanor hos lantbrukarfamiljer 1945.</p></div></div>
`;

/** Samma kortstruktur men utan <time> — datumet saknas helt. */
const LISTING_NO_DATE = `
<div class="grid content-start rounded-lg bg-gray-200"><div class="row-start-2 row-span-1 px-4 py-4 space-y-2"><h3 class="h4-md"><a class="no-underline" href="/evenemang/utstallning-utan-datum">Utställning: Utan datum</a></h3><dl class="flex flex-wrap gap-x-[2ch] text-gray-500 text-xs"><div class="flex items-center gap-[.66ch]"><dt class="font-semibold"><span class="sr-only">Datum:</span></dt><dd class=""><span>Datum meddelas senare</span></dd></div><div class="flex items-center gap-[.66ch]"><dt class="font-semibold"><span class="sr-only">Plats:</span></dt><dd class="">Stockholm</dd></div></dl></div></div>
`;

const DETAIL = `
<h1>Arkivens dag i Täby</h1>
<dl class="flex flex-col gap-2 text-gray-500 text-sm md:flex-row md:gap-6 md:text-md"><div class="flex flex-wrap gap-[.66ch]"><dt class="font-semibold">Publicerad:</dt><dd class=""><time datetime="2026-10-08">2026-10-08</time></dd></div></dl>
<div class="min-w-52 space-y-2"><div class="flex items-center font-bold"><span class="icon flex-none mr-2 text-xl" style="background-color:currentColor;mask-image:url('/_next/static/media/calendar.2277526z5-zfv.svg');"></span><time datetime="2026-11-14">lördag 14 november 2026</time></div><div class="flex items-center"><span class="icon flex-none mr-2 text-xl" style="background-color:currentColor;mask-image:url('/_next/static/media/schedule.2sx0pyvvntgk6.svg');"></span><time datetime="10:30/14:00">10.30&ndash;14.00</time></div><div class="flex items-center"><span class="icon flex-none mr-2 text-xl" style="background-color:currentColor;mask-image:url('/_next/static/media/place.2lfkh89l6g1k6.svg');"></span>Täby</div><div class=""><span class="mr-2 font-bold">Arrangör<!-- -->:</span>Riksarkivet</div></div>
<div class="prose prose-md"><p class="lead">Den 14 november firas arkivens dag i hela Sverige. Årets tema är Människan och tekniken. I Täby kan du ta bland annat ta del av en ny utställning och två visningar.</p></div>
`;

describe('riksarkivet adapter', () => {
  it('matchar bara riksarkivet.se', () => {
    expect(matches('https://riksarkivet.se/kalendarium')).toBe(true);
    expect(matches('https://www.riksarkivet.se/evenemang/arkivens-dag-i-taby')).toBe(true);
    expect(matches('https://example.com/evenemang')).toBe(false);
    expect(matches('https://www.kultur1.se/calendar_lan.php')).toBe(false);
    expect(matches('https://kungstradgarden.stockholm/evenemang/')).toBe(false);
    expect(matches('inte en url')).toBe(false);
  });

  it('läser alla kort i listan', () => {
    const rows = parseListing(LISTING);
    expect(rows.length).toBe(3);
    expect(rows[0].title).toBe('Utställning: Fotografier från Fackskolan för huslig ekonomi');
    expect(rows[0].url).toBe(
      'https://riksarkivet.se/evenemang/utstallning-fotografier-fran-fackskolan-for-huslig-ekonomi'
    );
  });

  it('läser datumintervall och plats ur kortet', () => {
    const rows = parseListing(LISTING);
    expect(rows[0].date).toBe('2026-01-01');
    expect(rows[0].endDate).toBe('2026-12-30');
    expect(rows[0].place).toBe('Uppsala');
  });

  it('läser originalbilden ur Next.js-bilden', () => {
    const rows = parseListing(LISTING);
    expect(rows[0].imageUrl).toBe(
      'https://cmsprodut.ra.se/wp-content/uploads/2025/06/utstallning_uppsala_foto_ur_fackskolan_for_huslig_ekonomi.jpg'
    );
  });

  it('hoppar över kort utan datum', () => {
    const rows = parseListing(LISTING_NO_DATE);
    expect(rows.length).toBe(1);
    expect(rows[0].date).toBeNull();

    const res = extract(LISTING_NO_DATE, 'https://riksarkivet.se/kalendarium');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('extraherar tre evenemang ur listan', () => {
    const res = extract(LISTING, 'https://riksarkivet.se/kalendarium');
    expect(res.method).toBe('riksarkivet-listing');
    expect(res.events.length).toBe(3);
    expect(res.events[0].date).toBe('2026-01-01');
    expect(res.events[0].endDate).toBe('2026-12-30');
    expect(res.events[0].venue).toBe('Riksarkivet, Uppsala');
    expect(res.events[0].source).toBe('riksarkivet');
    expect(res.events[0].url).toContain('riksarkivet.se/evenemang/');
    expect(res.showUrls.length).toBe(3);
  });

  it('tar inte den dekorativa kalenderbadgen som datum', () => {
    const res = extract(LISTING, 'https://riksarkivet.se/kalendarium');
    expect(res.events.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date))).toBe(true);
    expect(res.events.some((e) => e.date === '10-24')).toBe(false);
  });

  it('läser detaljsidan: evenemangsdatum, inte publiceringsdatum', () => {
    const detail = parseDetail(DETAIL, 'https://riksarkivet.se/evenemang/arkivens-dag-i-taby');
    expect(detail).not.toBeNull();
    expect(detail?.title).toBe('Arkivens dag i Täby');
    expect(detail?.date).toBe('2026-11-14');
    expect(detail?.time).toBe('10:30');
    expect(detail?.endTime).toBe('14:00');
    expect(detail?.place).toBe('Täby');
    expect(detail?.organizer).toBe('Riksarkivet');
    expect(detail?.description).toContain('arkivens dag');
  });

  it('extraherar ett evenemang ur detaljsidan', () => {
    const res = extract(DETAIL, 'https://riksarkivet.se/evenemang/arkivens-dag-i-taby');
    expect(res.method).toBe('riksarkivet-detail');
    expect(res.events.length).toBe(1);
    expect(res.events[0].date).toBe('2026-11-14');
    expect(res.events[0].time).toBe('10:30');
    expect(res.events[0].endTime).toBe('14:00');
    expect(res.events[0].venue).toBe('Riksarkivet, Täby');
    expect(res.events[0].city).toBe('Täby');
    expect(res.events[0].sourceUrl).toBe('https://riksarkivet.se/evenemang/arkivens-dag-i-taby');
  });

  it('gör inget på främmande URL', () => {
    const res = extract(LISTING, 'https://example.com/kalendarium');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('hanterar HTML utan evenemang', () => {
    const res = extract('<html><body><h1>Vi kan tyvärr inte hitta sidan du söker</h1></body></html>', 'https://riksarkivet.se/kalendarium');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });
});
