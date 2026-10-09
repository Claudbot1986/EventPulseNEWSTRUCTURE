---
name: feature
description: Standard feature-arbetsflöde. /how → /architect → implement → /correct → /show-me-your-work. Pstack-feature-playbook.
source: cursor/plugins/tree/main/pstack/skills/poteto-mode/playbooks/feature.md
---

# Feature Playbook (Stream B)

## Steg

### 1. `/how` — förstå nuläget
- Vilka screens berörs? Läs befintliga filer (Read-only).
- Vilka features i `FEATURE_MAP.md` rör sig?
- Finns det befintlig feature-map-katalog (`06-UI/features/<name>/`)?

### 2. `/architect` — planera
- Feature-as-directory-struktur: `06-UI/features/<feature>/{ui,api,test}.{js,ts,tsx}`.
- Vilka delar rör sig? UI, state, API-koppling, tester.
- Visual regression-påverkan? Lista vilka screens som kräver baseline-bild.

### 3. Implementera
- Skriv feature-as-directory. Inga features i `components/`-rötter.
- Feature-flag om irreversibel (`EXPO_PUBLIC_<FEATURE>_ENABLED`).
- Smoke-test manuellt eller via Playwright.

### 4. `/correct` — review
- Granska mot pstack-principier. Läs `principle-type-system-discipline/SKILL.md`, `principle-migrate-callers-then-delete-legacy-apis/SKILL.md`.
- Hitta: döda exports, magic numbers, mutation istället för immutable.

### 5. `/show-me-your-work` — verifiering
- Kör `npx playwright test` för visual regression.
- Kör `npx vitest run <feature>/` för feature-tester.
- Dokumentera i vault om ändringen är strukturell (ny feature-mapp, ny regel).

## Wiring till EventPulse

- Feature-katalog: `06-UI/features/<feature>/`
- Visual regression: `06-UI/e2e/visual-regression/`
- Feature-flag-system: `EXPO_PUBLIC_*`-miljövariabler

## Anti-mönster

- **Feature-i-rotmapp**: `components/<FeatureName>.js` istället för `features/<feature>/`.
- **Ingen feature-flag**: irreversibel feature merges utan rollback-väg.
- **Skippa tester**: "tar tid" är inte giltigt skäl.