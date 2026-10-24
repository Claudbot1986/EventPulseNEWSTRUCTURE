/**
 * rssPath.ts — gemensamt RSS-spår för B-gatens två körningar.
 *
 * Bakgrund (2026-10-24). RSS-spåret fanns bara i `runB-parallel.ts`, medan
 * cronen kör `runB.ts` (seriell variant). Resultatet: en källa med
 * `preferredPath: 'rss'` tog aldrig den avsedda vägen — B-gatens network
 * gate körde mot feed-URL:en, hittade ingen JSON-LD och källan föll
 * tillbaka till HTML-spåret. KTH:s kalenderfeed (`?rss=calendar`) ger 62
 * riktiga events via RSS men gav 0 genom den vägen.
 *
 * Modulen är medveten liten och delar mellan körningarna, så att nästa
 * förändring i RSS-spåret inte kan glömmas i den ena varianten igen.
 *
 * Vad spåret gör:
 *   1. Hämta feeden (RSS 2.0 eller Atom) via rssExtractor.
 *   2. Skriv eventsen till 03-Queue/03-extractedevents/<sourceId>.jsonl.
 *      Importen (importToEventPulse) läser top-level + gate-subdirs och
 *      skickar dem till BullMQ. Här nollas INTE något direkt till BullMQ —
 *      annars skulle samma event köas in två gånger.
 */

import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { extractFromRss } from './rssExtractor';
import type { ParsedEvent } from '../F-eventExtraction/schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.EVENTPULSE_SANDBOX_ROOT
  ? path.resolve(process.env.EVENTPULSE_SANDBOX_ROOT)
  : path.resolve(__dirname, '../..');
const EXTRACTED_DIR = path.resolve(DATA_ROOT, '03-Queue/03-extractedevents');

export type RssPathResult =
  | {
      ok: true;
      events: ParsedEvent[];
      eventsFound: number;
      /** Kort beskrivning av vad feeden gav — hamnar i sources_status. */
      verdict: string;
    }
  | {
      ok: false;
      error: string;
      verdict: string;
    };

/**
 * Är detta en RSS-källa? Registry-fältet preferredPath är det explicita
 * routingbeslutet — 'rss' betyder "URL:en är en feed, läs den som feed".
 */
export function isRssSource(source: { preferredPath?: string | null } | null | undefined): boolean {
  return source?.preferredPath === 'rss';
}

/**
 * Kör RSS-spåret för en källa.
 *
 * Returnerar ok=true med eventsen skrivna till extractedevents/, eller
 * ok=false med en feltext som kan skrivas till sources_status.
 */
export async function runRssPath(sourceId: string, url: string): Promise<RssPathResult> {
  try {
    const rssResult = await extractFromRss(url, sourceId);
    const verdict = `rss:${rssResult.format} rawCount=${rssResult.rawCount}`;

    if (rssResult.events.length === 0) {
      return {
        ok: false,
        error:
          rssResult.parseErrors[0] ??
          `RSS feed returned 0 events (format=${rssResult.format})`,
        verdict: `${verdict} errors=${rssResult.parseErrors.length}`,
      };
    }

    mkdirSync(EXTRACTED_DIR, { recursive: true });
    const lines = rssResult.events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(path.join(EXTRACTED_DIR, `${sourceId}.jsonl`), lines, 'utf-8');

    return {
      ok: true,
      events: rssResult.events,
      eventsFound: rssResult.events.length,
      verdict,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `rss exception: ${message}`, verdict: 'rss:exception' };
  }
}
