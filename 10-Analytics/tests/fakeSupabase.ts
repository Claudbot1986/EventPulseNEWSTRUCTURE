/**
 * fakeSupabase.ts — minimal in-memory fake of the supabase-js query
 * builder, covering only the surface 10-Analytics/storage.ts uses:
 *
 *   insert(values)                                 → { error }
 *   select(cols).gte/.order/.range(...)            → { data, error }
 *   select('id', { count:'exact', head:true })     → { count, error }
 *   delete().eq/.lt(...).select('id')              → { data, error }
 *
 * Not a general supabase-js mock — throws on unknown tables so a typo
 * in the table name fails loudly instead of passing silently.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoredEvent } from '../analytics.js';

export type FakeRow = StoredEvent & { id?: number };

export interface FakeSupabaseOptions {
  failInsert?: boolean;
  failSelect?: boolean;
  failDelete?: boolean;
}

type Filter = (r: FakeRow) => boolean;

function makeFilter(op: string, col: string, val: unknown): Filter {
  const get = (r: FakeRow) => String((r as unknown as Record<string, unknown>)[col] ?? '');
  const target = String(val);
  switch (op) {
    case 'eq':
      return (r) => (r as unknown as Record<string, unknown>)[col] === val;
    case 'gte':
      return (r) => get(r) >= target;
    case 'lt':
      return (r) => get(r) < target;
    default:
      throw new Error(`fakeSupabase: unsupported filter ${op}`);
  }
}

export interface FakeSupabaseOptions {
  failInsert?: boolean;
  failSelect?: boolean;
  failDelete?: boolean;
}

/** The fake's public face (what tests keep a handle on). */
export type FakeSupabase = ReturnType<typeof makeFakeSupabase>;

export function makeFakeSupabase(opts: FakeSupabaseOptions = {}) {
  const rows: FakeRow[] = [];
  let nextId = 1;

  function selectBuilder() {
    const filters: Filter[] = [];
    let order: { col: string; asc: boolean } | null = null;
    let range: [number, number] | null = null;

    const b = {
      gte(col: string, val: unknown) {
        filters.push(makeFilter('gte', col, val));
        return b;
      },
      lt(col: string, val: unknown) {
        filters.push(makeFilter('lt', col, val));
        return b;
      },
      eq(col: string, val: unknown) {
        filters.push(makeFilter('eq', col, val));
        return b;
      },
      order(col: string, o?: { ascending?: boolean }) {
        order = { col, asc: o?.ascending !== false };
        return b;
      },
      range(from: number, to: number) {
        range = [from, to];
        return Promise.resolve(finish());
      },
    };

    function finish(): { data: FakeRow[] | null; error: { message: string } | null } {
      if (opts.failSelect) return { data: null, error: { message: 'select failed (fake)' } };
      let out = rows.filter((r) => filters.every((f) => f(r)));
      if (order) {
        const { col, asc } = order;
        out = [...out].sort((x, y) => {
          const a = String((x as unknown as Record<string, unknown>)[col]);
          const c = String((y as unknown as Record<string, unknown>)[col]);
          if (a === c) return 0;
          if (asc) return a < c ? -1 : 1;
          return a < c ? 1 : -1;
        });
      }
      // PostgREST range() is inclusive on both ends.
      if (range) out = out.slice(range[0], range[1] + 1);
      return { data: out.map((r) => ({ ...r })), error: null };
    }

    return b;
  }

  function deleteBuilder() {
    const filters: Filter[] = [];
    const b = {
      eq(col: string, val: unknown) {
        filters.push(makeFilter('eq', col, val));
        return b;
      },
      lt(col: string, val: unknown) {
        filters.push(makeFilter('lt', col, val));
        return b;
      },
      select() {
        if (opts.failDelete) {
          return Promise.resolve({ data: null, error: { message: 'delete failed (fake)' } });
        }
        const removed = rows.filter((r) => filters.every((f) => f(r)));
        for (const r of removed) {
          const i = rows.indexOf(r);
          if (i >= 0) rows.splice(i, 1);
        }
        return Promise.resolve({ data: removed.map((r) => ({ ...r })), error: null });
      },
    };
    return b;
  }

  const client = {
    /** Direct access for assertions. */
    __rows: rows,
    from(table: string) {
      if (table !== 'analytics_events') {
        throw new Error(`fakeSupabase: unknown table ${table}`);
      }
      return {
        insert(values: unknown) {
          if (opts.failInsert) {
            return Promise.resolve({ error: { message: 'insert failed (fake)' } });
          }
          const list = Array.isArray(values) ? values : [values];
          for (const v of list) {
            rows.push({ ...(v as Record<string, unknown>), id: nextId++ } as FakeRow);
          }
          return Promise.resolve({ error: null });
        },
        select(...args: unknown[]) {
          const maybe = args[1] as { count?: string; head?: boolean } | undefined;
          if (maybe?.head) {
            if (opts.failSelect) {
              return Promise.resolve({ count: null, error: { message: 'count failed (fake)' } });
            }
            return Promise.resolve({ count: rows.length, error: null });
          }
          return selectBuilder();
        },
        delete() {
          return deleteBuilder();
        },
      };
    },
  };

  return client as unknown as typeof client & { __rows: FakeRow[] } & SupabaseClient;
}