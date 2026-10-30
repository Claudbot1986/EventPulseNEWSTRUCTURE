/**
 * dedup-no-duplicate-cards.test.mjs — bevisa att APPEN inte visar dubbletter.
 *
 * ROTSAK (2026-10-30): Utforska → Comedy visade flera eventkort för samma
 * evenemang ("MAFFIA COMEDY SUPERWEEKEND" — två kort, identisk
 * titel/datum/tid, från livespot + evensos).
 *
 * Det här är APP-NIVÅN: vi kör den riktiga webbbyggen, navigerar till
 * Utforska, öppnar kategorier och läser de kort som faktiskt renderas.
 * DB-nivån (identity-nyckeln) verifieras av scripts/audit-duplicates.ts
 * --gate.
 *
 *   cd 06-UI && BASE_URL=http://localhost:9090 npx playwright test e2e/dedup-no-duplicate-cards.test.mjs
 */

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { boot, collectErrors, tapTab, tapText } from './helpers/ui.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:9090';
const OUT =
  process.env.UI_EVIDENCE_DIR ||
  `runtime/verification-reports/dedup-verify-${new Date().toISOString().replace(/[:.]/g, '-')}`;

/**
 * Kategorier som verifieras. "Komedi" är användarens egna exempel
 * (MAFFIA COMEDY SUPERWEEKEND); de andra fångar olika källor.
 */
const CATEGORIES = (process.env.DEDUP_CATEGORIES || 'Komedi,Musik,Drama').split(',');

/** Normalisera en titel på samma sätt som appens identitetsnyckel. */
function normTitle(t) {
  return (t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9åäö\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Hämta de eventkort som renderas på skärmen.
 *
 * Utforska-radens tryckyta har accessibilityLabel = "<titel> — <datum · tid · venue · area>".
 * Vi läser de faktiska attributen ur DOM — inga API-anrop, inga mockar.
 */
async function readCards(page) {
  return page.evaluate(() => {
    const screen = document.querySelector('[data-testid="utforska-section-screen"]');
    if (!screen) return { ok: false, reason: 'utforska-section-screen missing' };

    const out = [];
    for (const el of screen.querySelectorAll('[role="button"], button')) {
      const label = (el.getAttribute('aria-label') || '').trim();
      if (!label || !label.includes('—')) continue; // "⋯"-menyknappen m.m.
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // osynliga
      const [title, ...rest] = label.split('—').map((s) => s.trim());
      out.push({
        title,
        subtitle: rest.join('—').trim(),
        label,
        parts: rest.join('—').split('·').map((s) => s.trim()).filter(Boolean),
      });
    }
    return { ok: true, cards: out };
  });
}

/**
 * Scrolla till slutet av kategorilistan så fler sidor laddas.
 *
 * Utforska-kategorivyn har oändlig scroll (`onEndReached`, EXPLORE_PAGE_SIZE
 * = 15). UTAN detta läser gaten bara första sidan — vilket gjorde att
 * MAFFIA-fallet (2026-11-20) aldrig syntes och gaten var växelvis grön
 * trots dubbletten. Varje runda scrollar till botten och väntar på att
 * nästa sida ska landa.
 */
async function scrollToLoadMore(page, maxRounds = 40) {
  let lastCount = -1;
  let stableRounds = 0;
  let rounds = 0;
  for (; rounds < maxRounds; rounds++) {
    const count = await page.evaluate(() => {
      const screen = document.querySelector('[data-testid="utforska-section-screen"]');
      if (!screen) return -1;
      return screen.querySelectorAll('[role="button"], button').length;
    });
    if (count === lastCount) {
      stableRounds += 1;
      if (stableRounds >= 2) break; // två rader utan tillväxt → slut
    } else {
      stableRounds = 0;
    }
    lastCount = count;

    // Riktig scroll-gest (mus-hjul) över listan — samma som en användare.
    // Programmatisk scrollTop + syntetiskt scroll-event triggar inte
    // React Native Webs onScroll->onEndReached-kedja tillförlitligt.
    const box = await page.evaluate(() => {
      const screen = document.querySelector('[data-testid="utforska-section-screen"]');
      if (!screen) return null;
      // ScrollViewen kan SJÄLV vara testid-elementet — sök både i det
      // och bland dess barn.
      const candidates = [screen, ...Array.from(screen.querySelectorAll('div'))];
      const containers = candidates.filter((n) => {
        const st = window.getComputedStyle(n);
        return st.overflowY === 'auto' || st.overflowY === 'scroll';
      });
      const target = containers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (!target) return null;
      const r = target.getBoundingClientRect();
      return {
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        scrollable: target.scrollHeight > target.clientHeight,
      };
    });
    if (!box || !box.scrollable) break;
    await page.mouse.move(box.x, box.y);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(2_000);
  }
  return { rounds, elements: lastCount };
}

/**
 * Vänta tills en text syns i DOM.
 *
 * Efter "Tillbaka" laddas kategorichipsen om asynkront. Utan den här
 * väntan tryckte gaten på laddningsskelet och rapporterade "kategorin
 * kunde inte öppnas" — en falsk röd, inte en riktig dubblett.
 */
async function waitForText(page, text, { exact = true, timeout = 30_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await page.evaluate(
      ({ needle, exactMatch }) => {
        const isVisible = (el) => {
          const r = el.getBoundingClientRect();
          const st = window.getComputedStyle(el);
          return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
        };
        const all = Array.from(document.querySelectorAll('body *')).filter(isVisible);
        return all.some((el) => {
          const t = (el.textContent || '').trim();
          const label = el.getAttribute('aria-label') || '';
          return exactMatch ? t === needle || label === needle : t.includes(needle) || label.includes(needle);
        });
      },
      { needle: text, exactMatch: exact },
    );
    if (found) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

/**
 * Vänta tills kategorivyn renderat minst ett kort.
 *
 * Utan detta läser gaten listan medan den fortfarande är tom (skelett),
 * och en lista med 0 kort ger 0 dubbletter — en falsk grön.
 */
async function waitForCards(page, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const n = await page.evaluate(() => {
      const screen = document.querySelector('[data-testid="utforska-section-screen"]');
      if (!screen) return -1;
      return screen.querySelectorAll('[role="button"], button').length;
    });
    if (n > 0) return n;
    await page.waitForTimeout(500);
  }
  return 0;
}

test.describe('Utforska — inga dubbletter', () => {
  test.setTimeout(300_000);
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  test('ingen kategori visar två kort för samma evenemang', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page, BASE_URL);

    await tapTab(page, 'Utforska');
    await page.waitForTimeout(3_000);

    const findings = [];
    const review = [];
    const allCards = [];
    let totalCards = 0;

    for (const category of CATEGORIES) {
      const visible = await waitForText(page, category, { exact: true });
      expect(visible, `kategorin "${category}" syns inte i Utforska`).toBe(true);
      const opened = await tapText(page, category, { exact: true });
      expect(opened.ok, `kategorin "${category}" kunde inte öppnas i Utforska`).toBe(true);

      const firstBatch = await waitForCards(page);
      expect(firstBatch, `kategorin "${category}" renderade inga kort`).toBeGreaterThan(0);
      await page.waitForTimeout(1_500);

      // Ladda hela kategorilistan (oändlig scroll) — annars ser gaten
      // bara första sidan (15 kort) och missar allt som ligger längre ner.
      const loaded = await scrollToLoadMore(page);
      await page.waitForTimeout(1_000);

      const read = await readCards(page);
      expect(read.ok, `Utforska-sidan saknas för kategorin "${category}"`).toBe(true);

      const cards = read.cards;
      totalCards += cards.length;
      for (const card of cards) {
        allCards.push({ category, title: card.title, label: card.label });
      }

      // ── Granskningslista: samma titel + samma datum (oavsett tid/plats) ──
      // Detta fångar ALLA par som ser likadana ut, också när platsnamnen
      // skiljer sig ("Slaktkyrkan" vs "Styckmästergatan 10, Stockholm").
      //
      // Varför inte bara hårdfelet ovan? Hårdfelet kräver samma TID, och
      // 2026-10-30 fanns de sista dubbletterna ("President" 19:30 + 20:30,
      // "Nemzzz" 20:00 + 21:00) med olika klockslag — de föll igenom både
      // hårdfelet och den mjuka regeln (som krävde samma platsnamn).
      // En gate som inte ser paren kan inte hävda att de är borta.
      //
      // Listan är en GRANSKNINGSLISTA, inte ett fel: "Mia, myself and I"
      // har matiné 17:00 och kväll 20:00 — två föreställningar, inte två
      // dubbletter. DB-gaten (scripts/audit-duplicates.ts --gate) avgör vad
      // som faktiskt är samma evenemang.
      const byDay = new Map();
      for (const card of cards) {
        const day = card.parts[0] ?? '';
        if (!day) continue;
        const key = `${normTitle(card.title)}|${day}`;
        const bucket = byDay.get(key) ?? [];
        bucket.push(card);
        byDay.set(key, bucket);
      }
      for (const [key, bucket] of byDay) {
        if (bucket.length < 2) continue;
        const times = bucket.map((c) => c.parts[1] ?? '');
        const venues = [...new Set(bucket.map((c) => c.parts[2] ?? ''))];
        review.push({
          category,
          key,
          count: bucket.length,
          sameTime: new Set(times).size === 1,
          venues,
          cards: bucket.map((c) => `${c.title} — ${c.subtitle}`),
        });
      }

      // ── Hårdfel: samma titel + samma datum + samma klockslag ───────────
      // Detta är exakt symptomet användaren rapporterade.
      const byExact = new Map();
      for (const card of cards) {
        const key = `${normTitle(card.title)}|${card.parts[0] ?? ''}|${card.parts[1] ?? ''}`;
        const bucket = byExact.get(key) ?? [];
        bucket.push(card);
        byExact.set(key, bucket);
      }
      for (const [key, bucket] of byExact) {
        if (bucket.length > 1) {
          findings.push({
            kind: 'exact',
            category,
            key,
            count: bucket.length,
            cards: bucket.map((c) => `${c.title} — ${c.subtitle}`),
          });
        }
      }

      // ── Mjukrapport: samma titel + samma datum + samma plats, tid inom
      //    180 min. Kan vara en samma show med olika klockslag från olika
      //    aggregatorer — rapporteras, fälls inte. ────────────────────────
      const byVenue = new Map();
      for (const card of cards) {
        const day = card.parts[0] ?? '';
        const time = card.parts[1] ?? '';
        const venue = card.parts[2] ?? '';
        if (!day || !venue || !/^\d{1,2}:\d{2}$/.test(time)) continue;
        const key = `${normTitle(card.title)}|${day}|${venue}`;
        const bucket = byVenue.get(key) ?? [];
        bucket.push({ ...card, minutes: Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) });
        byVenue.set(key, bucket);
      }
      for (const [key, bucket] of byVenue) {
        if (bucket.length < 2) continue;
        const mins = bucket.map((c) => c.minutes);
        const gap = Math.max(...mins) - Math.min(...mins);
        if (gap > 180) continue; // kan vara två skilda föreställningar
        findings.push({
          kind: 'soft',
          category,
          key,
          count: bucket.length,
          gapMinutes: gap,
          cards: bucket.map((c) => `${c.title} — ${c.subtitle}`),
        });
      }

      console.log(`[dedup] ${category}: ${cards.length} kort efter ${loaded.rounds} scrollrundor`);
      await tapText(page, 'Tillbaka', { exact: false });
      await page.waitForTimeout(1_500);
    }

    // Varje läst kort skrivs till rapporten: beviset ska gå att granska
    // i efterhand utan att köra om hela gaten.
    const report = {
      at: new Date().toISOString(),
      categories: CATEGORIES,
      totalCards,
      cards: allCards,
      findings,
      review,
    };
    writeFileSync(`${OUT}/dedup-cards.json`, JSON.stringify(report, null, 2));
    await page.screenshot({ path: `${OUT}/utforska-last.png`, fullPage: false });

    const exact = findings.filter((f) => f.kind === 'exact');
    const soft = findings.filter((f) => f.kind === 'soft');
    const sameTime = review.filter((r) => r.sameTime);
    console.log(
      `[dedup] ${totalCards} kort i ${CATEGORIES.length} kategorier — ` +
        `${exact.length} dubblettgrupper (hårdfel), ${soft.length} mjuka observationer, ` +
        `${review.length} par med samma titel+datum (granskning), ` +
        `${sameTime.length} av dem med identisk tid`,
    );
    if (review.length > 0) {
      console.log('\n[dedup] Granskningslista — samma titel + samma datum:');
      for (const r of review) {
        console.log(`  [${r.category}] ${r.key} (${r.count} kort, samma tid: ${r.sameTime ? 'JA' : 'nej'})`);
        for (const c of r.cards) console.log(`      ${c}`);
      }
    }
    if (exact.length > 0) {
      console.error(
        '\nDUBBLETTKORT hittade i Utforska:\n' +
          exact
            .map(
              (f) =>
                `  [${f.category}] ${f.count} kort för "${f.key}"\n` +
                f.cards.map((c) => `      ${c}`).join('\n'),
            )
            .join('\n'),
      );
    }
    expect(
      exact,
      `Utforska visar ${exact.length} uppsättningar av dubbletter (se ${OUT}/dedup-cards.json)`,
    ).toHaveLength(0);

    // Inga konsolfel längs vägen — en trasig vy kan dölja dubbletter.
    expect(errors, `konsolfel under körningen: ${JSON.stringify(errors)}`).toHaveLength(0);
  });
});
