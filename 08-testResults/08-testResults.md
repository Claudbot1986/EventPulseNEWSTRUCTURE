# 08-testResults

## Syfte
Denna mapp innehåller alla e2e-testraapporten från körningar av `100testcandidates.ts` genom pipeline 01 → 02(A–G) → 03 → 04 → 05 → 06.

## Namnkonvention för körfiler
Alla testkörningsfiler ska namnges enligt:
```
ååmmdd-hhmmss-beskrivning
```
Exempel: `260330-060000-batch1-10-korning.ts`

## Struktur
- Varje batch (1-10, 11-20, etc.) får en egen körlogg och rapport
- `MONSTERKÖRNING.ts` används som spårbar loggfil under batchkörningar
- Batchrapporter namnges enligt konventionen ovan

## Spårbarhet
Allt arbete ska vara spårbart:
- Vilka källor som kördes
- Vilken metod i ingestion som användes (A–G)
- Resultat per källa (steg 01 → 02 → 03 → 04 → 05 → 06)
- Eventuella kodändringar eller verktyg som skapades
- Fel och hur de löstes

## Batchöversikt
| Batch | Källor | Status |
|-------|--------|--------|
| 1-10 | 1-10 | [PÅGÅR] |
| 11-20 | 11-20 | — |
| 21-30 | 21-30 | — |
| 31-40 | 31-40 | — |
| 41-50 | 41-50 | — |
| 51-60 | 51-60 | — |
| 61-70 | 61-70 | — |
| 71-80 | 71-80 | — |
| 81-90 | 81-90 | — |
| 91-100 | 91-100 | — |
