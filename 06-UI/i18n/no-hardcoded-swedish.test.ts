/**
 * CI grep-gate (Språkstöd 2026-09-20): the migrated UI files must contain NO
 * hardcoded Swedish string literals — every user-facing string goes through
 * t()/uiText() and the dictionaries.
 *
 * How: strip comments, extract string literals, fail on any literal containing
 * å/ä/ö/Å/Ä/Ö. The dictionaries themselves (i18n/strings/**) and dateNames.js
 * are Swedish BY DESIGN and are excluded from the scan. Known intentional
 * leftovers (brand names like "Malmö Live" now live in the dictionaries;
 * the 'no credits BFL - recharge' operator log has no Swedish characters).
 *
 * A failing line means someone hardcoded UI copy again — move it to the
 * dictionaries instead of suppressing this test.
 *
 * Run with: npx vitest run 06-UI/i18n/no-hardcoded-swedish.test.ts (repo root)
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const UI_ROOT = resolve(__dirname, '..');

const MIGRATED_FILES = [
  'App.js',
  'AppShell.js',
  'screens/HomeScreen.js',
  'screens/ProfileScreen.js',
  'screens/NotificationsScreen.js',
  'screens/OnboardingScreen.js',
  'screens/LoginScreen.js',
  'screens/CodeEntryScreen.js',
  'screens/MagicLinkHandlerScreen.js',
  'screens/MapScreen.js',
  'components/AuthReminderModal.js',
  'components/BottomTabBar.js',
  'components/NetworkBanner.js',
  'services/agentClient.js',
  'services/notificationsClient.js',
  'utils/rankReasonLabels.js',
];

// Swedish characters that essentially never appear in non-Swedish UI copy.
const SWEDISH_CHARS = /[åäöÅÄÖ]/;

// Intentional exceptions — wire/data, not translatable UI copy:
//  - App.js deep-link share query: an agent prompt (Swedish wire data), the
//    code comment at the site documents why it must not be translated.
//  - MapScreen KNOWN_VENUES: Stockholm place-name lookup keys/names matched
//    against upstream venue data — translating them would break matching.
const ALLOWLIST = new Map<string, Set<string>>([
  // eslint-disable-next-line no-template-curly-in-string
  ['App.js', new Set(['${title} på ${venue}'])],
  ['screens/MapScreen.js', new Set(['Södra Teatern', 'Kungsträdgården', 'Göta Lejon'])],
]);

/** Remove block comments and naive line comments (URL-safe). */
function stripComments(source: string): string {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock
    .split('\n')
    // Drop `// …` unless preceded by `:` (keeps https:// schemes intact).
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/** Extract string literals (single, double, template) with å/ä/ö. */
function swedishLiterals(source: string): string[] {
  const hits: string[] = [];
  const literalRe = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/gs;
  let m: RegExpExecArray | null;
  while ((m = literalRe.exec(source))) {
    if (SWEDISH_CHARS.test(m[0])) hits.push(m[0]);
  }
  return hits;
}

describe('no hardcoded Swedish strings in migrated UI files', () => {
  for (const file of MIGRATED_FILES) {
    it(`${file} has no Swedish string literals`, () => {
      const source = readFileSync(resolve(UI_ROOT, file), 'utf8');
      const allowed = ALLOWLIST.get(file) ?? new Set<string>();
      const hits = swedishLiterals(stripComments(source)).filter(
        (lit) => !allowed.has(lit.slice(1, -1)),
      );
      expect(
        hits,
        `${file} contains hardcoded Swedish — move these into i18n/strings/: ${hits.join(', ')}`,
      ).toEqual([]);
    });
  }
});
