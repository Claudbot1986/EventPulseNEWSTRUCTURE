# Väg B — Plan: Isolera Steg 4-effekten (inlänk-räkning)

**Datum:** 2026-10-09
**Stream:** A.3 (fortsättning, inom C-testRigg-scope)
**Klassificering:** Mätning / verifiering (ingen regeländring)
**Författare:** ep-lead (planering)

## Kontext — varför denna plan

Steg 4 (inlänk-räkning) implementerades i C0 i commit `cebb1e0c`. Pilotmätningarna i
slutrapporten visar **0-effekt på NO_CANDIDATES** (förväntat — dessa sajter har 0
discovery-länkar) men pilotmätningen säger inget om **working-sajter** där två
kandidater har samma `eventDensityScore`.

**Teorin:** Steg 4 ska hjälpa när:
1. En sajt har discovery-länkar (inlänk-räkning > 0 för minst en candidate)
2. Två kandidater har samma `eventDensityScore` (t.ex. båda 0.5)
3. Då vinner den med flest inlänkar — det är den som root-sidan "tycker är viktigast"

**Vad vi inte vet:**
- Hur ofta villkor 1+2+3 inträffar i verkligheten?
- När de inträffar — väljer inlänk-räkningen rätt winner (den med faktiska events)?
- Är log2-skalan rätt vald?

## Vad Väg B gör (2 faser: cohort-analys + kontrollerad mini-batch)

### Fas B.1 — Cohort-analys (ingen kod, ingen batch, bara data)

**Mål:** Hur ofta har kandidater i vår historik discovery-länkar OCH samma densityScore?

**Datakällor:**
- `02-Ingestion/C-htmlGate/reports/batch-{N}/batch-traces.jsonl` för batch-001 → batch-209
- `02-Ingestion/C-htmlGate/reports/batch-{N}/source-results.jsonl` (om finns)
- `02-Ingestion/C-htmlGate/reports/batch-{N}/c4-ai-analysis-*.md` (om finns)

**Extrahera per source:**
- `c0Candidates`: antal hittade kandidater
- `c0WinnerDensity`: vinnarens eventDensityScore
- `c0RuleSource`: sitemap / topLinks / swedish-patterns
- `c0WinnerUrl`: vinnarens URL

**Analys:**
1. Hur många sources har c0Candidates > 1?
2. Hur många har winnerDensity < 0.5 (dvs inlänk kan tippa balansen)?
3. Hur många har winnerDensity === 0 (dvs inlänk är ENDA signalen)?

**Output:** En `.md` med siffrorna, t.ex.
```
Batch 001-209 cohort-analys:
- 1234 sources totalt
- 567 (46%) hade c0Candidates > 1
- 89 (7%) hade winnerDensity < 0.5
- 23 (1.9%) hade winnerDensity === 0
→ Steg 4 kan påverka 7-46% av sources (1.9% kraftigt)
```

**Tidsåtgång:** 1-2 timmar (manuellt JSONL-parse-arbete, alternativt: kasta in i en
subagent med "verifiera cohorte Storlek" instruktion).

### Fas B.2 — Kontrollerad mini-batch (10-15 källor, ENDA om Fas B.1 visar ≥5% teoretisk påverkan)

**Villkor för att köra Fas B.2:**
- Fas B.1 visar att ≥5% av källorna teoretiskt kan påverkas
- Annars: avbryt Väg B (Steg 4 har för liten effekt att mäta)

**Mini-batch-storlek:** 10-15 källor valda enligt:
1. Har discovery-länkar (c0Candidates > 1 i historik)
2. Har två kandidater med liknande eventDensityScore
3. Blandade Stockholm + icke-Stockholm (minska bias)
4. INGA redan-vinnande källor (skippa UI-success som redan hittar events)

**Kör:**
```bash
# 1. Skapa mini-batch-queue
npx tsx runtime/ingestion/eval/site-discovery-fas1/fill-postB-preC-from-sources.ts --limit 15

# 2. Kör batch-210 (eller liknande mini-batch-nr)
npx tsx 02-Ingestion/C-htmlGate/run-dynamic-pool.ts

# 3. Aggregera → eval
npx tsx runtime/ingestion/eval/aggregate-batch-to-eval.ts <batch-id>
```

**Mät (före/efter-jämförelse på samma källor):**
- Kör varje källa TVÅ GÅNGER: en gång med Steg 4 aktiv (nuvarande kod), en gång med
  Steg 4 inaktiverad (tillfällig feature-flag i `C0-htmlFrontierDiscovery.ts`).
- Jämför `c0WinnerUrl` mellan körningarna.
- Räkna hur många gånger de skiljer sig åt.
- För de källor där de skiljer sig: manuellt inspektera — vann rätt URL?

**Output:** En `.md` med siffrorna, t.ex.
```
Mini-batch 10 källor:
- 4/10 hade samma winner båda körningarna (Steg 4 inverkan: 0)
- 6/10 hade annan winner
  - 5/6: Steg 4 vann rätt (fler events)
  - 1/6: Steg 4 vann fel
→ Steg 4 hjälper 50% av tiden, skadar 10%, ingen effekt 40%
```

### Fas B.3 — Beslut: behåll, förfina, eller ta bort Steg 4

**Tre utfall:**

| Resultat | Åtgärd |
|---|---|
| Steg 4 hjälper ≥40% av testkällor utan att skada | Behåll, committa resultat |
| Steg 4 hjälper <40% ELLER skadar ≥20% | Förfina — justera log2-bas eller tiebreaker-ordning |
| Steg 4 har 0-effekt (winner alltid densamma) | **Ta bort Steg 4** — dead code, döljer bugs |

## Filer som skapas

| Fil | Roll |
|---|---|
| `02-Operations/2026-10-09-Vag-B-Fas-B1-Cohort.md` | Output från cohort-analys (siffror) |
| `02-Ingestion/C-htmlGate/reports/batch-210-mini/` (NY) | Mini-batch outputs (gitignored) |
| `02-Operations/2026-10-09-Vag-B-Fas-B2-Resultat.md` | Output från mini-batch + före/efter-jämförelse |
| `02-Operations/2026-10-09-Vag-B-Slutbeslut.md` | Behåll/förfina/ta-bort-beslut med evidens |

## Vad INTE görs i Väg B

- ❌ Inga kod-ändringar i Fas B.1 (bara data-analys)
- ❌ Inga IGNORE_PATTERNS-ändringar
- ❌ Inga regel-justeringar i Fas B.2 (bara feature-flag för att inaktivera Steg 4 tillfälligt)
- ❌ Inget push, merge, PR förrän Fas B.3 beslut är fattat och godkänt av användaren
- ❌ Steg 4 tas bara bort efter explicit godkännande (commit + beslut)

## Verifieringsbara slutkriterier

1. ✅ Fas B.1 cohort-analys dokumenterad med siffror (per-batch-nedbrytning)
2. ✅ Beslut taget: kör Fas B.2 eller avbryt (≥5% teoretisk påverkan krävs)
3. ✅ Om Fas B.2 körs: före/efter-jämförelse med 10-15 källor
4. ✅ Fas B.3 beslut dokumenterat med konkret evidens
5. ✅ Working tree clean (eller bara feature-flag + rapport + gitignored batch-210-data)

## Risk / oklarheter

- **Cohort-analys kan visa <5%** → Väg B avbryts efter Fas B.1. Det är ett OK utfall
  (vi lärde oss att Steg 4 sannolikt har liten effekt i praktiken).
- **Mini-batch-bias:** 10-15 källor är litet urval. En outlier kan tippa resultatet.
  Mitigation: använd Wilson CI på resultatet och rapportera konfidensintervall.
- **Feature-flag i C0:** Om vi inaktiverar Steg 4 via feature-flag, måste flaggan tas
  bort efter mätningen (annars blir dead code som glöms kvar).
- **Käll-validering:** Vi vet inte i förväg om våra 10-15 källor har upptäckbara
  skillnader mellan Steg 4-på/Steg 4-av. Kan bli 0-resultat som inte är generaliserbart.

## Alternativ: hoppa över Väg B om Fas B.1 visar <5%

Om cohort-analysen visar att Steg 4 teoretiskt påverkar <5% av källorna, är Väg B
inte kostnadseffektivt — bättre att fokusera på Väg A (C1_NO_MAIN_ARTICLE, 39%).

**Beslutströskel för Väg B:** ≥5% teoretisk påverkan OCH ≥10 unika källor med
upptäckbara skillnader.

## På människospråk

Steg 4 (inlänk-räkning) är på plats men vi vet inte om det faktiskt gör nytta
i praktiken. Vi kör två faser: först tittar vi på historiska data för att se om
tillräckligt många källor teoretiskt kan påverkas. Om ja kör vi en liten batch
på 10-15 källor och jämför vad som händer med och utan Steg 4. Om nej avbryter
vi Väg B — då vet vi att Steg 4 sannolikt är overksam och kan tas bort.
