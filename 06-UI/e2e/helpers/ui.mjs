/**
 * Delade hjälpare för verify-eventpulse-ui (Expo-webb, Playwright).
 *
 * Viktigt: React Native Web:s Pressable/TouchableOpacity svarar INTE på
 * `.click()` — de lyssnar på pointerdown/pointerup. Alla tryck går därför
 * via pointer-events, precis som i `e2e/search.test.mjs`.
 */

/** Tryck på första matchande element (CSS-selektor). */
export async function tap(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, reason: 'not-found' };
    const opts = {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
      isPrimary: true,
      pointerId: 1,
    };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    return { ok: true };
  }, selector);
}

/**
 * Tryck på element som matchar text. Väljer det DJUPAST matchande elementet
 * så att en container (t.ex. hela home-screen) inte vinner över knappen.
 *
 * Viktigt: vissa trykbara ytor i den här appen är INTE <button> — t.ex.
 * "< Tillbaka" är en TouchableOpacity utan accessibilityRole och renderas
 * därför som ett vanligt <div>. Därför faller sökningen tillbaka på
 * textinnehåll över alla element och trycker på det djupaste träffen.
 * Events bubblar upp till föräldern, som har React-handlern.
 */
export async function tapText(page, text, { exact = false } = {}) {
  return page.evaluate(
    ({ needle, exactMatch }) => {
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        const st = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
      };
      const isMatch = (el) => {
        const t = (el.textContent || '').trim();
        const label = el.getAttribute('aria-label') || '';
        if (exactMatch) return t === needle || label === needle;
        return t === needle || label === needle || t.includes(needle) || label.includes(needle);
      };

      const interactables = Array.from(
        document.querySelectorAll('button, [role="button"], [role="tab"], a, [data-testid]'),
      ).filter(isVisible);
      let hits = interactables.filter(isMatch);

      if (!hits.length) {
        const all = Array.from(document.querySelectorAll('body *')).filter(isVisible);
        hits = all.filter((el) => {
          const t = (el.textContent || '').trim();
          return exactMatch ? t === needle : t.includes(needle);
        });
      }

      if (!hits.length) return { ok: false, reason: 'not-found' };

      const hit = hits.find((el) => !hits.some((other) => other !== el && el.contains(other))) || hits[0];
      const opts = {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 1,
      };
      hit.dispatchEvent(new PointerEvent('pointerdown', opts));
      hit.dispatchEvent(new PointerEvent('pointerup', opts));
      hit.dispatchEvent(new MouseEvent('click', opts));
      return { ok: true, text: (hit.textContent || '').trim().slice(0, 80), tag: hit.tagName.toLowerCase() };
    },
    { needle: text, exactMatch: exact },
  );
}

/** Tryck på "< Tillbaka" (renderas som TouchableOpacity, inte <button>). */
export async function tapBack(page) {
  return tapText(page, 'Tillbaka', { exact: false });
}

/** Tryck på en flik (Hem/Utforska/Karta/Notiser/Profil). */
export async function tapTab(page, label) {
  return page.evaluate((needle) => {
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    // Appen har TVÅ tabbars: App.js:os egen (dold) och AppShells synliga
    // BottomTabBar. Vi får bara trycka på synliga flikar.
    const tabs = Array.from(document.querySelectorAll('[role="tab"], button')).filter(isVisible);
    const tab = tabs.find((t) =>
      (t.getAttribute('aria-label') || t.textContent || '').trim().toLowerCase().includes(needle.toLowerCase()),
    );
    if (!tab) return { ok: false, reason: 'not-found', visible: tabs.map((t) => t.getAttribute('aria-label') || (t.textContent || '').trim()) };
    const opts = {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
      isPrimary: true,
      pointerId: 1,
    };
    tab.dispatchEvent(new PointerEvent('pointerdown', opts));
    tab.dispatchEvent(new PointerEvent('pointerup', opts));
    tab.dispatchEvent(new MouseEvent('click', opts));
    return { ok: true };
  }, label);
}

/**
 * Samlar konsolfel och page errors under en drive.
 * CORS/agent-health-brus filtreras bort (test-miljöens CORS-quirk), men
 * ALLA andra konsolfel räknas — de är det vi letar efter.
 */
export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push({ type: 'pageerror', text: err.message }));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const txt = msg.text();
    if (txt.includes('agent/health') && txt.includes('CORS')) return;
    if (txt === 'Failed to load resource: net::ERR_FAILED' && /agent\/(health|feed)/.test(txt)) return;
    errors.push({ type: 'console', text: txt });
  });
  return errors;
}

/** Starta appen och vänta in att första feeden renderats. */
export async function boot(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(5_000);
}

/**
 * Hem-sektioner: rubrik + första eventkortet under rubriken.
 * Returnerar [{ title, aria, top }] för varje sektion som har kort.
 */
export async function homeSections(page) {
  return page.evaluate(() => {
    const home = document.querySelector('[data-testid="home-screen"]');
    if (!home) return { ok: false, reason: 'home-screen missing' };

    const titles = Array.from(home.querySelectorAll('div'))
      .filter((d) => d.children.length === 0)
      .map((d) => ({ text: (d.textContent || '').trim(), top: d.getBoundingClientRect().top }))
      .filter((d) => d.text.length > 0 && d.text.length < 30);

    const cards = Array.from(home.querySelectorAll('button, [role="button"]'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          aria: el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 80),
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
        };
      })
      .filter((c) => c.width > 0 && c.height > 0 && c.aria);

    // Rubriker som ligger till vänster (x < 30) och på samma radstruktur.
    const heads = titles.filter((t) => {
      const el = Array.from(home.querySelectorAll('div')).find(
        (d) => d.children.length === 0 && (d.textContent || '').trim() === t.text,
      );
      return el && el.getBoundingClientRect().left < 30;
    });

    const out = [];
    for (let i = 0; i < heads.length; i += 1) {
      const head = heads[i];
      const next = heads[i + 1];
      const card = cards
        .filter((c) => c.top >= head.top && (!next || c.top < next.top))
        .sort((a, b) => a.top - b.top)[0];
      out.push({ title: head.text, card: card || null });
    }
    return { ok: true, sections: out };
  });
}

/** Scrolla så att elementet syns i den scrollbara containern (RN-web). */
export async function scrollIntoView(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const containers = Array.from(document.querySelectorAll('body *')).filter((n) => {
      const st = window.getComputedStyle(n);
      return (st.overflowY === 'auto' || st.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 40;
    });
    const target = containers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (target) target.scrollTop = el.getBoundingClientRect().top + target.scrollTop - target.clientHeight / 2;
    return { ok: true };
  }, selector);
}
