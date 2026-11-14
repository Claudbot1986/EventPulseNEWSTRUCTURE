/**
 * Juridisk text i appen (Apple §2.1 + §5.1.1(i)):
 *   - ingen platshållartext ("[TODO: ...]") får synas
 *   - ingen "AI-utkast"-banner (flaggan _legalDraftOnly = '0')
 *   - rätt region (eu-north-1), rätt kontakt
 *   - policyn får INTE påstå agentchatt/MiniMax (build 6 har ingen av dem)
 *   - villkoren ska inte innehålla en åldersgräns som understiger 18 år
 *
 *   cd 06-UI && BASE_URL=http://localhost:9090 npx playwright test e2e/legal-policy.test.mjs
 */

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { boot, collectErrors, tap, tapTab } from './helpers/ui.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:9090';
const OUT = process.env.UI_EVIDENCE_DIR || `runtime/verification-reports/ui-verify-${new Date().toISOString().replace(/[:.]/g, '-')}`;

async function openLegal(page, testId) {
  await tapTab(page, 'Profil');
  await page.waitForTimeout(2_500);
  const res = await tap(page, `[data-testid="${testId}"]`);
  expect(res.ok, `${testId} hittades inte på Profil`).toBe(true);
  await page.waitForTimeout(1_500);
  return page.locator('body').innerText();
}

test.describe('Juridisk text i appen', () => {
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  test('integritet policyn: inga platshållare, ingen utkastsbanner, rätt fakta', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page, BASE_URL);
    const text = await openLegal(page, 'open-privacy-policy');

    await page.screenshot({ path: `${OUT}/privacy-policy.png`, fullPage: false });

    expect(text, 'integritetspolicyn öppnade inte').toMatch(/Integritetspolicy/i);
    expect(text, 'en [TODO: ...]-platshållare syns i appen').not.toMatch(/\[TODO:/i);
    // Råa i18n-nycklar i den publicerade texten = trasig sektionskoppling.
    expect(text, 'råa i18n-nycklar renderas i policyn').not.toMatch(/legal\.(privacy|terms)\./i);
    expect(text, 'AI-utkastsbanneren syns fortfarande').not.toMatch(/AI-utkast|AI draft|bozza AI/i);
    // POLICY ≈ APP (2026-11-14): build 6 har ingen agentchatt och skickar
    // ingen text till MiniMax (index.js registrerar AppShell, inte
    // App-agent.js; composeReply nås bara via POST /agent/chat som appen
    // aldrig anropar). Policyn får därför inte påstå det, och privacy-
    // etiketten säger "Data Shared with third parties: Nej".
    expect(text, 'policyn påstår fortfarande att MiniMax är leverantör').not.toMatch(/MiniMax/);
    expect(text, 'policyn påstår fortfarande en agentchatt').not.toMatch(/event-agent|agentchat/i);
    expect(text, 'policyn påstår fortfarande en sparad smakprofil').not.toMatch(/smakprofil/i);
    expect(text, 'policyn saknar förklaringen av söktexten').toMatch(/söktext/i);
    expect(text, 'policyn saknar förklaringen att söktexten inte går till en AI-modell')
      .toMatch(/utan AI|någon AI-modell/i);
    expect(text, 'Supabase-regionen eu-north-1 saknas').toMatch(/eu-north-1/);
    expect(text, 'kontaktadressen hej@eventpulse.nu saknas').toMatch(/hej@eventpulse\.nu/);
    expect(text, 'den gamla kontaktadressen syns fortfarande').not.toMatch(/privacy@eventpulse\.nu/);
    expect(text, 'den felaktiga salt-nyckel-formuleringen syns').not.toMatch(/salt-nyckel|salt key|chiave di salt/i);
    expect(text, 'platsdata påstås fortfarande samlas in').not.toMatch(/Plats \(endast om|Location \(only if/i);
    // Personuppgiftsansvarig (2026-11-07): Perfectday AB, org.nr 556990-9830.
    // Tidigare stod "drivs av Tomor Gashi" — det var ett underbyggt antagande.
    expect(text, 'personuppgiftsansvarig Perfectday AB saknas').toMatch(/Perfectday AB/);
    expect(text, 'organisationsnumret 556990-9830 saknas').toMatch(/556990-9830/);
    expect(text, 'privatpersonen syns fortfarande som operatör').not.toMatch(/Tomor Gashi/);

    const realErrors = errors.filter((e) => !/429/.test(e.text));
    expect(realErrors, `Konsolfel: ${JSON.stringify(realErrors, null, 2)}`).toEqual([]);
  });

  test('villkoren: inga platshållare och 18 års gräns', async ({ page }) => {
    await boot(page, BASE_URL);
    const text = await openLegal(page, 'open-terms-of-service');

    await page.screenshot({ path: `${OUT}/terms-of-service.png`, fullPage: false });

    expect(text, 'villkoren öppnade inte').toMatch(/Användarvillkor/i);
    expect(text, 'en [TODO: ...]-platshållare syns i villkoren').not.toMatch(/\[TODO:/i);
    expect(text, 'råa i18n-nycklar renderas i villkoren').not.toMatch(/legal\.(privacy|terms)\./i);
    expect(text, 'AI-utkastsbanneren syns fortfarande').not.toMatch(/AI-utkast|AI draft|bozza AI/i);
    expect(text, 'åldersgränsen är fortfarande 16 år').not.toMatch(/minst 16 år|at least 16 years|almeno 16 anni/i);
    expect(text, 'åldersgränsen 18 år saknas').toMatch(/minst 18 år|at least 18 years|almeno 18 anni/i);
    expect(text, 'den gamla kontaktadressen syns fortfarande').not.toMatch(/privacy@eventpulse\.nu/);
    expect(text, 'äganderätten pekar inte på Perfectday AB').toMatch(/Perfectday AB/);
    expect(text, 'privatpersonen syns fortfarande som ägare').not.toMatch(/Tomor Gashi/);
  });
});
