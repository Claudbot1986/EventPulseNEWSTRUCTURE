# Sökmetod-utvärdering: Steg 1 → Steg 3
## Genererad: 2026-03-31 20:00
## Steg 2: Analys och optimering

---

## Steg 1 Resultat

**Totalt kandidater:** 100
**Högpotential:** 22 (22%)
**Medelhög:** 42 (42%)
**Lågpotential:** 36 (36%)

---

## Analys av Steg 1

### Vad funkade bra:

1. **`site:.se [city] evenemang kalender`** - Mycket produktiv sökfras som snabbt gav kommunala kalendrar och lokala eventguider

2. **`site:.se arena stadium evenemang`** - Gav starka arena-kandidater (Strawberry Arena, Avicii Arena, Annexet) med hög kvalitet

3. **`site:.se konserthus opera teater program`** - Utmärkt för kulturinstitutioner med tydliga program och kalendrar

4. **Besöksbaserade turistfraser** (`Visit Stockholm`, `Visit Lund`) - Gav officiella, välskötta eventkalendrar

5. **Festival-sökningar** - Bra för säsongsbetonade evenemang med tydlig struktur

### Vad gav sämre resultat:

1. **`site:.se förening kalender evenemang`** - Gav mestadels lågpotential kandidater (idrottsföreningar, studieföreningar) med svag eventstruktur

2. **`site:.se sport matcher evenemang`** - Returnerade mest sportsajter med livesändningar och TV-scheman, inte faktiska venues

3. **`site:.se "what's on"`** - Svagt utbyte, få eller inga nya kvalitetskandidater

4. **E-sport/LAN-sökningar** - Gav mycket lågpotential-kandidater, inte kvalitetsvenues

5. **Kyrkliga söktermer** - Gav mest kyrkokalendrar som inte är generellt intressanta för breda eventsamlingar

### Brus-mönster:

| Brus-källa | Andel högpotential | Kommentar |
|------------|-------------------|-----------|
| Föreningskalendrar | ~5% | För smala eller inaktuella |
| E-sport/LAN | ~0% | Inte breda nog |
| Kyrkokalendrar | ~0% | För specifik målgrupp |
| Blogginlägg | ~10% | Ensides-artiklar, inte venues |
| Nyhetssajter | ~15% | Event-annonsering, inte venue |

---

## Metodoptimering för Steg 3

### Förbättringar att implementera:

#### 1. **Bättre sökfras-kategorisering**

| Fras-typ | Prioritet | Exempel |
|----------|----------|---------|
| Venue-specifika | HÖG | `site:.se konserthus evenemang`, `site:.se arena evenemang` |
| Kommunala kalendrar | HÖG | `site:.se [stad] evenemang` (varierat) |
| Festivaler | HÖG | `site:.se festival [stad] 2026` |
| Turist/Visit-sidor | HÖG | `site:.se visit [stad] events` |
| Mäss-/konferenscenter | MEDIUM | `site:.se mässcenter evenemang` |
| Student/universitet | MEDIUM | `site:.se universitet evenemang` |
| Idrott (sportsajter) | LÅG | Undvik rena sportsajter, fokusera på arenasidor |
| Föreningar | LÅG | Begränsa till kulturföreningar |
| E-sport/LAN | UNDVIK | Ger låg kvalitet |
| Blogg/nyheter | UNDVIK | Inte venues |

#### 2. **Fokusera på strukturerade venues**
- Konserthus och musikaler
- Teatrar och scenkonst
- Kommunala turistbyråer
- Mäss- och konferenscenter
- Stora festivaler

#### 3. **Förbättra geografisk täckning**
- Steg 1 fokuserade mycket på Stockholm, Göteborg, Malmö
- Steg 3 ska söka mer efter:
  - Mellanstora städer: Västerås, Örebro, Linköping, Norrköping, Helsingborg
  - Mindre städer med stark kultur: Umeå, Luleå, Sundsvall, Kalmar, Karlstad
  - Regionala centra: Skåne, Västergötland, Östergötland

#### 4. **Variera sökfras-strukturen**
Istället för: `site:.se evenemang kalender`
Prova: `site:.se "evenemang" OR "events" kalender program 2026`

Istället för: `site:.se sport matcher evenemang`
Prova: `site:.se arena matcher kalender evenemang`

---

## Optimerad sökstrategi för Steg 3

### Primära sökningar (hög prioritet):

```
site:.se konserthus evenemang program
site:.se teater evenemang kalender
site:.se arena evenemang biljetter
site:.se mässcenter konferens evenemang
site:.se festival 2026 evenemang
site:.se turistbyrå evenemang kalender
site:.se kulturhus evenemang program
site:.se visit [stad] events
site:.se stadshotell konferens evenemang
site:.se museum evenemang utställning
```

### Sekundära sökningar (medium prioritet):

```
site:.se student evenemang kalender
site:.se universitet konserter evenemang
site:.se idrottshall evenemang
site:.se dans evenemang program
site:.se musikförening evenemang
site:.se litteraturfestival evenemang
site:.se filmfestival evenemang program
site:.se matfestival evenemang
site:.se marknad evenemang kalender
```

### Undvik:
- `site:.se förening kalender` (för brett, för låg kvalitet)
- `site:.se sport matcher` (sportsajter, inte venues)
- `site:.se e-sport lan`
- `site:.se church congregation` (för specifikt)
- `site:.se "what's on"` (svagt)

---

## Förväntat resultat Steg 3

**Mål:** 400 nya kvalitetskandidater

**Fördelning:**
- Arena/Konserthus/Teater: ~30% (120 st)
- Kommunala/Turist: ~25% (100 st)
- Festivaler: ~15% (60 st)
- Mäss/Konferens: ~10% (40 st)
- Övriga venues: ~20% (80 st)

**Kvalitetsmål:**
- Minst 30% högpotential (tidigare 22%)
- Max 25% lågpotential (tidigare 36%)
- Bättre geografisk spridning över Sverige

---

## Sammanfattning

Steg 1 gav en bra grund men med viss överrepresentation av lågpotential föreningskalendrar och sportportal-sajter. Steg 3 optimeras genom:

1. **Fokusera på venue-specifika sökningar** snarare än föreningssökningar
2. **Variera geografin** för bättre täckning
3. **Undvika brus** från sportportalar, e-sport, kyrkor
4. **Prioritera officiella venues** (konserthus, teatrar, arenor, kommuner)

 Nästa steg: Kör 400 kandidater med denna optimerade strategi.
