import { describe, it, expect } from 'vitest';
import { resolveDrainMode } from './drainMode';

describe('resolveDrainMode', () => {
  it('returns status for --status (read-only, must never drain)', () => {
    expect(resolveDrainMode(['--status'])).toBe('status');
    expect(resolveDrainMode(['--max-ms', '60000', '--status'])).toBe('status');
  });

  it('returns drain when no --status flag is present', () => {
    expect(resolveDrainMode([])).toBe('drain');
    expect(resolveDrainMode(['--max-ms', '60000'])).toBe('drain');
  });

  it('does not treat a lookalike flag as --status', () => {
    // "--status=1" är inte samma sak; "--status-verbose" ska inte heller
    // stänga av dräneringen.
    expect(resolveDrainMode(['--status=1'])).toBe('drain');
    expect(resolveDrainMode(['--status-verbose'])).toBe('drain');
  });
});
