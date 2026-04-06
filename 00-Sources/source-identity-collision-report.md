# SOURCE IDENTITY COLLISION REPORT

**Genererad:** 2026-04-06
**Källa:** `sources/*.jsonl` (420 filer)
**Analysverktyg:** canonical-collision-detector.ts (read-only)

---

## Sammanfattning

| Decision | Antal hostname-grupper | Filer | Exempel |
|----------|------------------------|-------|---------|
| keep-separate-subvenues | 13 | 37 | www.vasteras.se → 4 paths |
| merge-duplicate-imports | 3 | 6 | uppsala-stadsteatern + liseberg |
| manual-review | 7 | 15 | www.stadsteatern.se (2 städer), gronalund.com |
| data-error | 1 | 1 | liseberg-1 på fel hostname |
| **Total** | **24** | **59** | |

---

## keep-separate-subvenues

### 13 hostnames med olika paths — ALLA subvenues separeras

| sourceIdentityKey | Filer | sourceIdentityKeys | Decision |
|-------------------|-------|-------------------|----------|
| aviciiarena.se | avicii-arena.jsonl, avicii-arena-sport.jsonl | aviciiarena.se + aviciiarena.se-sport | keep-separate-subvenues |
| falu.se | falun-konserthus.jsonl, falun-stadsteatern.jsonl | falu.se-konserthus + falu.se-stadsteatern | keep-separate-subvenues |
| gavle.se | gavle-konserthus.jsonl, gavle-konstmuseum.jsonl, gavle-stadsteatern.jsonl | gavle.se-konserthus + gavle.se-konst + gavle.se-stadsteatern | keep-separate-subvenues |
| halmstad.se | halmstad-konserthus.jsonl, halmstad-stadsteatern.jsonl | halmstad.se-konserthus + halmstad.se-stadsteatern | keep-separate-subvenues |
| jonkoping.se | jonkoping.jsonl, jonkoping-konserthus.jsonl, jonkoping-stadsteatern.jsonl | jonkoping.se + jonkoping.se-konserthus + jonkoping.se-stadsteatern | keep-separate-subvenues |
| karlstad.se | karlstad-konserthus.jsonl, karlstad-stadsteatern.jsonl | karlstad.se-konserthus + karlstad.se-stadsteatern | keep-separate-subvenues |
| linkoping.se | linkoping-konserthus.jsonl, linkoping-stadsteatern.jsonl | linkoping.se-konserthus + linkoping.se-stadsteatern | keep-separate-subvenues |
| lulea.se | lulea-konserthus.jsonl, lulea-stadsteatern.jsonl | lulea.se-konserthus + lulea.se-stadsteatern | keep-separate-subvenues |
| lund.se | lunds-konserthus.jsonl, lunds-stadsteatern.jsonl | lund.se-konserthus + lund.se-stadsteatern | keep-separate-subvenues |
| malmö.se | malmo-stad.jsonl, malmo-stadsbibliotek.jsonl | malmoe.se + malmoe.se-bibliotek | keep-separate-subvenues |
| norrkoping.se | norrkoping-konserthus.jsonl, norrkoping-museum.jsonl, norrkoping-stadsteatern.jsonl | norrkoping.se-konserthus + norrkoping.se-museum + norrkoping.se-stadsteatern | keep-separate-subvenues |
| umea.se | umea-konserthus.jsonl, umea-stadsteatern.jsonl | umea.se-konserthus + umea.se-stadsteatern | keep-separate-subvenues |
| vasteras.se | vasteras-konserthus.jsonl, vasteras-konstmuseum.jsonl, vasteras-stad.jsonl, vasteras-stadsteatern.jsonl | vasteras.se-konserthus + vasteras.se-konstmuseum + vasteras.se + vasteras.se-stadsteatern | keep-separate-subvenues |

---

## merge-duplicate-imports

### 3 hostnames — slå ihop dubbletter

| sourceIdentityKey | Filer | Namn | city | Skillnad | Decision |
|-------------------|-------|------|------|----------|----------|
| uppsala-stadsteatern.se | uppsala-stadsteatern.jsonl + uppsala-stadsteatern-1.jsonl | Uppsala Stadsteatern | Uppsala | Samma URL, samma namn | merge |
| liseberg.se | liseberg.jsonl + liseberg-n-je.jsonl | Liseberg | Göteborg | Samma URL, samma namn, olika type=nöje | merge |
| gronalund.se | gr-na-lund.jsonl + gr-na-lund-n-je.jsonl | Gröna Lund | Stockholm | Samma URL, samma namn, olika type=nöje | merge |

---

## manual-review

### 7 hostnames — kräver mänsklig bedömning

| sourceIdentityKey | Filer | Namn | city | Fråga | Decision |
|-------------------|-------|------|------|-------|----------|
| stadsteatern.se | goteborgs-stadsteatern.jsonl + stockholms-stadsteater.jsonl | Göteborgs Stadsteater + Stockholms Stadsteater | Göteborg + Stockholm | Två städer på samma hostname. Separata venues? | manual-review → SEPARATE med suffix |
| arkitekturgalleriet.se | arkitekturgalleriet.jsonl + goteborgs-arkitekturgalleri.jsonl | Arkitekturgalleriet + Göteborgs Arkitekturgalleri | Göteborg | Samma venue? Namnvariant? | manual-review |
| gronalund.com | grona-lund.jsonl + liseberg-1.jsonl | Gröna Lund + Liseberg | Stockholm + Göteborg |Två helt olika nöjesfält på samma hostname | manual-review → FIX för liseberg-1 |
| liljevalchs.se | liljevalchs.jsonl + liljevalchs-konsthall.jsonl | Liljevalchs + Liljevalchs Konsthall | Göteborg | Samma venue? Namnvariant? | manual-review |
| malmoarena.se | malm-arena.jsonl + malm-arena-ishockey.jsonl | Malmö Arena + Malmö Arena (ishockey) | Malmö | Arena + sport-subpage? | manual-review |
| skovde.se | skovde-konserthus.jsonl + skovde-stadsteatern.jsonl | Skövde Konserthus + Skövde Stadsteatern | Skövde | Olika venue-typer? | manual-review → SEPARATE |
| varmland.se | varmland.jsonl + varmland-1.jsonl | Värmland | Karlstad + Uppsala | Importfel: Uppsala ska inte vara Värmland | manual-review → MERGE |

---

## data-error

### 1 post — uppenbart fel

| Fil | ID | URL | Name | Felbeskrivning | Decision |
|-----|-----|-----|------|----------------|----------|
| liseberg-1.jsonl | liseberg-1 | https://www.gronalund.com | Liseberg | FEL! Liseberg = www.liseberg.se, inte gronalund.com | data-error → fix hostname |

---

## Antal unika hostnames (uppdaterad)

```
Unika hostnames:     396
Totalt filer:        420
Duplicerade filer:   59 (i 24 hostname-grupper)
```

---

## Verktyg som behövs

- `canonical-collision-detector.ts` — redan skapat, read-only
- `source-identity-decision-rules.md` — skapat i Fas 3.2, regler + exempel
- Manuell granskningslista — per hostname, med beslutskolumn
- Beslut loggas i `sources_v2/_collision-report/decisions.jsonl`
