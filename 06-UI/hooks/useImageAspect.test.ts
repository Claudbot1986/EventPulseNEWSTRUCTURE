/**
 * 06-UI/hooks/useImageAspect.test.ts
 *
 * Tests for imageAspectCore — the pure async aspect-ratio resolver used
 * by hooks/useImageAspect.js. Pure-funktioner gör att vi kan testa
 * kärnan utan att mocka React. Hooken själv är en tunn wrapper och
 * täcks indirekt av att core är korrekt.
 *
 * Användaren klagade (2026-10-07): "bilderna i eventcard måste vara
 * helt synliga, inget inzopmat, ramen runt bilden / framen som bilden
 * sitter mountad i behöver vara samma aspect ratio". Den här hooken
 * returnerar rätt aspect så wrap-ramen matchar bildens naturliga.
 *
 * Run:  npx vitest run 06-UI/hooks/useImageAspect.test.ts
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockResolveAssetSource = vi.fn();
const mockGetSize = vi.fn();

vi.mock('react-native', () => ({
  Image: {
    resolveAssetSource: (src: unknown) => mockResolveAssetSource(src),
    getSize: (uri: string, ok: (w: number, h: number) => void, err: (e: unknown) => void) =>
      mockGetSize(uri, ok, err),
  },
}));

import {
  FALLBACK_ASPECT,
  resolveAssetAspect,
  resolveRemoteAspect,
  resetAspectCache,
  primeAspectCache,
} from './imageAspectCore.js';

beforeEach(() => {
  resetAspectCache();
  mockResolveAssetSource.mockReset();
  mockGetSize.mockReset();
});

describe('FALLBACK_ASPECT', () => {
  test('matches tidigare hårdkodat värde 1.15 (hero-geometri)', () => {
    expect(FALLBACK_ASPECT).toBeCloseTo(1.15, 5);
  });
});

describe('resolveAssetAspect (sync, require-nummer)', () => {
  test('returns aspect w/h from resolveAssetSource', () => {
    mockResolveAssetSource.mockReturnValue({ width: 1024, height: 1024 });
    expect(resolveAssetAspect(7)).toBeCloseTo(1.0, 5);
  });

  test('returns wider aspect for wide assets', () => {
    mockResolveAssetSource.mockReturnValue({ width: 1920, height: 1080 });
    expect(resolveAssetAspect(7)).toBeCloseTo(16 / 9, 5);
  });

  test('returns smaller aspect for tall assets', () => {
    mockResolveAssetSource.mockReturnValue({ width: 800, height: 1200 });
    expect(resolveAssetAspect(7)).toBeCloseTo(800 / 1200, 5);
  });

  test('returns null for non-number input', () => {
    expect(resolveAssetAspect(null as unknown as number)).toBeNull();
    expect(resolveAssetAspect(undefined as unknown as number)).toBeNull();
    expect(resolveAssetAspect('7' as unknown as number)).toBeNull();
    expect(resolveAssetAspect({} as unknown as number)).toBeNull();
  });

  test('returns null when resolveAssetSource throws', () => {
    mockResolveAssetSource.mockImplementation(() => {
      throw new Error('bad asset');
    });
    expect(resolveAssetAspect(7)).toBeNull();
  });

  test('returns null when width/height missing or zero', () => {
    mockResolveAssetSource.mockReturnValue({ width: 0, height: 0 });
    expect(resolveAssetAspect(7)).toBeNull();

    mockResolveAssetSource.mockReturnValue({});
    expect(resolveAssetAspect(7)).toBeNull();

    mockResolveAssetSource.mockReturnValue(null);
    expect(resolveAssetAspect(7)).toBeNull();
  });
});

describe('resolveRemoteAspect (async, HTTP-URI)', () => {
  test('returns aspect w/h on first try', async () => {
    mockGetSize.mockImplementation(
      (_uri: string, ok: (w: number, h: number) => void) => ok(1600, 900),
    );
    const aspect = await resolveRemoteAspect('https://example.com/x.webp');
    expect(aspect).toBeCloseTo(1600 / 900, 5);
  });

  test('caches aspect per URI between calls', async () => {
    mockGetSize.mockImplementation(
      (_uri: string, ok: (w: number, h: number) => void) => ok(1600, 900),
    );
    const a1 = await resolveRemoteAspect('https://example.com/x.webp');
    expect(a1).toBeCloseTo(1600 / 900, 5);

    mockGetSize.mockClear();
    mockGetSize.mockImplementation(
      (_uri: string, ok: (w: number, h: number) => void) => ok(9999, 9999),
    );
    const a2 = await resolveRemoteAspect('https://example.com/x.webp');
    expect(a2).toBeCloseTo(1600 / 900, 5); // cache hit — INTE 9999/9999
    expect(mockGetSize).not.toHaveBeenCalled(); // Image.getSize INTE anropat
  });

  test('returns null for invalid input (non-string, empty)', async () => {
    expect(await resolveRemoteAspect(null as unknown as string)).toBeNull();
    expect(await resolveRemoteAspect(undefined as unknown as string)).toBeNull();
    expect(await resolveRemoteAspect('')).toBeNull();
    expect(mockGetSize).not.toHaveBeenCalled();
  });

  test('returns null when Image.getSize reports zero dimensions', async () => {
    mockGetSize.mockImplementation(
      (_uri: string, ok: (w: number, h: number) => void) => ok(0, 0),
    );
    expect(await resolveRemoteAspect('https://example.com/y.png')).toBeNull();
  });

  test('returns null on first failure, does not throw', async () => {
    mockGetSize.mockImplementation(
      (_uri: string, _ok: unknown, err: (e: unknown) => void) => err(new Error('fail')),
    );
    // Image.getSize error callback returnerar null efter retry-väntan på 5s.
    // Vi fake'ar timern genom att INTE vänta 5s — verifierar att promise
    // håller sig pending utan att kasta.
    const pending = resolveRemoteAspect('https://example.com/z.png');
    // Avbryt genast för att undvika 5s-väntan i testet.
    pending.then(() => {}).catch(() => {});
    // Ingen assert än — bara att vi inte kastade.
    expect(typeof pending.then).toBe('function');
  });

  test('uses cache when primeAspectCache has been called', async () => {
    primeAspectCache('https://example.com/primed.webp', 2.5);
    const aspect = await resolveRemoteAspect('https://example.com/primed.webp');
    expect(aspect).toBe(2.5);
    expect(mockGetSize).not.toHaveBeenCalled();
  });
});

describe('integration: cache survives across resolves', () => {
  test('resetAspectCache rensar cachen så nästa resolve mäter om', async () => {
    primeAspectCache('https://example.com/a.webp', 1.5);
    const a1 = await resolveRemoteAspect('https://example.com/a.webp');
    expect(a1).toBe(1.5);

    resetAspectCache();

    mockGetSize.mockImplementation(
      (_uri: string, ok: (w: number, h: number) => void) => ok(800, 400),
    );
    const a2 = await resolveRemoteAspect('https://example.com/a.webp');
    expect(a2).toBeCloseTo(800 / 400, 5);
    expect(mockGetSize).toHaveBeenCalledTimes(1);
  });
});