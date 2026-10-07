/**
 * index.test.ts — pipeline-orchestrator end-to-end (med MockLlmClient).
 */
import { describe, expect, it } from 'vitest';
import { runEditorialPipeline, buildStoredProfile, buildStoredEditorialDescription } from './index';
import { MockLlmClient } from './editorialWriter';
import type { EventUnderstandingInput } from './eventUnderstanding';

const baseEvent: EventUnderstandingInput = {
  category_slug: 'rock',
  venue_type: 'club',
  venue_name: 'Debaser',
  city: 'Stockholm',
  start_time: '2026-10-15T20:00:00+02:00',
  end_time: '2026-10-15T22:00:00+02:00',
  price_min_sek: 250,
  is_free: false,
  language: 'sv',
  source: 'debaster',
  title: 'Hooligan Bobs',
  performers: ['Hooligan Bobs'],
};

describe('runEditorialPipeline', () => {
  it('klar hela kedjan PASS på första försöket', async () => {
    const llm = new MockLlmClient(
      'Hooligan Bobs intar Debaser med rock från scenen.',
    );
    const r = await runEditorialPipeline({
      event: baseEvent,
      sourceDescription: 'En helt annan scraperad text från sajten.',
      llm,
    });
    expect(r.status).toBe('passed');
    expect(r.draft?.text.length).toBeGreaterThan(0);
    expect(r.factuality?.pass).toBe(true);
    expect(r.independence?.pass).toBe(true);
    expect(r.attempts).toBe(0);
    expect(r.final_text).toBe(r.draft?.text);
  });

  it('regenererar när factuality fail på första försöket', async () => {
    let attempt = 0;
    const llm = new MockLlmClient((args) => {
      attempt++;
      if (attempt === 1) {
        // Första försöket — hitta på en artist som inte finns.
        return 'The Strokes spelar ikväll på Debaser.';
      }
      // Andra försöket — håll dig till Profile.
      return 'Hooligan Bobs intar Debaser med rock.';
    });
    const r = await runEditorialPipeline({
      event: baseEvent,
      sourceDescription: null,
      llm,
      maxAttempts: 2,
    });
    expect(attempt).toBe(2);
    expect(r.attempts).toBe(1);
    expect(r.factuality?.pass).toBe(true);
  });

  it('FAILED om factuality fortsätter fail efter max attempts', async () => {
    const llm = new MockLlmClient('The Strokes spelar ikväll på Debaser.');
    const r = await runEditorialPipeline({
      event: baseEvent,
      sourceDescription: null,
      llm,
      maxAttempts: 2,
    });
    expect(r.status).toBe('failed');
    expect(r.factuality?.pass).toBe(false);
    expect(r.factuality?.unsupported_claims).toContain('The Strokes');
  });

  it('FAILED om independence fail (draft kopierar source)', async () => {
    const sourceText = 'Konserthuset är glada att välkomna artister från hela världen. Årets festival bjuder på det bästa.';
    const llm = new MockLlmClient(
      'Konserthuset är glada att välkomna artister från hela världen. Kvällen blir magisk.',
    );
    const r = await runEditorialPipeline({
      event: { ...baseEvent, venue_name: 'Konserthuset' },
      sourceDescription: sourceText,
      llm,
      maxAttempts: 1,
    });
    expect(r.independence?.pass).toBe(false);
    expect(r.independence?.matched_phrases.length).toBeGreaterThan(0);
  });

  it('onAttempt callback anropas för varje försök', async () => {
    let calls = 0;
    const llm = new MockLlmClient('Hooligan Bobs intar Debaser med rock.');
    await runEditorialPipeline({
      event: baseEvent,
      sourceDescription: null,
      llm,
      onAttempt: () => { calls++; },
    });
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});

describe('storage helpers', () => {
  it('buildStoredProfile sparar profile + version + timestamp', () => {
    const sp = buildStoredProfile({
      event_type: 'music',
      performers: [],
      genres: ['rock'],
      content: [],
      experience_characteristics: [],
      language: [],
      provenance: {},
    }, { source1: 'abc123' });
    expect(sp.version).toBe(1);
    expect(sp.source_hashes['source1']).toBe('abc123');
    expect(sp.generated_at).toMatch(/T/);
  });

  it('buildStoredEditorialDescription speglar draft + checks', () => {
    const draft = {
      text: 'Kort text.',
      word_count: 2,
      info_level: 'MEDIUM' as const,
      meta: { model: 'gpt-4o-mini', prompt_version: 'v1', generated_at: '2026-10-07T00:00:00Z' },
    };
    const sed = buildStoredEditorialDescription(draft, true, true);
    expect(sed.factuality_pass).toBe(true);
    expect(sed.independence_pass).toBe(true);
    expect(sed.text).toBe('Kort text.');
  });
});