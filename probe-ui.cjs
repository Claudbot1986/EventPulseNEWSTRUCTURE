// Probe: open Expo web app, type "hej", send, wait for chips, screenshot.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 820 } });
  const page = await ctx.newPage();
  page.on('console', (msg) => console.log('[browser]', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));

  await page.goto('http://localhost:19006/', { waitUntil: 'networkidle', timeout: 30_000 });

  await page.waitForSelector('input', { timeout: 10_000 });
  console.log('[probe] input present');

  await page.screenshot({ path: '/tmp/ui-1-empty.png' });

  await page.fill('input', 'hej');
  await page.press('input', 'Enter');

  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/ui-2-after-hej.png' });

  const text = await page.evaluate(() => document.body.innerText);
  console.log('[probe] visible text:\n' + text);

  await browser.close();
})();
