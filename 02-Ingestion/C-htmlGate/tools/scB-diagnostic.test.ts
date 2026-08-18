import { describe, expect, it } from 'vitest';
import { determineHypothesis, hypothesisToQueueKey } from './scB-diagnostic.js';

describe('scB diagnostic routing', () => {
  it('does not label successful diagnostic fetches as error500 just because no specific blocker was found', () => {
    const hypothesis = determineHypothesis({
      directHttp: { success: true, statusCode: 200, htmlLength: 1200 },
      scbNoJs: { success: false, htmlLength: 0 },
      scbWithJs: { success: true, statusCode: 200, htmlLength: 1600 },
      scbPremiumProxy: { success: false, htmlLength: 0 },
      headers: { cloudflare: false, securityHeaders: {} },
    });

    expect(hypothesis).toBe('diagnostic_no_actionable_fetch_error');
    expect(hypothesisToQueueKey(hypothesis)).toBe('manual');
  });

  it('keeps actual 500-style ScB failures out of manual routing', () => {
    const hypothesis = determineHypothesis({
      directHttp: { success: true, statusCode: 200, htmlLength: 1200 },
      scbNoJs: { success: false, error: 'HTTP 500', statusCode: 500 },
      scbWithJs: { success: false, error: 'HTTP 500', statusCode: 500 },
      scbPremiumProxy: { success: false, htmlLength: 0 },
      headers: { cloudflare: false, securityHeaders: {} },
    });

    expect(hypothesis).toBe('origin_blocks_scb_ip');
    expect(hypothesisToQueueKey(hypothesis)).toBe('blocked');
  });
});
