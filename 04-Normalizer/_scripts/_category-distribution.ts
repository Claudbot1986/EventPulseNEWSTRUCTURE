/**
 * _category-distribution.ts — verifiering efter retag-batch.
 *
 * Körs efter migration för att verifiera slutresultatet.
 * Skriver en tabell till stdout + en markdown-rapport till vault.
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

async function main() {
  const counts = new Map<string, number>();
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select('category_slug')
      .range(offset, offset + 999);
    if (error) throw error;
    if (data && data.length > 0) {
      for (const row of data) {
        const slug = (row as { category_slug: string | null }).category_slug ?? '(null)';
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
      }
      offset += data.length;
      hasMore = data.length === 1000;
    } else hasMore = false;
  }

  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  const communityN = counts.get('community') ?? 0;
  const communityPct = total > 0 ? (100 * communityN) / total : 0;

  console.log(`\nTotal events: ${total}`);
  console.log(`Community bucket: ${communityN} (${communityPct.toFixed(1)} %)\n`);
  console.log('Per category:');
  for (const [slug, n] of Array.from(counts.entries()).sort((a, b) => b[1] - a[1])) {
    const pct = total > 0 ? (100 * n) / total : 0;
    console.log(`  ${slug.padEnd(22)} ${String(n).padStart(5)}  (${pct.toFixed(1)} %)`);
  }

  // Top-3 concentration
  const top3 = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .reduce((acc, [, n]) => acc + n, 0);
  const top3Pct = total > 0 ? (100 * top3) / total : 0;
  console.log(`\nTop-3 concentration: ${top3Pct.toFixed(1)} % (target: < 60 %)`);

  // Verdict
  console.log(`\n── VERDICT ──`);
  console.log(`community ≤ 5 % target: ${communityPct <= 5 ? '✅' : '❌'} (${communityPct.toFixed(1)} %)`);
  console.log(`top-3 ≤ 60 % target:    ${top3Pct <= 60 ? '✅' : '❌'} (${top3Pct.toFixed(1)} %)`);

  // Markdown report to vault
  const md = `# Category distribution after retag-batch

**Date:** 2026-10-01
**Migration:** \`05-Supabase/migrations/2026-10-01-0001-retag-community-batch-dry-run.sql\`

| Slug | Count | Pct |
|---|---:|---:|
${Array.from(counts.entries())
  .sort((a, b) => b[1] - a[1])
  .map(([slug, n]) => {
    const pct = total > 0 ? (100 * n) / total : 0;
    return `| ${slug} | ${n} | ${pct.toFixed(1)} % |`;
  })
  .join('\n')}

**Total:** ${total}
**community:** ${communityN} (${communityPct.toFixed(1)} %)
**Top-3:** ${top3Pct.toFixed(1)} %
`;
  await mkdir('00-Vault/01-Projects/EventPulse/04-Sources', { recursive: true });
  await writeFile(
    '00-Vault/01-Projects/EventPulse/04-Sources/category-distribution-2026-10-01.md',
    md,
  );
  console.log('\n✅ Wrote report to 00-Vault/01-Projects/EventPulse/04-Sources/category-distribution-2026-10-01.md');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
