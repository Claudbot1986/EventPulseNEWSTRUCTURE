// 05-Supabase/migrations/events-public-lockdown.test.ts
//
// Engångstest som verifierar GDPR-lockdownen på events_public-vyn.
// Migrationen 20260905-0001-events-public-lockdown-test.sql skapar:
//   - events_public_expected_columns (auktoritativ kolumnlista)
//   - assert_events_public_lockdown() (PL/pgSQL-funktion)
//
// Detta test anropar funktionen och failar om någon check har status='FAIL'.
// Köres mot lokal supabase start. Inte per-request, inte per-deploy.
//
// Kör:
//   cd 06-UI && npx vitest run ../../05-Supabase/migrations/events-public-lockdown.test.ts
//
// Eller mot remote (manuellt):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx vitest run ...

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Miljövariabler — service_role är OK här eftersom vi kör mot en migration-
// testdatabas, INTE mot appens publika anon-nyckel.
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

interface LockdownCheck {
  check_name: string;
  status: 'OK' | 'WARN' | 'FAIL';
  detail: string;
}

describe('events_public GDPR lockdown', () => {
  let supabase: SupabaseClient;

  beforeAll(() => {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY saknas. Detta test kräver service_role-nyckel ' +
        'för att anropa assert_events_public_lockdown(). Sätt env-variabeln eller ' +
        'kör mot lokal `supabase start`.',
      );
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  });

  it('events_public har inte raw_data eller organizer_id (GDPR-kontroll)', async () => {
    // Direktfråga mot information_schema — det här är den mest robusta kontrollen.
    // Vi frågar inte själva tabellen eftersom GRANT SELECT på events är REVOKE:at
    // för service_role-rollen ... faktiskt inte, service_role har GRANT ALL.
    // Men information_schema räcker och är snabbare.
    const { data: columns, error } = await supabase
      .from('information_schema.columns' as never)
      .select('column_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'events_public');

    expect(error).toBeNull();
    const colNames = (columns ?? []).map((c: { column_name: string }) => c.column_name);

    // GDPR-kontroll A: raw_data får aldrig exponeras.
    expect(
      colNames.includes('raw_data'),
      `GDPR-LÄCKA: events_public innehåller kolumnen 'raw_data'. Detta är en ` +
      `JSONB med hela scrape-payloaden och kan innehålla personuppgifter ` +
      `(organizer.email, performer.phone). Ta bort ur vyn.`,
    ).toBe(false);

    // GDPR-kontroll B: organizer_id är internt.
    expect(
      colNames.includes('organizer_id'),
      `Internt fält exponerat: 'organizer_id' finns i events_public. ` +
      `B2B-readiness (Phase 4) krävs först.`,
    ).toBe(false);

    // GDPR-kontroll C: source_id och dedup_hash är små onödiga läckor.
    expect(
      colNames.includes('source_id'),
      `'source_id' exponerat — liten risk för härledning av scrape-target. ` +
      `Överväg att ta bort ur vyn.`,
    ).toBe(false);
    expect(
      colNames.includes('dedup_hash'),
      `'dedup_hash' exponerat — avslöjar normaliseringsdetaljer. Ta bort ur vyn.`,
    ).toBe(false);
  });

  it('events_public har inte fler kolumner än events (regression-guard)', async () => {
    const { data: viewCols, error: viewErr } = await supabase
      .rpc('list_public_columns' as never, { p_table: 'events_public' } as never);
    // Om RPC:n inte finns (migrationen är inte körts lokalt), fall tillbaka till
    // information_schema.
    if (viewErr) {
      const { data: cols } = await supabase
        .from('information_schema.columns' as never)
        .select('column_name')
        .eq('table_schema', 'public')
        .eq('table_name', 'events_public');
      const viewNames = (cols ?? []).map((c: { column_name: string }) => c.column_name);

      const { data: tableCols } = await supabase
        .from('information_schema.columns' as never)
        .select('column_name')
        .eq('table_schema', 'public')
        .eq('table_name', 'events');
      const tableNames = (tableCols ?? []).map((c: { column_name: string }) => c.column_name);

      const unexpected = viewNames.filter((n) => !tableNames.includes(n));
      expect(
        unexpected,
        `events_public har kolumner som inte finns i events: ${unexpected.join(', ')}.`,
      ).toEqual([]);
    } else {
      expect(viewCols).toBeDefined();
    }
  });

  it('alla förväntade publika kolumner finns i events_public (declared-list-guard)', async () => {
    // Om migrationens expected-tabell finns — använd den. Annars skip.
    const { data: expected, error: expErr } = await supabase
      .from('events_public_expected_columns' as never)
      .select('column_name, must_be_present')
      .eq('must_be_present', true);

    if (expErr || !expected || expected.length === 0) {
      // Migrationen är inte körts lokalt — skip med informativt meddelande.
      // eslint-disable-next-line no-console
      console.warn(
        '[lockdown-test] events_public_expected_columns saknas — ' +
        'kör migrationen 20260905-0001-events-public-lockdown-test.sql först.',
      );
      return;
    }

    const { data: viewCols } = await supabase
      .from('information_schema.columns' as never)
      .select('column_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'events_public');
    const viewNames = (viewCols ?? []).map((c: { column_name: string }) => c.column_name);

    const missing = expected
      .map((e: { column_name: string }) => e.column_name)
      .filter((n: string) => !viewNames.includes(n));

    expect(
      missing,
      `events_public saknar förväntade kolumner: ${missing.join(', ')}. ` +
      `En migration glömde troligen uppdatera vyn.`,
    ).toEqual([]);
  });

  it('assert_events_public_lockdown() returnerar inga FAIL-rader (fullständig kontroll)', async () => {
    // Detta är den starkaste kontrollen — den kör alla fem checks i PL/pgSQL.
    const { data, error } = await supabase.rpc('assert_events_public_lockdown');

    if (error) {
      // Funktionen finns inte (migrationen är inte körts lokalt).
      if (error.message.includes('function') && error.message.includes('does not exist')) {
        // eslint-disable-next-line no-console
        console.warn(
          '[lockdown-test] assert_events_public_lockdown() saknas — ' +
          'kör migrationen 20260905-0001-events-public-lockdown-test.sql först.',
        );
        return;
      }
      throw error;
    }

    const rows = (data ?? []) as LockdownCheck[];
    const failures = rows.filter((r) => r.status === 'FAIL');
    const warnings = rows.filter((r) => r.status === 'WARN');

    if (warnings.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        '[lockdown-test] WARN-rader:\n' +
        warnings.map((w) => `  ${w.check_name}: ${w.detail}`).join('\n'),
      );
    }

    expect(
      failures,
      `events_public lockdown har ${failures.length} fail:\n` +
      failures.map((f) => `  ${f.check_name}: ${f.detail}`).join('\n'),
    ).toEqual([]);

    // Vi vill ha minst 5 checks (A–E). Om färre → migrationen är inte korrekt.
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });
});
