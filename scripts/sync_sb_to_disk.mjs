#!/usr/bin/env node
/**
 * scripts/sync_sb_to_disk.mjs
 *
 * Synka Supabase `image_library`-tabellen med lokal disk:
 *   - Disk är sanningen
 *   - SB-poster utan motsvarande disk-fil → DELETE
 *   - Disk-filer utan SB-post → INSERT
 *   - Raderar INGENTING på lokal disk
 *
 * Schema (Supabase image_library):
 *   id (uuid), storage_path (text), public_url, category_slug, venue_pattern,
 *   tags (text[]), source_event_id, times_used, last_used_at, rating,
 *   approved_by, added_at, updated_at, cluster_tags (text[])
 *
 * Disk: local_image_library_stamped/<cat>/zoom_<cat>_<slug>_<pose>_<light>_<runTag>_<idx>.webp
 * + .webp.json metadata-fil med category, cluster_tag, zoomId, pose, light, created_at
 *
 * Matchning: diskfilnamn ↔ storage_path (utan 'event-posters/import-stamped/' prefix).
 *
 * Kör: node scripts/sync_sb_to_disk.mjs [--dry-run]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const URL = readFileSync(".env", "utf8").match(/SUPABASE_URL=(.+)/)?.[1].trim();
const KEY = readFileSync(".env", "utf8").match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1].trim();
const DRY_RUN = process.argv.includes("--dry-run");

const STAMPED_DIR = join(process.cwd(), "local_image_library_stamped");

async function sbFetch(path, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch(`${URL}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(options.headers ?? {}),
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return r;
  } catch (e) {
    throw new Error(`fetch ${path}: ${e.message}`);
  }
}

async function fetchAllSbRows() {
  const PAGE = 1000;
  let offset = 0;
  const all = [];
  while (true) {
    const r = await sbFetch(
      `image_library?select=id,storage_path,category_slug,cluster_tags,tags&offset=${offset}&limit=${PAGE}`,
    );
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`SB fetch failed: ${r.status} ${txt.slice(0, 200)}`);
    }
    const rows = await r.json();
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
    if (all.length > 100_000) {
      console.error(`Säkerhetsgräns 100000 nådd — avbryter`);
      break;
    }
  }
  return all;
}

function walkDisk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDisk(p));
    else if (entry.name.endsWith(".webp.json")) out.push(p);
  }
  return out;
}

function fileBase(p) {
  let rel = p.replace(process.cwd() + "/", "");
  if (rel.startsWith("local_image_library_stamped/"))
    rel = rel.slice("local_image_library_stamped/".length);
  if (rel.endsWith(".webp.json")) rel = rel.slice(0, -".webp.json".length);
  return rel;
}

function sbStorageBase(sp) {
  if (!sp) return null;
  // SB storage_path-format: event-posters/import-stamped/<cat>/<filename>.webp
  // Matchar disk path-format: <cat>/<filename> (.webp)
  let s = sp;
  // Ta bort bucket-prefix (första path-segment som slutar på /)
  s = s.replace(/^[^/]+\/[^/]+\//, "");
  // Ta bort .webp-suffix
  if (s.endsWith(".webp")) s = s.slice(0, -5);
  return s;
}

async function main() {
  console.log(`=== SB ↔ DISK SYNC (dry-run=${DRY_RUN}) ===\n`);

  console.log(`Disk: läser ${STAMPED_DIR}…`);
  const diskFiles = walkDisk(STAMPED_DIR);
  console.log(`  ${diskFiles.length} .webp.json-filer\n`);

  console.log(`SB: läser image_library…`);
  const sbRows = await fetchAllSbRows();
  console.log(`  ${sbRows.length} rader\n`);

  // Disk map: fileBase(jsonPath) → json-content
  const diskMap = new Map();
  for (const f of diskFiles) {
    const k = fileBase(f);
    diskMap.set(k, {
      jsonPath: f,
      json: JSON.parse(readFileSync(f, "utf8")),
    });
  }

  // SB map: storage_base → row
  const sbMap = new Map();
  for (const row of sbRows) {
    const k = sbStorageBase(row.storage_path);
    if (k) sbMap.set(k, row);
  }

  // SB-poster vars storage_path-base INTE finns på disk
  const sbExtra = [];
  for (const [k, row] of sbMap.entries()) {
    if (!diskMap.has(k)) sbExtra.push(row);
  }

  // Disk-filer vars fileBase INTE finns i SB
  const diskExtra = [];
  for (const [k, v] of diskMap.entries()) {
    if (!sbMap.has(k)) diskExtra.push(v);
  }

  console.log(`=== ANALYS ===`);
  console.log(`  Match: ${sbRows.length - sbExtra.length}`);
  console.log(`  SB-extra (radering): ${sbExtra.length}`);
  console.log(`  Disk-extra (insert): ${diskExtra.length}\n`);

  if (sbExtra.length > 0) {
    console.log(`SB-EXTRA EXEMPEL (första 5):`);
    sbExtra.slice(0, 5).forEach((r) =>
      console.log(`  id=${r.id.slice(0, 8)}  storage_path=${r.storage_path}  category=${r.category_slug}`),
    );
    console.log();
  }
  if (diskExtra.length > 0) {
    console.log(`DISK-EXTRA EXEMPEL (första 5):`);
    diskExtra
      .slice(0, 5)
      .forEach((v) =>
        console.log(`  ${v.jsonPath.replace(process.cwd() + "/", "")}  cat=${v.json.category}`),
      );
    console.log();
  }

  if (DRY_RUN) {
    console.log(`[DRY-RUN] Inga ändringar utförda. Kör utan --dry-run för att verkställa.`);
    return;
  }

  console.log(`=== UTFÖR SYNC ===\n`);

  // 1. Radera SB-extra
  let deleted = 0;
  if (sbExtra.length > 0) {
    const ids = sbExtra.map((r) => r.id);
    console.log(`  Tar bort ${ids.length} SB-extra…`);
    // Radera i batcher om 100
    const BS = 100;
    for (let i = 0; i < ids.length; i += BS) {
      const chunk = ids.slice(i, i + BS);
      const inList = chunk.map((id) => `"${id}"`).join(",");
      const r = await sbFetch(`image_library?id=in.(${inList})`, { method: "DELETE" });
      if (r.ok) {
        deleted += chunk.length;
      } else {
        const txt = await r.text();
        console.log(`  FAIL: ${r.status} ${txt.slice(0, 200)}`);
      }
    }
    console.log(`  ✓ ${deleted} borttagna\n`);
  }

  // 2. INSERT disk-extra
  let inserted = 0;
  if (diskExtra.length > 0) {
    const rows = diskExtra.map((v) => {
      const j = v.json;
      const fb = fileBase(v.jsonPath);
      return {
        storage_path: `event-posters/import-stamped/${fb}.webp`,
        public_url: `https://placeholder.local/${fb}.webp`,
        category_slug: j.category,
        tags: ["minimax", "image-01", "zoom-variation", "stamped-2026-10-21"],
        cluster_tags: [j.cluster_tag].filter(Boolean),
        times_used: 0,
        rating: 3,
        approved_by: "auto",
        added_at: j.created_at ?? new Date().toISOString(),
      };
    });
    console.log(`  INSERTar ${rows.length} nya rader i SB…`);
    const BS = 100;
    for (let i = 0; i < rows.length; i += BS) {
      const chunk = rows.slice(i, i + BS);
      const r = await sbFetch("image_library", {
        method: "POST",
        body: JSON.stringify(chunk),
      });
      if (r.ok) {
        inserted += chunk.length;
      } else {
        const txt = await r.text();
        console.log(`  FAIL: ${r.status} ${txt.slice(0, 200)}`);
      }
    }
    console.log(`  ✓ ${inserted} tillagda\n`);
  }

  console.log(`=== SYNC KLAR ===`);
  console.log(`  Borttagna: ${deleted}`);
  console.log(`  Tillagda: ${inserted}`);
  console.log(`  SB borde nu ha ${sbRows.length - deleted + inserted} rader`);
  console.log(`  Disk har ${diskFiles.length} filer (oförändrat)`);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  console.error(e.stack);
  process.exit(1);
});
