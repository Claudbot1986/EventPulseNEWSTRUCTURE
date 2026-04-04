# Handoff – 01-Sources

## Senaste loop
Datum: 2026-04-03
Problem: Duplicerade och inkonsekventa sources över flera filer
Ändring: Skapade ALL_SOURCES.md med deduplicerad komplett lista från alla källor
Verifiering: Alla 49 unika sources identifierade och kategoriserade

---

## Scouting-loop (2026-04-03)
Datum: 2026-04-03
Problem: Behövde verifiera no-jsonld kandidaters lämpliga path
Ändring: Scoutade 4 källor (dramaten, varakonserthus, gso, operan)

### Scouting-resultat

| Källa | Status | Path | Confidence | Events |
|-------|--------|------|------------|--------|
| dramaten | ⚠️ maybe | html | 50% | 0 (d=3, v=3) |
| varakonserthus | ⚠️ maybe | html | 45% | 0 |
| gso | ⚠️ maybe | **network** | **65%** | 2 possible APIs |
| operan | ⚠️ maybe | html | 45% | 0 |

### Observation
- 3 av 4 källor = no-jsonld → HTML path
- 1 av 4 (gso) = no-jsonld men 2 möjliga API:endpoints → Network path
- GSO är mest lovande (65% confidence, öppna API:er)

### Nästa steg
1. ~~Testa GSO genom Network Path i 02-Ingestion~~ ✓ KLART
2. ~~Välj 1-2 HTML-källor för HTML extraction test~~ ✓ KLART (testade operan = 0 events)
3. ~~Uppdatera ALL_SOURCES.md med nya Statuser~~ ✓ KLART

---

## Verifierings-loop (2026-04-04)

### Syfte
Verifiera ett urval scoutade HTML-kandidater för att bekräfta att C2 och extraction fungerar korrekt.

### Testade källor

| Källa | URL | C2 Verdict | C2 Score | Extraction |
|--------|-----|------------|----------|------------|
| dramaten | https://www.dramaten.se | unclear | 10 | 0 events |
| malmoopera | https://www.malmoopera.se | **promising** | 48 | 0 events |
| malmolive | https://malmolive.se | **promising** | 22 | 0 events |

### C2 Page-Level Markers

| Källa | datePatterns | eventTitles | venueMarkers | priceMarkers | eventListStructure |
|--------|-------------|-------------|--------------|--------------|-------------------|
| dramaten | 3 | 12 | 3 | 0 | 0 |
| malmoopera | **32** | 14 | 1 | **5** | **6** |
| malmolive | **18** | 11 | 0 | 0 | 0 |

### Root-Cause Analys

**Problem:** C2 säger "promising" men extraction ger 0 events.

**Förklaring:**
1. C2 mäter **page-level signals** (datum i text, headings, liststruktur) - dessa är HÖGA för malmoopera/malmolive
2. Men `extractFromHtml` letar efter:
   - URLs med inbäddade datum (t.ex. `/2026-04-15-19-00/`)
   - Länkar i `/kalender/` paths
   - Swedish dates i näraliggande text
3. Root-sidorna har datum i text men INTE som klickbara event-länkar
4. Events finns på **undersidor** (t.ex. `/pa-scen/`, `/program/`, `/kalender/`)

**Slutsats:**
- Dessa källor behöver **HTML Frontier Discovery** för att hitta rätt interna sidor
- C2 är korrekt som säger "promising" - sidan ser ut som en eventsida
- Men rätt intern sida måste väljas före extraction kan fungera
- Root-sida ≠ eventsida för dessa källor

### Page Analysis (2026-04-04)

| Källa | JSON-LD | Event-länkar | Svenska datum | Root-sida som eventsida? |
|-------|---------|--------------|---------------|-------------------------|
| dramaten | 0 | **0** | 6 st | ❌ NEJ - root är "Misantropen" (pjäs) |
| malmoopera | 0 | **7** | 8 st | ⚠️ Delvis - datum i text men inte som events |
| malmolive | 0 | **2** | 0 | ❌ NEJ - root är "Malmö Live Konserthus" |

### Nästa steg
1. ~~Verifiera HTML-kandidater~~ ✓ KLART
2. Identifiera root-cause ✓ KLART
3. Dokumentera behov av HTML Frontier Discovery
4. Välja nästa kandidater att scouta

---

### Batch scouting (2026-04-03)
Datum: 2026-04-03
Problem: Behövde systematiskt scouta alla untestade källor
Ändring: Körde sourceScout --batch på 55 källor

### Batch-resultat (51/55 klara)

**Kandidater (41 st → candidates/):**
| Path | Antal | Exempel |
|------|-------|---------|
| html | 15 | operan, dramaten, vasamuseet, gronalund |
| network | 26 | folkoperan, allsvenskan, skansen, liseberg |

**Rejected (10 st → scouted-not-suitable/):**
| Reason | Antal | Sources |
|--------|-------|---------|
| DNS/bad_url | 5 | goteborgsoperan, stora-teatern, sparbankenlidkopingarena, elmia, goteborgfilmfestival |
| blocked (404) | 1 | slakthuset |
| not_suitable | 4 | debaser, fotografiska, wayoutwest |

**Inga med JSON-LD events hittades!**

### Nyckelobservationer
- ~80% av källor = no-jsonld → HTML eller Network
- ~20% = wrong-type JSON-LD (WebSite, Organization, etc) → Network
- 0 källor med Event JSON-LD utanför redan verifierade (ticketmaster, eventbrite, berwaldhallen)
- Många DNS/404 fel = URL:er behöver uppdateras

### Nästa steg
1. Fokusera på Network path kandidater (26 st) - kolla om API:erna faktiskt fungerar
2. För HTML path (15 st) - testa subpage discovery
3. Rensa bort döda URLs från ALL_SOURCES.md

Commit: ed2ca14 (efter uppdatering)

---

---

## Fasavslutning (2026-04-04)

### Sammanfattning
**01-Sources fas AVSLUTAD.** Nästa aktiv domain är `02-Ingestion`.

### Vad som verifierades
- C2 och extractFromHtml testades på 3 HTML-kandidater
- **dramaten**: C2=unclear(10), 0 events
- **malmoopera**: C2=promising(48), 0 events  
- **malmolive**: C2=promising(22), 0 events

### Root-cause (bekräftad)
- C2 mäter page-level signals (datum i text, headings, liststruktur)
- Men extractFromHtml behöver: URLs med datum ELLER /kalender/-länkar ELLER Swedish dates
- Root-sidorna = nationalscen/konserthus, INTE event-listings
- Events finns på undersidor: `/pa-scen/`, `/program/`, `/kalender/`
- **Nästa steg: HTML Frontier Discovery i 02-Ingestion**

### Överlämning till 02-Ingestion
Läs:
- NEWSTRUCTURE/02-Ingestion/current-task.md
- NEWSTRUCTURE/02-Ingestion/handoff.md

Fokus för 02-Ingestion:
1. HTML Frontier Discovery för malmoopera, malmolive, dramaten
2. Hitta rätt intern sida före extraction
3. C2 kan redan identifiera "promising" pages - nu behövs intern page-val

---

## Tidigare loop (2026-04-02)
Datum: 2026-04-02
Problem: Inga handoff-filer fanns för området
Ändring: Strukturen skapad, inga ändringar i källkod
Verifiering: Ej kör ännu
Commit: ingen ny commit
Nästa steg: Välj en liten grupp kandidater och kör scouting

---

## Nuvarande status

- sourceScout används för scouting
- 01-Sources/candidates/ används för maybe-resultat
- 01-Sources/scouted-not-suitable/ används för not_suitable
- minst en maybe-kandidat har skapats och sparats korrekt

---

## Öppna problem

1. Få källor blir promising
2. Många källor saknar JSON-LD och öppen API-path
3. HTML-path måste avgöra fler fall korrekt längre fram i kedjan

---

## Nästa rekommenderade steg

- Välj en liten ny grupp kandidater
- Verifiera dem
- Dokumentera utfallet
- Låt bara verkligt lovande källor gå vidare

---

## Regler för automatisk uppdatering

AI-agenten ska efter varje loop:
1. Uppdatera "Senaste loop"
2. Uppdatera status endast med verifierade fakta
3. Uppdatera öppna problem om något ändrats
4. Uppdatera nästa rekommenderade steg
