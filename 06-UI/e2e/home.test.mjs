/**
 * HomeScreen E2E tests — EventPulse Expo web build.
 *
 * 2026-10-28 — SKRIVEN OM för att spegla det som faktiskt är monterat:
 *  - `aria-selected` finns INTE i DOM (RNW mappar inte
 *    `accessibilityState.selected`) → "active"-läget verifieras via vilken
 *    INNEHÅLLSVY som visas, inte via tab-attribut.
 *  - `.click()` triggar inte RNW:s Pressable → tryck sker via
 *    `helpers/ui.mjs` (`tapTab`, pointer-events).
 *  - Appen har haft två tabbares i DOM; `tapTab` väljer den synliga.
 *
 * Run:  BASE_URL=http://localhost:9090 npx playwright test e2e/home.test.mjs
 */

import { test, expect } from '@playwright/test';
import { boot, collectErrors, tapTab } from './helpers/ui.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:9090';

test.describe('Hem — appstart, flikar och sektioner', () => {
  test.setTimeout(120_000);

  test('appen laddar utan krasch', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page, BASE_URL);

    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(10);
    await expect(page.getByTestId('home-screen')).toBeVisible();

    expect(errors.filter((e) => !/429/.test(e.text))).toEqual([]);
  });

  test('flikenavigation byter vy', async ({ page }) => {
    await boot(page, BASE_URL);

    // Hem → Hem-vyn syns.
    await expect(page.getByTestId('home-screen')).toBeVisible();

    // Utforska → kategorivyn syns. Hem-panelen ligger KVAR i DOM (lazy
    // keep-alive: monteras en gång, döljs sedan med display:none) — så
    // assertionen är "hidden", inte "borta".
    await tapTab(page, 'Utforska');
    await page.waitForTimeout(2_500);
    await expect(page.getByText('Kategorier')).toBeVisible();
    await expect(page.getByTestId('home-screen')).toBeHidden();

    // Notiser → notisvyn syns.
    await tapTab(page, 'Notiser');
    await page.waitForTimeout(2_500);
    await expect(page.getByText('NOTISER', { exact: true })).toBeVisible();

    // Profil → profilvyn syns.
    await tapTab(page, 'Profil');
    await page.waitForTimeout(2_500);
    await expect(page.getByText('Sparade & inställningar')).toBeVisible();

    // Hem → tillbaka.
    await tapTab(page, 'Hem');
    await page.waitForTimeout(2_500);
    await expect(page.getByTestId('home-screen')).toBeVisible();
  });

  test('det finns exakt en synlig tabbar (5 flikar)', async ({ page }) => {
    await boot(page, BASE_URL);

    const tabs = await page.evaluate(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const st = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
      };
      return {
        all: Array.from(document.querySelectorAll('[role="tab"]')).map((t) => t.getAttribute('aria-label')),
        visible: Array.from(document.querySelectorAll('[role="tab"]'))
          .filter(visible)
          .map((t) => t.getAttribute('aria-label')),
      };
    });

    console.log(`\nAlla tab-element: ${tabs.all.join(', ')}`);
    console.log(`Synliga tab-element: ${tabs.visible.join(', ')}`);

    // 2026-10-28 — App.js renderade tidigare en egen 3-tabbar parallellt med
    // AppShells synliga 5-tabbar. Nu ska det bara finnas EN.
    expect(tabs.all).toHaveLength(5);
    expect(tabs.visible.sort()).toEqual(['Hem', 'Karta', 'Notiser', 'Profil', 'Utforska'].sort());
  });

  test('HomeScreen-sektioner renderar (eller tomt läge)', async ({ page }) => {
    await boot(page, BASE_URL);
    await page.waitForTimeout(4_000);

    const tabs = page.locator('[role="tab"]');
    await expect(tabs.first()).toBeVisible();

    const emptyState = page.getByText('— inga evenemang just nu —');
    const isEmpty = await emptyState.isVisible().catch(() => false);

    if (isEmpty) {
      expect(true).toBe(true);
    } else {
      const bodyText = await page.locator('body').innerText();
      expect(bodyText.length).toBeGreaterThan(50);
      // Minst en karusell med en rubrik.
      await expect(page.getByRole('list', { name: /— karusell/ }).first()).toBeVisible();
    }
  });

  test('Konserter-chipet är inte monterat (Utforska har inga Hem-chips)', async ({ page }) => {
    // 2026-10-28 — Hem-chipsen ligger i HEM-QUARANTINE och är inte
    // monterade; `handleChipPress` är död kod. Detta test dokumenterar läget
    // istället för att tyst hoppa över det.
    await boot(page, BASE_URL);
    await page.waitForTimeout(2_000);

    const konserterChip = page.getByText('Konserter');
    const chipVisible = await konserterChip.isVisible().catch(() => false);
    expect(chipVisible, 'Hem-chipsen ska inte vara monterade i den utskickade appen').toBe(false);

    // Utforska har i stället 18 kategorirutor.
    await tapTab(page, 'Utforska');
    await page.waitForTimeout(2_500);
    await expect(page.getByRole('button', { name: 'Musik', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Community', exact: true })).toBeVisible();
  });

  test('Notiser-fliken visar tomt läge utan krasch', async ({ page }) => {
    await boot(page, BASE_URL);
    await tapTab(page, 'Notiser');
    await page.waitForTimeout(2_500);

    // "Notiser" finns tre gånger i DOM (rubrik, "Logga in för att se dina
    // notiser…", tabetiketten) → måste vara exakt.
    await expect(page.getByText('NOTISER', { exact: true })).toBeVisible();

    // Tomt läge skiljer sig mellan gäst (uppmaning att logga in) och
    // inloggad (inget ännu). Båda är ärliga tomma lägen — ingen krasch.
    const bodyText = await page.locator('body').innerText();
    expect(
      /Inga notiser än|Logga in för att se dina notiser/.test(bodyText),
      `oväntat notis-innehåll: ${bodyText.slice(0, 200)}`,
    ).toBe(true);
  });

  test('Profil-fliken visar gästvyn utan krasch', async ({ page }) => {
    await boot(page, BASE_URL);
    await tapTab(page, 'Profil');
    await page.waitForTimeout(2_500);

    await expect(page.getByText('Sparade & inställningar')).toBeVisible();
    // Gästvägen: "Lägg till e-post" ska finnas, GDPR-växeln ska inte synas.
    await expect(page.getByRole('button', { name: 'Lägg till e-post' })).toBeVisible();
    await expect(page.getByTestId('analytics-consent-switch')).toHaveCount(0);
  });
});
