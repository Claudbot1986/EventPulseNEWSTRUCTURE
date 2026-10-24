/**
 * index.ts — registret över source-adapters för Tool A.
 *
 * Gate-koden ska aldrig känna till en specifik sajt. Den slår bara upp
 * `metadata.sourceAdapter` i source-filen här, och kör adaptern som
 * registrerats under det namnet. Saknas adaptern faller källan tillbaka
 * till HTML-spåret (som den gjorde innan).
 *
 * En adapter registreras här när mönstret är verifierat på flera orelaterade
 * domäner (Generalization Protection Rule). Confetti är verifierat på
 * kmh.confetti.events och founders-alliance.confetti.events.
 */

import type { SourceTruth } from '../../tools/sourceRegistry';
import type { ApiAdapter } from './types';

const registry: ApiAdapter[] = [
  {
    name: 'confetti',
    hostSuffixes: ['.confetti.events'],
    run: async (source: SourceTruth) => {
      const { runConfettiAdapter } = await import('./confetti');
      return runConfettiAdapter(source);
    },
  },
  {
    // 2026-10-24 — universe.com:s egen GraphQL-sök-API. Källans URL
    // (www.universe.com/events/stockholm) är en SPA-ruta som renderar tomt;
    // API:t ger rader med datum, plats, adress och pris.
    name: 'universe',
    hostSuffixes: ['.universe.com'],
    run: async (source: SourceTruth) => {
      const { runUniverseAdapter } = await import('./universe');
      return runUniverseAdapter(source);
    },
  },
  {
    // 2026-10-24 — vasalund.com (DM/360Player). /matcher renderar tomt
    // (ScrapingBee-premium: loading-state hänger kvar, 0 match-rader i DOM),
    // men DM:s collections-API ger framtida matcher med ren HTTP.
    // Endast .com — .se är en parkerad domän ("TILL SALU") utan SiteAlias.
    name: 'vasalund',
    hostSuffixes: ['.vasalund.com'],
    run: async (source: SourceTruth) => {
      const { runVasalundAdapter } = await import('./vasalund');
      return runVasalundAdapter(source);
    },
  },
  {
    // 2026-10-24 — stockholmjazz.se (Stockholms Jazzfestival). /program är
    // ett SvelteKit-skal (~8 kB) utan JSON-LD; korten byggs client-side.
    // Plattformens eget /api/concerts ger däremot 331 rader med datum,
    // sluttid och plats — utan rendering.
    // Endast .se — .com är en uppköpt spamdomän utan jazz.
    name: 'stockholmjazz',
    hostSuffixes: ['.stockholmjazz.se'],
    run: async (source: SourceTruth) => {
      const { runStockholmJazzAdapter } = await import('./stockholmJazz');
      return runStockholmJazzAdapter(source);
    },
  },
];

export function getApiAdapter(name: string | undefined | null): ApiAdapter | null {
  if (!name) return null;
  return registry.find(a => a.name === name) ?? null;
}

/**
 * Hitta adaptern som ska köras mot en källa.
 *
 * Två vägar, i prioritetsordning:
 *   1. Explicit — `metadata.sourceAdapter` i source-filen. En explicit
 *      adapter vinner alltid: routingen i övriga lager känner inte till
 *      adaptrar, så ett routing-beslut får inte kunna stänga av en adapter
 *      som är verifierad för källan. Finns adaptern INTE i registret faller
 *      källan tillbaka till HTML-spåret — precis som innan.
 *   2. Automatisk — källans URL pekar på en värd som en adapter deklarerar.
 *      Detta gör att en källa från discovery-promotering fungerar direkt,
 *      eftersom promotorn inte känner till adaptrar.
 */
export function findAdapterForSource(
  source: SourceTruth | null | undefined,
): { adapter: ApiAdapter; mode: 'explicit' | 'auto' } | null {
  if (!source) return null;

  const meta = source.metadata ?? {};
  const adapterName = meta.sourceAdapter as string | undefined;
  if (adapterName) {
    const adapter = getApiAdapter(adapterName);
    return adapter ? { adapter, mode: 'explicit' } : null;
  }

  let host: string;
  try {
    host = new URL(source.url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const adapter = registry.find(a => a.hostSuffixes.some(suffix => host.endsWith(suffix)));
  return adapter ? { adapter, mode: 'auto' } : null;
}

export function listApiAdapters(): string[] {
  return registry.map(a => a.name);
}

export type { ApiAdapter, ApiAdapterResult, AdapterEventRow } from './types';
