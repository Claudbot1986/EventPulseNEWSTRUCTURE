# Hem — "Utforska"-tiles (Spotify-stil)

Persistent ordpool och designspec för den Spotify-inspirerade **Utforska**-sektionen på Hem-skärmen.

## Koncept — smakprofiler (2026-09-21)

Tiles är **känslor och lägen**, inte kategorifilter — som Spotifys genre/mood-knappar.
AI-agenten tolkar ordet fritt: tryck på "Skratt" → agenten hittar standup, komedi, roliga kvällar.
Varje tile är ett ord, AI-tolkat, med bild i höger ~33% och mörk enfärg + vit text till vänster.

## Aktiva 4 (2×2-grid, 2026-09-21)

| Position | Ord | Färg | AI-tolkning |
|----------|-----|------|-------------|
| Rad 1 vänster | **Gratis** | #1E6B45 (smaragd) | Gratis-evenemang (is_free-data) |
| Rad 1 höger | **Live** | #3B1F66 (djup lila) | Konsertenergi, scen, publik |
| Rad 2 vänster | **Skratt** | #6B4226 (varm koppar) | Standup, komedi, glädje |
| Rad 2 höger | **Stämningsfullt** | #5C1A2A (vinrött) | Ljuslysning, romantik, atmosfär |

## Tryck-beteende (2026-09-21)

Knapptrycket går på samma tråd som kuraterade chips (AppShell → Utforska, deterministiska filter — INTE fri AI-tolkning ännu):

| Ord | prompt_text (sv) | Hint | Utforska-effekt |
|-----|------------------|------|----------------|
| Gratis | "Gratis evenemang" | `budget: free` | Prisfiltret Gratis |
| Live | "Live på scen" | `category_slug: music` | Kategorin Musik |
| Skratt | "Skratt — standup och komedi" | genre `skratt` i promptIntent.js | Sökrad standup/komedi — andra genrer (t.ex. hårdrock) kan inte smyga in |
| Stämningsfullt | "Stämningsfullt" | — | Endast banner ännu — saknar ärlig deterministisk väg, beslut väntar |

- Texterna ligger i i18n (`home.explore.*`, sv+en; övriga språk via en-fallback tills översättningsomgången).
- Före 2026-09-21 skickade tilen bara ordet som rå sträng → AppShell tappade det → inget hände alls.
- Beteendet är pinned i `06-UI/utils/promptIntent.test.ts`.

## Parkade 11 (aktiveras efter analytics)

| # | Ord | Känsla | AI hittar... |
|---|-----|--------|--------------|
| 5 | Chill | Avkoppling, lugn | Mjuka konserter, mysiga ställen |
| 6 | Själv | Me-time, reflektion | Solo-vänliga evenemang |
| 7 | Tillsammans | Vänner, gemenskap | Afterwork, gruppaktiviteter |
| 8 | Ikväll | Spontant, nu! | Det som händer ikväll |
| 9 | Romantiskt | Dejt, två personer | Romantiska middagar, jazzkvällar |
| 10 | Äventyr | Spänning, nytt | Okända upplevelser, premiärer |
| 11 | Teater | Drama, berättelse | Teaterföreställningar, scenkonst |
| 12 | Familj | Barn, helg tillsammans | Familje-evenemang, barnaktiviteter |
| 13 | Dans | Rörelse, kropp | Dansföreställningar, klubbkvällar |
| 14 | Mysigt | Ombonat, varmt | Mjukt, stillsamt, högt i mysfaktor |
| 15 | Spänning | Adrenalin | Sport, tävlingar, hisnande upplevelser |

## Komplett ordpool — 24 ord

### När (7)
| Ord | Motiv (vad bilden ska förmedla) | Färg |
|-----|----------------------------------|------|
| Ikväll | Våt asfalt + ensam gul gatlykta + cyklist-siluett passerar + neon-reflex i bakgrund | Djup navy #0E1A2B + amber #FFB454 |
| Imorgon | Morgonkopp + ånga + lila gryningsljus + utsikt över vatten | Dim-lila + koppar |
| Helg | Jordgubbar i picknickhandduk + solhatt + solljus genom löv | Varmt grönt + kräm |
| Söndag | Liten pocketbok + kaffe + regn på fönsterruta | Grå-blå + varm lampa |
| Sent | Tom bardisk + ett glas kvar + en ensam stol + 02:00-känsla | Djupt indigo + gul spotlight |
| Nyår | Fyrverkeri-siluetter över Stadshusets tak + glitter + champagne | Svart + silver/guld |
| Sommar | Bara fötter i en sommaräng + kanon-glass + grönt gräs | Klart grönt + pastell |

### Vad (4)
| Ord | Motiv | Färg |
|-----|-------|------|
| Gratis | Öppen palm som ger bort en biljett / öppen parkgrind i solljus | Klart grönt #7FD9A4 |
| Billigt | 39:- lapp på ett drinkglas + röda reapryl-markeringar | Orange + vitt |
| Drop-in | Öppen dörr med "ingen bokning"-skylt + välkomnande ljus | Varmt gul + brunt |
| Sista chans | En biljett med stämpel "idag" + brand i kanten + utgångende dagsljus | Vinrött + varmvitt |

### Upplevelse (6)
| Ord | Motiv | Färg |
|-----|-------|------|
| Stämningsfullt | Stearinljus i mässingsljusstake + vinröd värme | Vinrött + bärnsten |
| Live | Mikrofon på stativ + spotlight-glöd + gitarrhals i förgrund | Djupt lila + spotlight-vit |
| Ensamt | Ensam stol i tom konsertsal precis innan dörrarna öppnas | Dim-blå + silver |
| Tillsammans | Två händer som klinkar glas + grupp runt eld | Varmt orange + koppar |
| Tyst | Tomt bibliotek + endast sidobelysning + ekgolv | Mjukt grönt + ekgolv |
| Skratt | Öppen mun framför mikrofon + varm scen-belysning | Klart gult + vitt |

### Plats (4)
| Ord | Motiv | Färg |
|-----|-------|------|
| Inomhus | Varma lampor + trägolv + tegelvägg + en detalj i förgrund | Varmt orange + brunt |
| Utomhus | Hängande trädgårdsljus i träd + en gunga | Djupt grönt + ljusprickar |
| Stadshagen | Stadshagens grönska + blomsterrabatt + parkbänk | Klart grönt + pastell |
| Kägelbanan | Gammal biokaraktär + röda sammetsstolar + projektor-glöd | Vinrött + guld |

### För vem (3)
| Ord | Motiv | Färg |
|-----|-------|------|
| Familj | Ballong + barnhand som håller vuxens finger + soligt | Ljusblå + ljusgul |
| Debutant | Öppen dörr + spotlight på scen + en nervös hand | Klart lila + vitt |
| Själv | Ett par hörlurar på en soffa + ensam kopp + regndroppe på ruta | Mjukt blå + beige |

## Designsystem-koppling

- **Tile-mått (1× enhet)**: 195pt × 110pt (2 kolumner, 8pt gap, 16pt sidopadding på en 430pt iPhone Pro Max-skärm)
- **Aspekt på råbild**: 16:9, 2048 × 1152 px (så inget klipps vid device-render till 195×110pt)
- **Text-overlay** (sätts i React Native, inte i bilden):
  - Färg: TOKENS.color.text (`#F7F2EA`)
  - Storlek: TOKENS.fontSize.xl (22pt), vikt `'800'`, letterSpacing: -0.4
  - Position: `paddingLeft: 16pt, paddingTop: 14pt` (vänster-upp-hörna av tile)
- **Corner radius**: TOKENS.radius.md (12pt)
- **Foto-overlay-andel i bilden**: höger 40%; vänster 60% är mestadels solid färg (för textkontrast)

## I18n

Samma ord översätts till de 5 språken som redan finns i repot (ar/fa/so/pl/tr).
Bild-filen är **språk-agnostisk** — samma PNG:ar funkar på alla språk eftersom texten sätts on-device.

## Ordning att aktivera

Vi börjar med 1 tile ("Ikväll") och ser om matchningen mellan bild och text håller.
Därefter expanderar vi i denna ordning:

1. **Ikväl** (först — högsta time-to-value)
2. Helg (nästa — andra naturliga ingången)
3. Gratis (lägsta konverteringströskeln)
4. Live (musikscen = kärnan i Stockholm)
5. Stämningsfullt (slow-query-segment)
6. Sista chans (FOMO-driver)

Övriga 18 ord aktiveras **efter analytics visar hur de första 6 presterar**.

## Genereringsverktyg

`tools/generate-explore-tiles.mjs` läser `MINIMAX_API_KEY` från projektets `.env` (root, INTE 06-UI) och anropar MiniMax-API:ets `/v1/image_generation`-endpoint.

```bash
node tools/generate-explore-tiles.mjs --phase=tile --label=Ikväl
```

Resultat sparas i `tmp/explore-tiles/<label-slug>.jpg`, redo att granskas.
Efter granskning kopieras godkända filer till `06-UI/assets/exploreTiles/`.
