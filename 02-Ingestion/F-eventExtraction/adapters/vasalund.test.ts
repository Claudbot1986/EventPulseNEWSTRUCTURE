/**
 * Vasalund-adapterns tester.
 *
 * Fixturerna är utklippta ur den RENDERADE HTML:en (mätt 2026-10-24 med
 * lokal Playwright/Chromium — JS-rendering är obligatorisk, server-HTML:en
 * på /matcher innehåller bara JS-mallen):
 *
 *   - MATCHER_FIXTURE   /matcher   → upcoming-grid (3 rader) + results-grid (1 rad)
 *   - CALENDAR_FIXTURE  /kalender  → månadsrubriken "okt 2026" + 6 rader
 *   - PARKED_FIXTURE    www.vasalund.se → den parkerade domänen ("TILL SALU")
 *
 * `<img class="team-badge">` och `<i class="fa-location-dot">` är utklippta
 * ur fixturerna för att hålla dem läsbara — de påverkar inte utvinningen.
 */
import { describe, it, expect } from 'vitest';
import { matches, extract, parseMatchItems, parseCalendarRows, parseTimeRange } from './vasalund';

const MATCHER_FIXTURE = `
<div class="matches-grid upcoming-grid">
  <div class="match-item">
    <div class="match-week-label">Vecka 43</div>
    <div class="match-card">
      <div class="match-card-body">
        <div class="team-col home">
          <div class="team-name">Sollentuna FK</div>
        </div>
        <div class="center-col">
          <div class="match-vs">vs</div>
          <div class="match-meta"><span>lör 24 okt. 2026</span><span>16:00</span><span>Sollentunavallen 1</span></div>
        </div>
        <div class="team-col away">
          <div class="team-name">Herrar </div>
        </div>
      </div>
    </div>
  </div>
  <div class="match-item">
    <div class="match-card">
      <div class="match-card-body">
        <div class="team-col home">
          <div class="team-name">P2015 Future Röd</div>
        </div>
        <div class="center-col">
          <div class="match-vs">vs</div>
          <div class="match-meta"><span>lör 24 okt. 2026</span><span>20:00</span><span>Järvastadens IP</span></div>
        </div>
        <div class="team-col away">
          <div class="team-name">Motståndare</div>
        </div>
      </div>
    </div>
  </div>
  <div class="match-item">
    <div class="match-card">
      <div class="match-card-body">
        <div class="team-col home">
          <div class="team-name">P2019 Solna Svart</div>
        </div>
        <div class="center-col">
          <div class="match-vs">vs</div>
          <div class="match-meta"><span>sön 25 okt. 2026</span><span>09:00</span><span>Råsasjöns IP, plan 1</span></div>
        </div>
        <div class="team-col away">
          <div class="team-name">IF Wasa P19</div>
        </div>
      </div>
    </div>
  </div>
</div>
<div class="matches-grid results-grid">
  <div class="match-item">
    <div class="match-week-label">Vecka 43</div>
    <div class="match-card">
      <div class="match-card-body">
        <div class="team-col home">
          <div class="team-name">F2016</div>
        </div>
        <div class="center-col">
          <div class="match-score">0 – 0</div>
          <div class="match-meta"><span>lör 24 okt. 2026</span><span>19:00</span></div>
        </div>
        <div class="team-col away">
          <div class="team-name">Motståndare</div>
        </div>
      </div>
    </div>
  </div>
</div>
`;

const CALENDAR_FIXTURE = `
<h4 class="calendar-club-date-selector-header">okt 2026</h4>
<div class="events">
  <div class="event-items">
    <div class="calendar-club-event-main ">
      <div class="calendar-club-event-date-mobile">
        <div class="container-date-mobile">
          <div class="calendar-club-day-item-date">
            <div>24</div>
            <div>lör</div>
          </div>
        </div>
      </div>
      <div class="calendar-club-day-date-none">
        <div class="event-wrapper-multiday">
          <div class="multiday-event">
            <div class="startsdate-wrapper-club-two">
              <div class="calendar-club-day-item-background">
                <div class="calendar-club-day-item-label event-type-cup"></div>
                <div class="calendar-club-label-title desktopFont">Cup</div>
                <div class="calendar-club-day-item-time desktopFont">08:45&nbsp;(25/10 16:00)</div>
              </div>
            </div>
          </div>
          <div class="calendar-club-event-title">
            <div class="calendar-club-day-item-background-title">
              <div class="calendar-club-day-item-groupname desktopFont"><h4>P2014 Future Svart</h4></div>
            </div>
          </div>
          <div class="calendar-club-event-loc">
            <div class="calendar-club-day-item-title-container">
              <div class="calendar-club-day-item-title desktopFont"><h4>NACKA OPEN 2026 U12&nbsp;</h4></div>
            </div>
            <div class="calendar-club-day-item-location desktopFont">
              <h4>Fisksätra IF </h4>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="calendar-club-event-main canceled">
      <div class="calendar-club-event-date-mobile">
        <div class="container-date-mobile">
          <div class="calendar-club-day-item-date"></div>
        </div>
      </div>
      <div class="calendar-club-day-date-none">
        <div class="event-wrapper-multiday">
          <div class="calendar-club-container-date">
            <div class="calendar-club-label-wrapper">
              <div class="calendar-club-day-item-label event-type-practice"></div>
              <div class="calendar-club-label-title desktopFont">Träning</div>
            </div>
            <div class="calendar-club-day-item-time desktopFont">09:50 - 10:35</div>
          </div>
          <div class="calendar-club-event-title">
            <div class="calendar-club-day-item-background-title">
              <div class="calendar-club-day-item-groupname desktopFont"><h4>Fotbollslekis F/P 2020 (Lördagar 09:50-10:35, Skytteholms IP C-plan)</h4></div>
            </div>
          </div>
          <div class="calendar-club-event-loc">
            <div class="calendar-club-day-item-title-container">
              <div class="calendar-club-day-item-title desktopFont"><h4>Träning F/P 2020&nbsp;</h4><h4 class="canceled-title">(Inställd)</h4></div>
            </div>
            <div class="calendar-club-day-item-location desktopFont">
              <h4>Skytteholm IP, C-plan.</h4>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="calendar-club-event-main ">
      <div class="calendar-club-event-date-mobile">
        <div class="container-date-mobile">
          <div class="calendar-club-day-item-date"></div>
        </div>
      </div>
      <div class="calendar-club-day-date-none">
        <div class="event-wrapper-multiday">
          <div class="calendar-club-container-date">
            <div class="calendar-club-label-wrapper">
              <div class="calendar-club-day-item-label event-type-match"></div>
              <div class="calendar-club-label-title desktopFont">Match</div>
            </div>
            <div class="calendar-club-day-item-time desktopFont">14:00 - 16:00</div>
          </div>
          <div class="calendar-club-event-title">
            <div class="calendar-club-day-item-background-title">
              <div class="calendar-club-day-item-groupname desktopFont"><h4>P19 (2007-2008)</h4></div>
            </div>
          </div>
          <div class="calendar-club-event-loc">
            <div class="calendar-club-day-item-title-container">
              <div class="calendar-club-day-item-title desktopFont"><h4>FC Djursholm - Vasalund IF&nbsp;</h4></div>
            </div>
            <div class="calendar-club-day-item-location desktopFont">
              <h4>Djursholms IP 2</h4>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="calendar-club-event-main ">
      <div class="calendar-club-event-date-mobile">
        <div class="container-date-mobile">
          <div class="calendar-club-day-item-date"></div>
        </div>
      </div>
      <div class="calendar-club-day-date-none">
        <div class="event-wrapper-multiday">
          <div class="calendar-club-container-date">
            <div class="calendar-club-label-wrapper">
              <div class="calendar-club-day-item-label event-type-match"></div>
              <div class="calendar-club-label-title desktopFont">Match</div>
            </div>
            <div class="calendar-club-day-item-time desktopFont">16:00 - 18:00</div>
          </div>
          <div class="calendar-club-event-title">
            <div class="calendar-club-day-item-background-title">
              <div class="calendar-club-day-item-groupname desktopFont"><h4>Herrar </h4></div>
            </div>
          </div>
          <div class="calendar-club-event-loc">
            <div class="calendar-club-day-item-title-container">
              <div class="calendar-club-day-item-title desktopFont"><h4>Sollentuna FK - Vasalund&nbsp;</h4></div>
            </div>
            <div class="calendar-club-day-item-location desktopFont">
              <h4>Sollentunavallen 1</h4>
            </div>
          </div>
        </div>
      </div>
      <div class="calendar-club-date-divider"></div>
    </div>
    <div class="calendar-club-event-main canceled">
      <div class="calendar-club-event-date-mobile">
        <div class="container-date-mobile">
          <div class="calendar-club-day-item-date">
            <div>25</div>
            <div>sön</div>
          </div>
        </div>
      </div>
      <div class="calendar-club-day-date-none">
        <div class="event-wrapper-multiday">
          <div class="calendar-club-container-date">
            <div class="calendar-club-label-wrapper">
              <div class="calendar-club-day-item-label event-type-practice"></div>
              <div class="calendar-club-label-title desktopFont">Träning</div>
            </div>
            <div class="calendar-club-day-item-time desktopFont">09:00 - 09:45</div>
          </div>
          <div class="calendar-club-event-title">
            <div class="calendar-club-day-item-background-title">
              <div class="calendar-club-day-item-groupname desktopFont"><h4>Fotbollslekis F/P 2020 (Söndagar 09:00-09:45, Järvastadens IP C-plan)</h4></div>
            </div>
          </div>
          <div class="calendar-club-event-loc">
            <div class="calendar-club-day-item-title-container">
              <div class="calendar-club-day-item-title desktopFont"><h4>Träning F/P 2020&nbsp;</h4><h4 class="canceled-title">(Inställd)</h4></div>
            </div>
            <div class="calendar-club-day-item-location desktopFont">
              <h4>Järvastadens IP C-plan</h4>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="calendar-club-event-main ">
      <div class="calendar-club-event-date-mobile">
        <div class="container-date-mobile">
          <div class="calendar-club-day-item-date"></div>
        </div>
      </div>
      <div class="calendar-club-day-date-none">
        <div class="event-wrapper-multiday">
          <div class="calendar-club-container-date">
            <div class="calendar-club-label-wrapper">
              <div class="calendar-club-day-item-label event-type-match"></div>
              <div class="calendar-club-label-title desktopFont">Match</div>
            </div>
            <div class="calendar-club-day-item-time desktopFont">09:00 - 10:00</div>
          </div>
          <div class="calendar-club-event-title">
            <div class="calendar-club-day-item-background-title">
              <div class="calendar-club-day-item-groupname desktopFont"><h4>P2019 Solna Svart</h4></div>
            </div>
          </div>
          <div class="calendar-club-event-loc">
            <div class="calendar-club-day-item-title-container">
              <div class="calendar-club-day-item-title desktopFont"><h4>VIF Solna Svart - IF Wasa P19&nbsp;</h4></div>
            </div>
            <div class="calendar-club-day-item-location desktopFont">
              <h4>Råsasjöns IP, plan 1</h4>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
`;

const PARKED_FIXTURE = `
<body>
    <div class="top"><span class="label">TILL SALU</span><a class="lang" href="/en">English</a></div>
    <main>
        <section>
            <h1>vasalund.se</h1>
            <p class="rad">Platsens eget namn. Adressen kan bara ha en ägare. Med AI blir allt som går att kopiera billigare. En adress under .se går inte att kopiera.</p>
            <div class="bruk">
                <span><b>Webb:</b> vasalund.se</span>
                <span><b>E-post:</b> namn@vasalund.se</span>
                <span><b>Skylt:</b> VASALUND</span>
            </div>
            <p class="direkt">Säljs direkt av innehavaren.</p>
        </section>
    </main>
</body>
`;

describe('vasalund adapter', () => {
  it('matchar bara vasalunds egna värdar', () => {
    expect(matches('https://www.vasalund.se')).toBe(true);
    expect(matches('https://vasalund.se')).toBe(true);
    expect(matches('https://www.vasalund.com/matcher')).toBe(true);
    expect(matches('https://vasalund.com/kalender')).toBe(true);
    expect(matches('https://example.com/matcher')).toBe(false);
    expect(matches('https://vasalund.se.evil.com/matcher')).toBe(false);
    expect(matches('https://notvasalund.se/matcher')).toBe(false);
    expect(matches('inte en url')).toBe(false);
  });

  it('läser matchrader med svenskt datum', () => {
    const rows = parseMatchItems(MATCHER_FIXTURE);
    expect(rows.length).toBe(3);
    expect(rows[0].home).toBe('Sollentuna FK');
    expect(rows[0].away).toBe('Herrar');
    expect(rows[0].date).toBe('2026-10-24');
    expect(rows[0].time).toBe('16:00');
    expect(rows[0].venue).toBe('Sollentunavallen 1');
    expect(rows[2].date).toBe('2026-10-25');
  });

  it('extraherar klubbens kommande matcher', () => {
    const res = extract(MATCHER_FIXTURE, 'https://www.vasalund.com/matcher');
    expect(res.method).toBe('vasalund-matches');
    expect(res.events.length).toBe(3);
    expect(res.events.map((e) => e.title)).toEqual([
      'Sollentuna FK vs Herrar',
      'P2015 Future Röd vs Motståndare',
      'P2019 Solna Svart vs IF Wasa P19',
    ]);
    expect(res.events.map((e) => e.date)).toEqual([
      '2026-10-24',
      '2026-10-24',
      '2026-10-25',
    ]);
    expect(res.events[0].time).toBe('16:00');
    expect(res.events[0].venue).toBe('Sollentunavallen 1');
    expect(res.events[0].category).toBe('sports');
    expect(res.events[0].source).toBe('vasalund-2');
  });

  it('släpper inte ut spelade matcher', () => {
    const res = extract(MATCHER_FIXTURE, 'https://www.vasalund.com/matcher');
    expect(res.events.some((e) => e.title.includes('F2016'))).toBe(false);
  });

  it('tar bara matcher ur kalendern, inte tränningar och cuper', () => {
    const res = extract(CALENDAR_FIXTURE, 'https://www.vasalund.com/kalender');
    expect(res.method).toBe('vasalund-calendar');
    expect(res.events.length).toBe(3);
    expect(res.events.map((e) => e.title)).toEqual([
      'FC Djursholm - Vasalund IF',
      'Sollentuna FK - Vasalund',
      'VIF Solna Svart - IF Wasa P19',
    ]);
    expect(res.events.map((e) => e.date)).toEqual([
      '2026-10-24',
      '2026-10-24',
      '2026-10-25',
    ]);
    expect(res.events[1].venue).toBe('Sollentunavallen 1');
    expect(res.events[1].time).toBe('16:00');
    expect(res.events[1].endTime).toBe('18:00');
    expect(res.events[1].description).toBe('Herrar');
  });

  it('läser dagen från första raden per dag (carry-forward)', () => {
    const rows = parseCalendarRows(CALENDAR_FIXTURE);
    expect(rows[0].day).toBe(24);
    expect(rows[1].day).toBe(24);
    expect(rows[4].day).toBe(25);
    expect(rows[5].day).toBe(25);
  });

  it('tolkar tidsintervall och flerdagars evenemang', () => {
    expect(parseTimeRange('16:00 - 18:00', 2026, 10)).toEqual({
      time: '16:00',
      endTime: '18:00',
      endDate: null,
    });
    expect(parseTimeRange('08:45 (25/10 16:00)', 2026, 10)).toEqual({
      time: '08:45',
      endTime: '16:00',
      endDate: '2026-10-25',
    });
  });

  it('hittar inget på den parkerade domänen', () => {
    const res = extract(PARKED_FIXTURE, 'https://www.vasalund.se');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('gör inget på främmande URL', () => {
    const res = extract(MATCHER_FIXTURE, 'https://example.com/matcher');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('hanterar HTML utan matcher', () => {
    const res = extract('<html><body>inget</body></html>', 'https://www.vasalund.com/matcher');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });
});
