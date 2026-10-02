/**
 * E2E smoke for Utforska sök-funktionen.
 *
 * 2026-10-02: Riktig runtime-verifiering.
 *
 * Viktigt: React Native Web:s Pressable/TouchableOpacity svarar INTE
 * på `.click()` direkt — den lyssnar på `pointerdown`/`pointerup`.
 *
 * 2026-10-02: Sök-knappen finns BARA i Utforska-tabben (App.js),
 * INTE i Hem. Användaren måste gå till Utforska-tabben för att söka.
 */

import { test, expect } from '@playwright/test';

async function tap(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const opts = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    return true;
  }, selector);
}

async function tapTab(page, labelRegex) {
  return page.evaluate((patternStr) => {
    const re = new RegExp(patternStr, 'i');
    const tabs = Array.from(document.querySelectorAll('button, [role="tab"]'));
    const tab = tabs.find((t) => re.test(t.textContent || ''));
    if (!tab) return false;
    const opts = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 1 };
    tab.dispatchEvent(new PointerEvent('pointerdown', opts));
    tab.dispatchEvent(new PointerEvent('pointerup', opts));
    tab.dispatchEvent(new MouseEvent('click', opts));
    return true;
  }, labelRegex.source);
}

test.describe('Utforska sök (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('eventpulse.onboarding_complete', '1');
    });
    page.on('pageerror', (err) => {
      console.error('[PAGE ERROR]', err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const txt = msg.text();
        // Filtrera bort CORS-fel från agent-health (test-env quirk)
        if (!txt.includes('CORS') && !txt.includes('agent/health') && !txt.includes('ERR_FAILED')) {
          console.error('[CONSOLE ERROR]', txt);
        }
      }
    });
  });

  test('Hem-skärmen har INGEN sök-knapp (sök hör till Utforska)', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'http://localhost:9090', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(4_000);
    const homeSearchBtn = page.getByTestId('home-search-button');
    expect(await homeSearchBtn.count()).toBe(0);
  });

  test('Utforska-tabben har en sök-knapp i DOM', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'http://localhost:9090', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(4_000);
    // Sök-knappen i App.js:s Utforska-tab finns i DOM (kan vara gömd
    // via tabHidden om Hem är aktiv).
    const count = await page.evaluate(() => {
      return document.querySelectorAll('[data-testid="explore-search-input"]').length;
    });
    expect(count).toBe(1);
  });

  test('Utforska → tryck sök → SearchScreen syns med synliga mått', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'http://localhost:9090', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(4_000);
    // Klicka Utforska-tab först
    await tapTab(page, /utforska|explore/i);
    await page.waitForTimeout(2_000);
    // Tap på sök-knappen
    const tapped = await tap(page, '[data-testid="explore-search-input"]');
    expect(tapped).toBe(true);
    await page.waitForTimeout(3_000);
    // SearchScreen ska ha synliga mått
    const info = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="search-screen-input"]');
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      return { found: true, w: r.width, h: r.height };
    });
    expect(info.found).toBe(true);
    expect(info.w).toBeGreaterThan(100);
    expect(info.h).toBeGreaterThan(10);
  });

  test('skriv "jazz" → fetch mot Fly.io → Nils Landgren', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'http://localhost:9090', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(4_000);
    await tapTab(page, /utforska|explore/i);
    await page.waitForTimeout(2_000);
    await tap(page, '[data-testid="explore-search-input"]');
    await page.waitForTimeout(3_000);
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="search-screen-input"]');
      if (el) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, 'jazz');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.waitForTimeout(6_000);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/Nils|Berwaldhallen|Love of my life|sökresultat|search results/i);
  });

  test('datum-knappen öppnar kalender utan render error', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'http://localhost:9090', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(4_000);
    await tapTab(page, /utforska|explore/i);
    await page.waitForTimeout(2_000);
    await tap(page, '[data-testid="explore-search-input"]');
    await page.waitForTimeout(3_000);
    // 2026-10-02 (filter-UX): filter-chips är nu dolda tills sök-input
    // får fokus (sticky once-shown). Vi fokuserar input innan vi testar
    // datum-modalen så att chip-raden syns.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="search-screen-input"]');
      if (el && typeof el.focus === 'function') el.focus();
    });
    await page.waitForTimeout(500);
    const filterBarVisible = await page.evaluate(() => {
      return !!document.querySelector('[data-testid="search-filter-bar"]');
    });
    expect(filterBarVisible).toBe(true);
    const tapped = await tap(page, '[data-testid="search-date-button"]');
    expect(tapped).toBe(true);
    await page.waitForTimeout(3_000);
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Render Error');
    expect(body).not.toContain("doesn't exist");
    const modalOpen = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      return buttons.some((b) => /^klar$|^apply$/i.test((b.textContent || '').trim()))
        || /välj datumintervall|pick a date range/i.test(document.body.innerText);
    });
    expect(modalOpen).toBe(true);
  });

  test('filter-chips är dolda vid mount, visas efter fokus på input', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'http://localhost:9090', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(4_000);
    await tapTab(page, /utforska|explore/i);
    await page.waitForTimeout(2_000);
    await tap(page, '[data-testid="explore-search-input"]');
    await page.waitForTimeout(3_000);
    // Innan fokus: filter-bar ska INTE finnas (dolt från start).
    const beforeFocus = await page.evaluate(() => {
      return !!document.querySelector('[data-testid="search-filter-bar"]');
    });
    expect(beforeFocus).toBe(false);
    // Fokusera input → filter-bar ska dyka upp.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="search-screen-input"]');
      if (el && typeof el.focus === 'function') el.focus();
    });
    await page.waitForTimeout(500);
    const afterFocus = await page.evaluate(() => {
      return !!document.querySelector('[data-testid="search-filter-bar"]');
    });
    expect(afterFocus).toBe(true);
  });
});
