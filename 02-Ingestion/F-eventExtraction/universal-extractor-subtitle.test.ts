/**
 * Underrubriker är inte evenemangets namn — 2026-10-25.
 *
 * Se titleClassTokens.ts för bakgrunden och beviset (sju orelaterade
 * domäner). Det här testet mäter effekten på extraktorn, inte bara
 * hjälpfunktionen.
 *
 * Berwaldhallen-formen:
 *
 *   <h3 class="Blurb__heading">
 *     <a href="…/streetstardanceschoolchallenge2026-14-16-ar">
 *       Streetstar Dance School Challenge 2026
 *       <span class="Blurb__subtitle"> — Next Generation 14–16 år</span>
 *     </a>
 *   </h3>
 *
 * FÖRE fixen: titeln blev "— Next Generation 14–16 år" (underrubriken).
 * EFTER fixen: titeln blir hela rubriken — evenemangets namn.
 */

import { describe, it, expect } from 'vitest';
import { extractEvents } from './universal-extractor';

/** Real markup från berwaldhallen.se (2026-10-25). */
const BERWALDHALLEN_HTML = `<!doctype html>
<html lang="sv">
<body>
  <ul class="Post-list">
    <li class="Blurb Blurb--default">
      <div class="Production-details__runs" aria-label="Pågår"><span>29 oktober</span></div>
      <h3 class="Blurb__heading">
        <a class="Blurb__cta" href="/konsert/streetstardanceschoolchallenge2026-14-16-ar">Streetstar Dance School Challenge 2026<span class="Blurb__subtitle"> — Next Generation 14–16 år</span></a>
      </h3>
    </li>
  </ul>
</body>
</html>`;

/** En sida där underrubriken är den ENDA titel-markeringen. */
const ONLY_SUBTITLE_HTML = `<!doctype html>
<html lang="sv">
<body>
  <div class="event-card">
    <h3 class="Blurb__heading">
      <a href="/konsert/kvart/">Sjungande vänner<span class="Blurb__subtitle"> — underrubrik</span></a>
    </h3>
    <time datetime="2026-11-07">7 november</time>
  </div>
</body>
</html>`;

describe('extraktorn — underrubrik är inte en titel', () => {
  it('berwaldhallen — titeln blir evenemangets namn, inte underrubriken', () => {
    const result = extractEvents(BERWALDHALLEN_HTML, 'berwaldhallen', 'https://www.berwaldhallen.se/');
    const evt = result.events.find((e) =>
      String(e.url ?? '').includes('streetstardanceschoolchallenge2026'),
    );
    expect(evt).toBeDefined();
    expect(evt!.title).toBe('Streetstar Dance School Challenge 2026 — Next Generation 14–16 år');
    expect(evt!.title.startsWith('—')).toBe(false);
  });

  it('NEGATIV KONTROLL — en ren underrubrik blir aldrig titeln', () => {
    const result = extractEvents(BERWALDHALLEN_HTML, 'berwaldhallen', 'https://www.berwaldhallen.se/');
    for (const evt of result.events) {
      expect(evt.title.trim().startsWith('—')).toBe(false);
    }
  });

  it('NEGATIV KONTROLL — underrubrik som enda markering faller tillbaka på ankarnas text', () => {
    const result = extractEvents(ONLY_SUBTITLE_HTML, 'berwaldhallen', 'https://www.berwaldhallen.se/');
    const evt = result.events.find((e) => String(e.url ?? '').includes('/kvart/'));
    expect(evt).toBeDefined();
    expect(evt!.title).not.toBe('— underrubrik');
    expect(evt!.title).toContain('Sjungande vänner');
  });
});
