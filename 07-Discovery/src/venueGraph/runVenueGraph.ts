import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildVenueGraph } from './graphBuilder.js';
import { createSupabaseVenueGraphRepository } from './supabaseRepository.js';
import type { VenueGraphMode } from './types.js';

dotenv.config({ override: true });

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function readMode(): VenueGraphMode {
  if (process.argv.includes('--apply')) return 'apply';
  return 'dry-run';
}

function readLimit(): number | undefined {
  const raw = readArg('limit');
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --limit value: ${raw}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Venue Graph runs');
  }

  const mode = readMode();
  const targetCity = readArg('city') || 'Stockholm';
  const limit = readLimit();
  const supabase = createClient(url, key);
  const repository = createSupabaseVenueGraphRepository(supabase);
  const result = await buildVenueGraph({ repository, targetCity, limit, mode });

  console.log(JSON.stringify({
    summary: result.summary,
    topCandidates: result.candidates
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 10)
      .map((candidate) => ({
        displayName: candidate.displayName,
        confidenceScore: candidate.confidenceScore,
        priorityScore: candidate.priorityScore,
        riskFlags: candidate.riskFlags,
        explanation: candidate.explanation,
        originPath: candidate.originPath,
      })),
    rejectedObservations: result.rejectedObservations.slice(0, 10),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
