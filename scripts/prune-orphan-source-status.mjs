#!/usr/bin/env node
/**
 * scripts/prune-orphan-source-status.mjs
 *
 * Rensar ORPHAN-rader ur `runtime/sources_status.jsonl` — rader vars
 * sourceId inte längre finns i `sources/`-registry (källan arkiverad, bytt
 * namn eller nollställd).
 *
 * ROTORSAK (2026-10-31): filen hade 365 rader medan registry bara har 140
 * källor. 225 orphan-rader låg kvar från äldre körningar och gjorde att
 * räknare som läste filen rakt rapporterade "177 failing sources" när det
 * verkliga antalet aktiva källor som misslyckas var 0. Alla orphan-rader är
 * inerta för kedjan (A-gaten joinar registry × status), men de skräpar ned
 * filen och förvirrar läsare.
 *
 * Säkerhet:
 *   - dry-run som default (skriver ingenting)
 *   - --apply skriver (med backup i runtime/archive/)
 *   - Rader för källor som INTE finns tas bort — de kan inte längre köras
 *     av någon gate, eftersom det är just registryn som avgör vilka källor
 *     som är riktiga.
 *
 * Kör: node scripts/prune-orphan-source-status.mjs [--apply]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const SOURCES_DIR = resolve(PROJECT_ROOT, 'sources');
const STATUS_FILE = resolve(PROJECT_ROOT, 'runtime', 'sources_status.jsonl');
const ARCHIVE_DIR = resolve(PROJECT_ROOT, 'runtime', 'archive');

const isApply = process.argv.includes('--apply');

function registryIds() {
  if (!existsSync(SOURCES_DIR)) return new Set();
  const ids = new Set();
  for (const file of readdirSync(SOURCES_DIR)) {
    if (!file.endsWith('.jsonl')) continue;
    const content = readFileSync(resolve(SOURCES_DIR, file), 'utf8').trim();
    // Multi-line JSON eller JSONL — samma logik som sourceRegistry.getAllSources.
    try {
      const parsed = JSON.parse(content);
      if (parsed?.id) ids.add(parsed.id);
      continue;
    } catch {}
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed?.id) ids.add(parsed.id);
      } catch {}
    }
  }
  return ids;
}

function main() {
  if (!existsSync(STATUS_FILE)) {
    console.error(`[prune] statusfil saknas: ${STATUS_FILE}`);
    process.exit(1);
  }

  const ids = registryIds();
  const lines = readFileSync(STATUS_FILE, 'utf8').split('\n').filter((l) => l.trim());

  const kept = [];
  const dropped = [];
  for (const line of lines) {
    let sourceId = null;
    try {
      sourceId = JSON.parse(line)?.sourceId ?? null;
    } catch {
      sourceId = null;
    }
    if (sourceId && ids.has(sourceId)) kept.push(line);
    else dropped.push(line);
  }

  console.log(`[prune] registry: ${ids.size} källor · statusfil: ${lines.length} rader`);
  console.log(`[prune] behålls: ${kept.length} · orphan tas bort: ${dropped.length}`);

  if (!isApply) {
    console.log('[prune] dry-run — inget skrivet. Kör med --apply.');
    return;
  }

  if (dropped.length === 0) {
    console.log('[prune] inget att rensa — filen är redan ren.');
    return;
  }

  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = resolve(ARCHIVE_DIR, `sources_status.prune-${stamp}.jsonl`);
  copyFileSync(STATUS_FILE, backup);
  console.log(`[prune] backup: ${backup}`);

  writeFileSync(STATUS_FILE, kept.join('\n') + '\n', 'utf8');
  console.log(`[prune] skrev ${kept.length} rader till ${STATUS_FILE}`);
}

main();
