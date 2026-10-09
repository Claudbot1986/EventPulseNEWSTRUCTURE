---
name: golden-eval
description: Kör baseline → gör ändring → kör igen → jämför diff. Förhindrar eval-theater (publicera siffror utan förändring).
source: cursor/plugins/tree/main/pstack/skills/poteto-mode/playbooks/hillclimb.md (anpassad)
---

# Golden Eval Playbook (Stream C)

## Syfte

Förhindra eval-theater. Varje eval-resultat ska kunna spåras till en kodändring (eller avsaknad av ändring).

## Steg

### 1. Definiera runner
Sätt eller vad är "klart"? I EventPulse:
- **Deterministisk runner:** `npx tsx 08-Agent/eval/run-golden-eval.ts` (default, 23/23 efter Q13-fix)
- **M3-live runner:** `npx tsx 08-Agent/eval/run-golden-eval.ts --mode live-m3` (kräver `MINIMAX_API_KEY`)

### 2. Baseline
Kör deterministisk. Spara:
```
results/baseline-2026-10-09.json:
{
  "deterministic_pass": 23,
  "deterministic_fail": 0,
  "git_sha": "...",
  "now": "2026-08-21T17:00:00Z"
}
```

### 3. Gör ändring
Liten, fokuserad. En funktion, ett test, en docs-sida. Committa separat.

### 4. Kör igen
Samma runner, samma `--mode`, samma `now`. **Samma pinned NOW i `golden-queries.stockholm.json`.**

### 5. Jämför diff
- Bättre → ny baseline, committa, vault-post.
- Sämre → revert, ny hypotes.
- Samma → ändring var ineffektiv. Deklarera och skippa.

### 6. Trend
Spara i `08-Agent/eval/trends/<week>.json`:
```json
{
  "week": "2026-W41",
  "deterministic_pass": 23,
  "m3_pass": null,
  "divergence_pattern": []
}
```

Kör M3-mode veckovis. Logga diff: vilka queries får annorlunda svar?

## Wiring

- Eval runner: `08-Agent/eval/run-golden-eval.ts`
- Trend dir: `08-Agent/eval/trends/`
- Failure catalog: `02-Operations/2026-MM-DD-M3-Failure-Catalog.md`

## Anti-mönster

- **Eval-theater**: kör eval, publicera siffran utan kodändring. → Sätt alltid diff mot baseline.
- **Olika runner före/efter**: jämförelse ogiltig.
- **Skippa trend**: kör en gång, publicera. → Spara alltid veckovis.

## M3-mode (nytt 2026-10-09)

Lägger `--mode live-m3`-flag till run-golden-eval.ts. Kör 23 queries genom `llmRouter.composeReply` mot MiniMax-M3, jämför mot facit. Första körningen är baseline för M3.