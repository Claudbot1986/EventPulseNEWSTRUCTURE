#!/usr/bin/env node
/**
 * scripts/test-web-playwright.mjs
 *
 * Systematisk funktionsgenomgång av eventpulse.nu — Hem/Utforska/Karta/Event.
 * Kör med: node scripts/test-web-playwright.mjs
 *
 * Checklista per sida:
 *  - Inga konsol-error (förutom network errors vi inte orsakar)
 *  - Alla karuseller/grid/pins renderas med riktig data från Supabase
 *  - Alla klickbara element (pills, kort, pinnar) fungerar
 *  - Mobil header overlappar inte
 *  - EN-sidor laddar upp
 *  - Kategori-aliaselören redirectar korrekt
 *
 * Skriver PASS/FAIL-sammanfattning till slutet. Returnerar exit code 1 om
 * något FAILar.
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'https://eventpulse.nu';
const TIMEOUT = 30_000;
const TEST_URL = BASE;

const checks = [];
function record(name, passed, detail = '') {
  checks.push({ name, passed, detail });
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} ${name}${detail ? '  — ' + detail : ''}`);
}

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  return ctx.newPage();
}

async function withConsole(page, fn) {
  const errors = [];
  const warns = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
    if (msg.type() === 'warning') warns.push(msg.text());
  });
  page.on('pageerror', (e) => errors.push('PageError: ' + e.message));
  page.on('requestfailed', (req) => {
    const url = req.url();
    // Filter out unrelated network errors
    if (!url.includes('supabase.co') && !url.includes('eventpulse.nu')) return;
    errors.push(`Failed: ${req.method()} ${url}  →  ${req.failure()?.errorText || ''}`);
  });
  try {
    await fn(errors);
  } finally {
    // page context closed by caller
  }
}

async function testHem(browser) {
  console.log('\n=== HEM (/) ===');
  const page = await newPage(browser);
  await withConsole(page, async (errors) => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    // Wait for at least one carousel to populate
    try {
      await page.waitForFunction(
        () => document.querySelectorAll('.event-card').length >= 5,
        { timeout: 15000 }
      );
    } catch (e) {
      record('Hem: minst 5 eventkort renderas', false, `0 kort — Supabase-anrop misslyckas?`);
    }

    const cardCount = await page.$$eval('.event-card', (els) => els.length);
    record('Hem: eventkort renderas', cardCount >= 5, `${cardCount} kort`);

    const sectionCount = await page.$$eval('[data-ep-carousel]', (els) => els.length);
    record('Hem: 10 karusell-sektioner', sectionCount === 10, `${sectionCount} sektioner`);

    const carouselNames = await page.$$eval('[data-ep-carousel]', (els) =>
      els.map((e) => e.dataset.epCarousel)
    );
    const expectedCarousels = [
      'foryou', 'tonight', 'weekend', 'music', 'theatre-drama', 'exhibition',
      'community', 'sports', 'family', 'comedy',
    ];
    record('Hem: alla förväntade karuseller', JSON.stringify(carouselNames.sort()) === JSON.stringify(expectedCarousels.sort()), `har: ${carouselNames.join(', ')}`);

    // Check no "Kunde inte ladda" message visible
    const errorTexts = await page.$$eval('.event-list__empty, .carousel__track > .event-list__empty', (els) => els.map((e) => e.textContent));
    const loadErrors = errorTexts.filter((t) => t.includes('Kunde inte ladda'));
    record('Hem: inga "Kunde inte ladda"-meddelanden', loadErrors.length === 0, loadErrors.length > 0 ? `${loadErrors.length} fel` : '');

    // Check Hero is visible
    const heroVisible = await page.isVisible('.hero__title');
    record('Hem: hero synlig', heroVisible);

    const heroText = await page.textContent('.hero__title');
    record('Hem: hero har rätt text', heroText.includes('evenemang'), `text: "${heroText.slice(0, 50)}..."`);

    // Check filter pills at top
    const topPills = await page.$$eval('.hero .pill', (els) => els.map((e) => e.textContent.trim()));
    record('Hem: filterpills högst upp', topPills.length >= 5, `antal: ${topPills.length}, första: ${topPills[0]}`);

    // Click a category pill → should navigate
    const musicPill = await page.$('.hero a[href*="category=music"]');
    if (musicPill) {
      await Promise.all([
        page.waitForLoadState('networkidle'),
        musicPill.click(),
      ]);
      const url = page.url();
      record('Hem: klick på "Musik"-pill navigerar', url.includes('category=music'), `URL: ${url}`);
    }

    // Click an event card → should navigate to /event/?id=
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.event-card', { timeout: 10000 });
    const firstCard = await page.$('.event-card');
    if (firstCard) {
      const cardHref = await firstCard.getAttribute('href');
      record('Hem: eventkort har /event/?id= länk', cardHref && cardHref.includes('/event/?id='), `href: ${cardHref}`);
    }

    // No console errors
    record('Hem: inga konsol-error', errors.length === 0, errors.length > 0 ? errors.slice(0, 2).join(' | ') : '');
  });
  await page.context().close();
}

async function testUtforska(browser) {
  console.log('\n=== UTFORSKA (/utforska/) ===');
  const page = await newPage(browser);
  await withConsole(page, async (errors) => {
    await page.goto(BASE + '/utforska/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    try {
      await page.waitForFunction(
        () => document.querySelectorAll('.event-list .event-card').length >= 3,
        { timeout: 15000 }
      );
    } catch (e) {
      record('Utforska: grid fylls med events', false, 'inga kort efter 15s');
    }

    const gridCount = await page.$$eval('.event-list .event-card', (els) => els.length);
    record('Utforska: eventkort i grid', gridCount >= 3, `${gridCount} kort`);

    // Pills
    const allPills = await page.$$eval('.pill-row .pill', (els) => els.map((e) => e.textContent.trim()));
    record('Utforska: filterpills närvarande', allPills.length >= 10, `${allPills.length} pills`);

    // Filter på kategori via klick
    const musikPill = await page.$('a[href*="category=music"]');
    if (musikPill) {
      await Promise.all([
        page.waitForLoadState('networkidle'),
        musikPill.click(),
      ]);
      await page.waitForTimeout(1000);
      const url = page.url();
      const musicCount = await page.$$eval('.event-list .event-card', (els) => els.length);
      record('Utforska: kategori-filter via klick', url.includes('category=music'), `URL: ${url}, antal: ${musicCount}`);
    }

    // Filter på datum via URL
    await page.goto(BASE + '/utforska/?date=today', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const todayCount = await page.$$eval('.event-list .event-card', (els) => els.length);
    record('Utforska: ?date=today returnerar events', todayCount > 0, `${todayCount} events`);

    await page.goto(BASE + '/utforska/?date=weekend', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const weekendCount = await page.$$eval('.event-list .event-card', (els) => els.length);
    record('Utforska: ?date=weekend returnerar events', weekendCount > 0, `${weekendCount} events`);

    record('Utforska: inga konsol-error', errors.length === 0, errors.length > 0 ? errors.slice(0, 2).join(' | ') : '');
  });
  await page.context().close();
}

async function testKarta(browser) {
  console.log('\n=== KARTA (/karta/) ===');
  const page = await newPage(browser);
  await withConsole(page, async (errors) => {
    await page.goto(BASE + '/karta/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    // Wait for Leaflet to load + markers
    try {
      await page.waitForFunction(
        () => document.querySelectorAll('.leaflet-interactive').length >= 10,
        { timeout: 20000 }
      );
    } catch (e) {
      record('Karta: ≥10 pinnar renderas', false, `hittade ${await page.$$eval('.leaflet-interactive', (els) => els.length)}`);
    }

    const markerCount = await page.$$eval('.leaflet-interactive', (els) => els.length);
    record('Karta: pinnar renderas via Leaflet', markerCount >= 10, `${markerCount} pinnar`);

    const listItems = await page.$$eval('.map-page__item', (els) => els.length);
    record('Karta: lista bredvid kartan fylls', listItems >= 10, `${listItems} items`);

    // Klick på pin → popup
    if (markerCount > 0) {
      // force:true för att kringgå Leaflets överlappande-pin-beteende i täta
      // stadsområden (500 pinnar i Stockholm kan ha många på samma pixel).
      const firstMarker = await page.$('.leaflet-interactive');
      await firstMarker.click({ force: true });
      await page.waitForTimeout(500);
      const popupVisible = await page.isVisible('.leaflet-popup');
      record('Karta: klick på pin öppnar popup', popupVisible);
    }

    // Klick på list-item → flyttar kartan
    if (listItems > 0) {
      const firstListItem = await page.$('.map-page__item');
      await firstListItem.click();
      await page.waitForTimeout(300);
      const isActive = await firstListItem.evaluate((el) => el.classList.contains('is-active'));
      record('Karta: klick på list-item markerar aktiv', isActive);
    }

    record('Karta: inga konsol-error', errors.length === 0, errors.length > 0 ? errors.slice(0, 2).join(' | ') : '');
  });
  await page.context().close();
}

async function testEventDetalj(browser) {
  console.log('\n=== EVENT-DETALJ (/event/?id=…) ===');
  // Hämta ett riktigt event-id från Supabase
  const apiRes = await fetch(
    'https://bsllkpvkowwndhhxtlln.supabase.co/rest/v1/events?select=id&status=eq.published&start_time=gte.2026-10-01&limit=1',
    {
      headers: {
        apikey: 'sb_publishable_Zy3H6r8GLtZNGC_GseZ-zQ_9aJQiugo',
        Authorization: 'Bearer sb_publishable_Zy3H6r8GLtZNGC_GseZ-zQ_9aJQiugo',
      },
    }
  );
  const arr = await apiRes.json();
  if (!arr.length) {
    record('Event-detalj: hittar test-event', false, 'inga events i DB');
    return;
  }
  const testId = arr[0].id;

  const page = await newPage(browser);
  await withConsole(page, async (errors) => {
    await page.goto(`${BASE}/event/?id=${testId}`, { waitUntil: 'networkidle', timeout: TIMEOUT });

    try {
      await page.waitForSelector('.event-detail__title', { timeout: 10000 });
    } catch (e) {
      record('Event-detalj: titel renderas', false, 'ingen titel efter 10s');
    }

    const titleText = await page.textContent('.event-detail__title').catch(() => '');
    record('Event-detalj: titelns text ej kort', titleText.length > 5, `text: "${titleText.slice(0, 60)}"`);

    const metaRows = await page.$$eval('.event-detail__meta-row', (els) => els.length);
    record('Event-detalj: meta-rader', metaRows >= 2, `${metaRows} rader`);

    const ctaLink = await page.$('.event-detail__cta');
    record('Event-detalj: köp-knapp finns', !!ctaLink, ctaLink ? 'synlig' : 'saknas (event saknar ticket_url?)');

    record('Event-detalj: inga konsol-error', errors.length === 0, errors.length > 0 ? errors.slice(0, 2).join(' | ') : '');
  });
  await page.context().close();
}

async function testMobile(browser) {
  console.log('\n=== MOBIL-VIEWPORT (iPhone-bredd) ===');
  const page = await newPage(browser, { viewport: { width: 390, height: 844 } });
  await withConsole(page, async (errors) => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    // Header får INTE overlappa
    const headerBoxes = await page.evaluate(() => {
      const els = ['.site-header__brand', '.site-header__nav a'];
      return els.flatMap((sel) =>
        Array.from(document.querySelectorAll(sel)).map((el) => ({
          sel,
          text: el.textContent.trim().slice(0, 30),
          rect: el.getBoundingClientRect(),
        }))
      );
    });

    // Hitta EventPulse-brand och första nav-länk
    const brand = headerBoxes.find((b) => b.sel === '.site-header__brand');
    const firstNav = headerBoxes.find((b) => b.sel === '.site-header__nav a');

    if (brand && firstNav) {
      const overlap = brand.rect.right > firstNav.rect.left;
      record('Mobil: header-brand överlappar inte första nav-länken', !overlap,
        overlap ? `brand-right=${Math.round(brand.rect.right)}, nav-left=${Math.round(firstNav.rect.left)}` : '');
    }

    // Horisontell scrollbar bör INTE finnas
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW = await page.evaluate(() => document.documentElement.clientWidth);
    record('Mobil: ingen horisontell scrollbar', scrollW <= clientW + 1, `scrollW=${scrollW}, clientW=${clientW}`);

    // Karuseller ska scrolla horisontellt på mobil (inte vertikalt)
    const firstCarouselScrollW = await page.evaluate(() => {
      const c = document.querySelector('.carousel__track');
      if (!c) return 0;
      return c.scrollWidth;
    });
    const firstCarouselClientW = await page.evaluate(() => {
      const c = document.querySelector('.carousel__track');
      if (!c) return 0;
      return c.clientWidth;
    });
    record('Mobil: karusell har inre scroll (cards bredare än view', firstCarouselScrollW > firstCarouselClientW,
      `scrollW=${firstCarouselScrollW}, clientW=${firstCarouselClientW}`);

    record('Mobil: inga konsol-error', errors.length === 0, errors.length > 0 ? errors.slice(0, 2).join(' | ') : '');
  });
  await page.context().close();
}

async function testEN(browser) {
  console.log('\n=== ENGELSKA (/en/) ===');
  const page = await newPage(browser);
  await withConsole(page, async (errors) => {
    await page.goto(BASE + '/en/', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(3000);
    const title = await page.title();
    record('EN: title är på engelska', title.includes('Stockholm'), `title: ${title}`);
    const cardCount = await page.$$eval('.event-card', (els) => els.length);
    record('EN: karuseller laddas', cardCount >= 5, `${cardCount} kort`);

    await page.goto(BASE + '/en/utforska/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const utfCount = await page.$$eval('.event-list .event-card', (els) => els.length);
    record('EN/utforska: events', utfCount > 0, `${utfCount} events`);

    await page.goto(BASE + '/en/karta/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const mapPins = await page.$$eval('.leaflet-interactive', (els) => els.length);
    record('EN/karta: pinnar', mapPins > 0, `${mapPins} pinnar`);

    record('EN: inga konsol-error', errors.length === 0, errors.length > 0 ? errors.slice(0, 2).join(' | ') : '');
  });
  await page.context().close();
}

async function testRedirects(browser) {
  console.log('\n=== REDIRECTS (/konsert → /utforska/?category=music m.fl.) ===');
  const cases = [
    { from: '/konsert/', expectQuery: 'category=music' },
    { from: '/teater/', expectQuery: 'category=theatre-drama' },
    { from: '/sport/', expectQuery: 'category=sports' },
    { from: '/utstallning/', expectQuery: 'category=exhibition' },
    { from: '/standup/', expectQuery: 'category=comedy' },
    { from: '/musik/', expectQuery: 'category=music' },
  ];
  for (const c of cases) {
    const page = await newPage(browser);
    await page.goto(BASE + c.from, { waitUntil: 'networkidle' });
    const url = page.url();
    const ok = url.includes(c.expectQuery);
    record(`Redirect ${c.from} → ${c.expectQuery}`, ok, ok ? '' : `landade på: ${url}`);
    await page.context().close();
  }
}

(async () => {
  const browser = await chromium.launch();

  console.log('=== eventpulse.nu — Playwright funktionsgenomgång ===');
  console.log(`Tid: ${new Date().toISOString()}`);
  console.log(`Base: ${BASE}`);

  try {
    await testHem(browser);
    await testUtforska(browser);
    await testKarta(browser);
    await testEventDetalj(browser);
    await testMobile(browser);
    await testEN(browser);
    await testRedirects(browser);
  } catch (e) {
    console.error('FATAL:', e);
  }

  await browser.close();

  // ── Summary ──
  console.log('\n' + '='.repeat(60));
  console.log('CHECKLIST-SAMMANFATTNING');
  console.log('='.repeat(60));
  const total = checks.length;
  const passed = checks.filter((c) => c.passed).length;
  const failed = total - passed;
  console.log(`Totalt: ${total}   PASS: ${passed}   FAIL: ${failed}`);
  if (failed > 0) {
    console.log('\nFAILURES:');
    for (const c of checks.filter((c) => !c.passed)) {
      console.log(`  ❌ ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
})();