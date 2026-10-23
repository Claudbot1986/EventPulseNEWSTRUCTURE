import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { toRawEvent, readExtractedEvents, mergeExtractedEvents, eventIdentity } from './importToEventPulse';

describe('toRawEvent', () => {
  it('maps camelCase extracted event link and image aliases into RawEventInput', () => {
    const raw = toRawEvent('synthetic-source', {
      title: 'Synthetic event',
      description: 'Synthetic description',
      date: '2026-05-02',
      time: '19:30',
      venue: 'Synthetic venue',
      address: 'Synthetic address',
      category: 'music',
      is_free: false,
      ticketUrl: 'https://tickets.example.com/event/synthetic',
      imageUrl: 'https://images.example.com/event.jpg',
      source_id: 'synthetic-1',
    });

    expect(raw.ticket_url).toBe('https://tickets.example.com/event/synthetic');
    expect(raw.image_url).toBe('https://images.example.com/event.jpg');
    expect(raw.start_time).toBe('2026-05-02T19:30:00.000Z');
  });

  it('maps boka.berwaldhallen.se ticket_url to canonical source "berwaldhallen"', () => {
    // Regression: 2026-09-27, 178 events kom in med source=NULL eftersom
    // Tixly-API:t returnerar purchase-URL:er på bokningssubdomänen. Boknings-
    // domänen måste mappas tillbaka till source='berwaldhallen' så att
    // source-quality-rapporter och category-mapping fungerar.
    const raw = toRawEvent('boka.berwaldhallen', {
      title: 'Test concert',
      date: '2026-05-02',
      time: '19:30',
      ticketUrl: 'https://boka.berwaldhallen.se/sv/buyingflow/tickets/30538/124898/',
      source_id: 'berwaldhallen-124898',
    });

    expect(raw.source).toBe('berwaldhallen');
    expect(raw.source_id).toBe('berwaldhallen-124898');
  });

  it('maps www.berwaldhallen.se ticket_url to canonical source "berwaldhallen"', () => {
    // Även om filnamnet är korrekt vill vi skydda mot framtida ändringar.
    const raw = toRawEvent('berwaldhallen', {
      title: 'Test concert 2',
      date: '2026-05-02',
      time: '19:30',
      ticketUrl: 'https://www.berwaldhallen.se/konsert/test',
      source_id: 'berwaldhallen-999',
    });

    expect(raw.source).toBe('berwaldhallen');
  });

  it('infers "berwaldhallen" from source_id prefix even if filename was missing', () => {
    // Edge case: filename är okänt (t.ex. legacy-fil) men source_id pekar
    // på berwaldhallen-API:t.
    const raw = toRawEvent('unknown-source', {
      title: 'Berwaldhallen event',
      date: '2026-05-02',
      time: '19:30',
      source_id: 'berwaldhallen-prod-30538-1',
    });

    expect(raw.source).toBe('berwaldhallen');
  });

  it('preserves non-berwaldhallen sources unchanged', () => {
    const raw = toRawEvent('kulturhuset', {
      title: 'Kulturhuset event',
      date: '2026-05-02',
      time: '19:30',
      ticketUrl: 'https://kulturhuset.se/event/x',
      source_id: 'kulturhuset-1',
    });

    expect(raw.source).toBe('kulturhuset');
  });
});

describe('readExtractedEvents — alla artefakter för en källa (2026-10-23)', () => {
  // Regression: importören läste FÖRSTA träffen (top-level före gate-subdirs).
  // lokalhelhet-calendar hade 23 rader top-level (2026-08-21) + 224 rader i C/
  // (2026-09-09) — de 224 raderna nådde aldrig databasen.
  function makeRoot(): string {
    const root = mkdtempSync(path.join(tmpdir(), 'ep-extracted-'));
    mkdirSync(path.join(root, 'C'), { recursive: true });
    return root;
  }

  it('läser BÅDE top-level och C/-filen (inte bara den första)', () => {
    const root = makeRoot();
    writeFileSync(
      path.join(root, 'lokalhelhet-calendar.jsonl'),
      JSON.stringify({ title: 'Gammal top-level-rad', date: '2026-11-01' }) + '\n',
    );
    writeFileSync(
      path.join(root, 'C', 'lokalhelhet-calendar.jsonl'),
      JSON.stringify({ title: 'C-gatens rikliga rad', date: '2026-11-02' }) + '\n',
    );

    const events = readExtractedEvents('lokalhelhet-calendar', root);
    const titles = events.map(e => e.title);

    expect(titles).toContain('Gammal top-level-rad');
    expect(titles).toContain('C-gatens rikliga rad');
  });

  it('nyare artefakt vinner för samma event-identitet (titel + datum)', () => {
    const root = makeRoot();
    writeFileSync(
      path.join(root, 'kalle.jsonl'),
      JSON.stringify({ title: 'Samma event', date: '2026-11-03', venue: 'gammal venue' }) + '\n',
    );
    writeFileSync(
      path.join(root, 'C', 'kalle.jsonl'),
      JSON.stringify({ title: 'Samma event', date: '2026-11-03', venue: 'ny venue' }) + '\n',
    );

    const events = readExtractedEvents('kalle', root);
    const same = events.filter(e => e.title === 'Samma event');

    expect(same).toHaveLength(1);
    expect(same[0].venue).toBe('ny venue');
  });

  it('slår ihop D/, C/, B/, A/ och top-level för samma källa', () => {
    const root = makeRoot();
    for (const dir of ['A', 'B', 'D']) mkdirSync(path.join(root, dir), { recursive: true });
    writeFileSync(path.join(root, 'multi.jsonl'), JSON.stringify({ title: 'Top', date: '2026-11-04' }) + '\n');
    for (const [dir, title] of [['A', 'A-rad'], ['B', 'B-rad'], ['C', 'C-rad'], ['D', 'D-rad']] as const) {
      writeFileSync(path.join(root, dir, 'multi.jsonl'), JSON.stringify({ title, date: '2026-11-04' }) + '\n');
    }

    const titles = readExtractedEvents('multi', root).map(e => e.title);
    expect(titles.sort()).toEqual(['A-rad', 'B-rad', 'C-rad', 'D-rad', 'Top']);
  });

  it('returnerar tom lista när källan saknar artefakter', () => {
    const root = makeRoot();
    expect(readExtractedEvents('saknas', root)).toEqual([]);
  });

  it('hoppar över trasiga JSON-rader istället för att kasta', () => {
    const root = makeRoot();
    writeFileSync(
      path.join(root, 'trasig.jsonl'),
      'this is not json\n' + JSON.stringify({ title: 'Bra rad', date: '2026-11-05' }) + '\n',
    );

    const events = readExtractedEvents('trasig', root);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Bra rad');
  });
});

describe('eventIdentity', () => {
  it('nycklar på titel + datum', () => {
    expect(eventIdentity({ title: 'Konsert', date: '2026-11-01' }))
      .toBe(eventIdentity({ title: 'konsert', date: '2026-11-01' }));
  });

  it('särskiljer två föreställningar med samma titel och samma dag men olika klockslag', () => {
    // Regression 2026-10-23: första versionen nycklade på (titel, datum-dag)
    // och kollapsade berwaldhallens "Bowie in Berlin" 18:00 och 20:00 samma dag.
    expect(eventIdentity({ title: 'Bowie in Berlin', startTime: '2026-11-26T18:00:00.000Z' }))
      .not.toBe(eventIdentity({ title: 'Bowie in Berlin', startTime: '2026-11-26T20:00:00.000Z' }));
  });

  it('särskiljer två föreställningar med samma titel och samma dag men olika biljett-URL', () => {
    // Regression 2026-10-23: gota-lejon har flera show samma dag.
    expect(eventIdentity({ title: 'StockholmGöta Lejon', date: '2026-10-29', url: 'https://tm.se/a' }))
      .not.toBe(eventIdentity({ title: 'StockholmGöta Lejon', date: '2026-10-29', url: 'https://tm.se/b' }));
  });

  it('nycklar på URL när titel/datum saknas', () => {
    expect(eventIdentity({ url: 'https://x.se/a' })).toBe(eventIdentity({ url: 'https://x.se/a' }));
    expect(eventIdentity({ url: 'https://x.se/a' })).not.toBe(eventIdentity({ url: 'https://x.se/b' }));
  });

  it('slår inte ihop en rad som saknar url med en rad som har url', () => {
    // Säker riktning: saknas ett identitetsfält får raden egen nyckel.
    expect(eventIdentity({ title: 'Konsert', date: '2026-11-01' }))
      .not.toBe(eventIdentity({ title: 'Konsert', date: '2026-11-01', url: 'https://x.se/a' }));
  });
});

describe('mergeExtractedEvents', () => {
  it('behåller rader från alla artefakter men slår ihop identiska', () => {
    const merged = mergeExtractedEvents([
      [{ title: 'A', date: '2026-11-01' }, { title: 'B', date: '2026-11-02' }],
      [{ title: 'A', date: '2026-11-01' }, { title: 'C', date: '2026-11-03' }],
    ]);

    expect(merged).toHaveLength(3);
    expect(merged.map(e => e.title).sort()).toEqual(['A', 'B', 'C']);
  });
});
