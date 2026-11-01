# Kvalitetsgaten i P3D (promote → evenemang eller artikel?)

## Sub-features

- **Bedömning av raderna** — `assessLikeness` avgör om en uppsättning rader
  är evenemang, artiklar eller okänt. två nivåer: sidans egna deklarationer
  (bevis) och rubrikens form (indikation).
- **Beslutsfiltret** — `shouldBlockPromotion` är avsiktligt konservativt:
  bara en klar majoritet artiklar blockerar, okända rader blockerar aldrig.
- **P3D-integreringen** — `decision.ts` anropar bedömningen i promote-grenen,
  och `realToolRunner.ts` hämtar sidorna (max 5 per kandidat).
- **Skuldbank** — källor som redan är inne och som gaten skulle blockat.
  Redovisas, raderas aldrig automatiskt.

## How to get to it (user POV)

Användaren ser i appen evenemang med titel, plats och tid. Utan gaten kan en
nyhetssajt som "Kulturfestivalen" eller "kollaboration.se" listar sina
artiklar, och de hamnar i appen som evenemang — med rätt datum och fel innehåll.
Gaten är det som hindrar att appen fylls med "Vad händer i Stockholm i helgen"
som om det vore ett evenemang.

## Driving it with <harness>

```bash
cd /Users/claudgashi/EventPulse

# Gaten i sin helhet
npx tsx scripts/verify-source-quality.mjs --window 48

# Bara Q5/Q6 ur rapporten
jq '.gates[] | select(.id=="Q5" or .id=="Q6")' \
  runtime/verification-reports/source-quality-<TS>.json
```

Bevis att gaten existerar och är inkopplad:

```bash
grep -n "assessLikeness\|shouldBlockPromotion" 07-Discovery/src/sourceTesting/decision.ts
# → förväntat: import + anrop i promote-grenen
```

Bevis att den faktiskt blockerar en artikelkandidat (negativ kontroll, utan
nätverk):

```bash
npx vitest run 07-Discovery/src/sourceTesting/sourceCandidateTesting.test.ts
# → "rejects a candidate whose persisted rows are articles, not events" PASS
```

Bevis att den INTE blockerar en bra källa (positiv kontroll):

```bash
npx vitest run 07-Discovery/src/sourceTesting/sourceCandidateTesting.test.ts
# → "still promotes a candidate with event-shaped rows" PASS
# → "does NOT block a mixed candidate (några guider bland många evenemang)" PASS
```

## Gotchas

- **Sidbeviset är ensidigt.** `Article`/`NewsArticle` i JSON-LD bevisar artikel.
  Frånvaro av `Event`-typ bevisar **inte** artikel. `og:type=article` ensamt
  blockerar aldrig — royaldjurgarden.se är ett riktigt evenemang med
  `og:type=article`.
- **Rubrikmönstren är en indikation.** Tröskeln är "minst 2 artiklar OCH minst
  30 % av raderna". Enstaka artikelrubriker blockerar inte.
- **Gaten läser bara detaljrader** (`url ≠ sourceUrl`). Se
  [retro-gate.md](retro-gate.md) — det var en verklig falsklarm.
- **Q5 mäter bara promotes EFTER gaten infördes.** Före det gick källorna
  inte genom gaten, så de mäts av retro-gaten i stället.
- **Gaten raderar aldrig.** En blockerad källa blir ett `reject` i
  `source_candidate_test_decisions` — den befintliga filen `sources/<id>.jsonl`
  tas inte bort. Radering är ett eget beslut.
