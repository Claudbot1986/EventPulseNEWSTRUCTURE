# Batch 1 Grovscoutnings-rapport
## Datum: 2026-04-01 05:50
## Batch: Högpotential kandidater ID 1-20 (19 URL:er)

---

## Input

**Kandidatfil:** `01-Sources/candidate-lists/010331-2045-500-candidates.md`
**Batch-fil:** `01-Sources/batch-020626-2045-batch1.txt`

---

## Sammanfattning

| Status | Antal | Andel |
|--------|-------|-------|
| ✅ promising | 1 | 5% |
| ⚠️ maybe | 13 | 68% |
| ❌ not_suitable | 5 | 26% |
| 🚫 blocked | 0 | 0% |
| 💥 bad_url | 0 | 0% |
| 🔍 manual_review | 0 | 0% |

**Total:** 19 kandidater scoutade

---

## Detaljerade Resultat

### ✅ PROMISING (1)

| Källa | URL | Reason |
|-------|-----|--------|
| Strawberry Arena | https://strawberryarena.se/evenemang/ | 6 events via ItemList schema, JSON-LD success |

### ⚠️ MAYBE (13) — Network Path

| Källa | URL | Reason |
|-------|-----|--------|
| Avicii Arena | https://aviciiarena.se/en/ | wrong-type JSON-LD, routing to network |
| Annexet | https://annexet.se/ | wrong-type JSON-LD, routing to network |
| Helsingborg Arena | https://www.hbgarena.se/ | wrong-type JSON-LD, routing to network |
| Sparbanken Skåne Arena | https://www.sparbankenskanearena.se/en/events/ | wrong-type JSON-LD, routing to network |
| Göteborgs Konserthus | https://www.gso.se/konserthuset/ | no-jsonld, routing to network |
| Scenkonst Västernorrland | https://scenkonstvasternorrland.se/sv/ | no-jsonld, routing to network |
| Västerås Konserthus | https://vastmanlandsmusiken.se/vasteras-konserthus/ | wrong-type JSON-LD, routing to network |
| Dunkers Kulturhus | https://dunkerskulturhus.se/pa-scen/musik/ | wrong-type JSON-LD (WebSite), routing to network |
| Artipelag | https://artipelag.se/hander-pa-artipelag/ | wrong-type JSON-LD, routing to network |
| Hallands Konstmuseum | https://hallandskonstmuseum.se/evenemang/ | wrong-type JSON-LD, routing to network |
| Museum Anna Nordlander | https://www.museumannanordlander.se/ | wrong-type JSON-LD, routing to network |
| Kulturhuset Jönköping | https://kulturhusetjonkoping.se/ | no-jsonld, routing to network |
| Scenkonstmuseet | https://musikmuseet.se/ | wrong-type JSON-LD, routing to network |

### ❌ NOT_SUITABLE (5)

| Källa | URL | Reason |
|-------|-----|--------|
| Halmstad Arena | https://www.halmstadarena.se/ | No JSON-LD, page has no structure |
| Sparbanken Lidköping Arena | http://sparbankenlidkopingarena.se/ | No JSON-LD, page has no structure |
| Konserthuset Stockholm | https://www.konserthuset.se/program-och-biljetter/kalender | No JSON-LD, page has no structure |
| Vara Konserthus | https://www.varakonserthus.se/ | No JSON-LD, page has no structure |
| MDU Konserter | https://www.mdu.se/utbildning/vara-utbildningsomraden/musik-och-opera/konserter | No JSON-LD, page has no structure |

---

## Återkommande Problem

### Problem 1: Många "no-jsonld" men ändå inte reject
Flera konserthus och kulturhus har inga JSON-LD men ändå inte "no structure". Detta tyder på att verktyget behöver förbättra sin HTML-analys för att bättre路由era dessa.

### Problem 2: "wrong-type" routing är inkonsekvent
Vissa `wrong-type` får `maybe` (65%) och routes to network, medan `no-jsonld` ofta får `reject` (70%). Detta är inkonsekvent - många `no-jsonld` sidor kan ha bra HTMLstruktur.

### Problem 3: Konserthus Stockholm misslyckades helt
Trots att Konserthuset Stockholm är en högpotential källa så fick den `not_suitable` pga `no-jsonld`. Detta antyder att verktyget missar potentialen i HTML-baserade sources.

---

## Scoutingverktyg Status

### Fungerar bra:
- URL sanity check fungerar stabilt
- JSON-LD diagnostik fungerar för de sidor som HAR JSON-LD
- Filerna sparas korrekt i rätt mappar
- Batch-läget fungerar

### Behöver förbättras:
1. **HTML-analys**: För `no-jsonld` sources bör verktyget undersöka HTMLstruktur innan det klassificerar som `not_suitable`. Många av de avvisade kandidaterna har sannolikt bra HTML-struktur men saknar bara JSON-LD.
2. **Confidence-justering**: `maybe` med 65% confidence är för lågt för att fatta beslut. Bör vara minst 70% om HTML ser bra ut.
3. **Routing-logic**: Network path bör testas för ALLA `no-jsonld` sources, inte bara resultera i `reject`.

---

## Skapade Filer

### I `01-Sources/candidates/` (14 filer):
- `260401-05:50-strawberryarena-se-evenemang.md` ✅
- `260401-05:50-aviciiarena-se.md` ⚠️
- `260401-05:50-annexet-se.md` ⚠️
- `260401-05:51-hbgarena-se.md` ⚠️
- `260401-05:51-sparbankenskanearena-se-events.md` ⚠️
- `260401-05:53-gso-se-konserthuset.md` ⚠️
- `260401-05:54-scenkonstvasternorrland-se.md` ⚠️
- `260401-05:54-vastmanlandsmusiken-se-vasteras-konserth.md` ⚠️
- `260401-05:54-dunkerskulturhus-se-pa-scen.md` ⚠️
- `260401-05:55-artipelag-se-hander-pa-artipelag.md` ⚠️
- `260401-05:56-hallandskonstmuseum-se-evenemang.md` ⚠️
- `260401-05:56-museumannanordlander-se.md` ⚠️
- `260401-05:57-kulturhusetjonkoping-se.md` ⚠️
- `260401-05:57-musikmuseet-se.md` ⚠️

### I `01-Sources/scouted-not-suitable/` (5 filer):
- `260401-05:50-halmstadarena-se.md` ❌
- `260401-05:51-sparbankenlidkopingarena-se.md` ❌
- `260401-05:52-konserthuset-se-program-och-biljetter.md` ❌
- `260401-05:53-varakonserthus-se.md` ❌
- `260401-05:54-mdu-se-utbildning.md` ❌

---

## Slutsats och Nästa Steg

### Verktygets mognad
`sourceScout` fungerar stabilt för gränssnittet men har en viktig begränsning: **den är för beroende av JSON-LD**. Sources utan JSON-LD men med potentiellt HTML-struktur avvisas för tidigt.

### Rekommendation
Innan nästa batch körs, bör följande förbättring göras:
1. Modifiera `computeVerdict` så att `no-jsonld` sources med god HTML-struktur routeas till `html` istället för `reject`
2. Förbättra HTML-gate trösklar för att undvika för tidig rejection

### Nästa steg
- **Fortsätt med nästa batch** - verktyget fungerar tillräckligt för att sortera kandidater
- **Batch 2**: Kommunala kalendrar och turistbyråer (ID 21-40)
- **Notering**: 14 av 19 (74%) hamnade i `maybe` vilket innebär att de behöver Network/HTML inspection i nästa fas

---

*Rapport genererad av sourceScout, 2026-04-01*
