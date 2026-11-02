/**
 * scripts/measure-editorial-rejections.ts
 *
 * DIAGNOSTIK — mäter VILKA claims som faktualitetsgaten underkänner, över ett
 * urval events som FALLBACK till faktmall. Skriver INTE till databasen.
 *
 * Användning:
 *   node --env-file=.env --import tsx scripts/measure-editorial-rejections.ts 30 LOW
 *   node --env-file=.env --import tsx scripts/measure-editorial-rejections.ts 30 MEDIUM
 *
 * Argument 1 = antal events, argument 2 = editorial_info_level att prova.
 * Målet: separera "generisk redaktionell glöd" (som inte påstår något)
 * från "substantiella påståenden" (som MÅSTE underkännas).
 * Skriver INTE till DB.
 */
import { createClient } from '@supabase/supabase-js';
import { MiniMaxM3LlmClient } from '../04-Normalizer/editorial/editorialWriter.ts';
import { runEditorialPipeline } from '../04-Normalizer/editorial/index.ts';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const LIMIT = Number(process.argv[2] || 30);
const LEVEL = process.argv[3] || 'LOW';

const { data: events } = await db
  .from('events')
  .select(
    'id,title_sv,title_en,category_slug,start_time,venue_full_name,venue_city,is_free,price_min_sek,event_profile,raw_description,description_sv,source',
  )
  .eq('editorial_info_level', LEVEL)
  .not('event_profile', 'is', null)
  .not('editorial_description', 'is', null)
  .limit(LIMIT);

console.log(`prov: ${events?.length ?? 0} events @ info_level=${LEVEL}\n`);

const llm = new MiniMaxM3LlmClient({ apiKey: process.env.MINIMAX_API_KEY! });
const rejected = new Map<string, number>();
const byStatus = new Map<string, number>();
let totalUnsupported = 0;

for (const ev of events ?? []) {
  const profileRaw = (ev.event_profile as any)?.profile ?? ev.event_profile;
  const res: any = await runEditorialPipeline(
    {
      event: {
        title: ev.title_sv || ev.title_en || '',
        title_sv: ev.title_sv,
        title_en: ev.title_en,
        category_slug: ev.category_slug,
        start_time: ev.start_time,
        venue_name: ev.venue_full_name,
        city: ev.venue_city,
        is_free: ev.is_free,
        price_min_sek: ev.price_min_sek,
        language: 'sv',
        profile: profileRaw,
      } as any,
      sourceDescription: ev.raw_description || ev.description_sv || null,
      llm,
      maxAttempts: 2,
    } as any,
    { useNliJudge: true } as any,
  );

  byStatus.set(res.status, (byStatus.get(res.status) || 0) + 1);
  const claims = res.factuality?.unsupported_claims ?? [];
  totalUnsupported += claims.length;
  for (const c of claims) rejected.set(c, (rejected.get(c) || 0) + 1);
}

console.log('=== utfall ===');
for (const [s, n] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${s}: ${n}`);
}
console.log(`\n=== ${totalUnsupported} underkända claims, top 40 ===`);
for (const [c, n] of [...rejected.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  console.log(`  ${String(n).padStart(3)}  "${c}"`);
}
