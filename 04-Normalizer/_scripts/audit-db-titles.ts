import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { evaluateTitle } from '/Users/claudgashi/EventPulse/04-Normalizer/title-quality-gate';

async function main() {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Hämta alla events med sus titlar (mest "Folkoperan")
  const all: any[] = [];
  let offset = 0;
  const PAGE = 200;
  while (true) {
    const { data, error } = await c
      .from('events')
      .select('id, source, title_sv, title_en, created_at')
      .or('title_sv.eq.Folkoperan,title_en.eq.Folkoperan')
      .range(offset, offset + PAGE - 1);
    if (error) { console.error(error.message); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`Hämtade ${all.length} events med titel "Folkoperan"\n`);

  let rejected = 0, passed = 0;
  const reasonCounts = new Map<string, number>();
  for (const r of all) {
    const title = r.title_sv || r.title_en;
    const gate = evaluateTitle(title, r.source ?? '');
    if (!gate.ok) {
      rejected++;
      reasonCounts.set(gate.reason!, (reasonCounts.get(gate.reason!) ?? 0) + 1);
    } else {
      passed++;
    }
  }

  console.log(`Gate-resultat:`);
  console.log(`  Avvisade: ${rejected}`);
  console.log(`  Passerade: ${passed}`);
  console.log(`\nAnledningar:`);
  for (const [reason, n] of reasonCounts) {
    console.log(`  ${n} × ${reason}`);
  }

  // Räkna även hur många av alla 5686 events gate:en skulle avvisa (samplat)
  const sample = await c.from('events').select('source, title_sv, title_en').limit(2000);
  if (sample.data) {
    let sampleRejected = 0;
    const sampleReasons = new Map<string, number>();
    const rejectedExamples: Array<{ title: string; source: string; reason: string }> = [];
    for (const r of sample.data) {
      const t = r.title_sv || r.title_en;
      const g = evaluateTitle(t, r.source ?? '');
      if (!g.ok) {
        sampleRejected++;
        sampleReasons.set(g.reason!, (sampleReasons.get(g.reason!) ?? 0) + 1);
        if (rejectedExamples.length < 10) {
          rejectedExamples.push({ title: t ?? '(null)', source: r.source ?? '(null)', reason: g.reason! });
        }
      }
    }
    console.log(`\nSampling 2000 events:`);
    console.log(`  Skulle avvisas av gate: ${sampleRejected} (${(sampleRejected / 2000 * 100).toFixed(1)}%)`);
    console.log(`  Anledningar:`);
    for (const [reason, n] of sampleReasons) {
      console.log(`    ${n} × ${reason}`);
    }
    if (rejectedExamples.length > 0) {
      console.log(`\n  Exempel på avvisade:`);
      for (const e of rejectedExamples) {
        console.log(`    [${e.reason}] ${e.source}: ${e.title}`);
      }
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });