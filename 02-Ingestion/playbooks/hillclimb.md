---
name: hillclimb
description: En metric, en hypotes, ett försök i taget. Pstack-standardprocess för kvalitetsförbättring i ingestion.
source: cursor/plugins/tree/main/pstack/skills/poteto-mode/playbooks/hillclimb.md
---

# Hillclimb Playbook (Stream A)

## Syfte

Förbättra en specifik metric i taget. Undvik "vi fixar allt samtidigt" — då vet vi inte vad som faktiskt hjälpte.

## Steg

### 1. Välj metric
En enda siffra. Inte "kvalitet" — för vagt. Exempel:
- Per-gate conversion rate (A→B, B→C, C→D)
- Per-source extract quality (events found / events verified)
- Hillclimb-resultat för en enskild source

### 2. Baseline
Kör eval mot nuvarande kod. Spara siffran. **Skriv baseline-filen** med datum + git-sha.

### 3. En hypotes
Skriv ner: "Vi tror att X förändring ger Y effekt, eftersom Z". En mening.

### 4. Gör ändringen
Minimal. En fil eller en funktion. Committa separat (eller i en worktree om riskabelt).

### 5. Kör eval igen
Samma runner, samma fixture. **Samma runner-kommando**, annars är jämförelsen ogiltig.

### 6. Jämför
- Bättre → committa, ny baseline. Gå till steg 1 med NY metric.
- Sämre → revert, ny hypotes.
- Samma → omtolka hypotes, annars är den inte falsifierbar.

### 7. Rapportera
I vault: `02-Operations/2026-MM-DD-Hillclimb-<metric>.md`. Citera princip: `principle-prove-it-works/SKILL.md`, `principle-outcome-oriented-execution/SKILL.md`.

## Anti-mönster (förbjudna)

- **Eval-theater**: kör eval utan att ändra kod, publicera siffran.
- **Multi-metric hillclimb**: förändra 3 saker på en gång.
- **Untracked experiment**: ändra kod utan baseline.

## Wiring till EventPulse

- Metric source: `02-Ingestion/reports/baseline-2026-10-09.json` (initial baseline)
- Eval runner: `vitest run 02-Ingestion/<gate>/`
- Hypothesis log: `02-Ingestion/hillclimb-log.md` (TODO: skapa vid behov)