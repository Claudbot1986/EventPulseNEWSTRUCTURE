import { describe, expect, it } from 'vitest';
import { normalizeFetchUrl } from './fetchTools.js';

describe('normalizeFetchUrl', () => {
  it('adds https protocol to bare source domains', () => {
    expect(normalizeFetchUrl('abf.se/')).toBe('https://abf.se');
    expect(normalizeFetchUrl('www.example.org/events/')).toBe('https://www.example.org/events');
  });

  it('keeps already-qualified and relative URLs unchanged except trailing slash normalization', () => {
    expect(normalizeFetchUrl('https://example.org/')).toBe('https://example.org');
    expect(normalizeFetchUrl('/evenemang/')).toBe('/evenemang');
  });
});
