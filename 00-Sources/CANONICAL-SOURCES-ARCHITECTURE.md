# CANONICAL SOURCES ARCHITECTURE — Fas 3 Design

**Fas:** 3 av RebuildPlan.md
**Status:** Analys och design — INGEN migrering ännu
**Datum:** 2026-04-06
**Version:** 2 — med subvenue-stöd och `domain-site`-namnregel

---

## 1. Nulägesproblem

### 1.1 Fil-per-source vs site-level identity

Nuvarande `sources/` har **420 filer** men varje fil representerar en rad
i en importlista — inte en canonical source. Samma hostname kan ha flera filer.

**Analys med canonical-collision-detector.ts (23 hostname-grupper, 51 duplicerade filer):**

| Kategori | Antal hostname-grupper | Filer | Exempel |
|----------|------------------------|-------|---------|
| Type C: Olika paths, samma hostname | 13 | 37 | www.vasteras.se → 4 paths |
| Type A: Olika venues, samma hostname | 9 | 19 | www.stadsteatern.se → Göteborgs + Stockholms |
| Type B: Samma venue, duplicerad import | 1 | 2 | www.uppsala-stadsteatern.se |
| 1 fil per hostname | ~396 | 396 | Normalt |

---

## 2. Principbeslut: Två nivåer av identitet

### 2.1 Varför hostname-ensam inte räcker

RebuildPlan.md.sektion 2.1 noterade "TODO: edge case" för fall där samma
hostname har helt olika eventkällor på olika paths. Exempel:

- `www.vasteras.se/konserthus` → Västerås Konserthus (egna event)
- `www.vasteras.se/konstmuseum` → Västerås Konstmuseum (egna event)
- `www.vasteras.se/stadsteatern` → Västerås Stadsteatern (egna event)
- `www.vasteras.se` → Malmö Stad (root, eventuell annan feed)

Dessa är **fyra olika eventkällor** med fyra olika eventflöden. Att slå ihop
dem till en enda source baserat på hostname skulle antingen:
- duplicera event från varje subvenue
- eller dölja att varje subvenue har ett eget program

**Därför införs två identity-nivåer.**

### 2.2 Två-nivå identitetsmodell

**Nivå 1: `siteIdentityKey` (hostname)**
- Endast hostname, strippat www och path
- Används för: grov gruppering, matchning mot befintliga sources
- Exempel: `vasteras.se`, `liseberg.se`

**Nivå 2: `sourceIdentityKey` (path-level)**
- Normaliserad URL utan trailing slash
- Används för: canonical dedup, filing, sourceId-generering
- Format: `hostname[/path-segment]`
- Exempel: `vasteras.se-konserthus`, `vasteras.se-konstmuseum`, `vasteras.se`

**Dedup-regel:** Två import-rader med samma `sourceIdentityKey` slås ihop.
Olika `sourceIdentityKey` på samma `siteIdentityKey` är **separata sources**.

### 2.3sourceIdentityKey-generering

```
Input:  https://www.vasteras.se/konserthus
Steg 1: Strippa protocol → www.vasteras.se/konserthus
Steg 2: Strippa www.     → vasteras.se/konserthus
Steg 3: Strippa trailing / → vasteras.se/konserthus

sourceIdentityKey = vasteras.se-konserthus
sourceId = genereras från sourceIdentityKey
```

```
Input:  https://www.vasteras.se
Steg 1: Strippa protocol → www.vasteras.se
Steg 2: Strippa www.     → vasteras.se
Steg 3: Strippa trailing / → vasteras.se

sourceIdentityKey = vasteras.se
sourceId = vasteras-se (eller liknande, se namnregeln nedan)
```

### 2.4sourceId-generering från sourceIdentityKey

Samma befintliga logik som i import-raw-sources.ts, applicerad på
hela sourceIdentityKey (inklusive path-delen):

1. Strippa .se/.no/.dk/.fi/.nu
2. Ersätt ÅÄÖ → A, Ö → O
3. Ersätt `_` och `-` med `-`
4. Strippa ledande/avslutande `-`
5. Max 40 tecken

---

## 3. Namnregel: `domain-site`

### 3.1 Grundregel

När en source är en subvenue (path ≠ root) genereras ett läsbart
namn enligt formatet: **`{domain}-{venue}`**

**Normaliseringssteg:**
1. Strippa `www.`
2. Strippa landstopp (.se osv.) — EJ för sourceId, endast för visning
3. Extrahera path-segment (första icke-root segment)
4. Normalisera ÅÄÖ → A/A/O
5. Ersätt alla icke-bokstäver förutom `-` med `-`
6. Strippa ledande/avslutande `-`

### 3.2 Path-segment vs venue-namn

Path-segmentet är ofta inte läsbart nog. Regel:

- Om path-segment matchar venue-typen: använd venue-namnet istället
  - `/konserthus` → `-konserthus`
  - `/stadsteatern` → `-stadsteatern`
  - `/konst` → `-konstmuseum` (om type=museum) — TODO: mappa i en path→venue-lista
- Om path-segment är tomt (root) → `-main` eller beskrivande suffix
- Om path-segment är neutralt: använd det

### 3.3 Exempel

| canonicalUrl | sourceIdentityKey | sourceId | Motivering |
|-------------|------------------|----------|-----------|
| `vasteras.se/konserthus` | `vasteras.se-konserthus` | `vasteras-se-konserthus` | Subvenue, behåller path |
| `vasteras.se/konstmuseum` | `vasteras.se-konstmuseum` | `vasteras-se-konstmuseum` | Subvenue |
| `vasteras.se` | `vasteras.se` | `vasteras-se-main` | Root-sida, suffix `-main` |
| `gavle.se/konserthus` | `gavle.se-konserthus` | `gavle-se-konserthus` | Subvenue |
| `gavle.se/konst` | `gavle.se-konst` | `gavle-se-konst` | TODO: path→venue-mappning |
| `gavle.se/stadsteatern` | `gavle.se-stadsteatern` | `gavle-se-stadsteatern` | Subvenue |
| `liseberg.se` | `liseberg.se` | `liseberg` | Ren venue, ingen path |
| `aik.se` | `aik.se` | `aik` | Ren venue |
| `aviciiarena.se` | `aviciiarena.se` | `aviciiarena-se` | Root-sida (aviciiarena.se → ingen path) |
| `aviciiarena.se` (sport) | `aviciiarena.se-sport` | `aviciiarena-se-sport` | Subvenue på samma hostname |

### 3.4 Root-source-regel

**Regel:** Om root-sidan (`www.example.se/`) är en legitim eventkälla
(separat eventflöde från subvenues), ska den hållas som en egen source.

Om root-sidan däremot bara omdirigerar eller saknar eget eventflöde,
ska den inte vara en egen source utan subvenues slås ihop under
någon av subvenues.

**TODO (Fas 3.2):** För varje hostname med root + subvenues: avgör om
root är en egen source eller kan ignoreras. Detta kräver manuell inspektion
av om root-sidan faktiskt har events.

---

## 4. Beslutsmall: När separera vs slå ihop

### 4.1 Hålla separata (`keep-separate-subvenues`) — ALLA tre villkor:

1. Samma hostname (siteIdentityKey)
2. Olika paths på hostname (sourceIdentityKey)
3. Varje path har ett **självständigt eventflöde** (egna events, inte kopior av en central feed)

**Exempel:**
```
vasteras.se/konserthus + vasteras.se/konstmuseum + vasteras.se/stadsteatern
→ tre separata sources (var och en med egen eventsida)
```

### 4.2 Slå ihop (`merge-duplicate-imports`) — minst ett villkor:

1. Samma URL (canonicalUrl) + samma namn → ren duplicering
2. Samma URL + olika namn → sannolikt importfel, granska manuellt
3. Samma URL + olika city → importfel (t.ex. Värmland med Uppsala vs Karlstad)

**Exempel:**
```
uppsala-stadsteatern + uppsala-stadsteatern-1
→ merge (samma URL, samma namn, samma city)
```

### 4.3 Manuell granskning (`manual-review`):

- Olika venues men samma hostname utan tydlig path-struktur
- Samma venue-namn men helt olika städer på samma hostname
- Osäkerhet om root-sidans status

**Exempel:**
```
www.stadsteatern.se → Göteborgs Stadsteatern + Stockholms Stadsteater
→ Två helt olika städer, samma hostname. Manuellt beslut: separata sources?
   Eller:www.stadsteatern.se-goteborg + www.stadsteatern.se-stockholm
```

### 4.4 Datafel (`data-error`):

- URL pekar mot helt fel sajt (t.ex. Liseberg på gronalund.com)
- Tydligt felstavad hostname

---

## 5. Interrim-klassning av nuvarande 23 hostname-grupper

Baserat på ovanstående regler (preliminär klassning, ingen migrering ännu):

### keep-separate-subvenues (13 hostnames med olika paths)

| sourceIdentityKey | Filer | Bedömning |
|-------------------|-------|-----------|
| aviciiarena.se | avicii-arena + avicii-arena-sport | Samma root, olika subpages → separata subvenues? TODO: verifiera om sport har eget eventflöde |
| falu.se | falun-konserthus + falun-stadsteatern | Konserthus + stadsteatern på olika paths → separata |
| gavle.se | gavle-konserthus + gavle-konstmuseum + gavle-stadsteatern | Tre subvenues → separata |
| halmstad.se | halmstad-konserthus + halmstad-stadsteatern | Två subvenues → separata |
| jonkoping.se | jonkoping + jonkoping-konserthus + jonkoping-stadsteatern | Root + två subvenues → TODO: root=självständig eventkälla? |
| karlstad.se | karlstad-konserthus + karlstad-stadsteatern | Två subvenues → separata |
| linkoping.se | linkoping-konserthus + linkoping-stadsteatern | Två subvenues → separata |
| lulea.se | lulea-konserthus + lulea-stadsteatern | Två subvenues → separata |
| lund.se | lunds-konserthus + lunds-stadsteatern | Två subvenues → separata |
| malmö.se | malmo-stad + malmo-stadsbibliotek | Root + bibliotek → TODO: root eventkälla? bibliotek eventkälla? |
| norrkoping.se | norrkoping-konserthus + norrkoping-museum + norrkoping-stadsteatern | Tre subvenues → separata |
| umea.se | umea-konserthus + umea-stadsteatern | Två subvenues → separata |
| vasteras.se | vasteras-konserthus + vasteras-konstmuseum + vasteras-stad + vasteras-stadsteatern | Fyra subvenues → separata |

### merge-duplicate-imports (1 hostname)

| sourceIdentityKey | Filer | Bedömning |
|-------------------|-------|-----------|
| uppsala-stadsteatern.se | uppsala-stadsteatern + uppsala-stadsteatern-1 | Samma URL + samma namn → merge |

### manual-review (8 hostnames)

| sourceIdentityKey | Filer | Bedömning |
|-------------------|-------|-----------|
| arkitekturgalleriet.se | arkitekturgalleriet + goteborgs-arkitekturgalleri | Samma hostname, samma city (Göteborg), olika namn → granska: samma venue med namnvariant? |
| gronalund.se | gr-na-lund + gr-na-lund-n-je | Samma URL, samma namn → merge (typ B) — men redan flaggad som manual |
| gronalund.com | grona-lund + liseberg-1 | DATA FEL: liseberg-1 ska vara på liseberg.se → data-error |
| liljevalchs.se | liljevalchs + liljevalchs-konsthall | Samma hostname, samma city → granska: samma venue? |
| liseberg.se | liseberg + liseberg-n-je | Samma URL, samma namn → merge (typ B) |
| malmoarena.se | malm-arena + malm-arena-ishockey | Samma hostname, samma city → granska: samma arena med sport-subpage? |
| skovde.se | skovde-konserthus + skovde-stadsteatern | Samma hostname, samma city → granska: samma venue? eller verkligen konserthus vs stadsteatern |
| varmland.se | varmland + varmland-1 | Samma URL, olika city (Karlstad vs Uppsala) → importfel, merge på rätt city |

### data-error (1 hostname)

| sourceIdentityKey | Filer | Bedömning |
|-------------------|-------|-----------|
| gronalund.com | liseberg-1 | FEL: URL=gronalund.com men innehåll=Liseberg → fix hostname |

---

## 6. Interrim-klassning — fortsättning

**OBS: Stadsteatern.se-gruppen hamnade inte i JSONL-rapporten.**
Efteranalys visar:

| sourceIdentityKey | Filer | Bedömning |
|-------------------|-------|-----------|
| stadsteatern.se | goteborgs-stadsteatern + stockholms-stadsteater | Manuell granskning: OLIKA STÄDER, samma hostname. Två alternativ: (A) behåll som separata sources med stadssuffix, (B) slå ihop under siteIdentityKey och låt subvenue-bestämma. Rekommendation: `stadsteatern.se-goteborg` + `stadsteatern.se-stockholm` |

---

## 7. sources_v2/ parallell struktur — uppdaterad

```
NEWSTRUCTURE/
  sources/              ← Nuvarande, orörd
  sources_v2/           ← Ny canonical structure (ej aktiv ännu)
    _meta/
      schema.md         ← CanonicalSource-type + två-nivå identity
      migration-log.md
      decision-rules.md ← Denna fils systerfil (source-identity-decision-rules.md)
    _canonical/         ← Nya canonical sources (sources_v2/id.jsonl)
      vasteras.se-konserthus.jsonl
      vasteras.se-konstmuseum.jsonl
      vasteras.se-main.jsonl
      vasteras.se-stadsteatern.jsonl
      liseberg.se.jsonl
      ...
    _staging/
    _collision-report/
      decisions.jsonl   ← Beslut per hostname
    _tools/
```

---

## 8. INTE ÄNNU — vad som INTE ska göras i denna fas

- [ ] Migrera data från `sources/` till `sources_v2/`
- [ ] Skriva till `sources/`
- [ ] Ändra `runtime/sources_status.jsonl`
- [ ] Ändra queue-arkitektur, routing, C-htmlGate
- [ ] Bygga merge-logic in i import-raw-sources.ts
- [ ] Ta bort eller döpa om `sources/`
- [ ] Ändra 123-loopen
- [ ] Implementera path→venue-mappning i 00A (kräver specifikation)
- [ ] Slå ihop eller splitta någon source fysiskt

---

## 9. Nästa lilla implementationsteg (Fas 3.2)

**Endast detta, ingen migrering:**
1. Skapa `source-identity-decision-rules.md` (denna fils systerfil med regler och exempel)
2. Manuellt granska de 23+1 hostname-grupper och fatta beslut (putsa listan ovan)
3. Dokumentera beslut i `sources_v2/_collision-report/decisions.jsonl`
4. **Sedan först:** eventuell migrering, men bara efter manuellt godkännande

---

## 10. sourceIdentityKey i praktiken

Fråga: **Behöver vi verkligen två nivåer?**

**Svar:** Ja, för att 00A-importverktyget ska kunna avgöra om inkommande
rader är "samma source" eller "ny subvenue på samma sajt". Om vi bara hade
siteIdentityKey (hostname) skulle alla paths på samma sajt slås ihop till
en source — vilket är fel för kommunala sajter med flera eventavdelningar.

**Dock:** För rena en-sajt-venues (liseberg, aik, konserthuset) är
siteIdentityKey = sourceIdentityKey (ingen path). För subvenue-sajter är
de olika.

**TODO:** 00A behöver uppdateras för att stödja sourceIdentityKey med
path-nivå. Detta görs i Fas 3.3 (nästa steg efter manuell granskning),
inte i denna fas.
