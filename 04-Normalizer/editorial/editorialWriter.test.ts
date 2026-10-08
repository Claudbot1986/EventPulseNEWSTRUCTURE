/**
 * editorialWriter.test.ts — verifierar Writer-pipeline med MockLlmClient.
 */
import { describe, expect, it } from 'vitest';
import {
  MockLlmClient,
  MiniMaxM3LlmClient,
  stripThinkBlock,
  writeEditorialDescription,
} from './editorialWriter';
import { compileWriterInputs, STYLE_GUIDE } from './textualFirewall';
import type { EventProfile } from './types';

const baseProfile: EventProfile = {
  event_type: 'music',
  performers: ['Hooligan Bobs'],
  genres: ['rock'],
  content: ['låtar', 'framförande'],
  experience_characteristics: ['live band', 'publikrespons'],
  setting: 'klubb',
  language: ['sv'],
  target_audience: ['vuxna'],
  audience_participation: ['dans', 'applåd'],
  performance_style: 'live',
  duration_minutes: 120,
  provenance: {},
};

describe('writeEditorialDescription', () => {
  it('skapar EditorialDraft med text + word_count + model', async () => {
    const mock = new MockLlmClient(
      'Hooligan Bobs intar Debaser med rock från scenen.',
    );
    const inputs = compileWriterInputs({
      profile: baseProfile,
      event: {
        title: 'Hooligan Bobs',
        start_time: '2026-10-15T20:00:00+02:00',
        venue_name: 'Debaser',
        city: 'Stockholm',
        price_min_sek: 250,
        is_free: false,
        language: 'sv',
      },
    });
    const draft = await writeEditorialDescription({ inputs, llm: mock, model: 'minimax-M3' });
    expect(draft.text.length).toBeGreaterThan(0);
    expect(draft.word_count).toBeGreaterThan(0);
    expect(draft.meta.model).toBe('minimax-M3');
    expect(draft.meta.prompt_version).toBe('editorial-writer/v1');
  });

  it('system-prompt innehåller ALDRIG source-text-relaterade ord', async () => {
    let captured = '';
    const mock = new MockLlmClient((args) => {
      captured = args.systemPrompt;
      return 'Kort text.';
    });
    const inputs = compileWriterInputs({
      profile: baseProfile,
      event: {
        title: 'Titel',
        start_time: '2026-10-15T20:00:00+02:00',
      },
    });
    await writeEditorialDescription({ inputs, llm: mock });
    expect(captured.toLowerCase()).not.toContain('source');
    expect(captured.toLowerCase()).not.toContain('källtext');
    expect(captured.toLowerCase()).not.toContain('raw_description');
    expect(captured.toLowerCase()).not.toContain('scraped_copy');
  });

  it('user-prompt innehåller Profile-fälten', async () => {
    let captured = '';
    const mock = new MockLlmClient((args) => {
      captured = args.userPrompt;
      return 'Kort text.';
    });
    const inputs = compileWriterInputs({
      profile: baseProfile,
      event: {
        title: 'Hooligan Bobs',
        start_time: '2026-10-15T20:00:00+02:00',
        venue_name: 'Debaser',
      },
    });
    await writeEditorialDescription({ inputs, llm: mock });
    expect(captured).toContain('Hooligan Bobs');
    expect(captured).toContain('Debaser');
    expect(captured).toContain('rock');
    expect(captured).toContain('live band');
  });

  it('MiniMaxM3LlmClient bygger korrekt request utan att köra (konstruktion OK)', () => {
    const client = new MiniMaxM3LlmClient({
      apiKey: 'sk-test-123',
      defaultModel: 'minimax-M3',
    });
    expect(client.name).toBe('minimax-M3');
  });

  it('MiniMaxM3LlmClient normaliserar bas-URL (tar bort trailing slash)', () => {
    const client = new MiniMaxM3LlmClient({
      apiKey: 'sk-test-123',
      baseUrl: 'https://api.minimax.io/v1/',
    });
    expect((client as unknown as { baseUrl: string }).baseUrl).toBe('https://api.minimax.io/v1');
  });
});

describe('stripThinkBlock', () => {
  it('plockar bort <think>…</think>-block och returnerar slut-svar', () => {
    const raw = '<think>jag räknar ut…\nflera rader resonemang…\n…klar</think>Hooligan Bobs intar Debaser.';
    expect(stripThinkBlock(raw)).toBe('Hooligan Bobs intar Debaser.');
  });

  it('lämnar content oförändrat när inget think-block finns', () => {
    const raw = 'Kort svar utan resonemang.';
    expect(stripThinkBlock(raw)).toBe('Kort svar utan resonemang.');
  });

  it('hanterar flera think-block (tar bort alla)', () => {
    const raw = '<think>första resonemanget</think>Hooligan Bobs spelar.<think>andra resonemanget</think> Ikväll på Debaser.';
    expect(stripThinkBlock(raw)).toBe('Hooligan Bobs spelar. Ikväll på Debaser.');
  });
});