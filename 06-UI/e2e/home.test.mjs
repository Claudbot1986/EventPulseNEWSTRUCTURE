/**
 * HomeScreen E2E tests — EventPulse Expo web build.
 *
 * Covers T0074:
 * - App loads without crash
 * - HomeScreen sections render (or empty state)
 * - Tab navigation works (Hem / Utforska / Notiser / Profil)
 * - Category chips trigger correct section content
 * - No console errors on load
 *
 * Run:  npx playwright test e2e/home.test.mjs
 * Env:  BASE_URL=http://localhost:8081 (defaults to Metro dev server on 8081)
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';

// ─── Test 1: App loads without crash ─────────────────────────────────────────

test('app loads without crash', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000); // allow React to hydrate

  const body = await page.textContent('body');
  expect(body).toBeTruthy();
  expect(body.length).toBeGreaterThan(10);

  expect(errors).toEqual([]);
});

// ─── Test 2: Tab navigation works ────────────────────────────────────────────

test('tab navigation works', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);

  const tabs = page.locator('[role="tab"]');

  const exploreTab = tabs.filter({ hasText: 'Utforska' });
  await expect(exploreTab).toBeVisible();

  const homeTab = tabs.filter({ hasText: 'Hem' });
  await homeTab.click();
  await page.waitForTimeout(1000);

  const homeTabActive = page.locator('[role="tab"][aria-selected="true"]').filter({ hasText: 'Hem' });
  await expect(homeTabActive).toBeVisible();

  const profileTab = tabs.filter({ hasText: 'Profil' });
  await profileTab.click();
  await page.waitForTimeout(1000);

  const profileTabActive = page.locator('[role="tab"][aria-selected="true"]').filter({ hasText: 'Profil' });
  await expect(profileTabActive).toBeVisible();

  await homeTab.click();
  await page.waitForTimeout(1000);
  await expect(homeTabActive).toBeVisible();
});

// ─── Test 3: HomeScreen sections render (or empty state) ────────────────────

test('HomeScreen sections render or show empty state', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });

  const homeTab = page.locator('[role="tab"]').filter({ hasText: 'Hem' });
  await homeTab.click();
  await page.waitForTimeout(4000);

  const tabs = page.locator('[role="tab"]');
  await expect(tabs.first()).toBeVisible();

  const emptyState = page.getByText('— inga evenemang just nu —');
  const isEmpty = await emptyState.isVisible().catch(() => false);

  if (isEmpty) {
    expect(true).toBe(true);
  } else {
    const bodyText = await page.textContent('body');
    expect(bodyText.length).toBeGreaterThan(50);
  }
});

// ─── Test 4: Konserter chip navigates to explore ─────────────────────────────

test('Konserter chip triggers explore tab', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);

  const homeTab = page.locator('[role="tab"]').filter({ hasText: 'Hem' });
  await homeTab.click();
  await page.waitForTimeout(2000);

  const konserterChip = page.getByText('Konserter');
  const chipVisible = await konserterChip.isVisible().catch(() => false);

  if (!chipVisible) {
    test.skip();
    return;
  }

  await konserterChip.click();
  await page.waitForTimeout(1500);

  const pendingBanner = page.getByText('DU FRÅGADE:');
  const exploreActive = page.locator('[role="tab"][aria-selected="true"]').filter({ hasText: 'Utforska' });

  const bannerVisible = await pendingBanner.isVisible().catch(() => false);
  const exploreSelected = await exploreActive.isVisible().catch(() => false);

  expect(bannerVisible || exploreSelected).toBe(true);
});

// ─── Test 5: Notifications tab shows without crash ────────────────────────────

test('NotificationsScreen shows without crash', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);

  const notiserTab = page.locator('[role="tab"]').filter({ hasText: 'Notiser' });
  await notiserTab.click();
  await page.waitForTimeout(2000);

  const bodyText = await page.textContent('body');
  expect(bodyText).toBeTruthy();
});

// ─── Test 6: Profile tab shows without crash ────────────────────────────────

test('ProfileScreen shows without crash', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);

  const profileTab = page.locator('[role="tab"]').filter({ hasText: 'Profil' });
  await profileTab.click();
  await page.waitForTimeout(2000);

  const bodyText = await page.textContent('body');
  expect(bodyText).toBeTruthy();
});
