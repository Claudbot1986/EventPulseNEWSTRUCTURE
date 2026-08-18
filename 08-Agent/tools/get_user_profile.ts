/**
 * get_user_profile — Phase 0 stub.
 *
 * Returns a sensible Stockholm-default profile when no row exists yet.
 * Phase 1 will replace this with real reads of user_profiles + learning
 * from user_interactions.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserProfile } from '../types';

const DEFAULT_PROFILE = (client_user_id: string): UserProfile => ({
  client_user_id,
  city_default: 'Stockholm',
  language: 'sv',
  budget_sek_max: null,
  party_size: 1,
  categories_pref: [],
});

export async function getUserProfile(
  supabase: SupabaseClient,
  client_user_id: string
): Promise<UserProfile> {
  const { data } = await supabase
    .from('user_profiles')
    .select('client_user_id, city_default, language, budget_sek_max, party_size, categories_pref')
    .eq('client_user_id', client_user_id)
    .maybeSingle();

  if (!data) return DEFAULT_PROFILE(client_user_id);
  return {
    client_user_id:  data.client_user_id,
    city_default:    data.city_default ?? 'Stockholm',
    language:        (data.language ?? 'sv') as UserProfile['language'],
    budget_sek_max:  data.budget_sek_max ?? null,
    party_size:      data.party_size ?? 1,
    categories_pref: data.categories_pref ?? [],
  };
}
