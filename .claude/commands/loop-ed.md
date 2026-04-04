# /loop-ed — Loop Execution & Development

## STEG 0: Active Context Resolution (ALLTID först)

### Aktiv domän
1. Sök efter `*/current-task.md` i NEWSTRUCTURE/
2. Domänen vars current-task.md pekar på verkligt, aktivt arbete = **aktiv domän**
3. **Regel:** domain-local current-task.md vinner över root current-task.md
4. Läs: `NEWSTRUCTURE/<domain>/current-task.md`

### Aktiv handoff
- **Regel:** domain-local handoff vinner över root handoff
- Läs: `NEWSTRUCTURE/<domain>/handoff.md`
- Om ingen finns: skapa tom fil
- Root `handoff.md` behandlas som historik om domain-local finns

### Aktiv rules
**strömning 1 — För ingestion-domain, läs alltid:**
```
NEWSTRUCTURE/AI/ingestion.md        ← FINNS: [JA/NEJ]
NEWSTRUCTURE/AI/html-discovery.md   ← FINNS: [JA/NEJ]
NEWSTRUCTURE/AI/ai-routing.md       ← FINNS: [JA/NEJ]
```

**strömning 2 — För andra domains:**
```
NEWSTRUCTURE/AI/<domain>.md
```

**strömning 3 — Fallback:**
```
global.md
```

**Output:**
```
AKTIV RULES: [sökväg]
HTML-DISCOVERY: [sökväg eller "saknas"]
AI-ROUTING: [sökväg eller "saknas"]
```

### Aktiv workflow
- Läs `NEWSTRUCTURE/AI/<domain>-loop.md` om det finns
- Annars `.claude/commands/loop-ed.md`

### Explicita frågor att besvara:
```
AKTIV DOMAIN: [domain]
AKTIV CURRENT-TASK: [sökväg]
AKTIV HANDOFF: [sökväg]
AKTIV RULES: [sökväg]
HTML-DISCOVERY: [sökväg eller "saknas"]
AI-ROUTING: [sökväg eller "saknas"]
```

---

## Generalization Gate (MANDATORY)

**"Do not generalize from one site."**

### Regler

1. **"One domain is evidence of a symptom, not proof of a rule."**
   - Om endast en domän uppvisar problemet: klassificera som Site-Specific
   - Om 2–3+ domäner uppvisar samma problem: proceed with General

2. **"No global heuristic may be changed based on a single domain."**
   - IGNORE_PATTERNS = aldrig ändra för en enskild sajt
   - scoring-vikter = aldrig ändra för en enskild sajt
   - candidate ranking = aldrig ändra för en enskild sajt
   - URL token logic = aldrig ändra för en enskild sajt
   - negative keyword lists = aldrig ändra för en enskild sajt

3. **"If only one domain exhibits the issue, stop and classify it as Site-Specific."**
   - Tillåtna alternativ: source adapter, source-specific config, manual review
   - INTE: ändring i C0/C1/C2 för att fixa en enskild sajt

4. **Cross-Site Verification innan heuristik-ändring:**
   - Minimum 2–3 olika domäner måste visa samma mönster
   - Annars: "Provisionally General" → gör INTE implementation ännu

### Konsekvens
- Att ändra `IGNORE_PATTERNS` för Folkoperan = förbjudet utan multi-site bevis
- Att lägga till www-normalisering = tillåtet (canonicalization är generellt)

---

## Execution-First Rule

**Do NOT ask for permission for normal workflow steps.**

Normal steps that require NO permission:
- reading the required markdown files
- identifying the root cause
- inspecting relevant code
- making the smallest safe change
- running lightweight verification
- updating handoff.md
- making a git commit

**Only STOP and ASK when there is a REAL blocker:**
1. missing required file or missing repo context
2. command cannot run due to environment/runtime failure
3. multiple destructive options with materially different outcomes
4. explicit conflict between current-task.md and repository reality
5. user secrets/credentials are required and unavailable

---

## System-Effect-Before-Local-Effect

**Nästa steg väljs utifrån största pipeline-/systemnytta, inte vad som ligger närmast i senast ändrad fil.**

Frågor att besvara:
1. Vilken flaskhals blockerar FLEST events just nu?
2. Vilken ändring ger mest throughput för minst risk?
3. Vad är upstream vs downstream av nuvarande problem?

---

## Execution Loop (steg-för-steg)

1. Identifiera största verifierbara gapet mot goals.md
2. Välj exakt ett problem
3. Gör minsta säkra förändring
4. Verifiera förändringen
5. Uppdatera handoff.md
6. Avgör om samma problem ska fortsätta eller om current-task.md ska ändras
7. **Skriv obligatorisk nästa-steg-analys**
8. Gör git commit

---

## Mandatory Next-Step Analysis (EFTER VARJE LOOP)

```
## Nästa-steg-analys [TIMESTAMP]

### Vad förbättrades denna loop
- [Faktiskt resultat, inte intention]

### Största kvarvarande flaskhals
- [Root cause, inte symptom]

### Tre möjliga nästa steg

| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | [namn] | [vad det ger pipeline] | [vad som kan gå fel] | [varför rätt timing] |
| 2 | ... | ... | ... | ... |
| 3 | ... | ... | ... | ... |

### Rekommenderat nästa steg
- [#] — [kort motivering]

### Två steg att INTE göra nu
1. [fel steg] — [varför lockande men fel just nu]
2. [fel steg] — [varför lockande men fel just nu]

### System-effect-before-local-effect
- [Förklara varför valt steg ger störst pipeline-nytta]
```

---

## Strong Output Contract (EFTER VARJE LOOP)

Avsluta ALLTID med exakt dessa rubriker:

```
## Aktiv kontext
## Root-cause
## Ändringar
## Verifiering
## Kvarvarande flaskhals
## Tre möjliga nästa steg
## Rekommenderat nästa steg
## Två steg att inte göra nu
## Handoff
## Commit
```

---

## Regler
- Svara alltid på svenska
- Inga broad refactors
- Ett problem åt gången
- Optimera aldrig ett nedströms steg om uppströms val fortfarande är fel
- **Om handoff.md inte uppdaterades = uppgiften inte klar**
- **Om nästa-steg-analys saknas = uppgiften inte klar**
- **Om Strong Output Contract inte följs = uppgiften inte klar**
