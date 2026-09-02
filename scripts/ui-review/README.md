# UI-review-loop — isolerad visuell UI-granskning

Isolerad loop för visuell UI-review av EventPulse-appen (Expo web).

```
Claude Code (text endast)
  → run-iteration.mjs          startar/kontrollerar Expo web
  → ui-screenshot.py           Playwright renderar vy, sparar PNG + dom-audit.json
  → ui-vision-review.ts        skickar PNG direkt till Ollama GLM-5.3-Flash (egen process)
  ← review.json + review.md    textbaserad UI-review
  → Claude läser ENDAST textresultatet → förbättrar UI:t → ny iteration
```

## SÄKERHETSREGL (kritisk)

1. **Claude Code får ALDRIG använda Read på PNG/JPG-screenshots i denna workflow.**
   Bildanalysen sker uteslutande i den fristående processen
   `ui-vision-review.ts` → Ollama → `glm-5.3-flash:cloud`. Bildinput via
   Claude Code → Ollamas Anthropic-lager ger `400 this model does not support
   image input` och kan krascha sessionen.
2. Claude konsumerar endast: `review.md`, `review.json`, `review-error.json`,
   `dom-audit.json`, `loop-state.json` och stdout från kommandona.
3. Om vision-reviewern misslyckas: felet fångas, loggas i `review-error.json`,
   loopen stoppas kontrollerat — huvudsessionen kraschar aldrig.

## Användning

```bash
# En iteration (skapar ny session, startar Expo web om den är nere)
node scripts/ui-review/run-iteration.mjs --view utforska

# Nästa iteration efter UI-förbättring (fortsätter senaste sessionen)
node scripts/ui-review/run-iteration.mjs --continue

# Explicit session + extra granskningsfokus
node scripts/ui-review/run-iteration.mjs --session-dir runtime/verify/ui-review/<ts> --focus "granska tabbaren"
```

Vyer: `utforska` | `hem` | `notiser` | `profil` (tabbar i `06-UI/components/BottomTabBar.js`).

Enstaka steg (för felsökning):

```bash
python3 scripts/ui-review/ui-screenshot.py --view utforska --out-dir /tmp/ui-debug
npx tsx scripts/ui-review/ui-vision-review.ts --screenshot <top.png> --out-dir /tmp/ui-debug
```

## Loop-regler

- **Default max 3 iterationer** per session (`--max-iterations`, vägrar köra fler).
- STOP tidigare om:
  - inga high/critical-issues återstår
  - försumbar förbättring mellan iterationer (< 5 poäng)
  - regression (≥ 5 poäng sämre)
  - vision-reviewern misslyckades
- Manuell STOP (Claudes bedömning): nästa ändring kräver produktbeslut
  snarare än UI-polish.

Rekommendationen (`CONTINUE`/`STOP` + skäl) skrivs i `loop-state.json` och
skrivs ut på stdout efter varje iteration.

## Artefakter

`runtime/verify/ui-review/` (gitignorad via `/runtime/`):

```
<session-ts>/
  loop-state.json          iterationer, scores, rekommendation
  expo-web-8088.log        Expo-logg om orchestratorn startade Expo
  iter-N/
    view-<vy>-top.png      övre viewport (primär för vision-review)
    view-<vy>-mid.png      mitten av feeden
    view-<vy>-full.png     hel sida (skickas endast om < 4 MB)
    dom-audit.json         naturalWidth-audit, knappar, texturval, konsol-logg
    review.json            strukturerad review (score, issues, rekommendationer)
    review.md              mänskligt läsbar version
    review-error.json      endast vid fel (stage, error, model)
```

## Review-schema

```json
{
  "score": 0-100,
  "summary": "…",
  "critical_issues": [],
  "high_priority": [],
  "medium_priority": [],
  "low_priority": [],
  "strengths": [],
  "recommended_changes": [{ "area", "problem", "change", "reason" }]
}
```

Reviewern bedömer: visual hierarchy, spacing, alignment, typography, density,
consistency, component proportions, card design, navigation, discoverability,
visual polish, mobile usability, uppenbara tillgänglighetsproblem, empty
states, loading states, clipping/overflow, trasiga layouter, intentional vs
generisk, och stöd för EventPulse produktmål — mot benchmarken i
`docs/UI-DESIGN.md`.

## Konfiguration

| Miljövariabel | Default | Beskrivning |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434/v1` | Ollama OpenAI-kompatibel endpoint |
| `UI_REVIEW_MODEL` | `glm-5.3-flash:cloud` | vision-kapabel modell |
| `UI_REVIEW_URL` | `http://localhost:8088` | Expo web-URL |
| `OLLAMA_API_KEY` | `ollama` | dummy — Ollama kräver ingen nyckel |

## Integration (senare)

- **UI-verifieringshook:** `scripts/ui-render-verify-hook.mjs` kan anropa
  `run-iteration.mjs` i stället för att bara varna.
- **EventPulse Agent Runtime / expo-profilen:** `run-iteration.mjs` är en
  självständig text-CLI (exit 0 = ok, 1 = fel, 2 = loop-vägran) som kan
  läggas in som gate eller verktyg.

Alla paths resolveras relativt skriptplatsen — inga hårdkodade absoluta paths.