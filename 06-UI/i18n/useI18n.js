/**
 * Stable import surface for consumers: `import { useI18n } from '../i18n'`
 * and `import { useI18n } from '../i18n/useI18n'` both work. The hook itself
 * lives in ./index.js next to the provider it reads from.
 */
export { useI18n } from './index';
