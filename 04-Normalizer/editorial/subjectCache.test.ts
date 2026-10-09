/**
 * subjectCache.test.ts — verifierar subjectCache-logik.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  lookupSubject,
  lookupSubjects,
  subjectCacheStats,
  subjectsByKind,
  __resetSubjectCacheForTests,
} from './subjectCache';

describe('subjectCache', () => {
  beforeEach(() => {
    __resetSubjectCacheForTests();
  });

  it('Total antal subjects i curerad JSON är minst 15', () => {
    const { totalSubjects } = subjectCacheStats();
    expect(totalSubjects).toBeGreaterThanOrEqual(15);
  });

  it('Hamlet har author=William Shakespeare, language=en, kind=work', () => {
    const e = lookupSubject('Hamlet');
    expect(e).not.toBeNull();
    expect(e?.kind).toBe('work');
    expect(e?.metadata?.author).toBe('William Shakespeare');
    expect(e?.language).toBe('en');
    expect(e?.inception_year).toBe(1603);
  });

  it('Case-insensitive lookup (hamlet, HAMLET, Hamlet)', () => {
    const a = lookupSubject('hamlet');
    const b = lookupSubject('HAMLET');
    const c = lookupSubject('Hamlet');
    expect(a?.wikidata_id).toBe(c?.wikidata_id);
    expect(b?.wikidata_id).toBe(c?.wikidata_id);
  });

  it('Alias-match fungerar (The Tragedy of Hamlet → Hamlet)', () => {
    const e = lookupSubject('The Tragedy of Hamlet');
    expect(e?.name).toBe('Hamlet');
  });

  it('Okänt subject returnerar null (Big in Japan finns inte)', () => {
    expect(lookupSubject('Big in Japan')).toBeNull();
  });

  it('Null/empty input ger null (försvar mot felaktiga anrop)', () => {
    expect(lookupSubject(null)).toBeNull();
    expect(lookupSubject('')).toBeNull();
    expect(lookupSubject(undefined)).toBeNull();
  });

  it('Kungliga Operan har inception_year=1773 och kind=organization', () => {
    const e = lookupSubject('Kungliga Operan');
    expect(e?.kind).toBe('organization');
    expect(e?.inception_year).toBe(1773);
    expect(e?.country).toBe('SE');
  });

  it('Dramaten har inception_year=1788', () => {
    const e = lookupSubject('Dramaten');
    expect(e?.inception_year).toBe(1788);
  });

  it('August Strindberg är svensk (country=SE)', () => {
    const e = lookupSubject('August Strindberg');
    expect(e?.kind).toBe('person');
    expect(e?.country).toBe('SE');
  });

  it('Lars von Trier är dansk (country=DK)', () => {
    const e = lookupSubject('Lars von Trier');
    expect(e?.country).toBe('DK');
  });

  it('Antikrist har author=Lars von Trier, kind=work', () => {
    const e = lookupSubject('Antikrist');
    expect(e?.kind).toBe('work');
    expect(e?.metadata?.author).toBe('Lars von Trier');
  });

  it('Svensk litteratur finns som topic', () => {
    const e = lookupSubject('Svensk litteratur');
    expect(e?.kind).toBe('topic');
  });

  it('subjectsByKind("work") returnerar alla verk', () => {
    const works = subjectsByKind('work');
    expect(works.length).toBeGreaterThanOrEqual(4);
    const names = works.map((w) => w.name);
    expect(names).toContain('Hamlet');
    expect(names).toContain('Chicago');
    expect(names).toContain('Antikrist');
  });

  it('lookupSubjects() returnerar map med null för okända', () => {
    const r = lookupSubjects(['Hamlet', 'Quidam', 'Kungliga Operan']);
    expect(r['Hamlet']?.kind).toBe('work');
    expect(r['Kungliga Operan']?.kind).toBe('organization');
    expect(r['Quidam']).toBeNull();
  });

  it('Alla subjects har _source.license (auditerbarhet)', () => {
    const { totalSubjects } = subjectCacheStats();
    const cache = (subjectCacheStats as any); // hack för test-iteration
    let withLicense = 0;
    for (const kind of ['work', 'person', 'organization', 'venue', 'topic', 'event_series'] as const) {
      for (const s of subjectsByKind(kind)) {
        if (s._source?.license && s._source.license !== 'unknown') {
          withLicense++;
        }
      }
    }
    expect(withLicense).toBe(totalSubjects);
  });
});
