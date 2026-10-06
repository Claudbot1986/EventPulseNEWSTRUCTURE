-- 2026-10-06 — Grant SELECT to anon role on public tables used by eventpulse.nu.
--
-- Bakgrund: web companion-siten (`site/`, deployad till eventpulse.nu) läser
-- events/categories/venues direkt från Supabase REST med publishable-nyckeln
-- (roll: `anon`). RLS-policyning finns redan:
--   * "Public can read categories"        (categories)
--   * "Public can read venues"           (venues)
--   * "Public can read published events" (events, status='published')
--
-- Men GRANTs på tabellnivå saknas för `anon` (verifierat 2026-10-06 mot
-- information_schema.role_table_grants). Detta gav 42501 "permission denied"
-- även om RLS-policyn tillåter läsning. GRANT krävs innan RLS evalueras.
--
-- Säkert: ger ENDAST SELECT. Inga INSERT/UPDATE/DELETE-rättigheter läggs till.
-- Publicerade events är redan publik information per design (se
-- docs/MASTERPLAN.md §3 — ingen commoditization av beteendedata, men
-- events-grafen i sig är publik via livespot.se / andra källor).
--
-- För säkerhets skull: framtida känsliga fält (t.ex. kan vi lägga in
-- `confidence_breakdown` eller cost-data) bör inte exponeras via `select=*`
-- i webbläsaren — explicit fältlista i app.js är redan minimivet.

BEGIN;

GRANT SELECT ON events     TO anon;
GRANT SELECT ON categories TO anon;
GRANT SELECT ON venues     TO anon;

COMMIT;