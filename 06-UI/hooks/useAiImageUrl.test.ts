/**
 * 06-UI/hooks/useAiImageUrl.test.ts
 *
 * Tests for the AI-image rollout decision tree. Verifies the hook:
 *   - Falls back to empty box when kill switch is OFF
 *   - Returns 'original' for explicit opt-out events
 *   - Returns 'pre-baked' when worker has persisted AI URL
 *   - Returns 'lazy' when worker flagged done but no URL yet
 *   - Returns 'empty' for pending/failed/no_credits status (NO original fallback)
 *
 * Run:  npx vitest run 06-UI/hooks/useAiImageUrl.test.ts
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// Mock agentClient so we can assert the lazy-path URL building
vi.mock('../services/agentClient', () => ({
  buildAiImageUrl: (eventId: string) => `https://example.com/agent/ai-image/${eventId}.png`,
}));

import { useAiImageUrl, emptyImageBoxStyle } from './useAiImageUrl';

interface TestEvent {
  id?: string;
  imageUrl?: string | null;
  image_url?: string | null;
  image_ai_generated?: boolean;
  image_ai_optout?: boolean;
  image_generation_status?: 'pending' | 'completed' | 'failed' | 'no_credits' | null;
}

describe('useAiImageUrl', () => {
  beforeEach(() => {
    // Default: kill switch ON
    process.env.EXPO_PUBLIC_AI_IMAGE_EXPLORE_ENABLED = 'true';
  });

  test('returns empty box when kill switch is OFF', () => {
    process.env.EXPO_PUBLIC_AI_IMAGE_EXPLORE_ENABLED = 'false';
    const result = useAiImageUrl({
      id: 'abc',
      image_ai_generated: true,
      imageUrl: 'https://x.com/img.png',
    });
    expect(result).toEqual({ uri: null, source: 'empty', stampVisible: false });
  });

  test('returns empty box when kill switch is unset', () => {
    delete process.env.EXPO_PUBLIC_AI_IMAGE_EXPLORE_ENABLED;
    const result = useAiImageUrl({
      id: 'abc',
      image_ai_generated: true,
      imageUrl: 'https://x.com/img.png',
    });
    expect(result).toEqual({ uri: null, source: 'empty', stampVisible: false });
  });

  test('returns original for explicit opt-out event', () => {
    const result = useAiImageUrl({
      id: 'abc',
      image_ai_optout: true,
      image_ai_generated: false,
      imageUrl: 'https://press.example.com/photo.jpg',
    });
    expect(result).toEqual({
      uri: 'https://press.example.com/photo.jpg',
      source: 'original',
      stampVisible: false,
    });
  });

  test('returns pre-baked when worker has persisted AI URL', () => {
    const result = useAiImageUrl({
      id: 'abc',
      image_ai_generated: true,
      image_ai_optout: false,
      image_generation_status: 'completed',
      imageUrl: 'https://storage.example.com/ai-generated/abc.png',
    });
    expect(result).toEqual({
      uri: 'https://storage.example.com/ai-generated/abc.png',
      source: 'pre-baked',
      stampVisible: true,
    });
  });

  test('returns lazy when AI done flag set but no URL yet', () => {
    const result = useAiImageUrl({
      id: 'lazy-event',
      image_ai_generated: true,
      image_ai_optout: false,
      image_generation_status: 'completed',
      imageUrl: null,
    });
    expect(result).toEqual({
      uri: 'https://example.com/agent/ai-image/lazy-event.png',
      source: 'lazy',
      stampVisible: true,
    });
  });

  test('returns empty when image_ai_generated is true but status pending', () => {
    const result = useAiImageUrl({
      id: 'pending-event',
      image_ai_generated: true,
      image_generation_status: 'pending',
      imageUrl: null,
    });
    expect(result).toEqual({ uri: null, source: 'empty', stampVisible: false });
  });

  test('returns empty when image_generation_status is no_credits', () => {
    const result = useAiImageUrl({
      id: 'no-credits-event',
      image_ai_generated: false,
      image_generation_status: 'no_credits',
      imageUrl: 'https://storage.example.com/ai-generated/whatever.png',
    });
    expect(result).toEqual({ uri: null, source: 'empty', stampVisible: false });
  });

  test('NEVER falls back to original URL when kill switch is ON and not opted out', () => {
    // Even if imageUrl points at a copyrighted upstream URL, the hook
    // refuses to surface it unless image_ai_optout is explicitly true.
    const result = useAiImageUrl({
      id: 'no-copyright-leak',
      image_ai_generated: false,
      image_ai_optout: false,
      image_generation_status: null,
      imageUrl: 'https://ticketmaster.com/photo.jpg',
    });
    expect(result).toEqual({ uri: null, source: 'empty', stampVisible: false });
  });

  test('handles image_url (snake_case) fallback', () => {
    const result = useAiImageUrl({
      id: 'snake-case',
      image_ai_generated: true,
      image_ai_optout: false,
      image_generation_status: 'completed',
      image_url: 'https://storage.example.com/ai-generated/snake.png',
    });
    expect(result.source).toBe('pre-baked');
    expect(result.uri).toBe('https://storage.example.com/ai-generated/snake.png');
  });

  test('handles null/undefined event gracefully', () => {
    expect(useAiImageUrl(null)).toEqual({ uri: null, source: 'empty', stampVisible: false });
    expect(useAiImageUrl(undefined)).toEqual({ uri: null, source: 'empty', stampVisible: false });
  });
});

describe('emptyImageBoxStyle', () => {
  test('has correct aspect ratio and dark surface', () => {
    expect(emptyImageBoxStyle.aspectRatio).toBe(1);
    expect(emptyImageBoxStyle.backgroundColor).toBe('#1A1A1A');
    expect(emptyImageBoxStyle.borderRadius).toBe(12);
    expect(emptyImageBoxStyle.width).toBe('100%');
  });
});