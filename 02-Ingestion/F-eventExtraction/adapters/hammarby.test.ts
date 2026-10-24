/**
 * Hammarby-adapterns tester.
 *
 * Fixturen är den RIKTIGA renderade markupen från
 * https://www.hammarbyfotboll.se/matcher (2026-10-24, Playwright-rendering).
 * Endast `srcset` och `src` på loggorna är kortade — allt annat är ordagrant.
 */
import { describe, it, expect } from 'vitest';
import { matches, parseMatchCards, parseMatchDetail, extract } from './hammarby';

/** Fast "nu" så att framtidsfiltret är deterministiskt i testerna. */
const NOW = new Date('2026-10-24T12:00:00Z');
const LISTING_URL = 'https://www.hammarbyfotboll.se/matcher';

/** Tre riktiga matchkort (Hammarby–Djurgården, Mjällby–Hammarby, Myjava–Hammarby). */
const LISTING_FIXTURE = `
<ul>
<li><div class="item-module--matchHorizontal--a2528  bg"><a class="item-module--matchHorizontal__link--717f1" href="/matcher/2026-10-25-00-00-hammarby-djurg-rden"></a><div class="item-module--matchHorizontal__content--5e485 item-module--matchHorizontal__contentWithButton--457a0"><div class="item-module--matchHorizontal__left--926e3"><p class="item-module--matchHorizontal__league--7ec8e">OBOS Damallsvenskan 2026</p><p class="item-module--match__loc--3beeb hidden-desktop text-xs text-medium uppercase text-darker">Sålda 2&nbsp;737</p><p class="text-lg text-semibold">Lördag 24 oktober 2026</p><p class="text-xs text-medium uppercase text-darker">Hammarby IP - 15.00</p></div><div class="item-module--matchHorizontal__center--2ea27"><div class="item-module--matchHorizontal__logoContainer--d161d"><div class="item-module--matchHorizontal__logo--2b102"><img src="https://cdn.sanity.io/images/8k2hu6rb/production/team-logo.png" loading="lazy" alt="Hammarby IF" class="cdn-sanity css-0" title="Hammarby IF"></div><span class="item-module--matchHorizontal__logoContainer__teamTitle--e7373 text-semibold">Hammarby IF</span></div><div><p class="text-xs text-medium uppercase text-darker">–</p></div><div class="item-module--matchHorizontal__logoContainer--d161d"><div class="item-module--matchHorizontal__logo--2b102"><img src="https://cdn.sanity.io/images/8k2hu6rb/production/team-logo.png" loading="lazy" alt="Djurgårdens IF" class="cdn-sanity css-0" title="Djurgårdens IF"></div><span class="item-module--matchHorizontal__logoContainer__teamTitle--e7373 text-semibold">Djurgårdens IF</span></div></div><div class="item-module--matchHorizontal__right--39b69"><a href="https://www.axs.com/se/events/1345478/hammarby-djurgarden-tickets?skin=hammarby" class="cta-white" target="_blank" rel="noreferrer" aria-label="Köp biljett">Köp biljett</a><p class="item-module--match__loc--3beeb hidden-mobile text-xs text-medium uppercase text-darker center">Sålda 2&nbsp;737</p></div></div></div></li>
<li><div class="item-module--matchHorizontal--a2528  bg"><a class="item-module--matchHorizontal__link--717f1" href="/matcher/2026-10-25-00-00-mj-llby-aif-hammarby"></a><div class="item-module--matchHorizontal__content--5e485 item-module--matchHorizontal__contentWithButton--457a0"><div class="item-module--matchHorizontal__left--926e3"><p class="item-module--matchHorizontal__league--7ec8e">Allsvenskan 2026</p><p class="text-lg text-semibold">Söndag 25 oktober 2026</p><p class="text-xs text-medium uppercase text-darker">Strandvallen - 16.30</p></div><div class="item-module--matchHorizontal__center--2ea27"><div class="item-module--matchHorizontal__logoContainer--d161d"><div class="item-module--matchHorizontal__logo--2b102"><img src="https://cdn.sanity.io/images/8k2hu6rb/production/team-logo.png" loading="lazy" alt="Mjällby AIF" class="cdn-sanity css-0" title="Mjällby AIF"></div><span class="item-module--matchHorizontal__logoContainer__teamTitle--e7373 text-semibold">Mjällby AIF</span></div><div><p class="text-xs text-medium uppercase text-darker">–</p></div><div class="item-module--matchHorizontal__logoContainer--d161d"><div class="item-module--matchHorizontal__logo--2b102"><img src="https://cdn.sanity.io/images/8k2hu6rb/production/team-logo.png" loading="lazy" alt="Hammarby IF" class="cdn-sanity css-0" title="Hammarby IF"></div><span class="item-module--matchHorizontal__logoContainer__teamTitle--e7373 text-semibold">Hammarby IF</span></div></div><div class="item-module--matchHorizontal__right--39b69"><a href="https://maif.ebiljett.nu/Tickets/Select/uxcewpv1" class="cta-white" target="_blank" rel="noreferrer" aria-label="Köp biljett">Köp biljett</a></div></div></div></li>
<li><div class="item-module--matchHorizontal--a2528  bg"><a class="item-module--matchHorizontal__link--717f1" href="/matcher/2026-10-28-17-00-uefa-women-s-europa-cup-spartak-myjava-hammarby-if"></a><div class="item-module--matchHorizontal__content--5e485 item-module--matchHorizontal__contentWithButton--457a0"><div class="item-module--matchHorizontal__left--926e3"><p class="item-module--matchHorizontal__league--7ec8e">UEFA Women's Europa Cup</p><p class="text-lg text-semibold">Onsdag 28 oktober 2026</p><p class="text-xs text-medium uppercase text-darker">Stadium Myjava - 18.00</p></div><div class="item-module--matchHorizontal__center--2ea27"><div class="item-module--matchHorizontal__logoContainer--d161d"><div class="item-module--matchHorizontal__logo--2b102"><img src="https://cdn.sanity.io/images/8k2hu6rb/production/team-logo.png" loading="lazy" alt="Spartak Myjava" class="cdn-sanity css-0" title="Spartak Myjava"></div><span class="item-module--matchHorizontal__logoContainer__teamTitle--e7373 text-semibold">Spartak Myjava</span></div><div><p class="text-xs text-medium uppercase text-darker">–</p></div><div class="item-module--matchHorizontal__logoContainer--d161d"><div class="item-module--matchHorizontal__logo--2b102"><img src="https://cdn.sanity.io/images/8k2hu6rb/production/team-logo.png" loading="lazy" alt="Hammarby IF" class="cdn-sanity css-0" title="Hammarby IF"></div><span class="item-module--matchHorizontal__logoContainer__teamTitle--e7373 text-semibold">Hammarby IF</span></div></div><div class="item-module--matchHorizontal__right--39b69"><button type="button" class="inactive cta-white" aria-label="Biljetter köps på plats">Biljetter köps på plats</button></div></div></div></li>
</ul>
`;

/** Riktig markup från /matcher/2026-10-25-00-00-mj-llby-aif-hammarby. */
const DETAIL_FIXTURE = `
<div class="page-module--match--be7b1"><div class="bg header-module--matchHeader--62c45"><div class="wrapper header-module--matchHeader__content--8e3d0"><span class="text-semibold header-module--matchHeader__startEventDate--0e46f">söndag 25 oktober 2026 16:30</span><span class="text-xs text-semibold header-module--matchHeader__competition--00483">ALLSVENSKAN 2026</span><div class="text-xs text-semibold header-module--matchHeader__location--17ade"><i class="ico-pin" aria-hidden="true"></i><span>STRANDVALLEN</span></div><div class="text-lg text-bold header-module--matchHeader__teams--6708e"><div class="header-module--matchHeader__localTeam--60d01"><span class="text">Mjällby AIF</span><img src="https://cdn.sanity.io/images/8k2hu6rb/production/team-logo.png" loading="lazy" alt="Mjällby AIF" class="cdn-sanity css-0" title="Mjällby AIF"></div><div class="text-lg header-module--matchHeader__score--39e9f">-</div><div class="header-module--matchHeader__externalTeam--e0c6c"><img src="https://cdn.sanity.io/images/8k2hu6rb/production/team-logo.png" loading="lazy" alt="Hammarby IF" class="cdn-sanity css-0" title="Hammarby IF"><span>Hammarby IF</span></div></div><a href="https://maif.ebiljett.nu/Tickets/Select/uxcewpv1" class="cta-white" target="_blank" rel="noreferrer" aria-label="Köp biljett">Köp biljett</a></div></div>
`;

describe('hammarby adapter', () => {
  it('matchar bara hammarbyfotboll.se', () => {
    expect(matches('https://www.hammarbyfotboll.se/matcher')).toBe(true);
    expect(matches('https://hammarbyfotboll.se/')).toBe(true);
    expect(matches('https://example.com/matcher')).toBe(false);
    expect(matches('https://falsk-hammarbyfotboll.se/matcher')).toBe(false);
  });

  it('läser alla tre matchkorten', () => {
    const cards = parseMatchCards(LISTING_FIXTURE);
    expect(cards.length).toBe(3);
  });

  it('läser titel, datum, tid och arena', () => {
    const cards = parseMatchCards(LISTING_FIXTURE);
    expect(cards[0].title).toBe('Hammarby IF – Djurgårdens IF');
    expect(cards[0].date).toBe('2026-10-24');
    expect(cards[0].time).toBe('15:00');
    expect(cards[0].venue).toBe('Hammarby IP');
    expect(cards[0].league).toBe('OBOS Damallsvenskan 2026');
    expect(cards[1].title).toBe('Mjällby AIF – Hammarby IF');
    expect(cards[1].date).toBe('2026-10-25');
    expect(cards[1].time).toBe('16:30');
    expect(cards[1].venue).toBe('Strandvallen');
  });

  it('tar datumet ur texten, inte ur sluggen', () => {
    // Sluggen säger 2026-10-25, matchen spelas 2026-10-24 (korsverifierat
    // mot Sanity-datumet). Det synliga datumet vinner.
    const cards = parseMatchCards(LISTING_FIXTURE);
    expect(cards[0].url).toContain('2026-10-25-00-00-hammarby-djurg-rden');
    expect(cards[0].date).toBe('2026-10-24');
  });

  it('läser biljetten men inte "biljetter köps på plats"', () => {
    const cards = parseMatchCards(LISTING_FIXTURE);
    expect(cards[0].ticketUrl).toBe(
      'https://www.axs.com/se/events/1345478/hammarby-djurgarden-tickets?skin=hammarby'
    );
    expect(cards[2].ticketUrl).toBeNull();
  });

  it('extraherar ett evenemang per matchkort', () => {
    const res = extract(LISTING_FIXTURE, LISTING_URL, 'hammarby', NOW);
    expect(res.method).toBe('hammarby-listing');
    expect(res.events.length).toBe(3);
    expect(res.events.map((e) => e.date)).toEqual([
      '2026-10-24',
      '2026-10-25',
      '2026-10-28',
    ]);
    expect(res.events[0].source).toBe('hammarby');
    expect(res.events[0].category).toBe('sports');
    expect(res.events[0].venue).toBe('Hammarby IP');
    expect(res.events[0].city).toBe('Stockholm');
    expect(res.events[1].city).toBe('Halmstad');
    expect(res.events[0].description).toBe('OBOS Damallsvenskan 2026');
    expect(res.events[0].confidence.hasTicketInfo).toBe(true);
    expect(res.showUrls.length).toBe(3);
  });

  it('läser en enskild matchsida', () => {
    const match = parseMatchDetail(DETAIL_FIXTURE);
    expect(match).not.toBeNull();
    expect(match!.title).toBe('Mjällby AIF – Hammarby IF');
    expect(match!.date).toBe('2026-10-25');
    expect(match!.time).toBe('16:30');
    expect(match!.venue).toBe('STRANDVALLEN');
    expect(match!.ticketUrl).toBe('https://maif.ebiljett.nu/Tickets/Select/uxcewpv1');

    const res = extract(
      DETAIL_FIXTURE,
      'https://www.hammarbyfotboll.se/matcher/2026-10-25-00-00-mj-llby-aif-hammarby',
      'hammarby',
      NOW
    );
    expect(res.method).toBe('hammarby-match-detail');
    expect(res.events.length).toBe(1);
    expect(res.events[0].date).toBe('2026-10-25');
    expect(res.events[0].venue).toBe('Strandvallen');
    expect(res.events[0].city).toBe('Halmstad');
  });

  it('släpper förflutna matcher', () => {
    const res = extract(LISTING_FIXTURE, LISTING_URL, 'hammarby', new Date('2026-10-26T12:00:00Z'));
    expect(res.events.length).toBe(1);
    expect(res.events[0].date).toBe('2026-10-28');
  });

  it('gör inget på främmande URL', () => {
    const res = extract(LISTING_FIXTURE, 'https://example.com/matcher', 'hammarby', NOW);
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('hanterar en sida utan matcher (negativ kontroll)', () => {
    const res = extract('<html><body><h1>Hammarby Fotboll</h1></body></html>', LISTING_URL, 'hammarby', NOW);
    expect(res.events.length).toBe(0);
    expect(res.showUrls.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('hanterar ett matchkort utan datum (negativ kontroll)', () => {
    const withoutDate = LISTING_FIXTURE.replace(
      '<p class="text-lg text-semibold">Lördag 24 oktober 2026</p>',
      '<p class="text-lg text-semibold">Datum meddelas</p>'
    );
    const cards = parseMatchCards(withoutDate);
    expect(cards[0].date).toBeNull();
    const res = extract(withoutDate, LISTING_URL, 'hammarby', NOW);
    expect(res.events.length).toBe(2);
  });
});
