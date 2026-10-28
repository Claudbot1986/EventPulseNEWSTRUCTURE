/**
 * preflight.mjs — kontrollera att världen fungerar INNAN kedjan startar.
 *
 * Varför (2026-10-28). Tre nätter i rad loggade kedjan "exit=0" medan den
 * producerade noll events. Rotorsaken: nätverksstacken dog (EADDRNOTAVAIL
 * mot både 127.0.0.1:6379 och externa värdar — ingen HTTP-status nåddes),
 * och koden översatte det tysta transportfelet till "klar".
 *
 * Preflight gör kedjan TALSAM: den mäter världen först, och säger ifrån
 * om den INTE går att köra — i stället för att börja, hänga i två timmar
 * och lämna status.json med running:true och en död pid.
 *
 * Designregler:
 *   - Varje kontroll har EGEN tidsgräns. Ingen kontroll kan hänga kedjan.
 *   - Varje kontroll är oberoende. En trasig kontroll stoppar inte de andra.
 *   - Hårda kontroller (utanförsta) blockerar kedjan → exit 69.
 *   - Mjuka kontroller (degraderade) rapporteras men blockerar inte.
 *   - INGA hemligheter i utdata. Nycklar kontrolleras på existens, inte värde.
 *
 * `--strict-preflight` (2026-10-28). Tredjepartstjänster (Exa, ScrapingBee)
 * är inte kedjans stomme — de flesta stegen klarar sig utan dem. Som
 * standard är deras kontroller MJUKA: kedjan startar, och de steg som
 * faktiskt behöver tjänsten faller med sin egen felklass (kedjan går RÖD,
 * men de övriga 24 stegen producerar events).
 *
 * Varför inte hårda som standard: en Exa-outage stoppade hela kedjan
 * (exit 69) och NOLL events importerades, trots att Redis och Supabase
 * var friska. Det är värre än en röd kedja — en kedja som tyst producerar
 * ingenting.
 *
 * `--strict-preflight` gör tredjepart HÅRD igen (gammalt beteende), för den
 * som vill att en tredjepartsoutage ska stoppa allt.
 *
 * Redis och Supabase är ALLTID hårda — utan dem sparas ingenting, och då
 * ska kedjan inte köra. ("blockera aldrig om Redis svarar PONG" — planen.)
 *
 * Exitkoder:
 *   0  — allt hårt grönt
 *   69 — EX_UNAVAILABLE: världen är trasig, kedjan ska inte starta
 */

import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { findUnparsableEnvLineNumbers } from './env-parse.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Ladda .env i process.env om den inte redan är laddad.
 *
 * Samma sätt runtime läser (dotenv), men override:false — den som anropar
 * preflight med egen env (t.ex. simuleringen) ska vinna över .env.
 * Redan satta variabler i process.env lämnas orörda.
 */
export function loadEnv(projectRoot = PROJECT_ROOT) {
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return false;
  dotenv.config({ path: envPath, override: false });
  return true;
}

// Ladda direkt så att preflight även fungerar som fristående verktyg
// (node scripts/verify-preflight.mjs) utan extern env-setup.
loadEnv();

/** Standard-timeouts per kontroll (ms). */
export const TIMEOUTS = {
  redisTcp: 3_000,
  redisPing: 5_000,
  dns: 4_000,
  egressTcp: 3_000,
  supabaseRest: 8_000,
  keys: 1_000,
  envParse: 2_000,
  localServer: 3_000,
};

/** Värdar som MÅSTE kunna slås upp. */
export const REQUIRED_HOSTS = ['api.exa.ai', 'app.scrapingbee.com'];

/** Lokala servrar som behövs för att "allt" ska fungera. */
export const LOCAL_SERVERS = [
  { name: 'supervisor', port: 7777, path: '/health', expect: 'ok' },
  { name: 'analytics', port: 7778, path: '/api/health', expect: 'json' },
];

/**
 * @typedef {Object} CheckResult
 * @property {string} name
 * @property {boolean} ok
 * @property {boolean} blocking      true = stoppar kedjan om den fallerar
 * @property {number} ms
 * @property {string} detail         kort, hemlighetsfri beskrivning
 * @property {string} [errorClass]   transport|auth|http|empty|logic
 */

/**
 * Kör ett anrop med tidsgräns. Returnerar { ok, value|error }.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} ms
 * @returns {Promise<{ ok: boolean, value?: T, error?: unknown, timedOut?: boolean }>}
 */
async function withTimeout(fn, ms) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`timeout efter ${ms} ms`);
      /** @type {any} */ (err).code = 'ETIMEDOUT';
      reject(err);
    }, ms);
  });
  try {
    const value = await Promise.race([fn(), timeout]);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TCP-connect mot värd:port. Fångar EADDRNOTAVAIL utan att någon HTTP-status
 * nås — det var exakt det som slog ut tre natter.
 *
 * @param {string} host
 * @param {number} port
 * @param {number} ms
 * @returns {Promise<{ ok: boolean, error?: unknown }>}
 */
export function tcpConnect(host, port, ms) {
  return withTimeout(
    () =>
      new Promise((resolve, reject) => {
        const socket = net.connect({ host, port });
        socket.setTimeout(ms);
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('timeout', () => {
          socket.destroy();
          const err = new Error(`tcp timeout ${host}:${port}`);
          /** @type {any} */ (err).code = 'ETIMEDOUT';
          reject(err);
        });
        socket.once('error', reject);
      }),
    ms + 500,
  );
}

/**
 * TLS-connect mot värd:443. Bevisar att egress fungerar på port 443.
 *
 * @param {string} host
 * @param {number} ms
 * @returns {Promise<{ ok: boolean, error?: unknown }>}
 */
export function tlsConnect(host, ms) {
  return withTimeout(
    () =>
      new Promise((resolve, reject) => {
        const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false });
        socket.once('secureConnect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('error', reject);
      }),
    ms + 500,
  );
}

/**
 * Läs REDIS_URL och returnera { host, port }.
 *
 * @param {string | undefined} redisUrl
 * @returns {{ host: string, port: number } | null}
 */
export function parseRedisTarget(redisUrl) {
  if (!redisUrl) return null;
  try {
    const url = new URL(redisUrl);
    return { host: url.hostname, port: Number(url.port || 6379) };
  } catch {
    return null;
  }
}

/**
 * Hitta en rad i .env som INTE kan parses som KEY=VÄRDE av en shell.
 *
 * Exempel: `FLY_API_TOKEN2=FlyV1 fm2_abc` — bash tolkar det som två ord,
 * där "fm2_abc" körs som ett kommando → "unknown command". Just det felet
 * gjorde att `. ./.env` i launchd-plisten kastade, och bash fortsatte — så
 * en verklig env-regression skulle vara osynlig.
 *
 * 2026-10-28 — regeln bor i scripts/lib/env-parse.mjs, delad med
 * scripts/verify-env-integrity.mjs. Innan dess hade de två OLIKA regler
 * (den här trimmade inte värdet) — en gate som säger "miljön är ren" medan
 * ett annat verktyg säger "trasigt" är värre än ingen gate.
 *
 * @param {string} envPath
 * @returns {string[]} radnummer (1-baserade) med trasiga rader
 */
export function findUnparsableEnvLines(envPath) {
  return findUnparsableEnvLineNumbers(envPath);
}

/**
 * Nycklar som måste finnas (och inte vara platshållare).
 * Kontrollerar existens — skriver ALDRIG ut värdet.
 *
 * 2026-10-28 — delad i två grupper. THIRD_PARTY_KEYS (Exa, ScrapingBee)
 * tillhör steg som bara är en del av kedjan; med `--allow-degraded` blir
 * de mjuka. SUPABASE_SERVICE_ROLE_KEY är hård — utan den sparas ingenting.
 */
const THIRD_PARTY_KEYS = ['EXA_API_KEY', 'SCRAPINGBEE_API_KEY'];
const PLACEHOLDER_PATTERN = /_PLACEHOLDER_|_FAKE_|^xxx+$|^changeme$/i;

/**
 * @param {string} key
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
export function hasUsableKey(key, env) {
  const value = env[key];
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return !PLACEHOLDER_PATTERN.test(trimmed);
}

/**
 * Hitta Supabase-värden ur URL:en (subdomain.bsllkpvk.supabase.co).
 *
 * @param {string | undefined} supabaseUrl
 * @returns {string | null}
 */
export function supabaseHostFromUrl(supabaseUrl) {
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).hostname;
  } catch {
    return null;
  }
}

/**
 * Kör hela preflight-sviten.
 *
 * @param {Object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.projectRoot]
 * @param {boolean} [options.requireLocalServers]  blocka om 7777/7778 inte svarar
 * @param {string[]} [options.skip]                 kontroller att hoppas över
 * @param {boolean} [options.allowDegraded]         tredjepartskontroller blir mjuka (standard: true)
 * @returns {Promise<{ ok: boolean, failed: string[], degraded: string[], checks: CheckResult[], durationMs: number }>}
 */
export async function runPreflight(options = {}) {
  const env = options.env ?? process.env;
  const projectRoot = options.projectRoot ?? PROJECT_ROOT;
  const skip = new Set(options.skip ?? []);
  // 2026-10-28 — tredjepartskontrollerna (dns för Exa/ScrapingBee,
  // egress-tcp, deras nycklar) är MJUKA som standard. Kedjan startar, och de
  // steg som faktiskt behöver tjänsten faller med sin egen felklass.
  // Redis och Supabase förblir HÅRDA — utan dem kan kedjan inte spara något,
  // och då ska den inte köra.
  const allowDegraded = options.allowDegraded !== false;
  const started = Date.now();

  /** @type {CheckResult[]} */
  const checks = [];

  /**
   * @param {string} name
   * @param {boolean} blocking
   * @param {() => Promise<{ ok: boolean, detail: string, errorClass?: string, error?: unknown }>} fn
   */
  async function run(name, blocking, fn) {
    if (skip.has(name)) return;
    const t0 = Date.now();
    try {
      const result = await fn();
      checks.push({ name, ok: result.ok, blocking, ms: Date.now() - t0, detail: result.detail, errorClass: result.errorClass });
    } catch (err) {
      checks.push({
        name,
        ok: false,
        blocking,
        ms: Date.now() - t0,
        detail: String(err instanceof Error ? err.message : err),
        errorClass: 'logic',
      });
    }
  }

  // ── 1. redis-tcp ────────────────────────────────────────────────────────
  const redisTarget = parseRedisTarget(env.REDIS_URL);
  await run('redis-tcp', true, async () => {
    if (!redisTarget) {
      return { ok: false, detail: 'REDIS_URL saknas eller går inte att tolka', errorClass: 'logic' };
    }
    const res = await tcpConnect(redisTarget.host, redisTarget.port, TIMEOUTS.redisTcp);
    if (!res.ok) {
      const code = /** @type {any} */ (res.error)?.code ?? 'okänt';
      return {
        ok: false,
        detail: `Redis nåbarhet misslyckades (${code})`,
        errorClass: 'transport',
      };
    }
    return { ok: true, detail: `tcp ${redisTarget.host}:${redisTarget.port} OK` };
  });

  // ── 2. redis-ping ───────────────────────────────────────────────────────
  await run('redis-ping', true, async () => {
    const res = await withTimeout(async () => {
      const { default: Redis } = await import('ioredis');
      const client = new Redis(env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        enableReadyCheck: false,
        connectTimeout: TIMEOUTS.redisPing,
        retryStrategy: () => null,
        lazyConnect: true,
      });
      // ioredis kastar ett 'error'-event vid connect-fel. Utan lyssnare
      // blir det ett ohanterat fel som dödar hela processen.
      client.on('error', () => {});
      try {
        await client.connect();
        const pong = await client.ping();
        return pong;
      } finally {
        client.disconnect();
      }
    }, TIMEOUTS.redisPing + 1_000);
    if (!res.ok) {
      const code = /** @type {any} */ (res.error)?.code ?? 'okänt';
      return { ok: false, detail: `Redis PING misslyckades (${code})`, errorClass: 'transport' };
    }
    return { ok: true, detail: `PING → ${res.value}` };
  });

  // ── 3. dns ──────────────────────────────────────────────────────────────
  // 2026-10-28 — SPLITAD. Tredjepartsvärdarna (Exa, ScrapingBee) är INTE
  // kedjans stomme: de flesta stegen klarar sig utan dem. Med
  // `--allow-degraded` får de mjuka kontroller — kedjan startar, och de
  // steg som faktiskt behöver dem faller med sin egen felklass.
  //
  // Supabase-värden däremot är ALLTID hård: utan den kan ingenting
  // persisteras, och kedjan ska inte lura sig att köra.
  await run('dns', !allowDegraded, async () => {
    const failures = [];
    for (const host of REQUIRED_HOSTS) {
      const res = await withTimeout(() => dns.lookup(host), TIMEOUTS.dns);
      if (!res.ok) failures.push(host);
    }
    if (failures.length > 0) {
      return { ok: false, detail: `DNS misslyckades för: ${failures.join(', ')}`, errorClass: 'transport' };
    }
    return { ok: true, detail: `${REQUIRED_HOSTS.length} värdar slås upp` };
  });

  await run('dns-supabase', true, async () => {
    const host = supabaseHostFromUrl(env.SUPABASE_URL);
    if (!host) {
      return { ok: false, detail: 'SUPABASE_URL saknas eller går inte att tolka', errorClass: 'logic' };
    }
    const res = await withTimeout(() => dns.lookup(host), TIMEOUTS.dns);
    if (!res.ok) {
      return { ok: false, detail: `DNS misslyckades för Supabase-värd ${host}`, errorClass: 'transport' };
    }
    return { ok: true, detail: `supabase-värd ${host} slås upp` };
  });

  // ── 4. egress-tcp ───────────────────────────────────────────────────────
  // Bara tredjepart — mjuk när `--allow-degraded`.
  await run('egress-tcp', !allowDegraded, async () => {
    const failures = [];
    for (const host of REQUIRED_HOSTS) {
      const res = await tlsConnect(host, TIMEOUTS.egressTcp);
      if (!res.ok) failures.push(host);
    }
    if (failures.length > 0) {
      return { ok: false, detail: `TLS-connect misslyckades för: ${failures.join(', ')}`, errorClass: 'transport' };
    }
    return { ok: true, detail: `${REQUIRED_HOSTS.length} värdar svarar på 443` };
  });

  // ── 5. supabase-rest ────────────────────────────────────────────────────
  await run('supabase-rest', true, async () => {
    const base = env.SUPABASE_URL;
    if (!base) return { ok: false, detail: 'SUPABASE_URL saknas', errorClass: 'logic' };
    const res = await withTimeout(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUTS.supabaseRest);
      try {
        const response = await fetch(`${base.replace(/\/$/, '')}/rest/v1/`, {
          signal: controller.signal,
          headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? '' },
        });
        return response.status;
      } finally {
        clearTimeout(timer);
      }
    }, TIMEOUTS.supabaseRest + 1_000);
    if (!res.ok) {
      return { ok: false, detail: `Supabase REST svarade inte (${describeCode(res.error)})`, errorClass: 'transport' };
    }
    const status = /** @type {number} */ (res.value);
    // 200 = anon-nyckel räcker, 401 = nåbar men kräver nyckel → BÅDA är nåbara.
    if (status === 200 || status === 401 || status === 403) {
      return { ok: true, detail: `Supabase REST svarade ${status}` };
    }
    return { ok: false, detail: `Supabase REST svarade oväntat ${status}`, errorClass: 'http' };
  });

  // ── 6. keys ─────────────────────────────────────────────────────────────
  // 2026-10-28 — SPLITAD på samma sätt som dns. Supabase-nyckeln är hård
  // (utan den persisterar ingenting). Exa/ScrapingBee-nycklarna blir mjuka
  // med `--allow-degraded` — de stegen faller med sin egen auth-klass.
  await run('keys-third-party', !allowDegraded, async () => {
    const missing = THIRD_PARTY_KEYS.filter((key) => !hasUsableKey(key, env));
    if (missing.length > 0) {
      return { ok: false, detail: `nycklar saknas/ser platshållare ut: ${missing.join(', ')}`, errorClass: 'auth' };
    }
    return { ok: true, detail: `${THIRD_PARTY_KEYS.length} nycklar finns` };
  });

  await run('keys', true, async () => {
    if (!hasUsableKey('SUPABASE_SERVICE_ROLE_KEY', env)) {
      return {
        ok: false,
        detail: 'nycklar saknas/ser platshållare ut: SUPABASE_SERVICE_ROLE_KEY',
        errorClass: 'auth',
      };
    }
    return { ok: true, detail: 'SUPABASE_SERVICE_ROLE_KEY finns' };
  });

  // ── 7. env-parse ────────────────────────────────────────────────────────
  await run('env-parse', true, async () => {
    const envPath = path.join(projectRoot, '.env');
    const broken = findUnparsableEnvLines(envPath);
    if (broken.length > 0) {
      return {
        ok: false,
        detail: `.env rad ${broken.join(', ')} kan inte parsas av en shell`,
        errorClass: 'logic',
      };
    }
    if (!fs.existsSync(envPath)) {
      return { ok: false, detail: '.env finns inte', errorClass: 'logic' };
    }
    const lines = fs.readFileSync(envPath, 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
    return { ok: true, detail: `${lines.length} nycklar, 0 olåsta rader` };
  });

  // ── 8. local-servers ────────────────────────────────────────────────────
  // 7777 (scraping supervisor) och 7778 (analytics) är INTE kedjans beroende —
  // kedjan kan köra utan dem. De är mjuka kontroller: de rapporteras, men
  // stoppar inte kedjan, eftersom analytics-fel inte ska fälla en nattkörning.
  // Med --require-local-servers blir de hårda.
  await run('local-servers', options.requireLocalServers === true, async () => {
    const results = [];
    for (const server of LOCAL_SERVERS) {
      const res = await withTimeout(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUTS.localServer);
        try {
          const response = await fetch(`http://127.0.0.1:${server.port}${server.path}`, {
            signal: controller.signal,
          });
          const text = await response.text();
          return { status: response.status, text };
        } finally {
          clearTimeout(timer);
        }
      }, TIMEOUTS.localServer + 1_000);
      if (!res.ok) {
        results.push(`${server.name}:${server.port} svarar inte`);
        continue;
      }
      const { status, text } = /** @type {{status: number, text: string}} */ (res.value);
      const ok =
        status === 200 &&
        (server.expect === 'json' ? text.trim().startsWith('{') && text.includes('"ok"') : text.trim() === server.expect);
      results.push(`${server.name}:${server.port} ${ok ? 'OK' : `svarade ${status}`}`);
    }
    const bad = results.filter((r) => !r.includes(' OK'));
    if (bad.length > 0) {
      return {
        ok: false,
        detail: `lokala servrar: ${bad.join('; ')}`,
        errorClass: 'logic',
      };
    }
    return { ok: true, detail: results.join('; ') };
  });

  const failed = checks.filter((c) => c.blocking && !c.ok).map((c) => c.name);
  const degraded = checks.filter((c) => !c.blocking && !c.ok).map((c) => c.name);
  return {
    ok: failed.length === 0,
    failed,
    degraded,
    checks,
    durationMs: Date.now() - started,
  };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeCode(error) {
  const code = /** @type {any} */ (error)?.code;
  if (typeof code === 'string') return code;
  const message = String(/** @type {any} */ (error)?.message ?? '').replace(/\s+/g, ' ').trim();
  return message ? message.slice(0, 60) : 'okänt';
}

/**
 * Skriv ett preflight-resultat till runtime/ingestion-cron/preflight-<stamp>.json
 * och appendera en rad till chain-overview.log.
 *
 * @param {Object} result
 * @param {Object} [options]
 * @param {string} [options.projectRoot]
 * @returns {{ reportPath: string | null }}
 */
export function writePreflightArtifacts(result, options = {}) {
  const projectRoot = options.projectRoot ?? PROJECT_ROOT;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(projectRoot, 'runtime', 'ingestion-cron');
  let reportPath = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    reportPath = path.join(dir, `preflight-${stamp}.json`);
    fs.writeFileSync(
      reportPath,
      `${JSON.stringify({ stamp, ...result }, null, 2)}\n`,
      'utf8',
    );
  } catch {
    reportPath = null;
  }
  try {
    // Samma logg som ingestion-cron.ts skriver till (CHAIN_OVERVIEW).
    const logPath = path.join(projectRoot, 'runtime', 'ingestion-cron', 'chain-overview.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event: result.ok ? 'preflight-ok' : 'preflight-fail',
      failed: result.failed,
      degraded: result.degraded,
      durationMs: result.durationMs,
    });
    fs.appendFileSync(logPath, `${line}\n`, 'utf8');
  } catch {
    // Loggen får aldrig stoppa kedjan.
  }
  return { reportPath };
}

// ─── Fristående körning ─────────────────────────────────────────────────────
// `node scripts/lib/preflight.mjs` → exit 0 (allt grönt) eller 69 (trasig
// värld). Shell-scripts (runPostIngest.sh) använder detta för att inte köra
// mot en värld som inte fungerar.
const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''));
if (invokedDirectly) {
  const result = await runPreflight({
    requireLocalServers: process.argv.includes('--require-local-servers'),
    allowDegraded: !process.argv.includes('--strict-preflight'),
  });
  for (const check of result.checks) {
    const mark = check.ok ? 'OK  ' : 'FAIL';
    console.log(
      `[preflight] [${mark}] ${check.blocking ? 'hard' : 'soft'} ${check.name.padEnd(15)} ` +
      `${String(check.ms).padStart(5)}ms  ${check.detail}`,
    );
  }
  writePreflightArtifacts(result);
  if (result.ok) {
    console.log(`[preflight] OK — världen är körbar (${result.durationMs}ms)`);
    process.exit(0);
  }
  console.error(`[preflight] MISSLYCKADES: ${result.failed.join(', ')} — kedjan ska inte starta`);
  process.exit(69);
}
