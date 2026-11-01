# Titalanpassad bildgen — uppskalning till 1 000 ord (2026-10-31)

> Leverans: orddriven bildpipeline som genererar **en bild per unikt ord** i
> eventtitlarna, granskar den med en visionmodell och kopplar den till de event
> vars titel innehåller ordet. Ordlistan är facit — inga kategorier, inga
> gissade suffixer.
>
> Beställning: *"kan du generera bilder med minimax för 1000 vanligaste orden?"*
> + *"och såklart koppla dem"* + *"med ui"*.

---

## 1. Vad som faktiskt gjordes

| Steg | Verktyg | Resultat |
|---|---|---|
| Ordlistan | `docs/audit/data/huvudattraktioner-2026-10-31-ord-inventering.csv` | 9 912 unika ord totalt; **1 057 ord** täcker ≥2 events → topp-1 000 är de mest förekommande |
| Generering | `scripts/word_image_gen.ts` | M3 skriver bildprompt → MiniMax `image-01` (1248×832) → AI Act-stämpel → M3-vision läser av filen → upp till 3 försök med skärpt prompt → karantän vid fel |
| Granskning | `scripts/verify-word-images.ts` | Test 1 (ordet i titeln, deterministiskt) + Test 2 (visar bilden ordets innebörd, M3-vision) |
| Återhämtning | `scripts/word_image_promote.ts` | Karantänens bilder granskas om mot aktuella regler; det som nu klarar gaten släpps in |
| Städning | `scripts/word_image_cleanup.ts` | Underkända bilder → karantän, dubbletter borttagna (behålls den med högst konfidens) |
| Koppling | `scripts/word_image_assign.ts` via `POST /api/bfl/word-assign {"apply":true}` | Uppladdning → `image_library` (`category_slug='word'`) → `events.image_url` |
| UI-parning | `scripts/check-word-image-pairing.mjs` | Test 3: rätt titel ↔ rätt bild i `events_public` (det appen läser) |

**Den orange knappen (`scripts/adaptive_image_gen.ts`) är orörd.** Den nya
knappen är en kopia på ordnivå: enheten är ett ord, inte kategori × kluster.

---

## 2. Resultat (live, 2026-10-31)

### 2.1 Biblioteket

| Mått | Värde |
|---|---|
| Ord med ≥2 events (ordlistan) | 1 057 |
| Ord med verifierad bild i biblioteket | **885** |
| Ord i topp-1 000 som täcks | **875** (88,6 % av evenemangstäckningen i topp-1 000) |
| Bilder i karantän (underkända) | 343 nycklar — laddas aldrig upp |
| Slutgiltig gaten | **885/901 ord klarade båda testerna** |

**Gaten kräver två underkännanden i rad.** M3-vision är inte deterministisk:
mätt på två identiska körningar (18:34 och 19:23) flippade **40 av 893 bilder**
(4,5 %) sitt omdöme. En enstaka underkänning är därför inget bevis för att
bilden är trasig. Gaten kör därför ett **bekräftelsepass**: de underkända
granskas om en gång till, och bara de som underkänds igen flyttas till
karantän. I slutomgången räddades **26 bilder** (underkända → godkända vid
bekräftelse) och **16 underkännanden bekräftades**.

### 2.2 Underkännanden — varför?

| Orsak | Antal (första passet) |
|---|---|
| Läsbar text i bilden (reklamtavlor, rinkbräden, skyltar) | 19 |
| Bilden visar fel sak | 17 |
| Förvansad text | 5 |
| Ansikte i förgrunden | 1 |

Detta är ett **medvetet val**, inte en bugg: en evenemangskort-bild med
"ÅSHÖR" på rinken ser trasig ut. Ord som *Match*, *Hockey*, *Dam*, *EXPO* och
*Fotboll* faller på samma sätt — MiniMax sätter rinkbräden och mässbord i
scenerna. De får hellre ingen bild än en trasig.

### 2.3 Kopplingen (test 3)

| Mått | Värde |
|---|---|
| Körning | `assign-mvwsmq6c` (startad via dashboardens knapp) |
| Bilder uppladdade | 885 — **0 fel** |
| Events matchade | 7 190 (50 uppdaterade + 7 140 redan samma) — 0 fel |
| Event i `events_public` med ordbild | 6 187 |
| Test 3 (titel ↔ bild) | **6 187/6 187 OK, 0 problem** |
| HTTP-kontroll av bilder | 15/15 → `200 image/webp` (tidigare 30/30 och 40/40) |
| `image_library` | 885 rader med `category_slug='word'` — **0 läckor** till fallback-poolerna |

**Vad som faktiskt byttes:** alla befintliga bilder i `events` var våra egna
biblioteksbilder (`import-stamped/community/…`, dvs. generiska
kategori-zoombilder) — **noll pressfoton** från källorna. Kopplingen byter alltså
en generisk bild mot en bild som visar det ord titeln innehåller. Det är
precis vad "titalanpassad" betyder.

**Reparation:** 52 event pekade fortfarande på bilder som karantänen flyttat ut
efter sista gaten. `scripts/word_image_repair.ts` satte tillbaka en generisk
biblioteksbild på dem (samma pool som appens fallback) — hellre en generisk
bild än en underkänd.

---

## 3. Ordmatchningen: ordlistan är facit

En tidigare version matchade med *"tokenet slutar med ordet"*. Det gav **922
falsa träffar** i det riktiga korpuset:

| Titel | Gissad träff | Verklighet |
|---|---|---|
| "Ludwig Hart" | `art` (konst) | instrumental |
| "Svart Samtid" | `art` (konst) | — |
| "Digitalt Forum" | `alt` | — |
| "Tennis Night" | `is` (isbana) | tennismatch |

Nu delas titeln i tokens och slås upp i ordlistan (`scripts/lib/word-image-match.ts`).
En token som inte finns i ordlistan matchar ingenting. Generator, gata och
tilldelning använder **samma modul**, så de kan inte glida isär.

Verifierat: "Ludwig Hart" → *unplugged*, "Svart Samtid" → ingen bild,
"Tennis Night" → *tennis*, "Inre bastun" → *bastu*, "Dambastu … Inre Bastu" →
*dambastu* (längsta ordet vinner).

---

## 4. Buggar som uppskalningen avslöjade (alla rättade)

1. **Granskningen frågade fel fråga.** "Visar bilden ordet?" → "visar bilden
   ordets *innebörd*?" (isbana = is, turnébuss = tour). Annars underkändes
   riktiga bilder.
2. **Granskningen litade på M3:s gissade betydelse.** *argbigga* ("Så tuktas en
   argbigga" = en arg trut) blev "en argsint person". Nu är **titlarna facit** —
   betydelsesteget, prompten och granskningen skickar med exempeltitlarna.
3. **Exempeltitlarnas tema läckte in i bilden.** *tipspromenad* → Halloween-
   dräkter, eftersom ordets enda exempel är en Halloween-titel.
4. **922 falsa träffar i titelmatchningen** (se ovan).
5. **Tilldelningen såg bara hälften av eventen.** `.range(0, 19999)` passerar
   inte Supabase-projektets radtak på 1 000 rader. Fix: sidnumrering.
6. **Generatorns `--apply` skapade trasiga biblioteksrader** (`category_slug=null`
   + lokal absolut sökväg) → ordbilder i de generiska fallback-poolerna.
7. **Dubbletter för samma ord** (`done` var en ögonblicksbild från körningens
   start) → nyckeln läggs in direkt när bilden klarar gaten.
8. **Tilldelningen kraschade vid uppskalning.** `matchForms(c.key, c.ord)`
   anropade en funktion som tar ett objekt → `TypeError: Cannot read
   properties of undefined (reading 'toLowerCase')`. Hittades av dry-runen
   innan något skrevs.
9. **Supabase Storage avvisar icke-ASCII-nycklar.** 212 av 896 bilder (ord med
   å/ä/ö/é) kunde inte laddas upp: `Invalid key:
   import-stamped/word/handarbetscafé__086.webp`. Percent-encoding hjälper inte
   — Storage avkodar nyckeln innan den valideras. Fix: ASCII-vikning + kort
   hash av originalnyckeln (`handarbetscafé` → `handarbetscafe--26d54dda.webp`).
   Hashen är nödvändig: `cafe`/`café` och `spoken`/`spöken` slår annars ihop.
10. **Gatens `--recheck` var meningslöst.** Villkoret var
    `verdict.verified_at === undefined`, men tidsstämpeln ligger i sidecaren,
    inte i verdict-objektet → gaten granskade om ALLA bilder varje gång.
    Fix: läs tidsstämpeln ur sidecaren.
11. **En underkänning räcker inte.** M3-vision flippade 4,5 % av omdömena
    mellan två identiska körningar. Gaten kräver nu två underkännanden i rad
    (bekräftelsepass) — annars kastades 26 riktiga bilder.
12. **Event kunde peka på karantänbilder.** När gaten flyttade en bild till
    karantän efter att den redan tilldelats stod eventen kvar med den bilden.
    Fix: `scripts/word_image_repair.ts` sätter tillbaka en generisk
    biblioteksbild (52 event reparerade).

---

## 4b. Ordbanken i ingestion-kedjan (2026-11-01)

**Beställning:** *"1. kolla om några unika ord finns i titeln – använd bildbanken
word, 2. speciella ord saknas – använd gammal heuristik. Denna kedja får inte
vara bruten."*

### Kedjan nu

| Steg | Väljer | Kod |
|---|---|---|
| **0** | **Ordbilden** — finns ett ord i titeln som har en bild? | `08-Agent/utils/wordImageBank.ts` → `pickLibraryFallback` (första steget) |
| 1 | Cluster-match (M3 läser beskrivningen) | `findImageForEvent` |
| 2 | Venue + kategori | `pickLibraryFallback` |
| 3 | Kategori (+ alias) | `pickLibraryFallback` |
| 4 | Default (NULL-kategori) → generisk community/culture | `nullDefaultImage` / `genericFallbackImage` |
| 5 | Ingen match → BFL genererar ny bild | `generateBatch` / `autoGen` |

**Steg 0 är ett tillägg, inte en ersättning.** Saknas ordet i titeln (eller kan
ordbanken inte läsas) faller kedjan vidare till steg 1–4 precis som förut.
Ordbanken är isolerad från den gamla vägen: `category_slug='word'` är ingen
eventkategori, så vare sig kategori-, venue- eller cluster-matcheraren kan
plocka en ordbild av misstag.

### Varifrån kommer indexet?

`image_library` är facit. För ordbilder är `tags[0]` bildnyckeln och
`cluster_tags` de **ordformer** bilden gäller ("jul", "julen"). Formerna skrivs
av `scripts/word_index_sync.ts` från ord-inventeringen — samma facit som
generatorn, gaten och tilldelningen använder. Utan det skulle "Julen är här"
inte hitta jul-bilden.

Ordlistan är facit även här: token "dag" matchar **inte**, eftersom "dag" inte
finns i ordlistan (nyckeln "dag" finns bara via formen "dagen").

### Bevis

- [VERIFIED] **Konsistens:** den nya kedjan ger **samma bild som den manuella
  tilldelningen på 5 874 av 5 874 event** (0 avvikelser).
- [VERIFIED] **End-to-end på riktigt event:** ett event med ord i titeln
  ("The Original Stockholm Pub Crawl") nollställdes (`image_url = NULL`, precis
  som normalizer sätter för nya event) och kördes genom nattens väg
  (`matchLibraryFirst`) → fick tillbaka **ordbilden** `crawl--3b8eaaf7.webp`
  med korrekta flaggor (`image_ai_generated=true`, `image_license=ai-generated`,
  `image_generation_status=completed`). Kontroll-eventet ("Unrecognized", inga
  ord med bild) fick den **gamla heuristikens** kategoribild
  (`image_ai_generated=false`, `status=library_fallback`).
- [VERIFIED] **Worker-vägen:** `aiImageWorker` provar ordbanken **innan** BFL
  anropas → en ny bild slipper kosta credits när ordet redan har en bild.
- [VERIFIED] **Tester:** `08-Agent/tests/wordImageBank.test.ts` (12 nya gröna)
  + 5 nya tester i `imageLibrary.test.ts` för steg 0 och flaggorna. De 6
  trasiga testerna i `imageLibrary.test.ts` är också fixade (mocken klarade
  inte kedjade `.not()`) → hela agent-suiten: 1 046 gröna, 10 kvar (alltså
  `feed_rank_wire`, en förinställd baslinjefel som inte rör bildkedjan).

---

## 5. Kvarvarande luckor

- [UNVERIFIED] **Fysisk Expo Go-enhet otestad.** Verifieringen går via
  `events_public` + HTTP-status, inte via en skärmbild från telefonen.
- [UNVERIFIED] **Ordlistans `typ`-kolumn har modellgränser.** 241 av topp-1 000
  ord har bara ett exempel-titel → mest utsatta för fel betydelse.
- [UNVERIFIED] **Vissa ord får sannolikt aldrig bild** (se 2.2) — MiniMax
  sätter text i rink- och mässscener oavsett prompt.
- [UNVERIFIED] **Uppskalningen kan fortsätta till fler ord.** Ordlistan har
  2 014 innehållsord; topp-1 000 täcker 10 490 event av 15 684.

---

## 6. Nästa steg

1. Granska ett urval ordbilder visuellt i appen (telefonen) — modellens
   omdöme är starkt men inte alltid rätt.
2. Bestäm om uppskalningen ska fortsätta till alla 2 014 innehållsord.
3. Bestäm om bilderna ska ligga kvar i `image_library` (de gör det nu, med
   `category_slug='word'`) eller bara i `events.image_url`.
