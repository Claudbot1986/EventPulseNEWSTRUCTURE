# ALLA SOURCES - Deduplicerad Komplett Lista

**Genererad:** 2026-04-03
**Syfte:** Samla alla event sources från hela projektet utan dubbletter

---

## Sammanfattning

| Kategori | Antal |
|----------|-------|
| Konserthus/Opera/Teater | 9 |
| Arena/Stadium | 8 |
| Kulturhus/Museum | 6 |
| Festival | 6 |
| Sport | 6 |
| Aggregator/Plattform | 4 |
| Kommun/Turistbyrå | 3 |
| Mässcenter | 4 |
| Övrigt | 3 |
| **TOTALT** | **49** |

---

## KONSERTHUS/OPERA/TEATER (9)

| ID | Namn | URL | Stad | Path | Status |
|----|------|-----|------|------|--------|
| konserthuset | Konserthuset Stockholm | https://www.konserthuset.se/program-och-biljetter/kalender/ | Stockholm | html | verifierad |
| gso | Göteborgs Symfoniker (GSO) | https://www.gso.se | Göteborg | **html** | **scoutad** - ingen Network API hittad, routas till HTML |
| malmolive | Malmö Live | https://malmolive.se | Malmö | unknown | untestad |
| operan | Kungliga Operan | https://www.operan.se | Stockholm | **html** | **scoutad** - 0 events via HTML extraction |
| folkoperan | Folkoperan | https://www.folkoperan.se | Stockholm | unknown | untestad |
| dramaten | Dramaten | https://www.dramaten.se | Stockholm | unknown | untestad |
| varakonserthus | Vara Konserthus | https://www.varakonserthus.se | Vara | unknown | untestad |
| malmoopera | Malmö Opera | https://www.malmoopera.se | Malmö | unknown | untestad |
| goteborgsoperan | GöteborgsOperan | https://www.goteborgsoperan.se | Göteborg | unknown | untestad |

---

## ARENA/STADIUM (8)

| ID | Namn | URL | Stad | Path | Status |
|----|------|-----|------|------|--------|
| strawberryarena | Strawberry Arena | https://strawberryarena.se/evenemang/ | Stockholm/Solna | unknown | untestad |
| aviciiarena | Avicii Arena | https://aviciiarena.se | Stockholm | wrong-type | JSON-LD finns men fel typ |
| annexet | Annexet | https://annexet.se | Stockholm | unknown | untestad |
| friendsarena | Friends Arena | https://friendsarena.se | Stockholm | wrong-type | untestad |
| tele2arena | Tele2 Arena | https://tele2arena.se | Stockholm | wrong-type | untestad |
| malmoarena | Malmö Arena | https://www.malmoarena.se | Malmö | wrong-type | untestad |
| slakthuset | Slakthuset | https://slakthuset.se | Stockholm | bad-url | 404 |
| scandinavium | Scandinavium | https://www.scandinavium.se | Göteborg | unknown | untestad |

---

## KULTURHUS/MUSEUM (6)

| ID | Namn | URL | Stad | Path | Status |
|----|------|-----|------|------|--------|
| kulturhuset | Kulturhuset Stadsteatern | https://www.kulturhuset.se | Stockholm | network (API) | **aktiv** |
| artipelag | Artipelag | https://artipelag.se/hander-pa-artipelag/ | Värmdö | wrong-type | untestad |
| dunkerskulturhus | Dunkers Kulturhus | https://dunkerskulturhus.se/pa-scen/musik/ | Helsingborg | unknown | untestad |
| historiska | Historiska Museet | https://historiska.se/events/ | Stockholm | unknown | untestad |
| vasamuseet | Vasamuseet | https://www.vasamuseet.se | Stockholm | unknown | untestad |
| gronalund | Gröna Lund | https://www.gronalund.se | Stockholm | unknown | untestad |

---

## FESTIVAL (6)

| ID | Namn | URL | Stad | Path | Status |
|----|------|-----|------|------|--------|
| wayoutwest | Way Out West | https://www.wayoutwest.se/ | Göteborg | wrong-type | untestad |
| almedalsveckan | Almedalsveckan | https://www.gotland.se/rg/almedalsveckan/officiellt-program/program-2026 | Gotland | unknown | untestad |
| liseberg | Liseberg | https://www.liseberg.se | Göteborg | wrong-type | untestad |
| malmofestivalen | Malmöfestivalen | https://www.malmofestivalen.se/ | Malmö | unknown | untestad |
| medeltidsveckan | Medeltidsveckan Visby | https://www.medeltidsveckan.se/ | Visby/Gotland | unknown | untestad |
| goteborgfilmfestival | Göteborg Film Festival | https://program.goteborgfilmfestival.se/en | Göteborg | unknown | untestad |

---

## SPORT (6)

| ID | Namn | URL | Stad | Path | Status |
|----|------|-----|------|------|--------|
| vasaloppet | Vasaloppet | https://www.vasaloppet.se | Sverige | **jsonld** | **verifierad** |
| svenskfotboll | Svensk Fotboll | https://www.svenskfotboll.se/ | Sverige | unknown | untestad |
| shl | Svenska Hockeyligan (SHL) | https://www.shl.se | Sverige | unknown | untestad |
| allsvenskan | Allsvenskan | https://www.allsvenskan.se/ | Sverige | unknown | untestad |
| marathongruppen | Marathongruppen | https://marathongruppen.se/ | Sverige | unknown | untestad |
| stockholmmarathon | Stockholm Marathon | https://www.stockholmmarathon.se/ | Stockholm | unknown | untestad |

---

## AGGREGATOR/PLATTFORM (4)

| ID | Namn | URL | Stad | Path | Status |
|----|------|-----|------|------|--------|
| ticketmaster | Ticketmaster Sverige | https://www.ticketmaster.se | Sverige | api | **aktiv** |
| eventbrite | Eventbrite Sverige | https://www.eventbrite.se | Sverige | jsonld | **aktiv** |
| billetto | Billetto | https://billetto.se | Sverige | wrong-type | API-nyckel krävs |
| berwaldhallen | Berwaldhallen | https://www.berwaldhallen.se | Stockholm | jsonld (tixly-api) | **verifierad** |

---

## KOMMUN/TURISTBYRÅ (3)

| ID | Namn | URL | Stad | Path | Status |
|----|------|-----|------|------|--------|
| visitstockholm | Visit Stockholm | https://www.visitstockholm.se/event/ | Stockholm | unknown | untestad |
| malmostad | Malmö Stad Evenemang | https://evenemang.malmo.se/ | Malmö | unknown | untestad |
| goteborgstad | Göteborgs Stad Evenemang | https://goteborg.se/wps/portal/start/uppleva-och-gora/evenemang-och-turistinformation | Göteborg | unknown | untestad |

---

## MÄSSCENTER (4)

| ID | Namn | URL | Stad | Path | Status |
|----|------|-----|------|------|--------|
| malmomassan | Malmömässan | https://www.malmomassan.se/en/congress/ | Malmö | unknown | untestad |
| stockholmsmattan | Stockholmsmässan | https://stockholmsmassan.se/skapa-event/ | Stockholm | unknown | untestad |
| svenskamassan | Svenska Mässan Gothia Towers | https://svenskamassan.se/utforska-oss/vara-massor/ | Göteborg | unknown | untestad |
| elmia | Elmia | https://www.elmia.se/ | Jönköping | unknown | untestad |

---

## ÖVRIGT (3)

| ID | Namn | URL | Stad | Path | Status |
|----|------|-----|------|------|--------|
| debaser | Debaser | https://debaser.se | Stockholm | render | JS-renderad |
| fryshuset | Fryshuset | https://fryshuset.se/kalendarium | Stockholm | render | JS-renderad |
| skansen | Skansen | https://www.skansen.se | Stockholm | wrong-type | untestad |

---

## STATUSÖVERSIKT

| Status | Antal | Sources |
|--------|-------|---------|
| **aktiv** | 4 | ticketmaster, eventbrite, kulturhuset, berwaldhallen |
| **verifierad** | 2 | vasaloppet, konserthuset |
| **needs_recheck** | 2 | debaser, gso |
| **render_pending** | 2 | debaser, fryshuset |
| **untestad** | 35 | - |
| **fel** | 4 | slakthuset (404), diverse (wrong-type) |

---

## HERKUNST

Dessa sources samlades från:

| Fil/Mapp | Antal sources |
|----------|---------------|
| `sources/*.jsonl` | 8 |
| `01-Sources/100testcandidates.md` | 25+ |
| `01-Sources/candidate-lists/010331-1945-100-candidates.md` | 100 |
| `01-Sources/candidate-lists/010331-2045-500-candidates.md` | 200 |
| `01-Sources/active/active.md` | 6 |
| `runtime/sources_status.jsonl` | 8 |
| `runtime/sources_priority_queue.jsonl` | 7 |

---

## NAMNGIVNINGSINKONSISTENSER UPPTÄCKTA

1. **berwaldhallen** förekommer som:
   - `berwaldhallen` (sources/)
   - `berwaldhallen-tixly` (active/) - samma source, annorlunda namn

2. **stockholm** förekommer i active men inte i sources - är en "discovery seeding" källa, inte en vanlig venue

3. **kulturhuset** vs **kulturhusetstadsteatern** - möjlig duplication

---

*Filen genererades automatiskt från alla källfiler i projektet*
