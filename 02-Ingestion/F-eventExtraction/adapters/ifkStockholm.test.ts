/**
 * IFK Stockholm-adapterns tester.
 *
 * Fixturen är den RIKTIGA markupen från
 * https://ifkstockholmsimklubb.se/sida/?ID=408177 (2026-10-24) och från
 * portalen https://www.ifkstockholm.se/. Endast inline-stilar är borttagade.
 */
import { describe, it, expect } from 'vitest';
import { matches, parseCalendarEntries, extract } from './ifkStockholm';

/** Fast "nu" så att framtidsfiltret är deterministiskt i testerna. */
const NOW = new Date('2026-10-24T12:00:00Z');
const KALENDARIUM_URL = 'https://ifkstockholmsimklubb.se/sida/?ID=408177';

/** Riktig markup från Simklubbens kalendarium (inline-stilar borttagna). */
const KALENDARIUM_FIXTURE = `
<div class="sa-paragraph__body"><div>
<p><strong>HT-2026</strong></p>
<p>Start simträning 25 augusti</p>
<p>Dagläger yngre simmare, lördag 17/10</p>
<p>Höstläger Katrineholm, 13-15 november</p>
<p>IFK Klubbmästerskap 24/11</p>
<p>Lucia och Banana Cup 8/12</p>
<p>Sista datum för terminen, söndag 20/12, tisdag 22/12</p>
<p>&nbsp;</p>
<p><strong>VT-2026</strong></p>
<p>Vårläger 21-22 mars</p>
<p>Vårmästerskap 5 maj</p>
<p>Sista träning våren söndag 24/5</p>
<p>Sista träning våren tisdag 26/5</p>
<p>Sommarläger, vecka 32</p>
<p>&nbsp;</p>
<p><strong>HT-2025</strong></p>
<p>Klubbmästerskap 18 november</p>
<p>Lucia och Banana Cup 9 december</p>
<p>Sista träning söndag 21 december</p>
<p>Sista träning tisdag 16 december</p>
<p>&nbsp;</p>
<table border="0">
<tbody>
<tr>
<td><strong>VT-2026</strong></td>
<td>&nbsp;</td>
</tr>
<tr>
<td>Terminsstart</td>
<td>Söndag 11 och Tisdag 13 januari</td>
</tr>
<tr>
<td>Årsmöte</td>
<td>8 februari kl. 15.00</td>
</tr>
<tr>
<td>Sportlov - ingen simning</td>
<td>22 och 24 februari</td>
</tr>
<tr>
<td>Vårläger</td>
<td>21-22 mars</td>
</tr>
<tr>
<td>Påsklov - ingen simning</td>
<td>&nbsp;</td>
</tr>
<tr>
<td>Vårmästerskap (VM)</td>
<td>5 maj</td>
</tr>
<tr>
<td>Terminsavslutning</td>
<td>&nbsp;</td>
</tr>
<tr>
<td>Picknick med brännboll</td>
<td>&nbsp;</td>
</tr>
<tr>
<td>Sommarläger</td>
<td>vecka 32</td>
</tr>
<tr>
<td>&nbsp;</td>
<td>&nbsp;</td>
</tr>
<tr>
<td><strong>HT-2024</strong></td>
<td>&nbsp;</td>
</tr>
<tr>
<td>Kickoff för tränare och styrelsen</td>
<td>27 augusti</td>
</tr>
<tr>
<td>Terminsstart</td>
<td>1 och 3 september</td>
</tr>
<tr>
<td>Föräldramöte</td>
<td>1 oktober kl. 18.30</td>
</tr>
<tr>
<td>Höstlov - ingen simning</td>
<td>27 och 29 oktober</td>
</tr>
<tr>
<td>Höstläger</td>
<td>15-17 november</td>
</tr>
<tr>
<td>Klubbmästerskap</td>
<td>26 november</td>
</tr>
<tr>
<td>Luciafirande och Banana cup</td>
<td>10 december</td>
</tr>
<tr>
<td>Terminsavslutning</td>
<td>15 och 17 december</td>
</tr>
<tr>
<td>&nbsp;</td>
<td>&nbsp;</td>
</tr>
</tbody>
</table>
</div>
<div>&nbsp;</div></div>
`;

/** Riktig markup från portalen ifkstockholm.se (avdelningslänkarna). */
const PORTAL_FIXTURE = `
<div class="styles_contentContainer__lrPIa textnormal styles_text__3jGMu styles_invalidateHighlightAndShadows__2W3IH White themeTextClass"><p class="">http://ifkstockholmbk.se/</p></div>
<div class="styles_contentContainer__lrPIa textnormal styles_text__3jGMu styles_invalidateHighlightAndShadows__2W3IH White themeTextClass"><p style="text-align: center;" class=""><a class="link1" href="http://ifkstockholmfk.se" target="_blank" rel="noopener">kansli@ifkstockholmfk.se<br></a></p></div>
<div class="styles_contentContainer__lrPIa textnormal styles_text__3jGMu styles_invalidateHighlightAndShadows__2W3IH White themeTextClass"><p style="text-align: center;" class=""><a class="link1" href="http://ifkstockholmsimklubb.se" target="_blank" rel="noopener">Hemsida</a></p></div>
`;

describe('ifkStockholm adapter', () => {
  it('matchar bara IFK Stockholms egna värdar', () => {
    expect(matches('https://www.ifkstockholm.se/')).toBe(true);
    expect(matches('https://ifkstockholm.se/')).toBe(true);
    expect(matches('https://ifkstockholmsimklubb.se/sida/?ID=408177')).toBe(true);
    expect(matches('https://ifkstockholmsimklubb.web.sportadmin.se/sida/?ID=408177')).toBe(true);
    expect(matches('https://example.com/')).toBe(false);
    expect(matches('https://ifkstockholm.se.evil.example/')).toBe(false);
  });

  it('läser både listan och tabellen', () => {
    const entries = parseCalendarEntries(KALENDARIUM_FIXTURE);
    // 21 rader: 13 i <p>-listan och 8 i tabellen (Vårläger och
    // Vårmästerskap finns i båda). Mätt mot den riktiga sidan.
    expect(entries.length).toBe(21);
  });

  it('deriverar året ur terminrubriken', () => {
    const entries = parseCalendarEntries(KALENDARIUM_FIXTURE);
    const lager = entries.find((e) => e.title === 'Höstläger Katrineholm');
    expect(lager).toBeDefined();
    expect(lager!.date).toBe('2026-11-13');
    expect(lager!.endDate).toBe('2026-11-15');
    expect(lager!.term).toBe('HT-2026');

    const gammalt = entries.find((e) => e.title === 'Klubbmästerskap' && e.term === 'HT-2025');
    expect(gammalt!.date).toBe('2025-11-18');
  });

  it('läser tabellradens namn och datum', () => {
    const entries = parseCalendarEntries(KALENDARIUM_FIXTURE);
    const arsmote = entries.find((e) => e.title === 'Årsmöte');
    expect(arsmote!.date).toBe('2026-02-08');
    expect(arsmote!.time).toBe('15:00');

    const kickoff = entries.find((e) => e.title === 'Kickoff för tränare och styrelsen');
    expect(kickoff!.date).toBe('2024-08-27');
    expect(kickoff!.term).toBe('HT-2024');

    const gammaltMesterskap = entries.find(
      (e) => e.title === 'Klubbmästerskap' && e.term === 'HT-2024'
    );
    expect(gammaltMesterskap!.date).toBe('2024-11-26');
  });

  it('hoppar över rader med flera datum eller utan datum', () => {
    const entries = parseCalendarEntries(KALENDARIUM_FIXTURE);
    const titles = entries.map((e) => e.title);
    expect(titles).not.toContain('Sista datum för terminen');
    expect(titles).not.toContain('Sommarläger');
    expect(titles).not.toContain('Sportlov - ingen simning');
    expect(titles).not.toContain('Höstlov - ingen simning');
    expect(titles).not.toContain('Terminsstart');
    expect(titles).not.toContain('Terminsavslutning');
    expect(titles).not.toContain('Påsklov - ingen simning');
  });

  it('extraherar de tre framtida terminraderna', () => {
    const res = extract(KALENDARIUM_FIXTURE, KALENDARIUM_URL, 'ifk-stockholm', NOW);
    expect(res.method).toBe('ifk-sim-kalendarium');
    expect(res.events.length).toBe(3);
    expect(res.events.map((e) => e.title)).toEqual([
      'Höstläger Katrineholm',
      'IFK Klubbmästerskap',
      'Lucia och Banana Cup',
    ]);
    expect(res.events.map((e) => e.date)).toEqual(['2026-11-13', '2026-11-24', '2026-12-08']);
    expect(res.events[0].endDate).toBe('2026-11-15');
    expect(res.events[0].source).toBe('ifk-stockholm');
    expect(res.events[0].organizer).toBe('IFK Stockholm Simklubb');
    expect(res.events[0].category).toBe('sports');
    expect(res.events[0].venue).toBeUndefined();
    expect(res.events[0].confidence.hasVenue).toBe(false);
  });

  it('släpper avslutade termindagar', () => {
    const res = extract(
      KALENDARIUM_FIXTURE,
      KALENDARIUM_URL,
      'ifk-stockholm',
      new Date('2026-12-01T12:00:00Z')
    );
    expect(res.events.length).toBe(1);
    expect(res.events[0].date).toBe('2026-12-08');
  });

  it('gör inget på främmande URL', () => {
    const res = extract(KALENDARIUM_FIXTURE, 'https://example.com/kalendarium', 'ifk-stockholm', NOW);
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('hanterar en sida utan kalendarium (negativ kontroll)', () => {
    const res = extract(
      '<html><body><h1>IFK Stockholm</h1></body></html>',
      KALENDARIUM_URL,
      'ifk-stockholm',
      NOW
    );
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('lämnar vidare avdelningslänkarna från portalen', () => {
    const res = extract(PORTAL_FIXTURE, 'https://www.ifkstockholm.se/', 'ifk-stockholm', NOW);
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('ifk-portal-links');
    expect(res.showUrls).toContain('http://ifkstockholmsimklubb.se');
    expect(res.showUrls).toContain('http://ifkstockholmfk.se');
  });
});
