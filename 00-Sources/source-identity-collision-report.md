# SOURCE IDENTITY COLLISION REPORT

**Genererad:** 2026-04-06
**Källa:** `sources/*.jsonl` (420 filer)
**Analysverktyg:** bash + python3 (read-only)

---

## Sammanfattning

| Kategori | Antal hostnames | Exempel |
|----------|----------------|---------|
| 4 filer per hostname | 1 | www.vasteras.se |
| 3 filer per hostname | 3 | www.norrkoping.se, www.jonkoping.se, www.gavle.se |
| 2 filer per hostname | 19 | Se nedan |
| 1 fil per hostname | ~396 | Normalt |

---

## TYPDELT COLLISIONER

### Typ A: Olika venues på samma sajt (LEGELEGISKT — granska manuellt)

| sourceIdentityKey | Filer | Namn | Stad | Status |
|-------------------|-------|------|------|--------|
| www.stadsteatern.se | goteborgs-stadsteatern.jsonl | Göteborgs Stadsteater | Göteborg | Manuell granskning: OLIKA städer, samma hostname |
| www.stadsteatern.se | stockholms-stadsteater.jsonl | Stockholms Stadsteater | Stockholm | Manuell granskning: OLIKA städer, samma hostname |
| www.vasteras.se | vasteras-konserthus.jsonl | Västerås Konserthus | Västerås | Manuell granskning |
| www.vasteras.se | vasteras-konstmuseum.jsonl | Västerås Konstmuseum | Västerås | Manuell granskning |
| www.vasteras.se | vasteras-stad.jsonl | Västerås stad | Västerås | Manuell granskning |
| www.vasteras.se | vasteras-stadsteatern.jsonl | Västerås Stadsteater | Västerås | Manuell granskning |
| www.norrkoping.se | norrkoping-konserthus.jsonl | Norrköpings Konserthus | Norrköping | Manuell granskning |
| www.norrkoping.se | norrkoping-museum.jsonl | Norrköpings Museum | Norrköping | Manuell granskning |
| www.norrkoping.se | norrkoping-stadsteatern.jsonl | Norrköpings Stadsteater | Norrköping | Manuell granskning |
| www.jonkoping.se | jonkoping.jsonl | Jönköping | Jönköping | Manuell granskning |
| www.jonkoping.se | jonkoping-konserthus.jsonl | Jönköpings Konserthus | Jönköping | Manuell granskning |
| www.jonkoping.se | jonkoping-stadsteatern.jsonl | Jönköpings Stadsteater | Jönköping | Manuell granskning |
| www.gavle.se | gavle-konserthus.jsonl | Gävle Konserthus | Gävle | Manuell granskning |
| www.gavle.se | gavle-konstmuseum.jsonl | Gävle Konstmuseum | Gävle | Manuell granskning |
| www.gavle.se | gavle-stadsteatern.jsonl | Gävle Stadsteater | Gävle | Manuell granskning |
| www.lund.se | lunds-konserthus.jsonl | Lunds Konserthus | Lund | Manuell granskning |
| www.lund.se | lunds-stadsteatern.jsonl | Lunds Stadsteater | Lund | Manuell granskning |

**OBS:** `www.stadsteatern.se` är ett tydligt exempel där samma hostname
har helt olika venues i helt olika städer. Site-level deduplication
AVSLÖJAR detta — det ska inte döljas. Manuell granskning krävs.

---

### Typ B: Samma venue importerad flera gånger (MERGE-KANDIDATER)

| sourceIdentityKey | Filer | ID | Namn | city | difference |
|-------------------|-------|-----|------|------|------------|
| www.gronalund.se | gr-na-lund.jsonl, gr-na-lund-n-je.jsonl | gr-na-lund, gr-na-lund-n-je | Gröna Lund (nöje) | Stockholm | test#33 vs test#98, samma URL, samma namn |
| www.liseberg.se | liseberg.jsonl, liseberg-n-je.jsonl | liseberg, liseberg-n-je | Liseberg (nöje) | Göteborg | test#34 vs test#99, samma URL, samma namn |
| www.varmland.se | varmland.jsonl, varmland-1.jsonl | varmland, varmland-1 | Värmland | Karlstad vs Uppsala | Samma URL, olika city, samma type=turism |

**OBS:** Värmland är intressant: `varmland-1` har city="Uppsala" men
url är `www.varmland.se` som pekar mot Karlstad. Detta är troligen
ett importfel där Uppsala felaktigt angavs.

---

### Typ C: Fel hostname / DATA FEL

| Fil | ID | URL | Name | Felbeskrivning |
|-----|-----|-----|------|----------------|
| liseberg-1.jsonl | liseberg-1 | https://www.gronalund.com | Liseberg | FEL! Liseberg = www.liseberg.se INTE www.gronalund.com |
| grona-lund.jsonl | grona-lund | https://www.gronalund.com | Gröna Lund | Korrekt hostname för Gröna Lund? Ja. |
| gronalund.jsonl | (saknas) | — | — | Filen saknas trots listning |

**Åtgärd:** `liseberg-1.jsonl` bör antingen:
- Fas 3.1: Rapporteras som datafel i collision-report
- Senare: Flyttas till `sources_v2/` rättade som `liseberg.se`

---

## ALLA 2-FILS HOSTNAMES

```
4 filer:  www.vasteras.se
3 filer:  www.norrkoping.se, www.jonkoping.se, www.gavle.se
2 filer:  www.varmland.se, www.uppsala-stadsteatern.se, www.umea.se,
          www.stadsteatern.se, www.skovde.se, www.malmö.se,
          www.malmoarena.se, www.lund.se, www.lulea.se,
          www.liseberg.se, www.linkoping.se, www.liljevalchs.se,
          www.karlstad.se, www.halmstad.se, www.gronalund.se,
          www.gronalund.com, www.falu.se, www.arkitekturgalleriet.se
```

---

## ANTAL UNIKA HOSTNAMES

```
Unika hostnames:  396
Totalt filer:     420
Duplicerade filer: 24
```

Av 420 filer är 24 duplicerade (samma hostname = 2+ filer).
Detta innebär 24 filer som potentiellt behöver merge eller manuell granskning.

---

## REKOMMENDERAD PRIORITETSORDNING

1. **Typ C (1 fil)** — liseberg-1.jsonl fel hostname — enklast
2. **Typ B (5 hostnames)** — merge dubbletter — medel
3. **Typ A (15 hostnames)** — manuell granskning — kräver mest arbete

---

## VERKTYG SOM BEHÖVS

- `canonical-collision-detector.ts` — read-only, genererar denna rapport
- Manuell granskningslista — Excel/MD per hostname
- Merge-beslut loggas i `sources_v2/_collision-report/decisions.jsonl`
