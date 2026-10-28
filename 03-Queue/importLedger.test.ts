/**
 * Ledger-beviset räknas PER FIL (2026-10-28, femte rundan).
 *
 * Negativa kontroller:
 *   - en källa i 'queued' hoppas INTE över (jobben kan vara borta)
 *   - en källa i 'persisted' hoppas över
 *   - en källa i 'empty' hoppas över (filen lade in inget jobb)
 *   - en källa i 'failed' hoppas INTE över (importen var inte komplett)
 *   - gamla rader utan 'state' räknas som KÖADE, inte persisterade (de har
 *     inget bevis — de importeras om en gång)
 *   - recordImport muterar INTE den inkommande Mapen
 *   - markPersisted muterar INTE den inkommande Mapen
 *
 * Bevisregeln: en rad får bara 'persisted' om antalet körda jobb MED
 * DENNA FILS märke täcker det importeraren lade in för just den filen.
 * En tom kö räcker INTE — Redis kan ha dött och tömtt kön utan att jobben
 * persisterats.
 */

import { describe, it, expect } from 'vitest';
import {
  loadLedger,
  saveLedger,
  isAlreadyImported,
  recordImport,
  markPersisted,
  mergeLedger,
  ledgerChanged,
} from './importLedger.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FINGERPRINT = { fileMtime: 1730000000000, fileHash: 'hash-1' };

describe('tvåfas-ledger', () => {
  it('en köad källa hoppas INTE över — bara en persisterad', () => {
    const queued = recordImport(new Map(), 'kalla', FINGERPRINT, 5, '2026-10-28T00:00:00Z', 5);
    expect(isAlreadyImported(queued, 'kalla', 'hash-1')).toBe(false);

    const persisted = markPersisted(queued, new Map([['kalla', 5]]));
    expect(isAlreadyImported(persisted, 'kalla', 'hash-1')).toBe(true);
  });

  it('en ändrad fil importeras igen även om källan är persisterad', () => {
    const queued = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 5);
    const persisted = markPersisted(queued, new Map([['kalla', 5]]));
    expect(isAlreadyImported(persisted, 'kalla', 'hash-2')).toBe(false);
  });

  it('recordImport muterar INTE den inkommande Mapen', () => {
    const original = new Map();
    const next = recordImport(original, 'kalla', FINGERPRINT, 5, 'x', 5);
    expect(original.size).toBe(0);
    expect(next.size).toBe(1);
  });

  it('markPersisted muterar INTE den inkommande Mapen', () => {
    const queued = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 5);
    const persisted = markPersisted(queued, new Map([['kalla', 5]]));
    expect(queued.get('kalla')?.state).toBe('queued');
    expect(persisted.get('kalla')?.state).toBe('persisted');
  });

  it('gamla rader utan state räknas som KÖADE — de saknar bevis', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventpulse-ledger-'));
    const file = path.join(dir, 'ledger.jsonl');
    fs.writeFileSync(
      file,
      JSON.stringify({ sourceId: 'gammal', fileMtime: 1, fileHash: 'h', enqueued: 3, at: 'x' }) + '\n',
      'utf8',
    );
    const ledger = loadLedger(file);
    expect(ledger.get('gammal')?.state).toBe('queued');
    expect(isAlreadyImported(ledger, 'gammal', 'h')).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('state överlever en sparad/laddad cykel', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventpulse-ledger-'));
    const file = path.join(dir, 'ledger.jsonl');
    const queued = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 5);
    saveLedger(file, queued);
    expect(loadLedger(file).get('kalla')?.state).toBe('queued');
    saveLedger(file, markPersisted(queued, new Map([['kalla', 5]])));
    expect(loadLedger(file).get('kalla')?.state).toBe('persisted');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('bevisregeln — "kön är tom" är INTE bevis', () => {
  it('en källa markeras INTE persisterad om för få jobb kördes', () => {
    // Importeraren lade in 5 jobb. Dräneringen fick bara igenom 3 — Redis
    // kan ha dött. Källan MÅSTE stanna i 'queued' så att nästa natt
    // importerar den igen.
    const queued = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 5);
    const marked = markPersisted(queued, new Map([['kalla', 3]]));
    expect(marked.get('kalla')?.state).toBe('queued');
  });

  it('NEGATIV KONTROLL — noll körda jobb markerar ingenting', () => {
    const queued = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 5);
    const marked = markPersisted(queued, new Map());
    expect(marked.get('kalla')?.state).toBe('queued');
  });

  it('en tom kö (noll jobb) markerar INTE en källa med jobb kvar', () => {
    // Detta är exakt scenariot från 26–28 okt: Redis dog, kön tömdes,
    // dräneringen avslutade "rent" — och ledger ljög.
    const queued = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 5);
    const marked = markPersisted(queued, new Map([['kalla', 0]]));
    expect(marked.get('kalla')?.state).toBe('queued');
    expect(isAlreadyImported(marked, 'kalla', 'hash-1')).toBe(false);
  });

  it('en källa med NOLL events får state empty — inget att bevisa', () => {
    // Inget köades ⇒ inget att bevisa ⇒ 'empty'. Det är ett FAKTUM om
    // filen, inte ett vakuum-bevis om att jobben persisterades.
    const row = recordImport(new Map(), 'tom', FINGERPRINT, 0, 'x', 0);
    expect(row.get('tom')?.state).toBe('empty');
    expect(isAlreadyImported(row, 'tom', 'hash-1')).toBe(true);
  });

  it('en fil som lade in noll jobb (alla kolliderade) får state empty', () => {
    // Två filer ger samma kanoniska källa och samma source_id → samma
    // jobId. Den andra filens jobb läggs aldrig in (BullMQ-dedupe), så
    // den har inget att bevisa — och inget att importera om.
    const row = recordImport(new Map(), 'kolliderad', FINGERPRINT, 5, 'x', 0);
    expect(row.get('kolliderad')?.state).toBe('empty');
  });
});

describe('beviset får INTE lånas mellan filer (HIGH-1, 2026-10-28)', () => {
  it('två filer med samma kanoniska källa — fil A:s bevis flippar INTE fil B', () => {
    // `berwaldhallen` och `berwaldhallen-tixly` ger BÅDA den kanoniska
    // källan 'berwaldhallen'. Beviset räknas per FIL, så fil A:s 100 körda
    // jobb kan inte täcka fil B:s krav på 9 jobb.
    const a = recordImport(new Map(), 'berwaldhallen', FINGERPRINT, 100, 'x', 100);
    const b = recordImport(a, 'berwaldhallen-tixly', FINGERPRINT, 9, 'x', 9);

    // 109 körda, men de tillhör olika filer.
    const marked = markPersisted(b, new Map([['berwaldhallen', 100], ['berwaldhallen-tixly', 9]]));
    expect(marked.get('berwaldhallen')?.state).toBe('persisted');
    expect(marked.get('berwaldhallen-tixly')?.state).toBe('persisted');

    // NEGATIV KONTROLL: bara fil A:s bevis finns → B stannar kvar.
    const onlyA = markPersisted(b, new Map([['berwaldhallen', 100]]));
    expect(onlyA.get('berwaldhallen')?.state).toBe('persisted');
    expect(onlyA.get('berwaldhallen-tixly')?.state).toBe('queued');
  });

  it('EN gammal queued-rad låser INTE en annan källa (stale-row poisoning)', () => {
    // 2026-10-28 — HIGH-2. En kvittensrad som ligger kvar i 'queued'
    // höjde kravsumman för evigt, så källan kunde aldrig flippa igen.
    // Med per-fil-räkning påverkar en gammal rad bara sin egen källa.
    const stale = recordImport(new Map(), 'gammal', FINGERPRINT, 40, 'x', 40);
    const fresh = recordImport(stale, 'färsk', FINGERPRINT, 7, 'x', 7);

    // Den gamla radens jobb körs inte — men den färska källan flippar
    // ändå, eftersom dess krav är bara dess eget.
    const marked = markPersisted(fresh, new Map([['färsk', 7]]));
    expect(marked.get('färsk')?.state).toBe('persisted');
    expect(marked.get('gammal')?.state).toBe('queued');
  });

  it('en MISLYCKAD import får aldrig bli persisterad (failed-row asymmetri)', () => {
    // 2026-10-28 — HIGH-3. En fil som delvis misslyckades räknade de jobb
    // den ändå köade, så ett bevis (även från en annan fil) kunde få den
    // att flippa — trots att ett event aldrig sparades.
    const failed = recordImport(new Map(), 'trasig', FINGERPRINT, 50, 'x', 12, true);
    expect(failed.get('trasig')?.state).toBe('failed');
    expect(isAlreadyImported(failed, 'trasig', 'hash-1')).toBe(false);
    // Även fullt bevis flippar den inte.
    expect(markPersisted(failed, new Map([['trasig', 12]])).get('trasig')?.state).toBe('failed');
    expect(markPersisted(failed, new Map([['trasig', 999]])).get('trasig')?.state).toBe('failed');
  });

  it('en rad UTEN jobs markeras ALDRIG persisterad — inget krav', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventpulse-ledger-'));
    const file = path.join(dir, 'ledger.jsonl');
    fs.writeFileSync(
      file,
      JSON.stringify({ sourceId: 'gammal', fileMtime: 1, fileHash: 'h', enqueued: 3, state: 'queued', at: 'x' }) + '\n',
      'utf8',
    );
    const ledger = loadLedger(file);
    const marked = markPersisted(ledger, new Map([['gammal', 99]]));
    expect(marked.get('gammal')?.state).toBe('queued');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('jobs överlever en sparad/laddad cykel', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventpulse-ledger-'));
    const file = path.join(dir, 'ledger.jsonl');
    const queued = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 5);
    saveLedger(file, queued);
    const reloaded = loadLedger(file);
    expect(reloaded.get('kalla')?.jobs).toBe(5);
    expect(markPersisted(reloaded, new Map([['kalla', 5]])).get('kalla')?.state).toBe('persisted');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ETT misslyckat jobb håller bara SIN källa kvar — övriga flippar', () => {
    // Regressionstest för D1. Det globala villkoret "ett misslyckat jobb ⇒
    // ingen rad får flippa" togs bort, eftersom det höll hela importen från
    // att någons bli 'persisted' (varje natt importerades samma ~5 000 jobb
    // igen). Beviset ligger per fil.
    const queued = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 5);
    const withOther = recordImport(queued, 'annan', FINGERPRINT, 3, 'x', 3);
    const marked = markPersisted(withOther, new Map([['kalla', 4], ['annan', 3]]));
    expect(marked.get('kalla')?.state).toBe('queued');
    expect(marked.get('annan')?.state).toBe('persisted');
  });
});

describe('mergeLedger — importen får inte skriva över dräneringens bevis', () => {
  it('en persisterad rad på disk vinner över importens queued-rad', () => {
    // Importen laddade ledger (källan var 'queued'), köade jobb, och
    // dräneringen flippaade källan till 'persisted' under tiden. Importens
    // sparande får INTE skriva tillbaka den till 'queued'.
    const queued = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 5);
    const disk = markPersisted(queued, new Map([['kalla', 5]]));
    const merged = mergeLedger(disk, queued);
    expect(merged.get('kalla')?.state).toBe('persisted');
  });

  it('NEGATIV KONTROLL — en rad med ANNAN hash på disk vinner inte', () => {
    const queued = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 5);
    const disk = markPersisted(queued, new Map([['kalla', 5]]));
    disk.set('kalla', { ...disk.get('kalla')!, fileHash: 'hash-2' });
    const merged = mergeLedger(disk, queued);
    expect(merged.get('kalla')?.state).toBe('queued');
    expect(merged.get('kalla')?.fileHash).toBe('hash-1');
  });

  it('Nya källor från importen kommer med', () => {
    const disk = new Map();
    const pending = recordImport(disk, 'ny', FINGERPRINT, 3, 'x', 3);
    const merged = mergeLedger(disk, pending);
    expect(merged.get('ny')?.state).toBe('queued');
  });
});

describe('ledgerChanged — ledgerfilen ska inte röras utan anledning', () => {
  it('två lika mappar är oförändrade', () => {
    const a = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 5);
    const b = new Map(a);
    expect(ledgerChanged(a, b)).toBe(false);
  });

  it('en ny källa ÄR en förändring', () => {
    const a = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 5);
    const b = recordImport(a, 'ny', FINGERPRINT, 3, 'x', 3);
    expect(ledgerChanged(a, b)).toBe(true);
  });

  it('en state-flipp ÄR en förändring', () => {
    const queued = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 5);
    const persisted = markPersisted(queued, new Map([['kalla', 5]]));
    expect(ledgerChanged(queued, persisted)).toBe(true);
  });

  it('ett annat antal köade jobb ÄR en förändring', () => {
    const a = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 5);
    const b = recordImport(new Map(), 'kalla', FINGERPRINT, 9, 'x', 9);
    expect(ledgerChanged(a, b)).toBe(true);
  });

  it('samma state men olika antal jobb ÄR en förändring', () => {
    const a = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 5);
    const b = recordImport(new Map(), 'kalla', FINGERPRINT, 5, 'x', 4);
    expect(ledgerChanged(a, b)).toBe(true);
  });

  it('en rad UTAN jobs jämförs med en rad MED jobs — förändring', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventpulse-ledger-'));
    const file = path.join(dir, 'ledger.jsonl');
    fs.writeFileSync(
      file,
      JSON.stringify({ sourceId: 'gammal', fileMtime: 1, fileHash: 'h', enqueued: 3, at: 'x' }) + '\n',
      'utf8',
    );
    const loaded = loadLedger(file);
    const withEvidence = recordImport(loaded, 'gammal', { fileMtime: 1, fileHash: 'h' }, 3, 'x', 3);
    expect(ledgerChanged(loaded, withEvidence)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('NEGATIV KONTROLL — normaliseringen av gamla rader är INTE en förändring', () => {
    // loadLedger gör om en gammal rad (utan 'state') till 'queued'. Om
    // normaliseringen räknas som en förändring skriver varje importköring
    // tillbaka filen — och "ledgerfilen röds INTE" blir falskt.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventpulse-ledger-'));
    const file = path.join(dir, 'ledger.jsonl');
    fs.writeFileSync(
      file,
      JSON.stringify({ sourceId: 'gammal', fileMtime: 1, fileHash: 'h', enqueued: 3, at: 'x' }) + '\n',
      'utf8',
    );
    const loaded = loadLedger(file);
    expect(ledgerChanged(loaded, loadLedger(file))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
