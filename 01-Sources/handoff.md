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
