/**
 * reroute-jsonld-stuck.ts — T0096
 *
 * Reads runtime/sources_status.jsonl, finds sources stuck on the JSON-LD path
 * with 0 events, and reroutes them to preferredPath='html' so the scheduler
 * sends them to C-htmlGate for HTML candidate discovery.
 *
 * Reroute conditions (any):
 *   - lastPathUsed === 'jsonld' AND lastEventsFound === 0
 *   - status === 'failed' AND lastEventsFound === 0 (regardless of path)
 *
 * Skips:
 *   - sources with a working path (eventsFound > 0)
 *   - sources already on preferredPath='html' or 'render'
 *   - sources whose failure reason is a transient network/SSL error
 *     (mosebacke, nobel-prize-museum, observatoriet — T0098 separate task)
 *
 * Idempotent: safe to re-run. Updates preferredPath only if it would change.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { updateSourceStatus } from './sourceRegistry';

interface SourceStatus {
  sourceId: string;
  status: string;
  lastPathUsed?: string;
  lastEventsFound?: number;
  preferredPath?: string;
  lastRoutingReason?: string;
  lastRun?: string;
  consecutiveFailures?: number;
  attempts?: number;
}

const STATUS_FILE = '/Volumes/2TB filer/NEWSTRUCTURE-COPY/runtime/sources_status.jsonl';

// Transient-error patterns that should NOT be rerouted to html — handled by
// T0098 (SSL/cert fix) or scheduler retry. The fetch-failure messages below
// describe infra/connectivity problems, not content problems.
const TRANSIENT_FAILURE_RE = /Fetch failed|EPROTO|ECONNREFUSED|Hostname\/IP|exceeded 3 redirects|Redirect loop|timeout of 20000ms/i;

function main() {
  if (!existsSync(STATUS_FILE)) {
    console.error(`[reroute] ${STATUS_FILE} missing — nothing to do`);
    return;
  }

  const lines = readFileSync(STATUS_FILE, 'utf8').split('\n').filter(l => l.trim());
  const byId = new Map<string, SourceStatus>();
  for (const l of lines) {
    try {
      const s = JSON.parse(l) as SourceStatus;
      const cur = byId.get(s.sourceId);
      const curTs = cur?.lastRun ?? '';
      if (!cur || (s.lastRun ?? '') >= curTs) byId.set(s.sourceId, s);
    } catch {}
  }

  const toReroute: SourceStatus[] = [];
  const skipped: { sid: string; reason: string }[] = [];

  for (const [sid, s] of byId) {
    const path = s.lastPathUsed ?? '';
    const ev = s.lastEventsFound ?? 0;

    if (ev > 0) {
      skipped.push({ sid, reason: `has ${ev} events — not stuck` });
      continue;
    }
    if (s.preferredPath === 'html' || s.preferredPath === 'render') {
      skipped.push({ sid, reason: `already on preferredPath=${s.preferredPath}` });
      continue;
    }
    const reason = s.lastRoutingReason ?? '';
    if (TRANSIENT_FAILURE_RE.test(reason)) {
      skipped.push({ sid, reason: `transient error: ${reason.slice(0, 60)}` });
      continue;
    }
    if (path === 'jsonld' && ev === 0) {
      toReroute.push(s);
    } else if (s.status === 'failed' && ev === 0) {
      toReroute.push(s);
    } else {
      skipped.push({ sid, reason: `path=${path} ev=${ev} status=${s.status} — not matched` });
    }
  }

  console.log(`[reroute] scanned ${byId.size} sources`);
  console.log(`[reroute] will reroute: ${toReroute.length}`);
  console.log(`[reroute] skipped:      ${skipped.length}`);

  let applied = 0;
  let failed = 0;
  for (const s of toReroute) {
    const attempts = s.attempts ?? 0;
    const reason = `T0096: jsonld stuck (${attempts} attempts, 0 events). Routing to C-htmlGate for HTML candidate discovery.`;

    try {
      updateSourceStatus(s.sourceId, {
        success: false,
        eventsFound: 0,
        pathUsed: s.lastPathUsed,
        ingestionStage: 'pending',
        preferredPath: 'html',
        preferredPathReason: reason,
        lastRoutingReason: reason,
        lastRoutingSource: 'triage',
      });
      applied++;
      console.log(`  OK ${s.sourceId} -> preferredPath=html`);
    } catch (err: any) {
      failed++;
      console.error(`  ERR ${s.sourceId}: ${err.message}`);
    }
  }

  console.log('');
  console.log(`[reroute] DONE -- applied=${applied}, failed=${failed}, total-candidates=${toReroute.length}`);
  console.log('');
  console.log('Skipped:');
  for (const s of skipped) {
    console.log(`  . ${s.sid.padEnd(35)} ${s.reason}`);
  }
}

main();
