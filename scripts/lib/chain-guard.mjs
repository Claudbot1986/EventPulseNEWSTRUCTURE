/**
 * chain-guard.mjs — upptäckt av levande ingestion-kedjor + säker städning
 * av discovery-processer.
 *
 * Två funktioner, samma underlag (ps auxww):
 *
 *   1. liveChainPids() — vilka ingestion-cedjor kör JUST NU.
 *      Används av verifierings-gates: en gate som startar ett produktionssteg
 *      medan nattkörningen är igång mäter inte steget — den krockar med det.
 *
 *   2. killLivingDiscoveryProcesses() — städar bort discovery/ingest-
 *      processer från en tidigare HÄNGD körning.
 *
 * Varför fixen finns (2026-10-24). Den gamla logiken matchade bara cmdline-
 * mönstret och dödade allt som matchade. Den kunde inte se skillnaden mellan
 *
 *   (a) en zombie från en tidigare körning som kraschade, och
 *   (b) ett barn av den kedja som kör JUST NU.
 *
 * Fall (b) inträffade i verklighet, på nattkörningen 2026-10-24:
 *   00:21:43  pre-kill-sigterm pid 28221 "node scripts/discover-subpaths.mjs"
 *             → nattkörningens subpath-discovery dog med exit=1, UTAN FATAL i
 *               stderr (SIGTERM, inte ett fel).
 *   00:21:57  pre-kill-sigterm pid 29799 "node scripts/ingest-direct-jsonld.mjs"
 *             → nattkörningens direct-jsonld dog med exit=1.
 * Båda signalerna kom från verifierings-gates som startade
 * `ingestion-cron.ts --only direct-jsonld` parallellt med nattkörningen.
 *
 * Nu kontrolleras ANCESTOR: har processen en levande ingestion-kedja som
 * förfader är den levande arbete och lämnas i fred. Zombies från en död
 * kedja har ingen levande förfader och döds fortfarande — det ursprungliga
 * problemet (tribe-events som hängde 76 h) kvarstår.
 *
 * Den äldre varianten av zombie (en gammal kedja som lever men är hängd)
 * ägs nu av watchdog-lagret, inte av pre-kill: watchdog.log har en egen
 * gräns för "chain running for Nmin" och dödar kedjan. Två lager ska inte
 * döda samma process.
 */

import { execSync } from 'node:child_process';

/** En process vars cmdline innehåller detta är en ingestion-kedja. */
export const CHAIN_PATTERN = /scripts\/ingestion-cron\.ts/;

/** Processer som pre-kill får städa bort. */
export const DISCOVERY_PATTERNS = [
  /scripts\/ingest-[\w-]+\.m?js/, // scripts/ingest-tribe-events.mjs
  /scripts\/discover-[\w-]+\.m?js/, // scripts/discover-subpaths.mjs
  /07-Discovery\/src\//, // 07-Discovery/src/...
  /geoExpansion/,
  /rssDiscovery/,
  /discoverySearch/,
];

/**
 * @typedef {{ pid: number, cmdline: string }} ProcRow
 */

/**
 * Läs `ps auxww` och returnera pid + kommandorad per process.
 * @returns {ProcRow[]}
 */
export function listProcesses() {
  let out;
  try {
    out = execSync('ps auxww', { encoding: 'utf8', timeout: 5000 });
  } catch {
    return [];
  }
  const rows = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    // ps auxww: USER PID %CPU %MEM VSZ RSS TT STAT STARTED TIME COMMAND…
    //
    // VARNING: dela INTE med en limit. `split(regexp, limit)` behåller
    // INTE resten av strängen när separatorn är ett regex — den
    // returnerar bara de första `limit` fälten. Med limit 12 fick varje
    // cmdline avklippt till två ord ("…/node --require"), så
    // CHAIN_PATTERN.matchade aldrig "scripts/ingestion-cron.ts":
    //   • liveChainPids() returnerade ALLTID [] → gaterna körde parallellt
    //     med nattkörningen (precis det som dödade stegen 2026-10-24),
    //   • chainPids var tomt → pre-kill dödade kedjans egna barn.
    const parts = line.trim().split(/\s+/);
    if (parts.length < 11) continue;
    const pid = parseInt(parts[1], 10);
    if (Number.isNaN(pid)) continue;
    rows.push({ pid, cmdline: parts.slice(10).join(' ') });
  }
  return rows;
}

/**
 * Pids för alla levande ingestion-kedjor (utom `selfPid`).
 * @param {number} [selfPid]
 * @returns {number[]}
 */
export function liveChainPids(selfPid = process.pid) {
  return listProcesses()
    .filter((p) => p.pid !== selfPid && CHAIN_PATTERN.test(p.cmdline))
    .map((p) => p.pid);
}

/**
 * Föräldrapids för en process, uppåt i trädet. Tom lista om processen
 * inte finns eller om den når pid 1.
 * @param {number} pid
 * @param {number} [maxDepth]
 * @returns {number[]}
 */
export function ancestorPids(pid, maxDepth = 24) {
  const out = [];
  let cur = pid;
  for (let i = 0; i < maxDepth; i++) {
    const ppid = parentPid(cur);
    if (ppid === null || ppid <= 1 || ppid === cur) break;
    out.push(ppid);
    cur = ppid;
  }
  return out;
}

/**
 * @param {number} pid
 * @returns {number | null}
 */
function parentPid(pid) {
  try {
    const raw = execSync(`ps -o ppid= -p ${pid}`, { encoding: 'utf8', timeout: 3000 }).trim();
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

/**
 * Städa bort discovery/ingest-processer från en tidigare hängd körning.
 *
 * Processer som hör till en LEVANDE ingestion-kedja lämnas i fred.
 *
 * @param {object} [options]
 * @param {number} [options.selfPid]
 * @param {RegExp[]} [options.patterns]
 * @param {number} [options.graceMs] väntetid mellan SIGTERM och SIGKILL
 * @param {(e: {event: string, pid: number, cmdline?: string, ownerChainPid?: number}) => void} [options.onEvent]
 * @returns {Promise<{killed: number[], skipped: number[]}>}
 */
export async function killLivingDiscoveryProcesses(options = {}) {
  const {
    selfPid = process.pid,
    patterns = DISCOVERY_PATTERNS,
    graceMs = 5000,
    onEvent = () => {},
  } = options;

  const procs = listProcesses();

  // Alla levande kedjor — inklusive oss själva. Ett barn av någon av dem
  // är levande arbete, inte en zombie.
  const chainPids = new Set(
    procs.filter((p) => CHAIN_PATTERN.test(p.cmdline)).map((p) => p.pid),
  );

  const killed = [];
  const skipped = [];
  const seen = new Set();

  for (const proc of procs) {
    if (proc.pid === selfPid) continue;
    if (seen.has(proc.pid)) continue;
    if (!patterns.some((rx) => rx.test(proc.cmdline))) continue;
    seen.add(proc.pid);

    const owner = ancestorPids(proc.pid).find((a) => chainPids.has(a));
    if (owner !== undefined) {
      skipped.push(proc.pid);
      onEvent({ event: 'pre-kill-skip', pid: proc.pid, cmdline: proc.cmdline, ownerChainPid: owner });
      continue;
    }

    try {
      process.kill(proc.pid, 'SIGTERM');
      onEvent({ event: 'pre-kill-sigterm', pid: proc.pid, cmdline: proc.cmdline });
      await new Promise((r) => setTimeout(r, graceMs));
      try {
        process.kill(proc.pid, 0); // kollar om processen lever
        process.kill(proc.pid, 'SIGKILL');
        onEvent({ event: 'pre-kill-sigkill', pid: proc.pid, cmdline: proc.cmdline });
      } catch {
        // Redan död efter SIGTERM — bra.
      }
      killed.push(proc.pid);
    } catch (err) {
      // ESRCH = processen fanns inte (redan död). Inget att rapportera.
      if (err && err.code === 'ESRCH') continue;
      onEvent({ event: 'pre-kill-error', pid: proc.pid, cmdline: proc.cmdline });
    }
  }

  return { killed, skipped };
}
