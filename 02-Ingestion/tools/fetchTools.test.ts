import { describe, expect, it } from 'vitest';
import {
  charsetFromContentType,
  charsetFromMeta,
  decodeHtmlBytes,
  normalizeFetchUrl,
} from './fetchTools.js';

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

/**
 * Charset-avkodning (2026-10-24).
 *
 * Negativ kontroll: varje "nej"-fall har ett "ja"-fall bredvid sig, så att
 * testet inte kan passera på en avkodning som alltid ger samma svar.
 */
describe('charsetFromContentType', () => {
  it('läser charset ur headern', () => {
    expect(charsetFromContentType('text/html; charset=ISO-8859-1')).toBe('iso-8859-1');
    expect(charsetFromContentType('text/html;charset=utf-8')).toBe('utf-8');
    expect(charsetFromContentType('text/html; charset="windows-1252"')).toBe('windows-1252');
  });

  it('ger null när headern saknar charset', () => {
    expect(charsetFromContentType('text/html')).toBeNull();
    expect(charsetFromContentType(undefined)).toBeNull();
  });
});

describe('charsetFromMeta', () => {
  it('läser charset ur meta-taggen', () => {
    expect(charsetFromMeta('<meta charset="iso-8859-1">')).toBe('iso-8859-1');
    expect(charsetFromMeta('<meta http-equiv="Content-Type" content="text/html; charset=utf-8">')).toBe('utf-8');
  });

  it('ger null när det inte finns någon meta-charset', () => {
    expect(charsetFromMeta('<html><head><title>x</title></head>')).toBeNull();
  });
});

describe('decodeHtmlBytes', () => {
  // Bytes för "Samlingsutställning på" i ISO-8859-1 (å = 0xE5, ä = 0xE4).
  const latin1Bytes = Buffer.from([
    0x53, 0x61, 0x6d, 0x6c, 0x69, 0x6e, 0x67, 0x73, 0x75, 0x74, 0x73, 0x74,
    0xE4, 0x6C, 0x6C, 0x6E, 0x69, 0x6E, 0x67, 0x20, 0x70, 0xE5,
  ]);

  it('avkodar ISO-8859-1 enligt headern — svenska tecken överlever', () => {
    const html = decodeHtmlBytes(latin1Bytes, 'text/html; charset=ISO-8859-1');
    expect(html).toBe('Samlingsutställning på');
    expect(html).not.toContain('\uFFFD');
  });

  it('negativ kontroll: UTF-8-avkodning av samma bytes förstör tecknen', () => {
    // Utan charset-stödet (dvs. dagens beteende) blir detta skräp.
    const broken = latin1Bytes.toString('utf8');
    expect(broken).toContain('\uFFFD');
    expect(broken).not.toBe('Samlingsutställning på');
  });

  it('avkodar UTF-8 som standard när ingen charset anges', () => {
    const utf8 = Buffer.from('Samlingsutställning på', 'utf8');
    expect(decodeHtmlBytes(utf8)).toBe('Samlingsutställning på');
    expect(decodeHtmlBytes(utf8, 'text/html')).toBe('Samlingsutställning på');
  });

  it('följer meta-taggen när headern saknar charset', () => {
    const html = '<meta charset="iso-8859-1"><p>' + latin1Bytes.toString('latin1') + '</p>';
    const decoded = decodeHtmlBytes(Buffer.from(html, 'latin1'));
    expect(decoded).toContain('Samlingsutställning på');
    expect(decoded).not.toContain('\uFFFD');
  });

  it('en server som ljuger om charset (utf-8-head, latin1-bytes) repareras via meta', () => {
    const html = '<meta charset="iso-8859-1"><p>' + latin1Bytes.toString('latin1') + '</p>';
    const decoded = decodeHtmlBytes(Buffer.from(html, 'latin1'), 'text/html; charset=utf-8');
    expect(decoded).toContain('Samlingsutställning på');
    expect(decoded).not.toContain('\uFFFD');
  });

  it('BOM vinner framför headern', () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hej', 'utf8')]);
    expect(decodeHtmlBytes(withBom, 'text/html; charset=ISO-8859-1')).toBe('hej');
  });

  it('okänd charset ger UTF-8 i stället för att kasta', () => {
    const utf8 = Buffer.from('hej', 'utf8');
    expect(decodeHtmlBytes(utf8, 'text/html; charset=definitely-not-a-charset')).toBe('hej');
  });
});
