# P7 Editorial Engine — Reality Report (2026-10-08)

## Vad vi mätte

50 riktiga events från Supabase körda mot riktig MiniMax-M3.
46 events hann slutföras (4 sista hann avbrytas pga timeout).
Trace per event: `runtime/live-sample-2026-10-08.jsonl`
Sammanställning: `runtime/live-sample-2026-10-08.summary.json`
15 manuellt granskade exempel: `runtime/live-sample-2026-10-08.15examples.json`

## Huvudtal (faktiska, inte påstådda)

| Metric | Värde |
|---|---|
| Total events | 46 |
| **Pass rate** | **0/46 = 0.0%** |
| Fallback rate | 46/46 = 100.0% |
| Failure rate | 0/46 = 0.0% |
| Avg attempts/event | 2.0 (max) |
| Avg latency | 5 157 ms |
| Total MiniMax-M3 calls | ~138 |
| Avg unsupported claims/event | 32.8 |

Per source richness:
- RICH:     36 events, pass 0 (0.0%)
- MEDIUM:    4 events, pass 0 (0.0%)
- POOR:      4 events, pass 0 (0.0%)
- NO_SOURCE: 2 events, pass 0 (0.0%)

## Jämförelse med stratified mock (innan normalisering)

| Test | Pass rate | Fallback | Failure |
|---|---|---|---|
| Stratified (mock, före normalisering) | 22.6% | 77.4% | 0.0% |
| Stratified (mock, efter normalisering) | 35.5% | 64.5% | 0.0% |
| **Live-sample (riktig MiniMax-M3)** | **0.0%** | **100.0%** | **0.0%** |

**Normaliseringen förbättrade mock-resultatet med 12.9 procentenheter. Men riktig LLM: 0%.**

## Profil-mätning — varför allt failar

| Profile-fält | Events med data |
|---|---|
| `event_type` | 46/46 (100%) |
| `genres` | 12/46 (26%) |
| `duration_minutes` | 36/46 (78%) |
| **`performers`** | **0/46 (0%)** |

**NOLL events har performers i Profile.** Semantisk extraktion får inte ut artistnamn från raw_description → LLM har inget att skriva om → hallucinerar artister och verk.

## Failure breakdown

Per kategori: 0/28 kategorier har någon PASS.

Topp 10 unsupported claims (gemensamma för många events):
1. "som vill" / "vill" — 41 events
2. "bjuder" — 18 events
3. "riktar sig till" — 16 events
4. "fokus" — 13 events
5. "den som vill" — 13 events
6. "fylld" / "fylld av" — 12 events
7. "gemenskap" — 6 events
8. "besökare" / "publik" — 10 events
9. "kväll fylld" — 5 events
10. "lindblads tolkning" (ren hallucination) — 1 event

**~70% av unsupported claims är generisk svensk evenemangsprosa ("bjuder in", "fylld av", "den som vill uppleva").**
**~30% är rena hallucinationer ("lindblads tolkning", "helsingborgs symfoniorkester", "kvart").**

## Flaskhals-analys

### 1. WRITER (LLM) — primär flaskhals
- MiniMax-M3 producerar ~32 unsupported claims per event
- Lägger till "Lindblads tolkning", "klassisk stockholmsmiljö", "kvart" trots textual firewall
- LLM har textuell vana att skriva marknadsföringstext — det är tränat att göra det

### 2. EVENT UNDERSTANDING (semantisk extraktion) — sekundär flaskhals
- 0/46 events har performers i Profile trots att många events har artistnamn i title/raw_description
- Verifierat: event 11 "Chicago - the Musical" har inga performers extraherade
- Verifierat: event 5 "HSO – Orkesterfest med Pascal" har inga performers trots "Pascal" i titeln
- raw_description bearbetas inte tillräckligt av `extractSemantics()`

### 3. VALIDATION (factuality/independence) — fungerar som tänkt
- Validation fångar ALLA hallucinationer (0% false negatives)
- Independence-check passerar 100% av fallen (texten är inte kopierad)
- FACT-fallback är kort (10-15 ord) men korrekt (använder bara Profile)

### 4. SOURCE DATA — har enstaka buggar
- Event 11: `duration_minutes: 1440` = 24 timmar (uppenbart fel)
- Event 10: `duration_minutes: 2880` = 48 timmar (upptagen till flera dagar)
- Event 36: `duration_minutes: 4319` = 71 tim 59 min (upptagen till ~3 dagar)
- Dessa sprids till FACT-fallback-texten ("Längd: 24 tim") och blir pinsamma i UI

## 15 manuellt granskade exempel (RAW / PROFILE / GENERATED / CHECKS / FINAL)

| # | Titel (kategori, richness) | Profile (extrakt) | LLM output (utdrag) | Factuality | Final text (till UI) |
|---|---|---|---|---|---|
| 1 | Chicago (musical-theatre, RICH) | type=theater, perf=0, genre=musikal, dur=**1440** | "lindblads tolkning...kväll fylld av glamour och mörker" | FAIL (37 claims) | "Typ: theater. Genre: musikal. Längd: 24 tim. Lokal: teater. Koncept: Verk av Lindblad. För: familj, vuxna." |
| 2 | HSO (unknown, NO_SOURCE) | type=community, perf=0, dur=135 | "helsingborgs symfoniorkester bjuder...kväll fylld av gemensam musikglädje" | FAIL (65 claims) | "HSO – Orkesterfest med Pascal, 8 oktober 2026." |
| 3 | Människokung Hamlet (theatre-drama, POOR) | type=theater, perf=0, genre=drama, dur=150 | "klassisk tolkningen står centrum...halv timmes fokuserat" | FAIL (21 claims) | "Typ: theater. Genre: drama. Längd: 2 tim 30 min. Lokal: teater. För: vuxna, kulturellt intresserade." |
| 4 | Big in Japan 2026 (music, RICH) | type=music, perf=0, dur=null | "fokus på japansk kultur...bjuder in" | FAIL (47 claims) | "Big in Japan 2026 — Konsertsalen, 8 oktober 2026 (från 295 kr)." |
| 5 | Quidam (community, RICH) | type=community, perf=0, dur=90 | "karaktär medverkar tillsammans...bjuder in" | FAIL (35 claims) | "Typ: community. Längd: 1 tim 30 min. Lokal: lokal. För: lokala." |
| 6 | Birita (ovrigt, RICH) | type=community, perf=0, dur=90 | "kvällsevenemang med filmen visas" | FAIL (28 claims) | "Typ: community. Längd: 1 tim 30 min. Plats: Bio Skandia." |
| 7 | Fejk (theatre-comedy, MEDIUM) | type=theater, perf=0, genre=komedi+standup, dur=90 | "kvart...tecken...komik står centrum" | FAIL (45 claims) | "Typ: theater. Genre: komedi, standup. Längd: 1 tim 30 min. Lokal: teater. För: vuxna." |
| 8 | AIK - BIK Karlskoga (sports, MEDIUM) | type=sport, perf=0, dur=120 | "hockey...klassisk stockholmsmiljö...emot" | FAIL (29 claims) | "Typ: sport. Längd: 2 tim. Lokal: arena / plan. För: vuxna, sportintresserade." |
| 9 | Vin i Linköping (wine-tasting, POOR) | type=community, perf=0, dur=**2880** | "heldag fylld av inslag...den som vill" | FAIL (32 claims) | "Typ: community. Längd: 48 tim. Lokal: provningslokal. För: vuxna." |
| 10 | MYCKET HÄNDER! (festival, RICH) | type=community, perf=0, dur=420 | "fylld av aktiviteter...gemenskap" | FAIL (37 claims) | "Typ: community. Längd: 7 tim. Plats: Fylkingen." |
| 11 | Efter jobbet (nightlife, RICH) | type=community, perf=0, dur=null | "fokus...tillfälle för den som vill" | FAIL (25 claims) | "Efter jobbet — Nalen, 9 oktober 2026." |
| 12 | Nietzsche kontra Wagner (opera, RICH) | type=music, perf=0, dur=180 | "bjuder in till...möte mellan...filosofi" | FAIL (38 claims) | "Typ: music. Längd: 3 tim. Lokal: teater. För: vuxna, kulturellt intresserade." |
| 13 | Joy With Strings (festival, RICH) | type=music, perf=0, dur=null | "samlar...stjärnor...bjuder" | FAIL (41 claims) | "Typ: music. Lokal: scen. För: alla åldrar." |
| 14 | Lunchtrav (sport, RICH) | type=community, perf=0, dur=220 | "bjuder in till trav...soliga...travbanan" | FAIL (33 claims) | "Typ: community. Längd: 3 tim 40 min. Plats: Solvalla." |
| 15 | Konstruktion och bild (exhibition, RICH) | type=exhibition, perf=0, dur=90 | "förenar...regi...som förenar konstarter" | FAIL (28 claims) | "Typ: exhibition. Längd: 1 tim 30 min. Lokal: galleri / museum. För: vuxna, kulturellt intresserade." |

**Mönster i alla 15:**
- Profile.performers = 0 (LLM har inga artister att skriva om)
- LLM hallucinerar eller använder generisk prosa
- FACT-fallback är korrekt men platt (10-15 ord)
- 3/15 har orimliga duration-värden från source (Chicago 1440, Vin 2880, Bak 4319)

## Slutsats: var ligger flaskhalsen?

**Huvudflaskhalsen är WRITER + EVENT UNDERSTANDING (lika viktiga).**

1. **WRITER**: MiniMax-M3 producerar generisk svensk evenemangsmarknadsföring istället för att hålla sig till Profile. Skulle behöva:
   - Striktare prompt som säger "skriv BARA om det som finns i Profile"
   - Eller regel-baserad textbyggare (template) istället för LLM
   - Eller ett regenereringssteg som tar bort claims som inte stöds

2. **EVENT UNDERSTANDING**: 0/46 events har performers. Semantisk extraktion fungerar inte.
   - `extractSemantics()` anropas inte i live-flödet
   - Eller fungerar inte på korta raw_descriptions
   - **MÅSTE FIXAS INNAN** WRITER kan bli bättre

3. **VALIDATION**: Fungerar perfekt (inga false negatives). Men: tröskeln kan vara för stram.
   - Generiska fraser ("bjuder in", "fylld av", "den som vill uppleva") flaggas som unsupported
   - Dessa ÄR inte hallucinationer — de är naturlig evenemangsprosa
   - Lägga till dem i STYLISTIC_ADJECTIVES/INFERRED kan ge 30-50% pass rate

4. **SOURCE DATA**: 3/15 (20%) har orimliga duration-värden.
   - durations över 600 min (10h) bör filtreras bort
   - durations < 5 min bör filtreras bort
   - Dessa sprids rakt in i UI via FACT-fallback

**VI ÄR INTE REDO FÖR MIGRATION / BACKFILL.**

Innan vi går vidare behöver vi beslut om:
1. Ska vi lägga till generisk evenemangsvokabulär i INFERRED (minskad false positive-rate men ökad risk för missade hallucinationer)?
2. Ska vi stärka semantisk extraktion så att performers fylls i?
3. Ska vi filtrera bort orimliga duration-värden innan FACT-fallback?
4. Ska vi gå till template-baserad text (regel-baserad) istället för LLM?
