// supabaseClient — minimal Supabase-klient för home-tab i 06-UI.
//
// Home-tab-versionen (Hem-supabase-logik, 2026-09-25) pratar DIREKT mot
// Supabase (inte via 06-UI/services/agentClient.js). events_public-viewn
// är anon-läsbar — vi behöver ingen auth-session, ingen service-role.
//
// Identisk URL + anon-nyckel som 06-UI/.env.local. persistSession är false
// eftersom vi bara läser publika events — ingen auth, ingen refresh, ingen
// global state. HomeScreen bygger sina egna queries med supabase.from(...)
// .select(...) — inga helpers utöver createClient.
//
// Jämför med 06-UI/services/supabaseAuthClient.js (auth-fokuserad, persistent
// session) och 06-UI/services/eventsCanonical.js (service-role-fallback).
// Vi delar ingen kod eftersom läsning av publika events inte behöver auth-
// komplexiteten.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabaseClient] EXPO_PUBLIC_SUPABASE_URL/ANON_KEY missing — ' +
      'home-tab kan inte ladda events.',
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
