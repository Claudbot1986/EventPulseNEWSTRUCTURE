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

**TEMPORÄR NAMNGIVNING:** poster med `decision = manual-review` har under testfasen
temporär kategori `manualreview` och prefix `manualreview-`. Detta är INTE
slutlig canonical identity — det är endast en testmarkering för att möjliggöra
UI-visning och vidare analys tills slutgiltigt beslut fattats.

|| sourceIdentityKey | temporarySourceId | temporaryDisplayName | temporaryCategory | Namn | city | Decision |
|-------------------|-------------------|---------------------|--------------------|------|------|----------|
| stadsteatern.se | manualreview-stadsteatern-se-goteborg | Göteborgs Stadsteater | manualreview | Göteborgs Stadsteater | Göteborg | SEPARATE |
| stadsteatern.se | manualreview-stadsteatern-se-stockholm | Stockholms Stadsteater | manualreview | Stockholms Stadsteater | Stockholm | SEPARATE |
| arkitekturgalleriet.se | manualreview-arkitekturgalleriet-se | Arkitekturgalleriet | manualreview | Arkitekturgalleriet | Göteborg | REVIEW |
| arkitekturgalleriet.se | manualreview-arkitekturgalleriet-se-alt | Göteborgs Arkitekturgalleri | manualreview | Göteborgs Arkitekturgalleri | Göteborg | REVIEW |
| gronalund.com | manualreview-gronalund-com | Gröna Lund | manualreview | Gröna Lund | Stockholm | REVIEW |
| gronalund.com | manualreview-liseberg-1-fix | Liseberg (fel hostname) | manualreview | Liseberg | Göteborg | FIX |
| liljevalchs.se | manualreview-liljevalchs-se | Liljevalchs Konsthall | manualreview | Liljevalchs Konsthall | Göteborg | REVIEW |
| liljevalchs.se | manualreview-liljevalchs-se-alt | Liljevalchs | manualreview | Liljevalchs | Göteborg | REVIEW |
| malmoarena.se | manualreview-malmoarena-se-ishockey | Malmö Arena (ishockey) | manualreview | Malmö Arena (ishockey) | Malmö | SEPARATE |
| malmoarena.se | manualreview-malmoarena-se-main | Malmö Arena | manualreview | Malmö Arena | Malmö | SEPARATE |
| skovde.se | manualreview-skovde-se-konserthus | Skövde Konserthus | manualreview | Skövde Konserthus | Skövde | SEPARATE |
| skovde.se | manualreview-skovde-se-stadsteatern | Skövde Stadsteatern | manualreview | Skövde Stadsteatern | Skövde | SEPARATE |
| varmland.se | manualreview-varmland-se-karlstad | Värmland (Karlstad) | manualreview | Värmland | Karlstad | MERGE |
| varmland.se | manualreview-varmland-se-uppsala | Värmland (Uppsala - fel) | manualreview | Värmland | Uppsala | MERGE |

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
