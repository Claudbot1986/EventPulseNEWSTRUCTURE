/**
 * Ärlig felklassning — 2026-10-28.
 *
 * Kedjan loggade "klart" med 0 events i tre nätter för att ett tyst
 * transportfel översattes till exit 0. Klassningen är det som gör felet
 * synligt — och den måste BÅDE fånga verkliga transportfel och INTE fälla
 * kedjan på en fullständigt lyckad körning.
 *
 * Negativa kontroller i den här filen:
 *   - "fetch failed" utan DEGRADED ⇒ transport (det som gömde sig i nattet)
 *   - "fetch failed" med DEGRADED ⇒ inte transport (den falska larmet)
 *   - råa "401"/"403" utan kontext ⇒ inte auth (de kan vara antal)
 */

import { describe, it, expect } from 'vitest';
import {
  classifyMessage,
  classifyError,
  classifyWithCarried,
  errorText,
  isDegradedLine,
  splitDegraded,
  exitCodeFor,
} from './net-error.mjs';

describe('classifyMessage', () => {
  it('transport — riktiga nätverksfel', () => {
    expect(classifyMessage('Error: connect ECONNREFUSED 127.0.0.1:6379')).toBe('transport');
    expect(classifyMessage('fetch failed')).toBe('transport');
    expect(classifyMessage('Error: getaddrinfo ENOTFOUND api.exa.ai')).toBe('transport');
    expect(classifyMessage('socket hang up')).toBe('transport');
  });

  it('auth — servern nekade', () => {
    expect(classifyMessage('unauthorized')).toBe('auth');
    expect(classifyMessage('invalid api key')).toBe('auth');
    expect(classifyMessage('HTTP 401')).toBe('auth');
    expect(classifyMessage('status=403')).toBe('auth');
  });

  it('http — servern svarade med felstatus', () => {
    expect(classifyMessage('HTTP 500')).toBe('http');
    expect(classifyMessage('HTTP 404')).toBe('http');
  });

  it('NEGATIV KONTROLL — råa 401/403 utan kontext är antal, inte status', () => {
    expect(classifyMessage('403 poster processade')).toBe('logic');
    expect(classifyMessage('401 events kunde inte hittas')).toBe('logic');
  });

  it('logic — kodfel utan nätverkssignatur', () => {
    expect(classifyMessage('TypeError: cannot read property of undefined')).toBe('logic');
    expect(classifyMessage('')).toBe('logic');
  });

  it('transport — ioredis fel när Redis dör mitt i en körning', () => {
    // 2026-10-28 — verifierat mot en död Redis (127.0.0.1:9). Detta är de
    // exakta meddelanden ioredis ger när `enableOfflineQueue: false` möter
    // en död server. Utan dem klassades felet som 'logic' → kedjan avslutade
    // exit 0 = GRÖN medan Redis var död.
    expect(classifyMessage('Connection is closed.')).toBe('transport');
    expect(
      classifyMessage("Stream isn't writeable and enableOfflineQueue options is false"),
    ).toBe('transport');
  });

  it('NEGATIV KONTROLL — "closed" i annan mening är inte transport', () => {
    expect(classifyMessage('Feature flag closed for this tenant')).toBe('logic');
  });
});

describe('classifyError', () => {
  it('HTTP-status i felet vinner över texten', () => {
    const err = Object.assign(new Error('fetch failed'), { status: 401 });
    expect(classifyError(err)).toBe('auth');
    expect(classifyError(Object.assign(new Error('nope'), { status: 500 }))).toBe('http');
  });

  it('cause-kedjan hittar errno', () => {
    const err = new Error('boom', { cause: Object.assign(new Error('x'), { code: 'EADDRNOTAVAIL' }) });
    expect(classifyError(err)).toBe('transport');
  });
});

describe('DEGRADED-konventionen', () => {
  it('en markerad rad är en rapporterad försämring', () => {
    expect(isDegradedLine('[editorial] DEGRADED event abc misslyckades: fetch failed')).toBe(true);
    expect(isDegradedLine('[editorial] event abc misslyckades: fetch failed')).toBe(false);
  });

  it('splitDegraded delar upp raderna', () => {
    const { degraded, rest } = splitDegraded(
      [
        '[editorial] DEGRADED event a misslyckades: fetch failed',
        'Error: connect ECONNREFUSED 127.0.0.1:6379',
      ].join('\n'),
    );
    expect(degraded).toHaveLength(1);
    expect(rest).toContain('ECONNREFUSED');
    expect(rest).not.toContain('DEGRADED');
  });

  it('NEGATIV KONTROLL — utan DEGRADED är "fetch failed" ett transportfel', () => {
    // Detta är exakt det som gömde sig: steget avslutade exit=0 med
    // "fetch failed" i stderr och kedjan sa "klar".
    const { degraded, rest } = splitDegraded('[editorial] event a misslyckades: fetch failed');
    expect(degraded).toHaveLength(0);
    expect(classifyMessage(rest)).toBe('transport');
  });

  it('NEGATIV KONTROLL — med DEGRADED är samma rad INTE ett transportfel', () => {
    const { degraded, rest } = splitDegraded('[editorial] DEGRADED event a misslyckades: fetch failed');
    expect(degraded).toHaveLength(1);
    expect(classifyMessage(rest)).not.toBe('transport');
  });
});

describe('exitCodeFor', () => {
  it('transport ⇒ 69, auth ⇒ 77, empty ⇒ 0', () => {
    expect(exitCodeFor('transport')).toBe(69);
    expect(exitCodeFor('auth')).toBe(77);
    expect(exitCodeFor('empty')).toBe(0);
    expect(exitCodeFor('logic')).toBe(70);
  });
});

describe('errorText', () => {
  it('läser .message ur ett plain object (PostgREST-fel)', () => {
    // PostgREST returnerar {code, message, details, hint} — inte en Error.
    // String(obj) ger "[object Object]", vilket gjorde att ett verkligt
    // transportfel såg ut som "[object Object]" i kedjans logg.
    const pgError = { code: '42501', message: 'fetch failed', details: null, hint: null };
    expect(errorText(pgError)).toBe('fetch failed');
  });

  it('faller tillbaka på koden när det inte finns någon message', () => {
    expect(errorText({ code: '42P01' })).toBe('42P01');
  });

  it('hanterar Error, sträng och null', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText('plain')).toBe('plain');
    expect(errorText(null)).toBe('okänt fel');
    expect(errorText(undefined)).toBe('okänt fel');
  });

  it('NEGATIV KONTROLL — ett fel UTAN message får inte bli "[object Object]"', () => {
    expect(errorText({ some: 'field' })).not.toBe('[object Object]');
  });
});

describe('classifyWithCarried', () => {
  it('behåller klassen som lagret under högsta led lagade på felet', () => {
    // Lager som fångar och omsluter ett fel sätter errorClass på det nya
    // Error-objektet. Utan att ärva klassen försvann den: ett transportfel
    // i en Supabase-insert blev "logic" och kedjan avslutade med exit 1
    // i stället för 69.
    const wrapped = Object.assign(new Error('Failed to insert: fetch failed'), {
      errorClass: 'transport',
    });
    expect(classifyWithCarried(wrapped)).toBe('transport');
  });

  it('klassar om felet när ingen klass bärs med', () => {
    expect(classifyWithCarried(new Error('fetch failed'))).toBe('transport');
    expect(classifyWithCarried(new Error('cannot read property'))).toBe('logic');
  });

  it('NEGATIV KONTROLL — en bärande klass får inte hitta på en ny', () => {
    const wrapped = Object.assign(new Error('nope'), { errorClass: 'transport' });
    expect(classifyWithCarried(wrapped)).toBe('transport');
    const nonsense = Object.assign(new Error('nope'), { errorClass: 'bananas' });
    expect(classifyWithCarried(nonsense)).toBe('logic');
  });
});
