/**
 * Fas 1.5 #1 — Guest taste-first gate (2026-10-09).
 *
 * Personalized HomeScreen sections (För dig, Senaste, Ikväll, Imorgon,
 * Helgen) shall render for guests and logged-in users alike. The gate
 * exists to hide them ONLY during the brief auth-state-resolve phase
 * ('loading') so users don't see a flash of empty/placeholder cards.
 *
 * Content sections (Foodies, Gratis, Nytt Eventpulse, Upptäck) are
 * unauthenticated and never gated — they always render.
 *
 * Server-side is already in place (Supabase anon-signin, see
 * docs/BACKLOG.md Phase 1.5 #1). This helper is the UI-side piece.
 */

/**
 * @param {'loading' | 'guest' | 'logged_in' | undefined | null} userState
 * @returns {boolean} true when personalized sections should render
 */
export function shouldRenderPersonalized(userState) {
  return userState !== 'loading';
}
