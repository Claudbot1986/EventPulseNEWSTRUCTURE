/**
 * Event-hämtning för testsidan `*`.
 *
 * Återanvänder samma kod som hemknappen (App.js) — `fetchEvents` från
 * `services/eventServiceClient.js` — så att testsidan kör mot riktig
 * Supabase-data, inte mock.
 *
 * Del B (testkörning): tar de första N eventsen som hemknappen visar.
 * Del C (automatisk produktion, SENARE): skulle istället köra mot
 * `events WHERE image_url IS NULL`.
 */

import { fetchEvents } from '../../services/eventServiceClient.js';

/**
 * Hämtar samma events som hemknappen, begränsat till `limit` stycken.
 *
 * @param {number} [limit=10] - Max antal events att returnera
 * @returns {Promise<Array>} Lista med normaliserade events
 * @throws {Error} Om Supabase-anropet misslyckas
 */
export async function loadEventsForAsterisk(limit = 10) {
  const result = await fetchEvents();

  if (!result || !Array.isArray(result.events)) {
    throw new Error('Supabase returnerade inga events.');
  }

  return result.events.slice(0, limit);
}
