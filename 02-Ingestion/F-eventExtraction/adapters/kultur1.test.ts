/**
 * Kultur1-adapterns tester.
 *
 * Fixturen är klippt ur den RIKTIGA markupen (2026-10-24) från
 * `https://www.kultur1.se/calendar_lan.php?from=2026-10-24&to=2026-11-07&lid=1`
 * (7 evenemang mätta på den listan) och ur detaljsidan
 * `https://www.kultur1.se/open_cal.php?cid=16547`.
 */
import { describe, it, expect } from 'vitest';
import { matches, parseListing, parseDetail, parseMeta, extract } from './kultur1';

const LISTING = `
<table border='0' cellpadding='0' cellspacing='0'>
<tr>
<td width='110'><img src='../USERCONTENT/cal/2026/10/th_11163907_516.jpg' width='100' height='100' hspace='5'></td>
<td><span class='normal_headline'>Kathrin Bernekorn</span><br><span class='cal_small_text'><b>GALLERI GREGER, STOCKHOLM (2026-10-23 - 2026-10-29)</b></span><br>Naturmåleri<br><a href='' title='Kathrin Bernekorn' onclick='return OpenCal(16547)'>Läs mer »</a><br><br></td>
</tr>
<tr>
<td width='110'><img src='../USERCONTENT/cal/2026/06/th_08103901_791.jpg' width='100' height='100' hspace='5'></td>
<td><span class='normal_headline'>Fantastika 2026</span><br><span class='cal_small_text'><b>DIESELVERKSTADEN, NACKA (2026-10-23 - 2026-10-25)</b></span><br>Science fiction- och fantasydagar: Träffa andra fans och nördar, lyssna på författare och experter, delta i diskussioner!<br><a href='' title='Fantastika 2026' onclick='return OpenCal(16440)'>Läs mer »</a><br><br></td>
</tr>
<tr>
<td width='110'><img src='../USERCONTENT/cal/2026/09/th_28155859_228.jpg' width='100' height='100' hspace='5'></td>
<td><span class='normal_headline'>Höstsalong</span><br><span class='cal_small_text'><b>GALLERI ENSTA KROG, TäBY (2026-10-17 - 2026-10-25)</b></span><br>Medlemmar i konstföreningen Roslagsmålarna ställer ut sin konst. Målningar och konsthantverk.<br><a href='' title='Höstsalong' onclick='return OpenCal(16534)'>Läs mer »</a><br><br></td>
</tr>
<tr>
<td><span class='normal_headline'>Utställning utan datum</span><br><span class='cal_small_text'><b>GALLERI OCH SO, STOCKHOLM (datum meddelas senare)</b></span><br>Beskrivning<br><a href='' title='Utställning utan datum' onclick='return OpenCal(99999)'>Läs mer »</a><br><br></td>
</tr>
</table>
`;

const DETAIL = `<table cellspacing="5" cellpadding="0" border="0"><tr><td valign='top'><img src='../USERCONTENT/cal/2026/10/th_11163907_516.jpg'><br><br><span class='cal_small_text'><b>Datum: </b><br>2026-10-23 - 2026-10-29<br><br><b>Veckodagar:</b><br>Må Ti On To Fr Lö Sö <br><br><b>Öppettider:</b><br>11-17<br></span></td><td><span class='normal_headline'>Kathrin Bernekorn</span><br><span class='cal_small_text'>Konstnär: </span><a href='http://www.svenskakonstnarer.se/start/opengal.php?aid=250' target='_blank' title='Kathrin Bernekorn'><span class='cal_small_text_link'>Kathrin Bernekorn »</span></a><br><span class='cal_small_text'>Konst</span><br><br>Naturmåleri<br><br><b>Galleri Greger</b><br>Hornsgatan 46,  Stockholm<br>Stockholm, Stockholms län<br>Tel: 0735650322<br><br><b>Kontakt:</b><br>Kathrin Bernekorn<br>kathrinbernekorn@hotmail.com<br><a href='http://www.bernekorn.se' title='http://www.bernekorn.se' target='_blank'>Hemsida »</a><br></td></tr></table>`;

describe('kultur1 adapter', () => {
  it('matchar bara kultur1.se', () => {
    expect(matches('https://www.kultur1.se/calendar_lan.php?lid=1')).toBe(true);
    expect(matches('https://kultur1.se/open_cal.php?cid=16547')).toBe(true);
    expect(matches('https://example.com/calendar_lan.php')).toBe(false);
    expect(matches('https://riksarkivet.se/kalendarium')).toBe(false);
    expect(matches('https://kungstradgarden.stockholm/evenemang/')).toBe(false);
    expect(matches('ingen url')).toBe(false);
  });

  it('tolkar metaraden "VENUE, ORT (D1 - D2)"', () => {
    const parsed = parseMeta('GALLERI GREGER, STOCKHOLM (2026-10-23 - 2026-10-29)');
    expect(parsed.venue).toBe('GALLERI GREGER');
    expect(parsed.city).toBe('STOCKHOLM');
    expect(parsed.date).toBe('2026-10-23');
    expect(parsed.endDate).toBe('2026-10-29');
  });

  it('läser titel, datum och OpenCal-id ur listrader', () => {
    const rows = parseListing(LISTING);
    expect(rows.length).toBe(3);
    expect(rows[0].title).toBe('Kathrin Bernekorn');
    expect(rows[0].date).toBe('2026-10-23');
    expect(rows[0].endDate).toBe('2026-10-29');
    expect(rows[0].url).toBe('https://www.kultur1.se/open_cal.php?cid=16547');
  });

  it('hoppar över rader utan datum', () => {
    const rows = parseListing(LISTING);
    expect(rows.some((r) => r.title === 'Utställning utan datum')).toBe(false);

    const res = extract(LISTING, 'https://www.kultur1.se/calendar_lan.php?from=2026-10-24&to=2026-11-07&lid=1');
    expect(res.events.length).toBe(3);
  });

  it('gör om ort och plats till vanlig titelstil', () => {
    const res = extract(LISTING, 'https://www.kultur1.se/calendar_lan.php?lid=1');
    const gred = res.events.find((e) => e.title === 'Kathrin Bernekorn');
    expect(gred?.venue).toBe('Galleri Greger');
    expect(gred?.city).toBe('Stockholm');
    const krog = res.events.find((e) => e.title === 'Höstsalong');
    expect(krog?.venue).toBe('Galleri Ensta Krog');
    expect(krog?.city).toBe('Täby');
  });

  it('läser beskrivning och bild ur listraden', () => {
    const res = extract(LISTING, 'https://www.kultur1.se/calendar_lan.php?lid=1');
    const gred = res.events.find((e) => e.title === 'Kathrin Bernekorn');
    expect(gred?.description).toBe('Naturmåleri');
    expect(gred?.imageUrl).toBe('https://www.kultur1.se/USERCONTENT/cal/2026/10/th_11163907_516.jpg');
    expect(gred?.source).toBe('kultur1-stockholm');
  });

  it('extraherar tre evenemang ur listan', () => {
    const res = extract(LISTING, 'https://www.kultur1.se/calendar_lan.php?from=2026-10-24&to=2026-11-07&lid=1');
    expect(res.method).toBe('kultur1-listing');
    expect(res.events.length).toBe(3);
    const dates = res.events.map((e) => e.date).sort();
    expect(dates).toEqual(['2026-10-17', '2026-10-23', '2026-10-23']);
    expect(res.showUrls).toContain('https://www.kultur1.se/open_cal.php?cid=16547');
  });

  it('läser detaljsidan: datum, öppettider, plats, adress och kategori', () => {
    const detail = parseDetail(DETAIL, 'https://www.kultur1.se/open_cal.php?cid=16547');
    expect(detail).not.toBeNull();
    expect(detail?.title).toBe('Kathrin Bernekorn');
    expect(detail?.date).toBe('2026-10-23');
    expect(detail?.endDate).toBe('2026-10-29');
    expect(detail?.time).toBe('11:00');
    expect(detail?.endTime).toBe('17:00');
    expect(detail?.venue).toBe('Galleri Greger');
    expect(detail?.address).toBe('Hornsgatan 46, Stockholm');
    expect(detail?.city).toBe('Stockholm');
    expect(detail?.category).toBe('Konst');
    expect(detail?.description).toBe('Naturmåleri');
  });

  it('extraherar ett evenemang ur detaljsidan', () => {
    const res = extract(DETAIL, 'https://www.kultur1.se/open_cal.php?cid=16547');
    expect(res.method).toBe('kultur1-detail');
    expect(res.events.length).toBe(1);
    expect(res.events[0].date).toBe('2026-10-23');
    expect(res.events[0].time).toBe('11:00');
    expect(res.events[0].url).toBe('https://www.kultur1.se/open_cal.php?cid=16547');
  });

  it('markerar trasig latin1-avkodning', () => {
    const lossy = LISTING.replace(/å/g, '\uFFFD').replace(/ä/g, '\uFFFD').replace(/ö/g, '\uFFFD');
    const res = extract(lossy, 'https://www.kultur1.se/calendar_lan.php?lid=1');
    expect(res.events.length).toBe(3);
    expect(res.events[0].confidence.signals).toContain('charset-latin1-lossy');
    expect(res.events[0].confidence.score).toBeLessThan(0.78);
  });

  it('gör inget på främmande URL', () => {
    const res = extract(LISTING, 'https://example.com/calendar_lan.php');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('hanterar HTML utan evenemang', () => {
    const res = extract('<html><body>inget</body></html>', 'https://www.kultur1.se/calendar_lan.php');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });
});
