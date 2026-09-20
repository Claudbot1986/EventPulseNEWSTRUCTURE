/**
 * Pure lookup for the i18n shell — kept side-effect free so vitest can
 * exercise the fallback chain without React.
 *
 * Fallback chain (per build decision, do not reorder):
 *   chosen language → en → sv → the key itself.
 * The final key-echo makes gaps VISIBLE in dev instead of silently blank.
 *
 * Interpolation: `{name}` placeholders are replaced from `vars`; unknown
 * placeholders are left as-is (visible gap, never a crash).
 */

export function translate(dictionaries, language, key, vars) {
  const chain = [language, 'en', 'sv'];
  let text;
  for (const lang of chain) {
    const dict = dictionaries[lang];
    if (dict && Object.prototype.hasOwnProperty.call(dict, key)) {
      text = dict[key];
      break;
    }
  }
  if (typeof text !== 'string') return key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}
