/**
 * 09-DiscoveryAgent/env.ts — laddar .env FÖR alla andra moduler.
 *
 * 2026-10-31 — discovery-agenten fick env-värden (EXA_API_KEY, ScrapingBee-nyckel
 * m.fl.) genom att en importerad modul råkade köra `dotenv.config()`. Det var
 * implicit beroende: ändrade man importordningen eller togs modulen bort
 * skulle Exa-kedjan tyst bli "EXA_API_KEY not configured".
 *
 * Den här modulen importeras FÖRST i agent.ts, så att .env är laddad innan
 * någon annan modul läser process.env. Sökvägen löses mot modulens egen
 * plats (inte cwd) — cron-jobbet startar inte nödvändigtvis i projektroten.
 */
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.resolve(__dirname, '../.env'),
  // false = en explicit satt env-variabel vinner över .env.
  override: false,
});

export const ENV_PATH = path.resolve(__dirname, '../.env');
