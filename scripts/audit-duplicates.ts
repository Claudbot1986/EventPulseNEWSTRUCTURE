/**
 * audit-duplicates.ts — hitta och slå ihop dubbletter i events-tabellen.
 *
 * ROTSAK (2026-10-30): appen visade flera eventkort för samma evenemang.
 * Mätta orsaker: `dedup_hash` är källbunden (`sha256(source::source_id)`),
 * så den kan aldrig fånga samma evenemang från två källor; `ticket_url`
 * kräver identisk url-sträng; `canonical_event_id` var NULL på 99,5 % av
 * raderna. Se 05-Supabase/migrations/20261030-0001-events-event-identity.sql.
 *
 * SKRIPTET GÖR TRE SAKER
 *
 *   1. BACKFILL `event_identity` på alla rader. Utan den har normalizern
 *      ingen indexerad nyckel att slå upp vid write-time-dedup.
 *   2. RAPPORTER dubblettgrupper (grupperingsreglerna ligger i
 *      04-Normalizer/deduplication/duplicateGroups.ts — samma modul som
 *      normalizern använder, så mätning och produktion inte kan glida).
 *   3. SLÅ IHOP (--apply): flyttar beroende rader till huvudraden och
 *      sätter `merged_into` på dubbletten. `events_public` döljer rader
 *      med `merged_into IS NULL` → appen visar ett kort per evenemang.
 *
 * ANVÄNDNING
 *   npx tsx scripts/audit-duplicates.ts                 # rapport (skriver inga dubbletter)
 *   npx tsx scripts/audit-duplicates.ts --apply         # slå ihop + migrera beroende rader
 *   npx tsx scripts/audit-duplicates.ts --apply --dry   # visa vad som WOULD slås ihop
 *   npx tsx scripts/audit-duplicates.ts --json <fil>    # skriv rapporten som JSON
 *   npx tsx scripts/audit-duplicates.ts --limit 200     # bara de N största grupperna i rapporten
 *
 * EXIT-KOD: 0 = inga dubbletter kvar, 1 = dubbletter kvar (CI-gate),
 *            2 = fel.
 *
 * Detta är ett OPERATÖRSVERKTYG: det räknar på riktiga rader i den riktiga
 * databasen. Inga syntetiska event, inga simulerade utdata.
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { Client } from 'pg';
import {
  groupDuplicateEvents,
  duplicateExtras,
  type DuplicateGroup,
} from '../04-Normalizer/deduplication/duplicateGroups';
import {
  crossSourceIdentity,
  normalizeIdentityTitle,
  normalizeIdentityTitleWithVenue,
  stockholmLocalDateTime,
} from '../04-Normalizer/deduplication/crossSourceIdentity';

// ── Argument ───────────────────────────────────────────────────────────────

interface Args {
  apply: boolean;
  dry: boolean;
  gate: boolean;
  json?: string;
  limit: number;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, dry: false, gate: false, limit: 25, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--dry') args.dry = true;
    else if (a === '--gate') args.gate = true;
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--json') {
      // Värdet får inte vara en flagga — annars skrivs rapporten till en
      // fil som heter "--limit" (eller liknande).
      const next = argv[++i];
      if (!next || next.startsWith('--')) {
        console.error('[audit] --json kräver en filsökväg');
        process.exit(2);
      }
      args.json = next;
    } else if (a === '--limit') args.limit = Number(argv[++i] ?? 25);
    else if (a === '--help' || a === '-h') {
      console.log(
        [
          'audit-duplicates.ts — hitta och slå ihop dubbletter',
          '',
          '  --apply        slå ihop dubbletter (flyttar beroende rader, sätter merged_into)',
          '  --dry          med --apply: visa vad som skulle slås ihop, skriv inget',
          '  --gate         CI-gate: exit 1 om det finns dubbletter kvar (rapporterar bara)',
          '  --json <fil>   skriv rapporten som JSON',
          '  --limit <n>    antal grupper i textrapporten (default 25)',
          '  --quiet        bara sammanfattningen',
        ].join('\n'),
      );
      process.exit(0);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

/**
 * Formatera en tidsstämpel (string | Date | null) som "YYYY-MM-DD HH:MM".
 *
 * Tidsreferens: Europe/Stockholm — samma som identitetsreglerna använder.
 * En tidigare version skrev ut UTC, vilket gjorde att rapporten visade
 * en timme tidigare än vad appen visar. Rapporten ska spegla verkligheten.
 */
function fmtTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const dt = stockholmLocalDateTime(v);
  if (!dt) return '—';
  return dt.time ? `${dt.day} ${dt.time}` : `${dt.day} --:--`;
}

/** Formatera en tidsstämpel som "HH:MM" i Europe/Stockholm. */
function fmtClock(v: string | Date | null | undefined): string {
  if (!v) return '--:--';
  const dt = stockholmLocalDateTime(v);
  if (!dt || !dt.time) return '--:--';
  return dt.time;
}

// ── DB ─────────────────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  source: string | null;
  source_id: string | null;
  title_sv: string | null;
  title_en: string | null;
  start_time: string | null;
  venue_id: string | null;
  venue_full_name: string | null;
  venue_address: string | null;
  ticket_url: string | null;
  merged_into: string | null;
  event_identity: string | null;
  description_sv: string | null;
  description_en: string | null;
  image_url: string | null;
  category_slug: string | null;
  status: string | null;
  /** 'dead' = källans sida finns inte längre; raden är osynlig i events_public. */
  link_status: string | null;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set in .env');
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    // ── Hämta events ──────────────────────────────────────────────────────
    const rows: EventRow[] = [];
    let offset = 0;
    const PAGE = 1000;
    for (;;) {
      const res = await client.query(
        `SELECT e.id, e.source, e.source_id, e.title_sv, e.title_en, e.start_time,
                e.venue_id, e.venue_full_name, v.address AS venue_address,
                e.ticket_url, e.merged_into, e.event_identity,
                e.description_sv, e.description_en, e.image_url, e.category_slug, e.status,
                e.link_status
           FROM events e
           LEFT JOIN venues v ON v.id = e.venue_id
          WHERE e.status = 'published'
          ORDER BY e.id
          LIMIT $1 OFFSET $2`,
        [PAGE, offset],
      );
      rows.push(...(res.rows as EventRow[]));
      if (res.rows.length < PAGE) break;
      offset += PAGE;
    }
    if (!args.quiet) {
      console.log(`[audit] ${rows.length} publicerade events lästa`);
    }

    // ── 1. Backfill event_identity ───────────────────────────────────────
    // Utan detta har normalizern ingen indexerad nyckel att slå upp, och
    // audit-skriptet och normalizern räknar på olika nycklar.
    const identityUpdates: Array<{ id: string; event_identity: string | null }> = [];
    for (const r of rows) {
      const identity = crossSourceIdentity({
        title: r.title_sv || r.title_en,
        startTime: r.start_time,
        venueId: r.venue_id,
        venueName: r.venue_full_name,
      });
      if (identity !== r.event_identity) {
        identityUpdates.push({ id: r.id, event_identity: identity });
      }
    }
    if (identityUpdates.length > 0) {
      if (!args.quiet) {
        console.log(`[audit] backfill event_identity på ${identityUpdates.length} rad(er)`);
      }
      if (!args.dry) {
        // Batched: en UPDATE per 500 rader. 16 309 enskilda UPDATE-satser
        // tog över en minut; detta tar några sekunder.
        const BATCH = 500;
        await client.query('BEGIN');
        try {
          for (let i = 0; i < identityUpdates.length; i += BATCH) {
            const chunk = identityUpdates.slice(i, i + BATCH);
            const values: string[] = [];
            const params: unknown[] = [];
            chunk.forEach((u, idx) => {
              const idParam = `$${idx * 2 + 1}`;
              const valParam = `$${idx * 2 + 2}`;
              values.push(`(${idParam}::uuid, ${valParam}::text)`);
              params.push(u.id, u.event_identity);
            });
            await client.query(
              `UPDATE events e SET event_identity = v.event_identity
                 FROM (VALUES ${values.join(', ')}) AS v(id, event_identity)
                WHERE e.id = v.id`,
              params,
            );
          }
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    }

    // ── 2. Gruppera ───────────────────────────────────────────────────────
    // Bara rader som är SYNLIGA (merged_into IS NULL) grupperas. Redan
    // sammanslagna rader är ute ur bilden — annars skulle mergeen köra om
    // sig själv och ibland välja en annan huvudrad.
    const visibleRows = rows.filter((r) => !r.merged_into);
    const groupable = visibleRows.map((r) => ({
      id: r.id,
      source: r.source ?? '',
      title: r.title_sv || r.title_en,
      startTime: r.start_time,
      venueId: r.venue_id,
      venueName: r.venue_full_name,
      venueAddress: r.venue_address,
      ticketUrl: r.ticket_url,
    }));
    const groups = groupDuplicateEvents(groupable);
    const extras = duplicateExtras(groups);

    const byRule = new Map<string, number>();
    for (const g of groups) for (const rule of g.rules) byRule.set(rule, (byRule.get(rule) ?? 0) + 1);

    // ── 3. Sammanfattning ─────────────────────────────────────────────────
    if (!args.quiet) {
      console.log('');
      console.log('═══ DUBBLETT-AUDIT ═══');
      console.log(`grupper            : ${groups.length}`);
      console.log(`extra rader        : ${extras}`);
      console.log(`rader i grupper    : ${groups.reduce((s, g) => s + g.members.length, 0)}`);
      console.log(
        `per regel          : ${[...byRule.entries()].map(([k, v]) => `${k}=${v}`).join('  ')}`,
      );
      console.log('');
      const sorted = [...groups].sort((a, b) => b.members.length - a.members.length);
      console.log(`─── ${Math.min(args.limit, sorted.length)} största grupperna ───`);
      for (const g of sorted.slice(0, args.limit)) {
        const first = g.members[0];
        console.log(
          `\n[${g.members.length}x] "${(first.title ?? '').slice(0, 60)}" ` +
            `${fmtTime(first.startTime)} regler=${g.rules.join('+')}`,
        );
        for (const m of g.members) {
          console.log(
            `    ${fmtClock(m.startTime)} src=${(m.source ?? '').padEnd(24)} ` +
              `id=${m.id.slice(0, 8)} url=${(m.ticketUrl ?? 'NULL').slice(0, 44)}`,
          );
        }
      }
    }

    // ── 4. Slå ihop ───────────────────────────────────────────────────────
    let merged = 0;
    if (args.apply && !args.dry && groups.length > 0) {
      merged = await mergeGroups(client, groups, rows, args.quiet);
    } else if (args.apply && args.dry) {
      merged = groups.reduce((s, g) => s + g.members.length - 1, 0);
      if (!args.quiet) {
        console.log('');
        console.log(`[audit] --dry: skulle slå ihop ${merged} rader (inget skrivet)`);
      }
    }

    // ── 5. JSON-rapport ───────────────────────────────────────────────────
    if (args.json) {
      const path = resolve(args.json);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            eventsScanned: rows.length,
            groups: groups.length,
            extraRows: extras,
            rulesPerGroup: Object.fromEntries(byRule),
            mergedRows: merged,
            detail: [...groups]
              .sort((a, b) => b.members.length - a.members.length)
              .slice(0, args.limit)
              .map((g) => ({
                rules: g.rules,
                members: g.members.map((m) => ({
                  id: m.id,
                  source: m.source,
                  title: m.title,
                  startTime: m.startTime,
                  ticketUrl: m.ticketUrl,
                })),
              })),
          },
          null,
          2,
        ),
      );
      if (!args.quiet) console.log(`[audit] rapport skriven: ${path}`);
    }

    // ── 6. Verifiera resultatet ───────────────────────────────────────────
    if (args.apply && !args.dry) {
      const after = await client.query(
        `SELECT count(*)::int AS n FROM events WHERE status='published' AND merged_into IS NOT NULL`,
      );
      const visible = await client.query(
        `SELECT count(*)::int AS n FROM events_public`,
      );
      console.log('');
      console.log(`[audit] sammanslagna rader i events   : ${after.rows[0].n}`);
      console.log(`[audit] synliga rader i events_public : ${visible.rows[0].n}`);
    }

    // ── 7. Exit-kod ───────────────────────────────────────────────────────
    // Gate: efter en apply ska det inte finnas kvar någon dubblettgrupp.
    if (args.apply && !args.dry) {
      const check = await client.query(
        `SELECT count(*)::int AS n FROM (
           SELECT e.event_identity
             FROM events e
            WHERE e.status='published' AND e.merged_into IS NULL
              AND e.link_status IS DISTINCT FROM 'dead'
              AND e.event_identity IS NOT NULL
            GROUP BY e.event_identity
           HAVING count(*) > 1) g`,
      );
      const remaining = check.rows[0].n;
      if (remaining > 0) {
        console.error(`[audit] FEL: ${remaining} dubblettgrupper kvar efter merge`);
        process.exitCode = 1;
        return;
      }
      console.log('[audit] OK: inga dubblettgrupper kvar');
    }

    // --gate: CI-gate. Bara rapportera, aldrig mutera. Exit 1 om det finns
    // dubbletter kvar bland de rader som är synliga i events_public.
    if (args.gate) {
      const visible = await client.query(
        `SELECT count(*)::int AS n FROM (
           SELECT e.event_identity
             FROM events e
            WHERE e.status='published' AND e.merged_into IS NULL
              AND e.link_status IS DISTINCT FROM 'dead'
              AND e.event_identity IS NOT NULL
            GROUP BY e.event_identity
           HAVING count(*) > 1) g`,
      );
      const dupCount = visible.rows[0].n;
      if (dupCount > 0) {
        console.error(
          `[audit] GATE FAIL: ${dupCount} dubblettgrupper kvar bland synliga events ` +
            `(${groups.length} grupper / ${extras} extra rader).`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(`[audit] GATE OK: inga dubblettgrupper (${rows.length} events skannade)`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Bär radens titel ett trailing platsnamn ("Terra – Garden")?
 *
 * Samma definition som identitetsnyckeln använder — annars skulle
 * merge-vinnare och identitetsnyckel räkna på olika titlar.
 */
function titleCarriesVenue(r: {
  title_sv?: string | null;
  title_en?: string | null;
  venue_full_name?: string | null;
}): boolean {
  const title = r.title_sv || r.title_en;
  if (!title) return false;
  return (
    normalizeIdentityTitleWithVenue(title, r.venue_full_name) !==
    normalizeIdentityTitle(title)
  );
}

/**
 * Slå ihop dubblettgrupper.
 *
 * För varje grupp:
 *   1. Välj huvudrad (den mest kompletta).
 *   2. Flytta beroende rader till huvudraden: event_categories,
 *      event_translations, user_favorites, user_interactions.
 *   3. Sätt `merged_into` på dubbletten → den döljs ur events_public.
 *
 * Raderna tas INTE bort: spåret finns kvar och mergeen är reversibel
 * (`UPDATE events SET merged_into = NULL`).
 */
async function mergeGroups(
  client: Client,
  groups: DuplicateGroup<{
    id: string;
    source: string;
    title: string | null;
    startTime: string | Date | null;
    venueId: string | null;
    venueName: string | null;
    ticketUrl: string | null;
  }>[],
  rows: EventRow[],
  quiet: boolean,
): Promise<number> {
  const rowById = new Map(rows.map((r) => [r.id, r]));

  // ── Välj huvudrad per grupp ────────────────────────────────────────────
  // Mest komplett vinner: beskrivning, bild, kategori, titel, plats.
  //
  // TIEBREAK: en rad vars titel BÄR platsnamnet ("Terra – Garden") är sämre
  // som visningstitel än en rad med ren titel ("Terra") — appen visar
  // platsen i ett eget fält, så suffixet blir ren informationsduplicering.
  // Mätt 2026-10-30: spelning-se skriver alltid "<evenemang> – <plats>" i
  // titeln. Utan tiebreaken vann de raderna (lika poäng → DB-ordningen
  // avgjorde) och appen visade "Terra – Garden · 20:00 · Garden".
  function completeness(r: EventRow): number {
    let score = 0;
    if (r.description_sv?.trim()) score += 3;
    if (r.description_en?.trim()) score += 2;
    if (r.image_url?.trim()) score += 3;
    if (r.category_slug?.trim()) score += 1;
    if (r.title_sv?.trim()) score += 1;
    if (r.venue_full_name?.trim() || r.venue_id) score += 1;
    if (r.ticket_url?.trim()) score += 1;
    if (!titleCarriesVenue(r)) score += 1;
    return score;
  }

  let merged = 0;
  await client.query('BEGIN');
  try {
    // Bygg hela mappningen loser → winner först, sedan görs ALLA
    // beroendeflyttar med set-baserad SQL. En rad-at-a-tag-tid tog ~10 min
    // för 2 079 dubbletter (5 × 2 079 round-trips); detta tar några
    // sekunder.
    const mapping: Array<{ loser: string; winner: string }> = [];
    for (const g of groups) {
      const members = g.members
        .map((m) => rowById.get(m.id))
        .filter((r): r is EventRow => Boolean(r));
      if (members.length < 2) continue;

      // ── En DÖD rad får aldrig vara huvudrad ────────────────────────────
      // `link_status = 'dead'` betyder att källans sida inte längre
      // existerar. Sådana rader är redan osynliga i `events_public` (vyn
      // filtrerar på `link_status IS DISTINCT FROM 'dead'`).
      //
      // Om en död rad vann merge:en skulle ett LEVANDE evenemang försvinna
      // ur appen — den döda raden är ju osynlig. Mätt 2026-10-30: 14 av 57
      // grupper hade ticketmaster-rader med link_status='dead' som vinnare,
      // vilket tog bort 14 riktiga evenemang ur Utforska.
      //
      // Döda rader slås ihop mot den levande huvudraden (de är samma
      // evenemang, bara en stale kopia) — men de kan inte vinna.
      const live = members.filter((r) => (r.link_status ?? '') !== 'dead');
      const deadRows = members.filter((r) => (r.link_status ?? '') === 'dead');
      if (live.length === 0) continue; // bara döda kopior → inget att slå ihop

      // Vilken tid har flest röster i gruppen? Den tiden visas i appen.
      //
      // Källorna är oense om klockslaget ("The Wallflowers" 19:00 hos två
      // källor, 20:00 hos livespot). Att gissa fel tid är sämre än att
      // gissa fel — appen ska visa den tid de flesta källorna anger.
      const timeVotes = new Map<string, number>();
      for (const m of live) {
        const dt = stockholmLocalDateTime(m.startTime);
        if (!dt?.time) continue;
        timeVotes.set(dt.time, (timeVotes.get(dt.time) ?? 0) + 1);
      }
      let modalTime: string | undefined;
      let modalVotes = 0;
      for (const [t, n] of timeVotes) {
        if (n > modalVotes) {
          modalVotes = n;
          modalTime = t;
        }
      }

      const scored = live.map((r) => {
        const dt = stockholmLocalDateTime(r.startTime);
        let score = completeness(r);
        if (modalTime && dt?.time === modalTime && modalVotes > 1) score += 3;
        return { r, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const winner = scored[0].r;
      for (const loser of [...live.filter((r) => r.id !== winner.id), ...deadRows]) {
        mapping.push({ loser: loser.id, winner: winner.id });
      }
    }
    merged = mapping.length;

    // ── Backup före merge ────────────────────────────────────────────────
    // Merge är reversibel via `UPDATE events SET merged_into = NULL`, men
    // bara om vi vet VILKA rader som pekades var. Utan den här filen är
    // en återställning manuell och riskabel.
    //
    // Filen skrivs ALLTID vid --apply (även om ingenting slås ihop) så att
    // en verifieringskörning kan bevisa vad som gjordes.
    if (args.apply && !args.dry) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dir = resolve('runtime/verification-reports/merge-backup');
      mkdirSync(dir, { recursive: true });
      const backupPath = join(dir, `merge-backup-${stamp}.json`);
      const ids = mapping.map((m) => m.loser);
      const { rows: affected } = ids.length
        ? await client.query(
            `SELECT e.id, e.source, coalesce(e.title_sv, e.title_en) AS title,
                    e.start_time, e.venue_full_name, e.link_status
               FROM events e WHERE e.id = ANY($1::uuid[])`,
            [ids],
          )
        : { rows: [] };
      writeFileSync(
        backupPath,
        JSON.stringify(
          {
            at: new Date().toISOString(),
            eventsScanned: rows.length,
            mergedRows: mapping.length,
            mapping: mapping.map((m) => ({ loser: m.loser, winner: m.winner })),
            affectedRows: affected,
            undo: 'UPDATE events SET merged_into = NULL WHERE id = ANY(<loser ids>);',
          },
          null,
          1,
        ),
      );
      console.log(`[audit] backup: ${backupPath} (${mapping.length} rader)`);
    }

    if (mapping.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < mapping.length; i += CHUNK) {
        const chunk = mapping.slice(i, i + CHUNK);
        const values: string[] = [];
        const params: unknown[] = [];
        chunk.forEach((m, idx) => {
          values.push(`($${idx * 2 + 1}::uuid, $${idx * 2 + 2}::uuid)`);
          params.push(m.loser, m.winner);
        });
        const valuesSql = `(VALUES ${values.join(', ')})`;

        // Beroende rader → huvudraden. ON CONFLICT DO NOTHING eftersom
        // huvudraden kan redan ha samma kategori/översättning/favorit.
        await client.query(
          `INSERT INTO event_categories (event_id, category_id)
           SELECT m.winner, ec.category_id
             FROM event_categories ec JOIN ${valuesSql} AS m(loser, winner) ON m.loser = ec.event_id
           ON CONFLICT (event_id, category_id) DO NOTHING`,
          params,
        );
        await client.query(
          `INSERT INTO event_translations (event_id, language, title, description, model, translated_at)
           SELECT m.winner, et.language, et.title, et.description, et.model, et.translated_at
             FROM event_translations et JOIN ${valuesSql} AS m(loser, winner) ON m.loser = et.event_id
           ON CONFLICT (event_id, language) DO NOTHING`,
          params,
        );
        await client.query(
          `INSERT INTO user_favorites (user_id, event_id)
           SELECT uf.user_id, m.winner
             FROM user_favorites uf JOIN ${valuesSql} AS m(loser, winner) ON m.loser = uf.event_id
           ON CONFLICT (user_id, event_id) DO NOTHING`,
          params,
        );
        await client.query(
          `UPDATE user_interactions ui SET event_id = m.winner
             FROM ${valuesSql} AS m(loser, winner) WHERE ui.event_id = m.loser`,
          params,
        );
        await client.query(
          `INSERT INTO event_provenance (id, event_id, source, source_event_id, source_url, raw_payload_ref, fetched_at, confidence)
           SELECT gen_random_uuid(), m.winner, ep.source, ep.source_event_id, ep.source_url, ep.raw_payload_ref, ep.fetched_at, ep.confidence
             FROM event_provenance ep JOIN ${valuesSql} AS m(loser, winner) ON m.loser = ep.event_id`,
          params,
        );
        // Huvudradens pointer: dubbletten pekar på huvudraden.
        await client.query(
          `UPDATE events e SET merged_into = m.winner
             FROM ${valuesSql} AS m(loser, winner) WHERE e.id = m.loser`,
          params,
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  if (!quiet) {
    console.log('');
    console.log(`[audit] slog ihop ${merged} rader (beroende rader flyttade, merged_into satt)`);
  }
  return merged;
}

main().catch((err: unknown) => {
  console.error('[audit] FEL:', err instanceof Error ? err.message : err);
  process.exit(2);
});
