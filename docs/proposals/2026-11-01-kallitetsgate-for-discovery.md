# Förslag — kvalitetsgate för discovery (2026-11-01)

> Status: **genomfört** för del A. Del B (radnivå) är medvetet **ej**
> implementerad — se alternativens genomförandeordning.
> Bakgrund: mini-ingestionen 2026-10-31 och nattens körning 2026-11-01.

## Problemet

P3D promote:ar kandidater som bara har "persisterat events" som bevis. Men
"det finns rader" ≠ "raderna är evenemang". Resultatet: blogg- och nyhetssajter
ligger i registret som eventkällor och deras artikelrubrikar hamnar i grafen som
evenemang.

### Mätning (live, 154 rader från 20 promote:ade källor)

| Signal | Utfall | Användbar som gate? |
|---|---|---|
| `venue_full_name` finns | 28/154 (18 %) | **Nej** — 82 % av raderna saknar plats, även de riktiga |
| `venue_city` finns | 16/154 (10 %) | Nej |
| `start_time` finns | 154/154 (100 %) | Nej — datumet fylls alltid i med fallback |
| `ticket_url` finns | 148/154 (96 %) | Nej — faller tillbaka på käll-URL |
| `category_slug` | 124/154 = `community` | Nej — `community` är fallback |
| `confidence_score` | 15: 21 rader · 35: 106 · 55: 15 · 60: 12 | Nej — skräprader har samma poäng som riktiga |
| **titeln** | se nedan | **Ja** — det är den enda signalen som skiljer |

**Slutsats:** det finns ingen användbar signal på *radfält*. En gate måste
titta på **titeln** (och på URL:en). Det är därför förslag C (normalizer-confidence)
mäts som **förkastat** — inte av princip, utan för att mätningen visar att
fälten inte bär informationen.

### Skräpexemplar (faktiska titlar ur grafen)

- *"Har du glömt något på Kulturfestivalen?"*, *"Varför är vissa gator avstängda inför festivalen?"* — `kulturfestivalenstockholmse`
- *"Så väljer du ekologisk gurkmeja för kök och produktion"*, *"Därför dominerar mytologi och slott bland europeiska spelteman"* — `kollaborationse`
- *"Suicidpreventiva dagen uppmärksammades i Visby"* — `wwwsensusse` (annan stad!)
- *"Snart släpps biljetterna till Melodifestivalturnén 2027!"* — `wwwmynewsdeskcom`
- *"idag 31/10"* — `wwwnationalmuseumse` (datum som titel)
- *"Höstlov i Stockholm – här hittar du roliga saker att göra"*, *"Guiden till halloweenfester i Stockholm"* — `thatsupse` (4 av 65)

### Riktiga evenemang som INTE får fångas

*"Nietzsche kontra Wagner"*, *"Årsmöte"*, *"Elvis, Elvis, Elvis! - 2026"*,
*"Helgkurs – Improvisationsteater Karaktär 21-22 november"*,
*"Julmarknad på Nordiska museet"*, *"Lär dig stöpa ljus med bivax"*,
*"Utställning: Fritt fall – om modet att släppa taget"*,
*"Öppet hus på Kungliga Svenska Balettskolan"*,
*"Samtal på Systervåningen: Narrativ salong"*,
*"Nyanser av Södermalm: fotografer ger sin bild av Södermalm och Slussen"*

Mönstret är **6 oberoende domäner** (`kollaborationse`, `kulturfestivalenstockholmse`,
`wwwmynewsdeskcom`, `wwwsensusse`, `wwwnationalmuseumse`, `wwwsfotose`, `thatsupse`).
Det är alltså **General**, inte enstaka-domänfall → en gate i C-lagret är
förbjuden, men en gate i P3D är tillåten.

---

## Alternativ

### A — Kvalitetsgate i P3D:s promote-beslut (källnivå) ✅ **vald**

Smoke-evidensen innehåller redan de extraherade raderna. Innan ett beslut
`promote` tas, klassas radernas titlar. Är merparten artikelformad → beslutet
blir `reject` i stället för `promote`.

- **Fördelar:** stoppar *nya* artikelkällor innan de skrivs till `sources/`;
  liten blastradie (en ny modul + ett villkor i `decision.ts`); deterministisk
  (ingen LLM, ingen flak); lätt att testa; beslutet blir spårbart i
  `source_candidate_test_decisions.reason`.
- **Nackdelar:** en *blandad* källa (t.ex. `thatsupse`: 61 riktiga + 4 guider)
  släpps igenom och de 4 guidraderna finns kvar. Klassifikatorn är lexikal
  och svensk — en ny språkdomän kräver ny validering.
- **Utfall i mätningen:** `kollaborationse` (10 artikelrader) blockeras,
  `kulturfestivalenstockholmse` (4) blockeras, `wwwsensusse` (2) blockeras,
  `thatsupse` (4 av 65) släpps igenom, `improvisationsteaterse` (19) släpps igenom.

### B — Radfilter vid extraktion (C-gatens utdata)

Filtrera bort artikelraderna direkt ur `03-Queue/03-extractedevents/C/*.jsonl`
innan de når importen.

- **Fördelar:** renar även blandade källor; tar bort skräp direkt.
- **Nackdelar:** stor blastradie — C-gatens utdata är input till import, dedup
  och normalisering; en felaktig filtrering tömmer grafen. Klassifikatorns
  falsklarm blir synliga som *saknade evenemang*, inte som skräp.
- **Bedömning:** **senare.** Görs först när A är mätt och stabil i drift.

### C — Normalizer-gate på confidence-scoren ❌ **förkastad (mätt)**

Samma koncept som A men längre ner, i normalizern, på `confidence_score`.

- **Varför inte:** mätningen ovan visar att scoren **inte** skiljer. 106 av 154
  rader har score 35, och både skräprader och blandade rader ligger där.
- **Plus:** varm hot path — varje normalizeranrop.

### D — Efterhands-karantän av redan polluterade källor

Kör samma klassifikator mot det som redan finns i grafen och flagga
källor/källor för granskning. Kan återanvända den befintliga
retired/quarantined-mekanismen.

- **Fördelar:** rensar det som redan finns — det är 20 källor och 154 rader
  nu, och det växer.
- **Nackdelar:** automatisk radering av blandade källor (`thatsupse` 61 riktiga
  + 4 guider) kastar bort bra data. Automatisk radering är dessutom en
  fail-closed-kontrast i fel riktning: felaktig radering är inte reversibel
  utan backup.
- **Bedömning:** **ja, men som audit med förslag, inte som automatisk radering.**

### E — Trust-lager mot agenten

Behåll raderna men märk dem, och låt agenten filtrera bort låg tro.

- **Fördelar:** ingen data går förlorad; inga nya fel i ingest-lagret.
- **Nackdelar:** flyttar komplexiteten till agenten, som redan har mycket att
  göra; grafen är fortfarande skräpig för alla andra konsumenter
  (dashboard, sök-API, verifieringsskilarna).
- **Bedömning:** komplement, inte ersättning.

---

## Val

**A (källnivå i P3D) + D som audit (ej automatisk radering).**

Rationale: A stoppar det större problemet (nya artikelkällor) vid den tidigaste
och säkraste punkten — innan källan skrivs till registret. D hanterar det som
redan passerat, men **utan** att radera: auditen producerar en lista, och
radering är ett eget beslut.

B, C och E är inte förkastade i princip — B blir aktuell när A mätts i drift,
och E är ett naturligt komplement. C är förkastad på mätning, inte på åsikt.

### Vad som INTE ändras

- C0/C1/C2, URL-tokenlogik, scoring-vikter, `IGNORE_PATTERNS` — orörda.
  Gaten sitter i P3D, som är ett annat lager.
- Ingestions sätt att köra källor — orört. Mini-ingestionens princip
  ("endast antalet källor N ändras") gäller oförändrat.

---

## Relaterade luckor som uppmättes samtidigt

| Lucka | Mätning | Föreslagen åtgärd |
|---|---|---|
| **Kö-backlogg** | 316 pending-kandidater, varav **245 saknar `city`** och därför aldrig kan claimas (claim filtrerar på `city='Stockholm'`). Äldsta väntar sedan 2026-09-11. | Sätt `city` på de 245 via befintlig `backfillCandidateCities.ts` |
| **Testhastighet** | P3A producerar ~97 kandidater/natt, P3D testar 8 | Backloggen måste tömmas innan `--limit` kan höjas |
| **Titelkodning** | 63 rader har kvarvarande HTML-entiteter (`&#8211;`, `&#038;`), 1 rad har `%26` | Avkoda entiteter och percent-kodning i ett ställe (normalizer) |
| **M5 mäter antal** | Gaten räknar rader, inte evenemang | Ny sannhetsgate i verifieringsskillen |

---

## Koppling till verifieringen

`docs/proposals/2026-11-01-kallitetsgate-for-discovery.md` →
`.cursor/skills/verify-eventpulse-source-quality/` bevisar:

1. att discovery **hämtar** nya källor och att de **når databasen**,
2. att informationen är **sann** — att raderna som landar är evenemang,
3. att gaten **blockerar** artikelkällor och **släpper igenom** riktiga,
4. att inga regressioner skapas i resten av kedjan.
