// 05-Supabase/migrations/user-preferences-auth-uid.test.ts
//
// Schema-lås för 20260920-0001-user-preferences-auth-uid.sql (NOW#1).
//
// Beteende-baserat (inte information_schema): den hostade projektets
// PostgREST exponerar inte information_schema (PGRST205) — men BETEENDENA är
// det vi faktiskt förlitar oss på, och de går att bevisa mot både lokal
// `supabase start` och live-projektet med en engångs-användare:
//   1. client_user_id är uuid — ogiltig uuid-sträng avvisas vid insert
//   2. PK/upsert-kontraktet — upsert samma id två gånger = exakt en rad
//   3. FK ON DELETE CASCADE — ta bort användaren ⇒ prefs-raden försvinner
//
// RLS-ägarbeteendet bevisas separat LIVE (anon-JWT) via
// scripts/verify-user-preferences-rls.mjs (7/7 PASS 2026-09-20).
//
// Env-gated (samma mönster som events-public-lockdown.test.ts):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx vitest run <denna fil>
// Utan service-nyckel skippas hela suiten.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const HAS_SERVICE_KEY = SUPABASE_SERVICE_ROLE_KEY.length > 0;

describe.skipIf(!HAS_SERVICE_KEY)('user_preferences auth-uid-schema (20260920-0001)', () => {
  let supabase: SupabaseClient;
  let disposableUserId: string | null = null;

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    // Engångs-användare för hela suiten; städas i afterAll.
    const { data, error } = await supabase.auth.admin.createUser({
      email: `schema-lock-${Date.now()}@example.invalid`,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    disposableUserId = data.user.id;
  });

  afterAll(async () => {
    if (!disposableUserId) return;
    await supabase.from('user_preferences').delete().eq('client_user_id', disposableUserId);
    await supabase.auth.admin.deleteUser(disposableUserId).catch(() => {});
    disposableUserId = null;
  });

  it('client_user_id är uuid — ogiltig sträng avvisas vid insert', async () => {
    const { error } = await supabase.from('user_preferences').insert({
      client_user_id: 'definitely-not-a-uuid',
      preferences: { probe: true },
    });
    // 22P02 invalid_text_representation bevisar uuid-kolumnen.
    expect(error?.code).toBe('22P02');
  });

  it('upsert på samma client_user_id lämnar exakt en rad (PK-kontrakt)', async () => {
    const first = await supabase.from('user_preferences').upsert(
      { client_user_id: disposableUserId, preferences: { categories: ['music'] } },
      { onConflict: 'client_user_id' },
    );
    expect(first.error).toBeNull();

    const second = await supabase.from('user_preferences').upsert(
      { client_user_id: disposableUserId, preferences: { categories: ['art'] } },
      { onConflict: 'client_user_id' },
    );
    expect(second.error).toBeNull();

    const { count, error } = await supabase
      .from('user_preferences')
      .select('*', { count: 'exact', head: true })
      .eq('client_user_id', disposableUserId);
    expect(error).toBeNull();
    expect(count).toBe(1);
  });

  it('FK ON DELETE CASCADE: deleteUser tar bort prefs-raden', async () => {
    // Rad finns från föregående test (vitest kör describe-its i ordning).
    const { error: delErr } = await supabase.auth.admin.deleteUser(disposableUserId!);
    expect(delErr).toBeNull();

    const { count, error } = await supabase
      .from('user_preferences')
      .select('*', { count: 'exact', head: true })
      .eq('client_user_id', disposableUserId!);
    expect(error).toBeNull();
    expect(count).toBe(0);

    disposableUserId = null; // afterAll har inget kvar att städa.
  });
});
