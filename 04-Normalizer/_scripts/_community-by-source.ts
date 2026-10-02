/**
 * _community-by-source.ts — identify sources with high community-rate
 * (candidates for sourceCategoryDefaults entries).
 *
 * Uses Generalization Protection Rule: only flag sources where ≥ 50 % of
 * events from that source are STILL in community after our retag.
 *
 * Output: stdout table + markdown report to vault.
 */
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { createClient } from '@supabase/supabase-js';

for (const candidate of [process.cwd(), resolve(process.cwd(), '..'), resolve(process.cwd(), '../..')]) {
  dotenvConfig({ path: resolve(candidate, '.env') });
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface AggRow { source: string; category_slug: string; n: number }

async function main() {
  // Aggregate counts by (source, category_slug)
  const rows: AggRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select('source, category_slug')
      .range(offset, offset + 999);
    if (error) throw error;
    if (data && data.length > 0) {
      for (const r of data as Array<{ source: string | null; category_slug: string | null }>) {
        rows.push({
          source: r.source ?? '(null)',
          category_slug: r.category_slug ?? '(null)',
          n: 1,
        });
      }
      offset += data.length;
      hasMore = data.length === 1000;
    } else hasMore = false;
  }

  // Aggregate
  const bySourceTotal = new Map<string, number>();
  const bySourceCat = new Map<string, Map<string, number>>();
  for (const r of rows) {
    bySourceTotal.set(r.source, (bySourceTotal.get(r.source) ?? 0) + 1);
    if (!bySourceCat.has(r.source)) bySourceCat.set(r.source, new Map());
    const m = bySourceCat.get(r.source)!;
    m.set(r.category_slug, (m.get(r.category_slug) ?? 0) + 1);
  }

  // For each source: how many community events, what % of total
  const communityBySource: Array<{ source: string; total: number; community: number; pct: number }> = [];
  for (const [source, total] of bySourceTotal.entries()) {
    const community = bySourceCat.get(source)?.get('community') ?? 0;
    const pct = total > 0 ? (100 * community) / total : 0;
    communityBySource.push({ source, total, community, pct });
  }
  communityBySource.sort((a, b) => b.community - a.community);

  console.log('\n── Top 30 sources by community-event count ──');
  console.log('Source'.padEnd(35) + 'Total'.padStart(8) + 'Community'.padStart(12) + '%'.padStart(8));
  for (const r of communityBySource.slice(0, 30)) {
    console.log(
      r.source.padEnd(35) +
      String(r.total).padStart(8) +
      String(r.community).padStart(12) +
      r.pct.toFixed(1).padStart(8),
    );
  }

  // Flag sources where ≥ 50 % are community AND total ≥ 10 events
  console.log('\n── Candidates for new sourceCategoryDefaults entries (≥ 50 % community, ≥ 10 events) ──');
  const candidates = communityBySource.filter((r) => r.pct >= 50 && r.total >= 10 && r.community >= 10);
  if (candidates.length === 0) {
    console.log('  (none — community is well-distributed across remaining sources)');
  } else {
    for (const c of candidates) {
      console.log(`  ${c.source.padEnd(35)} ${c.community}/${c.total}  (${c.pct.toFixed(1)} %)`);
    }
  }

  // Markdown report
  const md = `# Community events by source (after retag-batch)

**Date:** 2026-10-01
**Total events:** ${rows.length}
**Community total:** ${communityBySource.reduce((a, b) => a + b.community, 0)}

## Top 30 sources by community-event count

| Source | Total | Community | % |
|---|---:|---:|---:|
${communityBySource.slice(0, 30).map((r) => `| ${r.source} | ${r.total} | ${r.community} | ${r.pct.toFixed(1)} % |`).join('\n')}

## Candidates for new sourceCategoryDefaults entries

${candidates.length === 0 ? '_None — community is well-distributed across remaining sources._' : candidates.map((c) => `- \`${c.source}\`: ${c.community}/${c.total} (${c.pct.toFixed(1)} %) — needs source-by-source analysis to determine if a single default category fits ≥ 50 %.`).join('\n')}
`;
  await mkdir('00-Vault/01-Projects/EventPulse/04-Sources', { recursive: true });
  await writeFile(
    '00-Vault/01-Projects/EventPulse/04-Sources/community-by-source-2026-10-01.md',
    md,
  );
  console.log('\n✅ Wrote 00-Vault/01-Projects/EventPulse/04-Sources/community-by-source-2026-10-01.md');
}

main().catch((e) => { console.error(e); process.exit(1); });
