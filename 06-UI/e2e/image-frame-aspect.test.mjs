/**
 * image-frame-aspect.test.mjs — regressionstest för den låsta 3:2-ramen.
 *
 * 2026-10-29 — användarbeslut: "ramen runt bilden behöver vara samma aspect
 * ratio" för ALLA eventbilder, så att karusellens kort blir lika höga.
 *
 * Tidigare följde ramen bildens naturliga aspect (useImageAspect + contain),
 * vilket gav kort med olika höjd när formaten blandades: 16:9 → 202 pt och
 * 3:2 → 240 pt vid 360 pt bredd (19 % skillnad).
 *
 * Testet mäter den RENDERADE ramen i en riktig app (Expo-webb) och kräver att
 * alla bildramar har samma aspect ratio — 1.5 (3:2) — inom 2 % tolerans.
 *
 * Run:  BASE_URL=http://localhost:8081 npx playwright test e2e/image-frame-aspect.test.mjs
 */

import { test, expect } from '@playwright/test';
import { boot } from './helpers/ui.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const EXPECTED_ASPECT = 1.5; // 3:2
const TOLERANCE = 0.02; // ±2 %

/** Mät alla element med givet testID och returnera deras aspect ratios. */
async function measureFrames(page, testId) {
  return page.evaluate((id) => {
    const els = Array.from(document.querySelectorAll(`[data-testid="${id}"]`));
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        width: r.width,
        height: r.height,
        aspect: r.height > 0 ? r.width / r.height : null,
      };
    });
  }, testId);
}

test.describe('Eventbildens ram — låst 3:2', () => {
  test.setTimeout(120_000);

  test('alla eventkort har samma bildram (3:2)', async ({ page }) => {
    await boot(page, BASE_URL);

    const frames = await measureFrames(page, 'event-card-image');
    expect(frames.length, 'hittade inga event-card-image-ramar').toBeGreaterThan(0);

    const measured = frames.filter((f) => f.aspect && f.aspect > 0);
    expect(measured.length).toBe(frames.length);

    for (const f of measured) {
      const dev = Math.abs(f.aspect - EXPECTED_ASPECT) / EXPECTED_ASPECT;
      expect(
        dev,
        `bildram ${f.width.toFixed(0)}x${f.height.toFixed(0)} har aspect ${f.aspect.toFixed(3)} — förväntat ${EXPECTED_ASPECT} (3:2)`,
      ).toBeLessThanOrEqual(TOLERANCE);
    }

    // Alla ramar ska dessutom ha samma höjd (det är hela poängen med låset).
    const heights = measured.map((f) => f.height);
    const spread = Math.max(...heights) - Math.min(...heights);
    expect(spread, `bildramarnas höjd sprider ${spread.toFixed(1)} px`).toBeLessThanOrEqual(1);
  });

  test('"Senaste"-kortet har samma låsta ram', async ({ page }) => {
    await boot(page, BASE_URL);

    const frames = await measureFrames(page, 'event-card-image-latest');
    // Skärmen kan ha noll "Senaste"-kort om datan inte hunnit ladda — då
    // är testet inte tillämpligt.
    test.skip(frames.length === 0, 'inga "Senaste"-kort renderade');

    for (const f of frames.filter((x) => x.aspect > 0)) {
      const dev = Math.abs(f.aspect - EXPECTED_ASPECT) / EXPECTED_ASPECT;
      expect(dev, `aspect ${f.aspect.toFixed(3)}`).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});
