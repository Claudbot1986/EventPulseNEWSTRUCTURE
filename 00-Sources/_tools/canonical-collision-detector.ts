/**
 * canonical-collision-detector.ts
 *
 * Read-only analysverktyg för Fas 3.
 * Genererar collision report från befintliga sources/*.jsonl.
 * SKRIVER INTE till sources/.
 *
 * ANVÄNDNING:
 *   npx tsx 00-Sources/_tools/canonical-collision-detector.ts \
 *     --sources-dir sources/ \
 *     --output 00-Sources/source-identity-collision-report.jsonl
 */

import * as fs from 'fs';
import * as path from 'path';

interface SourceFile {
  filename: string;
  url: string;
  name: string;
  city: string;
  type: string;
  id: string;
  discoveredAt: string;
  discoveredBy: string;
}

interface CollisionGroup {
  sourceIdentityKey: string;
  files: SourceFile[];
  count: number;
  collisionType: 'A' | 'B' | 'C';
  recommendation: 'manual-review' | 'merge' | 'fix';
  notes: string;
}

function normalizeToSiteIdentityKey(url: string): string {
  let u = url.trim();
  u = u.replace(/^https?:\/\//, '');
  u = u.replace(/^www\./, '');
  u = u.split('/')[0] ?? u;
  return u.toLowerCase();
}

function readSources(dir: string): SourceFile[] {
  const sources: SourceFile[] = [];
  if (!fs.existsSync(dir)) {
    console.warn(`Sources dir not found: ${dir}`);
    return sources;
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      if (lines.length === 0) continue;
      const src = JSON.parse(lines[0]);
      sources.push({
        filename: file,
        url: src.url || '',
        name: src.name || '',
        city: src.city || '',
        type: src.type || '',
        id: src.id || '',
        discoveredAt: src.discoveredAt || '',
        discoveredBy: src.discoveredBy || '',
      });
    } catch {}
  }
  return sources;
}

function analyzeCollisions(sources: SourceFile[]): CollisionGroup[] {
  const groups = new Map<string, SourceFile[]>();

  for (const src of sources) {
    if (!src.url) continue;
    const key = normalizeToSiteIdentityKey(src.url);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(src);
  }

  const collisions: CollisionGroup[] = [];

  for (const [key, files] of groups) {
    if (files.length < 2) continue;

    const urls = files.map(f => f.url);
    const uniqueUrls = [...new Set(urls)];

    // Typ C: fel hostname (URL:arna pekar mot olika domains)
    if (uniqueUrls.length > 1) {
      collisions.push({
        sourceIdentityKey: key,
        files,
        count: files.length,
        collisionType: 'C',
        recommendation: 'fix',
        notes: `Olika URLs för samma hostname-grupp: ${uniqueUrls.join(' | ')}`,
      });
      continue;
    }

    // Typ B: samma URL, olika name/city (dubbletter)
    const names = files.map(f => f.name);
    const cities = files.map(f => f.city);
    const uniqueNames = [...new Set(names)];
    const uniqueCities = [...new Set(cities)];

    if (uniqueNames.length === 1 && uniqueCities.length === 1) {
      collisions.push({
        sourceIdentityKey: key,
        files,
        count: files.length,
        collisionType: 'B',
        recommendation: 'merge',
        notes: `Samma venue dubbletter: ${files.map(f => f.filename).join(', ')}`,
      });
    } else {
      collisions.push({
        sourceIdentityKey: key,
        files,
        count: files.length,
        collisionType: 'A',
        recommendation: 'manual-review',
        notes: `Olika venues: names=[${uniqueNames.join('|')}], cities=[${uniqueCities.join('|')}]`,
      });
    }
  }

  return collisions.sort((a, b) => {
    const priority = { C: 0, B: 1, A: 2 };
    return priority[a.collisionType] - priority[b.collisionType];
  });
}

function main() {
  const args = process.argv.slice(2);
  let sourcesDir = 'sources/';
  let outputFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sources-dir' && i + 1 < args.length) {
      sourcesDir = args[++i];
    } else if (args[i] === '--output' && i + 1 < args.length) {
      outputFile = args[++i];
    }
  }

  console.log('=== canonical-collision-detector (read-only) ===\n');
  console.log(`Sources dir: ${sourcesDir}\n`);

  const sources = readSources(sourcesDir);
  console.log(`Read ${sources.length} source files\n`);

  const collisions = analyzeCollisions(sources);
  console.log(`Found ${collisions.length} collision groups\n`);

  // Console report
  for (const c of collisions) {
    console.log(`[${c.collisionType}] ${c.sourceIdentityKey} (${c.count} files)`);
    console.log(`  recommendation: ${c.recommendation}`);
    console.log(`  notes: ${c.notes}`);
    for (const f of c.files) {
      console.log(`    - ${f.filename} | ${f.id} | ${f.name} | ${f.city}`);
    }
    console.log();
  }

  // JSONL output
  if (outputFile) {
    const lines = collisions.map(c => JSON.stringify(c));
    fs.writeFileSync(outputFile, lines.join('\n') + '\n');
    console.log(`Report written to: ${outputFile}`);
  }

  // Summary stats
  const byType = { A: 0, B: 0, C: 0 };
  for (const c of collisions) byType[c.collisionType]++;
  console.log('\n=== Summary ===');
  console.log(`  Type A (manual-review): ${byType.A}`);
  console.log(`  Type B (merge):         ${byType.B}`);
  console.log(`  Type C (fix):           ${byType.C}`);
  console.log(`  Total collision groups: ${collisions.length}`);

  const totalFiles = collisions.reduce((s, c) => s + c.count, 0);
  console.log(`  Total files in collisions: ${totalFiles}`);
}

main();
