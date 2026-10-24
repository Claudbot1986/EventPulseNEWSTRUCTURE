/**
 * Zita-adapterns tester.
 *
 * Fixturen är en avskalad version av den riktiga /evenemang-strukturen
 * (2026-10-24): tre rader med datum, en rad utan datum, en rad med
 * programrubrik-prefix och en stor-rad (calendar_row_large).
 */
import { describe, it, expect } from 'vitest';
import { matches, parseRows, extract } from './zita';

const FIXTURE = `
<div class="column_calendar_day">idag </div>
<div class="column_calendar_theatre">Zita</div>
<div class="calendar_row">
<span class="column_time">
<span title="Boka biljetter..." class="ajax_link booking-56802">
<strong>12:00</strong>
</span>
</span>
 <span class="calendar_media"> <strong><a title="Barnens Bio " href="http://zita.se/barnens-bio">Barnens Bio </a>:</strong> <a title="Bus och mysterier med Alfons Åberg" href="bus-och-mysterier-med-alfons-aberg">Bus och mysterier med Alfons Åberg</a>  (Zita 1)</span>
</div>
<div class="calendar_row">
<span class="column_time">
<span title="Boka biljetter..." class="ajax_link booking-computer-56868">
<script>
  $( ".booking-computer-56868" ).click( function() {
    window.open('https://zita.se/includes/load-booking.php?s=Salong%203&t=16:00&d=2026-10-24','booking_window') ;
  });
</script>
<strong>16:00</strong>
</span>
</span>
 <span class="calendar_media"> <a title="Kärlek över Tanger" href="karlek-over-tanger">Kärlek över Tanger</a>  (Zita 3)</span>
</div>
<div class="calendar_row">
<span class="column_time">
<span title="Boka biljetter..." class="ajax_link booking-computer-56831">
<script>
  window.open('https://zita.se/includes/load-booking.php?s=Salong%203&t=12:00&d=2026-10-25','booking_window') ;
</script>
<strong>12:00</strong>
</span>
</span>
 <span class="calendar_media"> <strong><a title="Barnens Bio " href="http://zita.se/barnens-bio">Barnens Bio </a>:</strong> <a title="Olivia och den osynliga jordbävningen" href="olivia-och-den-osynliga-jordbavningen">Olivia och den osynliga jordbävningen</a>  (Zita 3)</span>
</div>
<div class="calendar_row_large"> <span class="column_time_large">
<span title="Boka biljetter..." class="ajax_link booking-large-56805">
<script> window.open('https://zita.se/includes/load-booking.php?s=Salong%203&t=12:00&d=2026-10-26','booking_window') ; </script>
<strong>12:00</strong></span></span>
 <span class="calendar_media_large"> <strong><a title="Bamse 60 år!" href="https://zita.se/bamse-60">Bamse 60 år!</a>:</strong> <a title="Den lilla åsnan &amp; Den stora kapplöpningen" href="den-lilla-asnan-amp--den-stora-kapplopningen">Den lilla åsnan</a>  (Zita 2)</span>
</div>
`;

describe('zita adapter', () => {
  it('matchar bara zita.se', () => {
    expect(matches('https://zita.se/evenemang')).toBe(true);
    expect(matches('https://www.zita.se/evenemang')).toBe(true);
    expect(matches('https://example.com/evenemang')).toBe(false);
  });

  it('läser alla rader', () => {
    const rows = parseRows(FIXTURE);
    expect(rows.length).toBe(4);
  });

  it('hoppar över rader utan datum', () => {
    const rows = parseRows(FIXTURE);
    expect(rows[0].date).toBeNull();
    expect(rows[1].date).toBe('2026-10-24');
    expect(rows[3].date).toBe('2026-10-26');
  });

  it('tar evenemangets titel, inte programrubriken', () => {
    const rows = parseRows(FIXTURE);
    expect(rows[0].title).toBe('Bus och mysterier med Alfons Åberg');
    expect(rows[2].title).toBe('Olivia och den osynliga jordbävningen');
    expect(rows[3].title).toBe('Den lilla åsnan & Den stora kapplöpningen');
  });

  it('läser tid och salong', () => {
    const rows = parseRows(FIXTURE);
    expect(rows[1].time).toBe('16:00');
    expect(rows[1].hall).toBe('Zita 3');
  });

  it('extraherar endast rader med datum', () => {
    const res = extract(FIXTURE, 'https://zita.se/evenemang');
    expect(res.method).toBe('zita-listing');
    expect(res.events.length).toBe(3);
    const dates = res.events.map((e) => e.date).sort();
    expect(dates).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
    expect(res.events[0].source).toBe('zita');
    expect(res.events[0].venue).toContain('Zita');
    expect(res.events[0].address).toBe('Birger Jarlsgatan 37, Stockholm');
  });

  it('gör inget på främmande URL', () => {
    const res = extract(FIXTURE, 'https://example.com/evenemang');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('hanterar HTML utan kalendarium', () => {
    const res = extract('<html><body>inget</body></html>', 'https://zita.se/evenemang');
    expect(res.events.length).toBe(0);
  });
});
