## C4-AI Learnings batch-14

**STATUS: IMPLEMENTATION GAP — C4-AI NOT YET CONNECTED**

### Vad C4-AI borde göra
C4-AI ska analysera fail-mängden från rundan och ge strukturerade lärdomar enligt C-testRig-reporting.md Lag 4.

### C4-AI-input (vad som finns)
- Antal fail: 9
  - naturhistoriska-riksmuseet: failType=extraction_failure, evidence="C3: extraction returned 0 events despite C2 promising (score=125)", winningStage=C3
  - mittuniversitetet: failType=screening_failure, evidence="C2: verdict=unclear, score=4 too low", winningStage=C3
  - ois: failType=discovery_failure, evidence="C0: no internal event candidates discovered", winningStage=C3
  - kungsbacka: failType=extraction_failure, evidence="C3: extraction returned 0 events despite C2 promising (score=105)", winningStage=C3
  - h-gskolan-i-sk-vde: failType=discovery_failure, evidence="C0: no internal event candidates discovered", winningStage=C3
  - svenska-innebandyf-rbundet: failType=discovery_failure, evidence="C0: no internal event candidates discovered", winningStage=C3
  - malmo-hogskola: failType=discovery_failure, evidence="C0: no internal event candidates discovered", winningStage=C3
  - ralambshovsparken: failType=discovery_failure, evidence="C0: no internal event candidates discovered", winningStage=C3
  - malm-opera: failType=extraction_failure, evidence="C3: extraction returned 0 events despite C2 promising (score=27)", winningStage=C3

### C4-AI-output som borde produceras
- observedPattern: string
- hypothesis: string
- proposedGeneralChange: string
- changeApplied: string | null
- whyGeneral: string
- beforeSummary: string
- afterSummary: string
- sourcesImproved: string[]
- sourcesUnchanged: string[]
- sourcesWorsened: string[]
- decision: "keep" | "revert" | "unclear"
- learnedRule: string
- confidence: "high" | "medium" | "low"
- shouldBeReusedLater: "ja" | "nej" | "prövas-igen"
- networkErrorClassification: object (per Lag 4 spec)

### Nästa steg för C4-AI
1. Anslut AI-analys till fail-mängden efter varje runda
2. Mata in fail-typer, evidens och winningStage till AI
3. Ta emot strukturerade learnings och spara i denna rapportfil
4. Koppla learnings till erfarenhetsbanken

### Krav för att C4-AI ska räknas som implementerad
- AI tar emot fail-mängd och ger strukturerade learnings
- Learnings sparas i denna fil efter varje runda
- AI-resultat påverkar INTE enskilda källors utfall (AI är analys, inte extraktion)
- AI får INTE fabricera events eller overrides measured evidence