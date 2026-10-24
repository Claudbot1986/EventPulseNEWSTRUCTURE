/**
 * Pingst-adapterns tester.
 *
 * Fixturen är kopplad ur den riktiga program-sidan
 * https://www.pingst.se/program (→ /program-2024/, hämtad 2026-10-24):
 * Divi-textmoduler med `<h1>Tisdag</h1>` och `<p><strong>10.00 – 11.00 …`.
 *
 * Den andra varianten är från
 * https://www.pingst.se/pingst-pastor-konferens/konferensprogram/:
 * `<h1>DAG 1</h1>` + `<p>10 januari</p>` (år saknas i texten och härleds
 * ur sidans publiceringsdatum 2022-10-27 → januari 2023).
 */
import { describe, it, expect } from 'vitest';
import { matches, extract, parseProgrammeDays, resolveProgrammeDates } from './pingstkyrkan';

/** Riktig markup från /program-2024/ (utdrag). */
const PROGRAMME_FIXTURE = `
<div id="main-content">
  <article class="post-19682 page type-page status-publish hentry">
    <div class="entry-content">
      <div class="et_pb_text_inner">
        <h1><span style="color: #ffffff;">Program &#8211; Pingst Pastor Konferens 2024</span></h1>
        <p><strong>Varmt välkommen till Pingst Pastor 2024 som kommer äga rum mellan 9&#8211;11 januari 2024 p&#229; Scandic Infra City i Upplands V&#228;sby.</strong></p>
      </div>
      <div class="et_pb_text_inner"><h1 style="text-align: center;">Tisdag</h1></div>
      <div class="et_pb_text_inner">
        <p><strong>10.00 &#8211; 11.00 Incheckning och fika</strong></p>
        <p><strong>11.00-12.30 Storsamling med v&#228;lkomnande av nya pastorer &#8211; </strong>Predikan av <em>Mats S&#228;rnholm</em></p>
        <p><strong>14.00 &#8211; 15.30 Storsamling &#8211;</strong> <em>Camilla Olsson</em><strong><em><br /></em></strong>Medverkande:<strong><br /></strong><em>Per Johan Stenstrand</em></p>
      </div>
      <div class="et_pb_text_inner"><h1 class="null" style="text-align: center;">Onsdag</h1></div>
      <div class="et_pb_text_inner">
        <p><strong>9.00 &#8211; 10.30 Storsamling och parentation &#8211; </strong>Predikan av <em>Sam Wohlin</em>, parentation med <em>Malin Hagenfors</em></p>
      </div>
    </div>
  </article>
</div>
`;

/** Riktig markup från /pingst-pastor-konferens/konferensprogram/ (utdrag). */
const DAG_FIXTURE = `
<html><head>
<meta property="article:published_time" content="2022-10-27T14:41:49+00:00" />
<meta property="article:modified_time" content="2023-01-06T09:55:27+00:00" />
</head><body>
<div id="main-content">
  <div class="et_pb_text_inner"><h1 style="text-align: center;">PROGRAM</h1>
  <p style="text-align: center;">Konferensen Pingst Pastor International</p></div>
  <div class="et_pb_text_inner">
    <h1 class="p1" style="text-align: center;"><strong>DAG 1</strong></h1>
    <p class="p1" style="text-align: center;">10 januari</p>
    <p class="p1"><strong>09.00&#8211;11.00 Incheckning</strong></p>
    <p class="p1"><strong>11.00&#8211;12.30 Den breda pentekostala familjen</strong></p>
    <ul><li class="p1">Lovs&#229;ng</li></ul>
  </div>
  <div class="et_pb_text_inner">
    <h1 class="p1" style="text-align: center;"><strong>DAG 2</strong></h1>
    <p class="p1" style="text-align: center;">11 januari</p>
    <p class="p1"><strong>09.00&#8211;10.30 Storsamling och parentation</strong></p>
  </div>
</div>
</body></html>
`;

/** Riktig JSON-LD från https://www.pingst.se/events/pingst-pastor-2025/ */
const MEC_FIXTURE = `
<html><head><script type="application/ld+json">
{
  "@context": "http://schema.org",
  "@type": "Event",
  "eventStatus": "https://schema.org/EventScheduled",
  "startDate": "2025-01-07",
  "endDate": "2025-01-09",
  "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
  "description": "Pingst Pastor är ett nätverk för pastorer verksamma inom Pingst.",
  "image": "https://www.pingst.se/wp-content/uploads/2024/02/Pingst-Pastor.jpg",
  "name": "Pingst Pastor 2025",
  "url": "https://www.pingst.se/om-pingst/pastor/"
}
</script></head><body><h1>Pingst Pastor 2025</h1></body></html>
`;

describe('pingst adapter', () => {
  it('matchar bara pingst.se', () => {
    expect(matches('https://www.pingst.se/program')).toBe(true);
    expect(matches('https://pingst.se/')).toBe(true);
    expect(matches('https://example.com/program')).toBe(false);
    expect(matches('https://www.pingst.se.evil.com/')).toBe(false);
  });

  it('läser dag-blocken och deras tidsrader', () => {
    const days = parseProgrammeDays(PROGRAMME_FIXTURE);
    expect(days.length).toBe(2);
    expect(days[0].kind).toBe('weekday');
    expect(days[0].rows.length).toBe(3);
    expect(days[0].rows[0]).toEqual({
      start: '10:00',
      end: '11:00',
      title: 'Incheckning och fika',
    });
  });

  it('räknar ut dagarnas datum från ingressens intervall', () => {
    const days = parseProgrammeDays(PROGRAMME_FIXTURE);
    const resolved = resolveProgrammeDates(days, PROGRAMME_FIXTURE, null);
    expect(resolved[0].date).toBe('2024-01-09'); // Tisdag
    expect(resolved[1].date).toBe('2024-01-10'); // Onsdag
  });

  it('extraherar titel, datum, tid och url ur program-sidan', () => {
    const res = extract(PROGRAMME_FIXTURE, 'https://www.pingst.se/program');
    expect(res.method).toBe('pingst-program');
    expect(res.events.length).toBe(4);
    const first = res.events[0];
    expect(first.title).toBe('Incheckning och fika');
    expect(first.date).toBe('2024-01-09');
    expect(first.time).toBe('10:00');
    expect(first.endTime).toBe('11:00');
    expect(first.venue).toBe('Scandic Infra City');
    expect(first.city).toBe('Upplands Väsby');
    expect(first.url).toBe('https://www.pingst.se/program');
    expect(first.source).toBe('pingstkyrkan');
  });

  it('tar bara titeln, inte "Medverkande:"-listan', () => {
    const res = extract(PROGRAMME_FIXTURE, 'https://www.pingst.se/program');
    const storsamling = res.events.find((e) => e.title.includes('Storsamling –'));
    expect(storsamling?.title).toBe('Storsamling – Camilla Olsson');
    expect(storsamling?.title).not.toContain('Medverkande');
  });

  it('hanterar DAG-blocks och härleder året ur publiceringsdatum', () => {
    const res = extract(DAG_FIXTURE, 'https://www.pingst.se/pingst-pastor-konferens/konferensprogram/');
    expect(res.method).toBe('pingst-program');
    expect(res.events.length).toBe(3);
    expect(res.events[0].title).toBe('Incheckning');
    expect(res.events[0].date).toBe('2023-01-10');
    expect(res.events[0].time).toBe('09:00');
    expect(res.events[2].date).toBe('2023-01-11');
  });

  it('läser MEC-eventsidor ur JSON-LD', () => {
    const res = extract(MEC_FIXTURE, 'https://www.pingst.se/events/pingst-pastor-2025/');
    expect(res.method).toBe('pingst-jsonld');
    expect(res.events.length).toBe(1);
    expect(res.events[0].title).toBe('Pingst Pastor 2025');
    expect(res.events[0].date).toBe('2025-01-07');
    expect(res.events[0].endDate).toBe('2025-01-09');
  });

  it('hoppar över rader utan datum', () => {
    // En tidsrad utan dag-block och en dag-block utan datum ska inte ge events.
    const noDay = `
      <div id="main-content">
        <p><strong>10.00 &#8211; 11.00 Incheckning och fika</strong></p>
        <h1>Tisdag</h1>
        <p><strong>12.00 &#8211; 13.00 Lunch</strong></p>
      </div>`;
    const res = extract(noDay, 'https://www.pingst.se/program');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('gör inget på främmande URL', () => {
    const res = extract(PROGRAMME_FIXTURE, 'https://example.com/program');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('hanterar HTML utan program', () => {
    const res = extract('<html><body>inget</body></html>', 'https://www.pingst.se/program');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });
});
