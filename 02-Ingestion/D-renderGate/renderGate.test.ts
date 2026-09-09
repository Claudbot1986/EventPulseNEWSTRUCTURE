/**
 * renderGate.test.ts — Unit tests for behavior ladder + stealth threshold.
 *
 * These tests do NOT make real Scrapingbee calls. They verify that:
 *   1. buildScrapingbeeParams() emits the correct params per behavior
 *   2. shouldEscalateToStealth() correctly classifies blocked renders
 *   3. estimateBehaviorCost() matches published credit ladder
 *   4. waitForSelector is gated correctly (premium-only/stealth only)
 */

import { describe, expect, test } from 'vitest';
import {
  buildScrapingbeeParams,
  shouldEscalateToStealth,
  estimateBehaviorCost,
  BEHAVIOR_MAX_CREDITS,
  type RenderBehavior,
  type RenderResult,
} from './renderGate';

const TEST_URL = 'https://example.com/events';

describe('buildScrapingbeeParams', () => {
  test('auto behavior uses mode=auto + max_cost=10, NO render_js/premium_proxy', () => {
    const { params, behavior } = buildScrapingbeeParams(TEST_URL, { behavior: 'auto' });
    expect(behavior).toBe('auto');
    expect(params.mode).toBe('auto');
    expect(params.max_cost).toBe(10);
    expect(params.country_code).toBe('se');
    expect(params.block_resources).toBe('true');
    expect(params).not.toHaveProperty('render_js');
    expect(params).not.toHaveProperty('premium_proxy');
    expect(params).not.toHaveProperty('stealth_proxy');
  });

  test('static-only behavior sets render_js=false + premium_proxy=true', () => {
    const { params, behavior } = buildScrapingbeeParams(TEST_URL, { behavior: 'static-only' });
    expect(behavior).toBe('static-only');
    expect(params.render_js).toBe('false');
    expect(params.premium_proxy).toBe('true');
    expect(params.country_code).toBe('se');
    expect(params.block_resources).toBe('true');
    expect(params).not.toHaveProperty('stealth_proxy');
    expect(params).not.toHaveProperty('mode');
  });

  test('premium-only behavior sets render_js=true + wait=2500', () => {
    const { params, behavior } = buildScrapingbeeParams(TEST_URL, { behavior: 'premium-only' });
    expect(behavior).toBe('premium-only');
    expect(params.render_js).toBe('true');
    expect(params.premium_proxy).toBe('true');
    expect(params.wait).toBe('2500');
    expect(params.country_code).toBe('se');
    expect(params).not.toHaveProperty('stealth_proxy');
    expect(params).not.toHaveProperty('mode');
  });

  test('stealth behavior sets stealth_proxy=true + render_js=true', () => {
    const { params, behavior } = buildScrapingbeeParams(TEST_URL, { behavior: 'stealth' });
    expect(behavior).toBe('stealth');
    expect(params.stealth_proxy).toBe('true');
    expect(params.render_js).toBe('true');
    expect(params.country_code).toBe('se');
    expect(params.block_resources).toBe('true');
    expect(params).not.toHaveProperty('premium_proxy');  // stealth implies premium
  });

  test('waitForSelector is forwarded for premium-only', () => {
    const { params } = buildScrapingbeeParams(TEST_URL, {
      behavior: 'premium-only',
      waitForSelector: '.event-card',
    });
    expect(params.wait_for).toBe('.event-card');
  });

  test('waitForSelector is forwarded for stealth', () => {
    const { params } = buildScrapingbeeParams(TEST_URL, {
      behavior: 'stealth',
      waitForSelector: '.event-card',
    });
    expect(params.wait_for).toBe('.event-card');
  });

  test('waitForSelector is NOT forwarded for auto (mode=auto has no wait_for)', () => {
    const { params } = buildScrapingbeeParams(TEST_URL, {
      behavior: 'auto',
      waitForSelector: '.event-card',
    });
    expect(params).not.toHaveProperty('wait_for');
  });

  test('waitForSelector is NOT forwarded for static-only (no JS render)', () => {
    const { params } = buildScrapingbeeParams(TEST_URL, {
      behavior: 'static-only',
      waitForSelector: '.event-card',
    });
    expect(params).not.toHaveProperty('wait_for');
  });

  test('default behavior is auto when none specified', () => {
    const { behavior } = buildScrapingbeeParams(TEST_URL, {});
    expect(behavior).toBe('auto');
  });
});

describe('shouldEscalateToStealth', () => {
  function makeResult(over: Partial<RenderResult>): RenderResult {
    return {
      url: TEST_URL,
      success: false,
      html: '',
      metrics: {
        renderTimeMs: 100,
        htmlLength: 0,
        hasEventContent: false,
      },
      ...over,
    };
  }

  test('healthy render with events and content should NOT escalate', () => {
    const html = '<html><body><h1>Evenemang</h1><p>datum biljett</p></body></html>';
    const result = makeResult({
      success: true,
      html,
      metrics: { renderTimeMs: 100, htmlLength: html.length, hasEventContent: true },
    });
    expect(shouldEscalateToStealth(result)).toBe(false);
  });

  test('short HTML + CF markers → escalate (signals >= 2)', () => {
    const html = '<html><body>cf-mitigated</body></html>';
    const result = makeResult({
      success: true,
      html,
      metrics: { renderTimeMs: 100, htmlLength: html.length, hasEventContent: false },
    });
    expect(shouldEscalateToStealth(result)).toBe(true);
  });

  test('short HTML alone (1 signal) → do NOT escalate', () => {
    const html = '<html><body>tiny</body></html>';
    const result = makeResult({
      success: true,
      html,
      metrics: { renderTimeMs: 100, htmlLength: html.length, hasEventContent: false },
    });
    expect(shouldEscalateToStealth(result)).toBe(false);
  });

  test('DataDome dd-token + error string 403 → escalate', () => {
    const html = '<html><body>dd-token present</body></html>';
    const result = makeResult({
      success: false,
      html,
      error: 'HTTP 403 forbidden',
      metrics: { renderTimeMs: 100, htmlLength: html.length, hasEventContent: false },
    });
    expect(shouldEscalateToStealth(result)).toBe(true);
  });

  test('large HTML + no markers + success → no escalation', () => {
    const html = 'x'.repeat(2000) + ' evenemang kalender biljett';
    const result = makeResult({
      success: true,
      html,
      metrics: { renderTimeMs: 100, htmlLength: html.length, hasEventContent: true },
    });
    expect(shouldEscalateToStealth(result)).toBe(false);
  });

  test('Attention Required marker alone (1 signal) → no escalation', () => {
    const html = 'x'.repeat(2000) + '<h1>Attention Required</h1>';
    const result = makeResult({
      success: true,
      html,
      metrics: { renderTimeMs: 100, htmlLength: html.length, hasEventContent: false },
    });
    expect(shouldEscalateToStealth(result)).toBe(false);
  });
});

describe('estimateBehaviorCost', () => {
  test('returns the published Scrapingbee credit ceiling per behavior', () => {
    expect(estimateBehaviorCost('auto')).toBe(10);
    expect(estimateBehaviorCost('static-only')).toBe(10);
    expect(estimateBehaviorCost('premium-only')).toBe(25);
    expect(estimateBehaviorCost('stealth')).toBe(75);
  });

  test('BEHAVIOR_MAX_CREDITS table covers all 4 behaviors', () => {
    const behaviors: RenderBehavior[] = ['auto', 'static-only', 'premium-only', 'stealth'];
    for (const b of behaviors) {
      expect(BEHAVIOR_MAX_CREDITS[b]).toBeGreaterThan(0);
    }
  });

  test('stealth is the most expensive (last-resort signal)', () => {
    const costs = (['auto', 'static-only', 'premium-only', 'stealth'] as RenderBehavior[])
      .map(estimateBehaviorCost);
    expect(Math.max(...costs)).toBe(75);
  });
});