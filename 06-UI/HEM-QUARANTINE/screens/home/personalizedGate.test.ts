/**
 * Pins the Fas 1.5 #1 UI-gate (2026-10-09): personalized sections render
 * for guest + logged_in, hide only during 'loading' (avoids flash of
 * empty cards). undefined/null treated as guest (backward-compat).
 *
 * Run with: npx vitest run 06-UI/HEM-QUARANTINE/screens/home/personalizedGate.test.ts
 */

import { describe, expect, it } from 'vitest';
import { shouldRenderPersonalized } from './personalizedGate';

describe('shouldRenderPersonalized — Fas 1.5 #1 gate', () => {
  it('renders for guest (anon taste is server-side, no auth needed)', () => {
    expect(shouldRenderPersonalized('guest')).toBe(true);
  });

  it('renders for logged_in (existing behavior preserved)', () => {
    expect(shouldRenderPersonalized('logged_in')).toBe(true);
  });

  it('hides during loading (avoids empty-card flash)', () => {
    expect(shouldRenderPersonalized('loading')).toBe(false);
  });

  it('renders for undefined userState (backward-compat)', () => {
    // AppShell always passes userState, but if a future caller forgets,
    // default to render rather than hide. Showing empty carousels is
    // less bad than hiding the entire home tab.
    expect(shouldRenderPersonalized(undefined)).toBe(true);
    expect(shouldRenderPersonalized(null)).toBe(true);
  });
});
