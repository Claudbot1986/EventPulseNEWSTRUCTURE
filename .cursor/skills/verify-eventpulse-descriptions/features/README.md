# Features — verify-eventpulse-descriptions

| Feature | Grind | Kommando | Fil |
|---|---|---|---|
| Rå källtext syns inte i appen | A — licensgrind | `node --env-file=.env --import tsx scripts/verify-description-rights.ts` | `features/license-gate.md` |
| Källtext når inte writer-modellen | B — brandvägg | `node --env-file=.env --import tsx scripts/verify-description-rights.ts` | `features/editorial-firewall.md` |
| Utdata liknar inte källtexten | C — icke-kopia | `node --env-file=.env --import tsx scripts/verify-description-rights.ts --sample=300` | `features/non-copy.md` |
| Råtext raderas efter 30 dagar | D — time-box | `node --env-file=.env --import tsx scripts/verify-description-rights.ts` | `features/retention-timebox.md` |
| Hem/Utforska/Sök visar samma sak | E — paritet | `node --env-file=.env scripts/_audit_description_coverage.mjs` | `features/flow-parity.md` |
| Beskrivningen är prosa, inte faktmall | — — kvalitet | `node --env-file=.env --import tsx scripts/verify-description-rights.ts` | `features/prose-quality.md` |

**Ordning:** A → B → C → D → E. A, B och D är billiga och deterministiska.
C behöver en sample av riktiga events (ingen LLM — bara textjämförelse mot
källtexten som redan ligger i databasen). E är den enda som kräver att
UI-koden och select-listorna är i sync.

**Bevisfiler:**

- `runtime/verification-reports/description-rights-<timestamp>.json`
- `docs/audit/description-coverage-<datum>.md` + `docs/audit/data/*.csv`

## Historik — vad gaterna faktiskt har fångat

| Datum | Grind | Fynd | Åtgärd |
|---|---|---|---|
| 2026-11-02 | E — paritet | Hem visade **11 932 av 11 932** events utan beskrivning — `HomeScreen.js` hämtade aldrig `editorial_description`/`eventpulse_summary`/`description_license`/`venue_name`; `venue_full_name` hämtades men mappades aldrig till `venue_name` (komentar på rad 145 sade "venue_name finns inte i events_public" — fel) | select-listorna kompletterade; `venue_full_name` → `venue_name`; `eventpulse_summary` + `category_slug` forwardas i payloaden; `rowMapping.js` forwardar numera `eventpulse_summary`. Efter fix: 95 / 95 / 95 |
| 2026-11-02 | A — licensgrind | `06-UI/services/eventsCanonical.js` läser **bas-tabellen `events`**, inte vyn — vyns licensfilter gäller inte där. Vägen var död (`App-Api.js` importeras inte) men kunde aktiveras av misstag | samma `isPublicLicense`-gate lagt in (både `.js` och `.cjs`-spegeln); regressionstest `06-UI/services/eventsCanonical.license.test.ts` (8 tester) |
| 2026-11-02 | D — time-box | `runRetentionWorker` hade **ingen anropare** — inte nattkedjan, inte launchd, inte purge-plisten (den kör en annan purga). 9 154 events hade råtext, 0 rader äldre än 30 dagar ännu | steget `raw-description-retention` in i `scripts/ingestion-cron.ts`; `--retention-days`-flagga för att kunna testa urvalslogiken; rad-för-rad radering bevisad på en kontrollerad rad |
| 2026-11-02 | C — icke-kopia | — | mätning: max similarity 0,385 · medel 0,076 över 40 events |
| 2026-11-02 | C — icke-kopia | gaten mätte bara `max_similarity`; pipeline-grinden fäller även på **matchade fraser**, och profil-skyddet var avstängt i gaten | gaten skickar nu `profile` + `event` med och kräver `pass=true`; fraser som består enbart av titel-/plats-/artistord räknas som förklarade fakta. Två av 140 rader var falska positiver (titelord: "what night", "spela scrabble rum") — inte kopior (similarity 0,017 och 0,138) |
| 2026-11-02 | E — paritet | `assertFirewallClean` var importerad men **aldrig anropad** i produktion — andra försvarslinjen fanns bara i tester | `runEditorialPipeline` anropar den nu på `writerInputs` före modellanropet |
| 2026-11-02 | prose-quality | 24 av 30 LOW-level events föll tillbaka till faktmall. 145 claims underkändes — **varje** av de 40 vanligaste var connective glöd ("riktar", "erbjuder", "stödja", "bygger", "bjuder", "kombinerar"…), inte hallucinationer | `NON_FACTUAL_VOCABULARY` i `factualityCheck.ts`: ord som inte kan falsifieras mot profilen får inte bilda claims. Substansord ("scen", "lokal", "community", "genre") är **inte** i listan — de är fakta |
