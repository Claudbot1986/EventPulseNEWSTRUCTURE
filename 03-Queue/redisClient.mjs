/**
 * redisClient.mjs — EN central options-källa för Redis i EventPulse.
 *
 * Varför (2026-10-28). Nattköningen 2026-10-26 hängde i två timmar
 * (exit=124) med 583 KB identiska felrader och 0 events köade. Rotorsaken:
 *
 *   - BullMQ ignorerade kopplingsfabriken i 03-Queue/queue.ts
 *     (`connection: { getConnection } as unknown as ConnectionOptions`).
 *     BullMQ behandlar det som PLAINA RedisOptions — `getConnection` är en
 *     okänd nyckel och ignoreras. Anslutningen gick därför alltid mot
 *     bullmq:s default (127.0.0.1:6379), aldrig mot REDIS_URL.
 *   - ioredis:s default `enableOfflineQueue: true` betyder att kommandon
 *     som skickas medan servern är borta LIGGER i offline-kön och väntar
 *     på återanslutning. `enqueueRawEvent()` fick därför aldrig rejecta →
 *     importen stod still i två timmar.
 *
 * Fixen: en enda modul som alla använder, med optioner som säger "nej"
 * i stället för att vänta, PLUS egna timeouts i anroparna.
 *
 * BullMQ-begränsningar (lästa i node_modules/bullmq/dist/cjs/classes/):
 *   - redis-connection.js:37 — blocking-anslutningen tvingas till
 *     `maxRetriesPerRequest = null`. Det är inte valfritt: BRPOPLPUSH
 *     behöver obegränsad retry.
 *   - redis-connection.js:71 — skickar man en ioredis-INSTANS med
 *     `maxRetriesPerRequest` satt kastar BullMQ. Därför skickar vi
 *     alltid PLAINA options, aldrig en instans.
 *   - queue-base.js:23 — Queue har `blocking: false`, så där KAN
 *     `maxRetriesPerRequest` sättas till 1 (fail-fast vid uttag).
 */

import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { errorText } from '../scripts/lib/net-error.mjs';

/** Standard-URL om REDIS_URL saknas. */
export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

/** Hur länge en anslutning får ta. */
export const REDIS_CONNECT_TIMEOUT_MS = 5_000;

/** Hur många återförsök innan klienten ger upp (och processen dör med exit 69). */
export const REDIS_MAX_RETRY_ATTEMPTS = 5;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveRedisUrl(env = process.env) {
  const url = env.REDIS_URL;
  if (!url || typeof url !== 'string' || url.trim().length === 0) return DEFAULT_REDIS_URL;
  return url.trim();
}

/**
 * retryStrategy som ger upp efter N försök → status 'end' → anropande
 * får ett fel i stället för att vänta.
 *
 * @param {number} [maxAttempts]
 * @returns {(times: number) => number | null}
 */
export function giveUpAfter(maxAttempts = REDIS_MAX_RETRY_ATTEMPTS) {
  return (times) => (times > maxAttempts ? null : Math.min(times * 200, 2000));
}

/**
 * Options för en PRODUCER (BullMQ Queue).
 *
 * - `url` MÅSTE vara med. BullMQ läser `opts.url` först (redis-connection.js:151)
 *   och använder `opts.host/port` (default 127.0.0.1:6379) annars. Utan `url`
 *   ignorerades REDIS_URL helt — det var den gamla `{ getConnection }`-fabrikens
 *   sista kvarvarande symptom.
 * - `maxRetriesPerRequest: 1` — ett uttag som inte kan skickas misslyckas
 *   omedelbart i stället för att köas.
 * - `enableOfflineQueue: false` — inga kommandon vilar i offline-kön.
 *   Detta är själva fixen på två-timmars-hängningen.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, unknown>}
 */
export function producerOptions(env = process.env) {
  const url = resolveRedisUrl(env);
  return {
    url,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    retryStrategy: giveUpAfter(),
    tls: url.startsWith('rediss://') ? {} : undefined,
  };
}

/**
 * Options för en WORKER (BullMQ Worker).
 *
 * `maxRetriesPerRequest` sätts INTE: BullMQ kastar om man skickar en
 * ioredis-instans med värdet satt (redis-connection.js:71) och tvingar
 * värdet till null på blocking-anslutningen (rad 37). Lämna det till
 * BullMQ.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, unknown>}
 */
export function workerOptions(env = process.env) {
  const url = resolveRedisUrl(env);
  return {
    url,
    enableOfflineQueue: false,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    retryStrategy: giveUpAfter(),
    tls: url.startsWith('rediss://') ? {} : undefined,
  };
}

/**
 * Skapa en fristående ioredis-klient med fail-fast-optioner.
 * Används av scripts/ingest-*.mjs som kör direkt mot Redis.
 *
 * @param {Record<string, unknown>} [overrides]
 * @returns {import('ioredis').default}
 */
export function createRedisClient(overrides = {}) {
  const url = resolveRedisUrl();
  const client = new IORedis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    retryStrategy: giveUpAfter(),
    tls: url.startsWith('rediss://') ? {} : undefined,
    ...overrides,
  });
  // Utan lyssnare blir connect-felet ett ohanterat 'error'-event som dödar
  // processen med en rå stacktrace i stället för ett begripligt fel.
  client.on('error', () => {});
  return client;
}

/**
 * Kör ett kommando mot Redis med tidsgräns. Returnerar `{ok, value}` eller
 * `{ok:false, error}` — kastar INTE, så att anroparen kan klassificera.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} ms
 * @returns {Promise<{ ok: boolean, value?: T, error?: unknown, timedOut?: boolean }>}
 */
export async function withRedisTimeout(fn, ms = 15_000) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`redis-timeout efter ${ms} ms`);
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
 * BullMQ:s Queue och Worker re-emitterar klientens 'error'
 * (queue-base.js:43: `this.connection.on('error', (e) => this.emit('error', e))`).
 * Utan en lyssnare kastar Node och skriver en RÅ STACKTRACE — åtta rader per
 * connection-fel.
 *
 * Varför det här är ett verkligt problem (2026-10-28). Uppmätt mot en död
 * Redis (127.0.0.1:6399):
 *
 *   - ett enda queue.add → 56 rader stacktrace (createBullQueue)
 *   - ett enda queue.add → 200 rader stacktrace (03-Queue/queue.ts, som
 *     skapar FYRA köer vid import)
 *
 * Importen nattet 26 okt köade ~5800 events mot en död Redis. Varje add
 * genererade sin egen uppsättning stacktraces — 583 KB logg. Det var
 * INTE en rad per event i catch-blocket (den var en rad per event också,
 * men den är nu takad); det var BullMQ:s fel-event.
 *
 * Här dämpas felet till EN rad per DISTINKT felmeddelande. Signalen finns
 * kvar — kedjan läser stderr och klassar raden (transport ⇒ röd) — men
 * loggen kan inte längre växa proportionellt med antalet event.
 *
 * @template {import('bullmq').Queue<unknown> | import('bullmq').Worker<unknown>} T
 * @param {T} emitter
 * @param {string} label
 * @returns {T}
 */
export function reportQueueErrors(emitter, label) {
  const seen = new Set();
  emitter.on('error', (err) => {
    const text = errorText(err);
    if (seen.has(text)) return;
    seen.add(text);
    console.error(`[${label}] ${text}`);
  });
  return emitter;
}

/**
 * Skapa en BullMQ-Queue med fail-fast-optioner.
 *
 * Används av scripts/ingest-*.mjs. De skickar en ioredis-INSTANS till
 * BullMQ (i stället för plain options som 03-Queue/queue.ts gör), och
 * BullMQ KASTAR om en instans har `maxRetriesPerRequest` satt till något
 * annat än null (redis-connection.js:71). Därför står värdet här som null —
 * det som stoppar hängningen är i stället `enableOfflineQueue: false`:
 * kommandon som skickas medan Redis är borta misslyckas då omedelbart i
 * stället för att ligga i offline-kön i evighet.
 *
 * @param {string} [name]
 * @param {Record<string, unknown>} [options]
 * @returns {Queue}
 */
export function createBullQueue(name = 'raw_events', options = {}) {
  const url = resolveRedisUrl();
  const client = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    retryStrategy: giveUpAfter(),
    tls: url.startsWith('rediss://') ? {} : undefined,
  });
  // Utan lyssnare blir connect-felet ett ohanterat 'error'-event.
  client.on('error', () => {});
  const queue = new Queue(name, { connection: client, prefix: 'bull', ...options });
  return reportQueueErrors(queue, `queue:${name}`);
}
