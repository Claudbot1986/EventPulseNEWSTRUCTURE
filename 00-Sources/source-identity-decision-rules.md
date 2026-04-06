# SOURCE IDENTITY DECISION RULES

**Fas:** 3 av RebuildPlan.md
**Syfte:** Korta regler och konkreta exempel för att avgöra hur en source-grupp ska hanteras
**Status:** Interrim — ingen migrering ännu

---

## Fyra beslutstyper

| Decision | Förkortning | När |
|----------|-------------|-----|
| `keep-separate-subvenues` | SEPARATE | Flera legitima eventkällor på samma hostname, olika paths |
| `merge-duplicate-imports` | MERGE | Samma venue importerad flera gånger av misstag |
| `manual-review` | REVIEW | Osäkerhet, edge cases, kräver mänsklig bedömning |
| `data-error` | FIX | Uppenbart fel, t.ex. fel hostname |

---

## Regel 1: SEPARATE — Håll källor separata

**Kriterier:** Samtliga tre måste vara uppfyllda:
1. Samma hostname (`siteIdentityKey`)
2. Olika paths eller subpages (`sourceIdentityKey` skiljer sig)
3. **Varje path har ett självständigt eventflöde** — egna events, inte kopior

**Exempel 1 — Kommunal sajt:**
```
www.vasteras.se/konserthus   → Västerås Konserthus event
www.vasteras.se/konstmuseum  → Västerås Konstmuseum event
www.vasteras.se/stadsteatern → Västerås Stadsteatern event
```
**Beslut:** `keep-separate-subvenues`
**Namn:** `vasteras.se-konserthus`, `vasteras.se-konstmuseum`, `vasteras.se-stadsteatern`

**Exempel 2 — Arena med subsido:**
```
aviciiarena.se        → Avicii Arena (generella event)
aviciiarena.se/sport  → Avicii Arena Sport (sportevent)
```
**Beslut:** `keep-separate-subvenues`
**Namn:** `aviciiarena.se-main`, `aviciiarena.se-sport`

**Exempel 3 — Root + subvenues:**
```
www.lund.se              → Lunds Stad (kommunal, event?)
www.lund.se/konserthus   → Lunds Konserthus event
www.lund.se/stadsteatern → Lunds Stadsteater event
```
**Beslut:** `keep-separate-subvenues` för konserthus och stadsteatern.
**Root:** `TODO` — avgör om root har självständigt eventflöde.

---

## Regel 2: MERGE — Slå ihop duplicerade importer

**Kriterier:** Minst ett:
1. Samma URL + samma namn + samma city → ren duplicering
2. Samma URL + samma namn + olika city → importfel → behåll korrekt, ignorera fel
3. Samma URL + olika namn → granska manuellt först

**Exempel 1 — Ren duplicering:**
```
uppsala-stadsteatern.jsonl      → Uppsala Stadsteatern | Uppsala
uppsala-stadsteatern-1.jsonl    → Uppsala Stadsteatern | Uppsala
```
**Beslut:** `merge-duplicate-imports`
**Vinnare:** `uppsala-stadsteatern` (första alfabetiskt)
**Aktion:** `originalRows` + merge, en post

**Exempel 2 — Importfel med rätt stad:**
```
varmland.jsonl      → Värmland | Karlstad (riktig stad för varmland.se)
varmland-1.jsonl    → Värmland | Uppsala (fel stad)
```
**Beslut:** `merge-duplicate-imports`
**Vinnare:** `varmland` (Karlstad)
**Aktion:** `originalRows` + merge, city=Karlstad

---

## Regel 3: REVIEW — Manuell granskning

**Kriterier:** Minst ett:
1. Samma hostname, samma city, olika namn → samma venue med namnvarianter?
2. Samma hostname, olika city → två venues? (t.ex. stadsteatern.se)
3. Samma hostname, ingen tydlig path-struktur → osäker
4. Root-sidans status oklar

**Exempel 1 — Samma venue, olika namn:**
```
liseberg.jsonl       → Liseberg | Göteborg
liseberg-n-je.jsonl  → Liseberg (nöje) | Göteborg
```
**Beslut:** `merge-duplicate-imports` — samma venue, samma URL, samma city,
olika namn beror bara på type-fält. Slå ihop.

**Exempel 2 — Två städer på samma hostname:**
```
goteborgs-stadsteatern.jsonl   → Göteborgs Stadsteater | Göteborg | www.stadsteatern.se
stockholms-stadsteater.jsonl   → Stockholms Stadsteater | Stockholm | www.stadsteatern.se
```
**Beslut:** `manual-review`
**Fråga:** Är detta verkligen två separata venues som råkar dela samma webbplats,
eller är det en shared platform med samma administrative struktur?

**Rekommendation:** `keep-separate-subvenues` med `stadsteatern.se-goteborg` +
`stadsteatern.se-stockholm` — två städer, två venues, två sources.

**Exempel 3 — Samma venue eller olika?**
```
skovde-konserthus.jsonl   → Skövde Konserthus | Skövde | www.skovde.se/konserthus
skovde-stadsteatern.jsonl → Skövde Stadsteatern | Skövde | www.skovde.se/stadsteatern
```
**Beslut:** `keep-separate-subvenues` — konserthus och stadsteatern är olika
venue-typer även om de ligger på samma stadssajt. Var och en har egna events.

---

## Regel 4: FIX — Datafel

**Kriterier:** Minst ett:
1. URL pekar mot helt fel sajt (Liseberg på gronalund.com)
2. Tydligt felstavad hostname
3. URL matcher inte venue-namnet

**Exempel 1:**
```
liseberg-1.jsonl → Liseberg | Göteborg | URL=https://www.gronalund.com
```
**Beslut:** `data-error`
**Fixa:** Ändra URL till `https://www.liseberg.se`, skapa som `liseberg.se`

**Exempel 2:**
```
grona-lund.jsonl  → Gröna Lund | Stockholm | URL=https://www.gronalund.com ✓
liseberg-1.jsonl  → Liseberg   | Göteborg   | URL=https://www.gronalund.com ✗
```
**Beslut:** `data-error` för liseberg-1. `grona-lund` är korrekt på gronalund.com.

---

## Konkreta namn exempel: `domain-site`-format

| URL | sourceIdentityKey | sourceId | Beslut |
|-----|------------------|----------|--------|
| `vasteras.se/konserthus` | `vasteras.se-konserthus` | `vasteras-se-konserthus` | SEPARATE |
| `vasteras.se/konstmuseum` | `vasteras.se-konstmuseum` | `vasteras-se-konstmuseum` | SEPARATE |
| `vasteras.se` | `vasteras.se` | `vasteras-se-main` | TODO: root? |
| `vasteras.se/stadsteatern` | `vasteras.se-stadsteatern` | `vasteras-se-stadsteatern` | SEPARATE |
| `aviciiarena.se` | `aviciiarena.se` | `aviciiarena-se` | SEPARATE |
| `aviciiarena.se/sport` | `aviciiarena.se-sport` | `aviciiarena-se-sport` | SEPARATE |
| `liseberg.se` | `liseberg.se` | `liseberg` | MERGE (ren venue) |
| `liseberg.se` + `liseberg-n-je` | samma → merge | samma → en | MERGE |
| `uppsala-stadsteatern.se` + `-1` | samma → merge | samma → en | MERGE |
| `www.stadsteatern.se` → Göteborg | `stadsteatern.se-goteborg` | `stadsteatern-se-goteborg` | REVIEW |
| `www.stadsteatern.se` → Stockholm | `stadsteatern.se-stockholm` | `stadsteatern-se-stockholm` | REVIEW |
| `www.gronalund.com` → liseberg | fix URL | `liseberg` | FIX → `liseberg.se` |

---

## Sammanfattning: Decision per hostname

```
SEPARATE: falu.se, gavle.se, halmstad.se, jonkoping.se, karlstad.se,
          linkoping.se, lulea.se, lund.se, norrkoping.se, umea.se,
          vasteras.se, skovde.se, aviciiarena.se
MERGE:    uppsala-stadsteatern.se, liseberg.se, gronalund.se, varmland.se
REVIEW:    stadsteatern.se, arkitekturgalleriet.se, liljevalchs.se,
           malmoarena.se, gronalund.com
FIX:       (liseberg-1 som separate fix-post)
```

---

## TODO-regler (ännu inte implementerade)

- **Root vs subvenue:** För `jonkoping.se` + `malmo.se`: avgör om root-sidan
  har ett eget eventflöde. Om inte: ignorera root, behold bara subvenues.
  Om ja: `example.se-main`.
- **Path→venue-mappning:** `/konst` → `-konstmuseum` (type=museum),
  `/bibliotek` → `-bibliotek` (type=bibliotek). Behöver en liten mappningstabell.
- **www-normalisering:** `www.example.se` och `example.se` är samma sajt.
  Vi normaliserar alltid bort `www.` i sourceIdentityKey.
