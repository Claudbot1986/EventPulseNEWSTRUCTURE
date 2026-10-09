# Visual Regression Pipeline

> Stream B.2 (Agent Trust Plan 2026-10-09).

## Vad

Screenshot-diff som körs som del av CI och fångar UI-regressioner innan de når produktion. Använder Playwrights inbyggda `expect(page).toHaveScreenshot()` (tillgänglig sedan Playwright 1.13; vi kör 1.62.1).

## Filer

```
06-UI/e2e/visual-regression/
├── README.md                  ← det här dokumentet
├── visual-regression.spec.mjs ← Playwright-spec med 4 live-views + self-test
└── baseline/                  ← godkända screenshots (committed)
```

## Vyer som täcks (de 4 användaren ser varje dag)

| Vy | Route | Test |
|----|-------|------|
| **HEM** — Senaste karusell + rekommendationer | `/` | `screen-home.png` |
| **UTFORSKA** — Sök + filter | `/utforska` | `screen-utforska.png` |
| **KARTA** — Stockholm-karta med markers | `/karta` | `screen-karta.png` |
| **AGENT** — Chatt + rekommendationer | `/agent` | `screen-agent.png` |

## Tröskelvärde

`maxDiffPixelRatio: 0.005` (0.5% pixlar). Generös nog att inte fånga font-rendering-buggar från CI-maskiner, hård nog att fånga riktiga UI-regressioner.

## Köra

### Förutsättningar

- **Live-app-tester:** Metro måste vara igång på `http://localhost:8081`:
  ```bash
  cd 06-UI && npx expo start --host lan --port 8081
  ```
- **Self-test:** inget beroende — funkar i ren CI.

### Self-test (verifierar pipeline-mekaniken)

```bash
cd 06-UI && npx playwright test e2e/visual-regression/ --grep '@visual-self-test'
```

Två assertions:
1. En inline HTML-fixture matchar sin baseline bit-exakt (deterministisk rendering).
2. En andra fixture med annan färg ger en annan screenshot (diff-mekanismen reagerar).

### Första gången — generera baseline

```bash
cd 06-UI && npx playwright test e2e/visual-regression/ \
  --grep '@visual-live' --update-snapshots
```

Granska, committa, pusha. CI kör nu diff mot dessa.

### Uppdatera baseline efter medveten UI-ändring

```bash
# 1. Starta Metro.
cd 06-UI && npx expo start --host lan --port 8081 &

# 2. Regenerera baseline.
npx playwright test e2e/visual-regression/ --grep '@visual-live' --update-snapshots

# 3. Kommitta.
git add 06-UI/e2e/visual-regression/baseline/
git commit -m "chore(visual): update baselines för <feature>"
```

### Smoke-test: fånga regression

I en separat branch, ändra en färg:
```bash
# I 06-UI/components/EventPulseCard.js — byt accent-färg
sed -i '' 's/#FFB454/#FF00FF/' 06-UI/components/EventPulseCard.js

# Kör live-testerna (ska nu faila)
cd 06-UI && npx playwright test e2e/visual-regression/ --grep '@visual-live'
```

Utan `--update-snapshots` ska testet rapportera en diff över tröskelvärdet.

## CI-integration

Lägg till i `.github/workflows/visual-regression.yml`:

```yaml
name: visual-regression
on:
  pull_request:
    paths:
      - '06-UI/**'
      - '06-UI/e2e/visual-regression/**'
jobs:
  self-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
      - run: npx playwright test e2e/visual-regression/ --grep '@visual-self-test'
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: visual-diff
          path: 06-UI/e2e/visual-regression/baseline/
```

Live-testerna kräver en körande Metro och kan köras i en staging-deploy-workflow, inte i vanlig PR-CI (för att undvika flaky fonts i CI-miljöer).

## Scope-skydd

- **Inte testa alla 25 vyer.** Bara de 4 som användaren ser varje dag.
- **Inte "pixel-perfekt match".** Tröskelvärde 0.5%, inte 0%.
- **Inte committa diff-bilder.** Bara baselines (`baseline/` checked in).
- **Inte köra live-tester i varje PR CI.** Self-test i PR, live-tester i nightly eller staging-deploy.

## På människospråk

Den här pipelinen tar screenshots av appens fyra viktigaste skärmar och jämför mot en godkänd "baseline". Om en skärm ändras utan att vi uppdaterat baselinen → fail. Det skyddar oss mot "men varför ser appen annorlunda ut?"-överraskningar.
