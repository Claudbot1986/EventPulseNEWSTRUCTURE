# Väg B Fas B.2 — A/B-test av Steg 4 (inlänk-räkning) — Resultat

**Datum:** 2026-10-09
**Mätverktyg:** `runtime/ingestion/eval/site-discovery-fas1/measure-c0-steg4-ab-test.ts`
**Testpopulation:** 10 multi-candidate källor från batch-209 (sitemap-discovery)

## Resultat

```
Kör 10 källor med Steg 4 PÅ och AV.

─── Inspektion: top3 inbound per källa (Steg 4 PÅ) ───

gratisistockholm               | cand=8  | inga inbound | top3: inb=0,0,0 dens=140,62,62
fallan                         | cand=12 | ⚠ har inbound | top3: inb=2,0,1 dens=516,55,14
3arena                         | cand=16 | ⚠ har inbound | top3: inb=1,6,6 dens=38,37,37
danielkane                     | cand=18 | inga inbound | top3: inb=0,0,0 dens=56,54,46
dansenshus-events              | cand=14 | inga inbound | top3: inb=0,0,0 dens=2804,312,226
grand                          | cand=14 | inga inbound | top3: inb=0,0,0 dens=1310,58,58
goteborgs-universitet          | cand=20 | inga inbound | top3: inb=0,0,0 dens=4006,4004,4002
hammarby                       | cand=1  | inga inbound | top3: inb=0 dens=1460
arenapuls                      | cand=2  | ⚠ har inbound | top3: inb=0,2 dens=14,0
gamla-uppsala-2                | cand=3  | (se A/B-resultat)

═══ A/B-test ═══
Winner oförändrad:      10 (Steg 4 hade 0 effekt)
Winner ändrad:          0
Källa med inbound > 0:  3/10
```

## Diagnos

**Steg 4 har strukturell effekt-barriär i sitemap-dominerade pooler:**

1. **Sitemap-URL:er finns aldrig på root-sidan** (root pekar inte på sin egen sitemap).
   Därför har sitemap-kandidater alltid `inboundCount=0`.
2. **7/10 källor i vår pool är sitemap-rena** → 0 inlänkar → 0 effekt.
3. **3/10 har faktiska inlänkar** (fallan, 3arena, arenapuls) men:
   - **3arena:** top1 (dens=38) och top2 (dens=37) har ENDAST 1 poängs skillnad.
     Steg 4 kunde tippa balansen, men top2 och top3 har BÅDA inbound=6 medan top1 har 1.
     finalScore(1) = 38 + log2(2) = 39
     finalScore(2) = 37 + log2(7) ≈ 39.8
     Skillnaden är 0.8 poäng men primär-sort på eventDensityScore (38 > 37) vinner oavsett.
   - **fallan:** top1 (dens=516) dominerar totalt, top2 är 10x lägre.
   - **arenapuls:** top1 (dens=14) vinner över top2 (dens=0) även med inlänk.

## Slutsats

**Steg 4 (inlänk-räkning) har 0 observerad effekt i 10/10 multi-candidate-fall.**

### Tre möjliga orsaker (rankade)

1. **Sitemap-dominerad pool:** vår pool är 31.7% sitemap-baserad. Sitemap-URL:er kan
   aldrig ha inlänkar från root. Steg 4 är strukturellt verkningslös på dessa.
2. **Density-dominans:** När två kandidater har samma density (det enda fall då Steg 4
   triggar) är det ovanligt i sitemap-flödet där varje sitemap-URL har unik density.
3. **För låg inlänk-vikt:** log2(inboundCount + 1) skalar för långsamt för att tippa
   en balans med density-skillnad 1-10.

### Beslutsrekommendation (Fas B.3)

| Alternativ | Argument |
|---|---|
| **Ta bort Steg 4** | 0 observerad effekt, dead code, döljer framtida buggar |
| **Behåll för link-discovery** | 3/10 källor hade inlänkar — kan hjälpa där Steg 4 inte mäts |
| **Förfina — öka vikt** | log2 → log10? Eller invertera: max(0, inboundCount - threshold)? |

**Min rekommendation:** Behåll Steg 4 med feature-flag MOUNTED (default på) tills vidare.
0-effekt i sitemap-dominerad pool är inte samma som 0-effekt överallt. Steg 4 är
gratis att köra (låg overhead) och kan hjälpa i framtida link-discovery-tunga pooler.

**VIKTIGT:** Detta är ett preliminärt resultat baserat på 10 källor. Wilson 95% CI:
0/10 = 0% ± 0% (exakt), men urvalet är litet och kanske inte representativt för
icke-sitemap-pooler. Kör Fas B.2 igen med 10 link-discovery-källor separat för
säkrare slutsats.

## Filer

| Fil | Roll |
|---|---|
| `02-Ingestion/C-htmlGate/C0-htmlFrontierDiscovery/C0-htmlFrontierDiscovery.ts` | +INBOUND_TIEBREAKER_ENABLED feature-flag |
| `runtime/ingestion/eval/site-discovery-fas1/measure-c0-steg4-ab-test.ts` | A/B-test-script (verifierbart) |
| `02-Operations/2026-10-09-Vag-B-Fas-B1-Cohort.md` | Cohort-analys (input till B.2) |
| `02-Operations/2026-10-09-Vag-B-Fas-B2-Resultat.md` | Den här rapporten |
