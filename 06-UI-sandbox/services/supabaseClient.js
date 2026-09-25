// supabaseClient — minimal Supabase-klient för 06-UI-sandbox.
//
// Sandbox-version av Hem-supabase pratar DIREKT mot Supabase (inte via
// 06-UI/services/agentClient.js). Detta är ett medvetet undantag från
// sandbox-regeln "Inget Supabase-anrop": Hem-supabase ska spegla hur
// Hem* i 06-UI kommer se ut, och validera hur riktiga events filtreras
// och sorteras — utan att behöva dra in hela agent-flödet.
//
// Identisk URL + anon-nyckel som 06-UI/.env.local (se 06-UI-sandbox/.env).
// events_public-viewn är anon-läsbar; vi behöver ingen auth-session.
//
// Sandbox-specifikt:
//   - persistSession: false (ingen auth, ingen refresh, ingen global state)
//   - Inga helpers utöver createClient — HemSupabase bygger sina egna
//     queries med supabase.from(...).select(...).
//
// Jämför med 06-UI/services/supabaseAuthClient.js (auth-fokuserad) och
// 06-UI/services/eventsCanonical.js (service-role-fallback). Vi delar
// ingen kod eftersom sandbox är isolerad labb.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabaseClient] EXPO_PUBLIC_SUPABASE_URL/ANON_KEY missing — ' +
      'Hem-supabase kommer inte kunna ladda events.',
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
