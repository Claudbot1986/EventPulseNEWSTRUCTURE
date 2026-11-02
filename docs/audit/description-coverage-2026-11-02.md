# Beskrivningstäckning — audit 2026-11-02

> Genererad av `scripts/_audit_description_coverage.mjs` (read-only, ingen DB-skrivning).
> Beskrivnings-resolutionen är importerad från den äkta UI-modulen
> `06-UI/utils/descriptionFallback.js` — auditen kan inte glida ifrån appens beteende.

## Mätvärden

| Mätning | Antal | Andel av 11308 |
|---|---:|---:|
| Events i `events_public` (det appen läser) | 11308 | 100 % |
| **Saknar beskrivning i Hem-flödet** | **89** | 0.8 % |
| **Saknar beskrivning i Agent/Utforska-flödet** | **89** | 0.8 % |
| **Saknar beskrivning i Sök-läget** | **89** | 0.8 % |
| Saknar beskrivning i BÅDA Hem och Agent | 89 | 0.8 % |
| Har beskrivning i Hem men inte i Agent | 0 | 0.0 % |
| Har bara `eventpulse_summary` → förlorar rad-preview i Sök | 0 | 0.0 % |

## Hem-flödets select-listor (lästa ur HomeScreen.js vid körning)

Fälten nedan är verifierade genom att select-listorna **läses ur koden vid körning** —
inte påstådda. En ändring i HomeScreen.js ändrar därför tabellen automatiskt.

Antal select()-listor i HomeScreen.js: 10

| Fält | finns i Hem-select? | betyder |
|---|---|---|
| `editorial_description` | JA | resolution steg 1 (primär) |
| `eventpulse_summary` | JA | resolution steg 2 |
| `description_license` | JA | gate för steg 3 |
| `venue_name` | **NEJ** | gate för steg 4 (faktarad) |
| `description_sv` / `description_en` | JA | steg 3 (men licens-gated) |

## Sök-läget (`mapAgentEventToRow` i `rowMapping.js`)

Sök-läget mappar sökresultat via `mapAgentEventToRow`. Mappen forwardar
`editorial_description`, `eventpulse_summary` (sedan 2026-11-02) och `description_license`.

| Mätning | Antal |
|---|---:|
| Saknar beskrivning i Sök-läget | 89 |
| Har bara `eventpulse_summary` (ingen editorial) → saknar rad-preview | 0 |

## Fördelning per källa — saknar beskrivning i Hem-flödet

| Källa | Antal |
|---|---:|
| visithelsingborg | 18 |
| dunkers | 17 |
| eventbrite-stockholm | 12 |
| studio-acusticum | 8 |
| tiqets-stockholm | 6 |
| stockholmlive-evenemang | 5 |
| lugerse | 5 |
| stampen | 5 |
| abf | 3 |
| stadsmuseet | 3 |
| stampense | 2 |
| kungliga-biblioteket | 2 |
| aik | 1 |
| tele2-arena | 1 |
| allevents-in-stockholm | 1 |

## Fördelning per källa — saknar beskrivning i Agent/Utforska-flödet

| Källa | Antal |
|---|---:|
| visithelsingborg | 18 |
| dunkers | 17 |
| eventbrite-stockholm | 12 |
| studio-acusticum | 8 |
| tiqets-stockholm | 6 |
| stockholmlive-evenemang | 5 |
| lugerse | 5 |
| stampen | 5 |
| abf | 3 |
| stadsmuseet | 3 |
| stampense | 2 |
| kungliga-biblioteket | 2 |
| aik | 1 |
| tele2-arena | 1 |
| allevents-in-stockholm | 1 |

## Rotorsaksklassning — de 89 events som saknar beskrivning överallt

| Rotorsak | Antal | Betydelse |
|---|---:|---|
| `R4-ingen-text-i-db` | 89 | Ingen text finns alls i DB → antingen har källan ingen beskrivning, eller så misslyckades extraktionen. |

## Komplett lista — saknar beskrivning i BÅDA flödena

Fullständig lista med rotorsak per rad: `docs/audit/data/events-without-description-2026-11-02.csv` (89 rader).

| # | Titel | Källa | Start | Rotorsak | Råtext-len | Licens | Bokningslänk? |
|---:|---|---|---|---|---:|---|---|
| 1 | Candlelight: Tribute to ABBA &amp; More | visithelsingborg | Fri Nov 13 | `R4-ingen-text-i-db` | 0 | — | ja |
| 2 | Djurgården Hockey | stockholmlive-evenemang | Thu Nov 19 | `R4-ingen-text-i-db` | 0 | — | ja |
| 3 | DAVID BINNEY %26 LOUIS COLE  • LIVE DUO AT STAMPEN! • November 4 • 2 | stampense | Wed Nov 04 | `R4-ingen-text-i-db` | 0 | — | ja |
| 4 | Occrasy | lugerse | Fri Dec 11 | `R4-ingen-text-i-db` | 0 | — | ja |
| 5 | Studio Acusticum i Piteå | studio-acusticum | Mon Nov 30 | `R4-ingen-text-i-db` | 0 | — | ja |
| 6 | Stilla vintervandring &#8211; med naturguide Britta Levin | visithelsingborg | Sun Nov 22 | `R4-ingen-text-i-db` | 0 | — | nej |
| 7 | Trollvinter i Mumindalen | tiqets-stockholm | Fri Dec 31 | `R4-ingen-text-i-db` | 0 | — | ja |
| 8 | Webbinarium: Ära, minne och praktik – om adelns gravmonument | kungliga-biblioteket | Thu Nov 05 | `R4-ingen-text-i-db` | 0 | — | ja |
| 9 | HSO &#8211; Allhelgonakonsert &#8211; Faurés Requiem | visithelsingborg | Sat Oct 31 | `R4-ingen-text-i-db` | 0 | — | nej |
| 10 | Life in Color & Form: Robert and Barbro Nilsson | tiqets-stockholm | Mon Mar 29 | `R4-ingen-text-i-db` | 0 | — | ja |
| 11 | Occrasy | lugerse | Sat Dec 12 | `R4-ingen-text-i-db` | 0 | — | nej |
| 12 | Djurgården Hockey | stockholmlive-evenemang | Mon Dec 28 | `R4-ingen-text-i-db` | 0 | — | ja |
| 13 | Djurgården Fotboll | stockholmlive-evenemang | Sun Nov 29 | `R4-ingen-text-i-db` | 0 | — | ja |
| 14 | Språkcafé – Language is Power | dunkers | Fri Oct 30 | `R4-ingen-text-i-db` | 0 | — | nej |
| 15 | AIK Open Wrestling | aik | Sun Nov 08 | `R4-ingen-text-i-db` | 0 | — | ja |
| 16 | SAMHAIN SÉANCE: Ancestral Collaboration with Pam Grossman & Janaka S | eventbrite-stockholm | Sun Nov 01 | `R4-ingen-text-i-db` | 0 | — | ja |
| 17 | Managing Your Emotions - Prof Ethan Kross | eventbrite-stockholm | Tue Nov 10 | `R4-ingen-text-i-db` | 0 | — | ja |
| 18 | Animation du débreffage - 17 décembre 2026 - En ligne | eventbrite-stockholm | Thu Dec 17 | `R4-ingen-text-i-db` | 0 | — | ja |
| 19 | Glam, sång och starka känslor med Operadonnorna | abf | Fri Nov 20 | `R4-ingen-text-i-db` | 0 | — | ja |
| 20 | AIK Hockey | stockholmlive-evenemang | Sun Nov 15 | `R4-ingen-text-i-db` | 0 | — | ja |
| 21 | Kulturellt mångfald i fokus presenterar – Edris Durani & Tamin Azizi | dunkers | Sun Nov 15 | `R4-ingen-text-i-db` | 0 | — | nej |
| 22 | Kulturellt mångfald I fokus presenterar – Haneen Choir – Echoes of S | dunkers | Sat Nov 14 | `R4-ingen-text-i-db` | 0 | — | nej |
| 23 | Studio Acusticum i Piteå | studio-acusticum | Fri Nov 27 | `R4-ingen-text-i-db` | 0 | — | ja |
| 24 | Stampen’s World Famous Blues Jam! 14:00 - 19:00 · Free Entry! | stampen | Sat Oct 31 | `R4-ingen-text-i-db` | 0 | — | ja |
| 25 | Söndagsdans i Atriet | dunkers | Sun Nov 01 | `R4-ingen-text-i-db` | 0 | — | nej |
| 26 | Nils Petter Löfstedt: The Unmeasurable - The Photos | tiqets-stockholm | Sun Feb 07 | `R4-ingen-text-i-db` | 0 | — | ja |
| 27 | Studio Acusticum i Piteå | studio-acusticum | Sat Nov 14 | `R4-ingen-text-i-db` | 0 | — | ja |
| 28 | Mozart Requiem | visithelsingborg | Sat Nov 07 | `R4-ingen-text-i-db` | 0 | — | ja |
| 29 | Drop-in frukost i S:t Mikael &#8211; När det värsta händer | visithelsingborg | Sat Nov 07 | `R4-ingen-text-i-db` | 0 | — | ja |
| 30 | Kvällsvisningar med Helsingborgs museum | dunkers | Thu Nov 19 | `R4-ingen-text-i-db` | 0 | — | nej |
| 31 | Värdet av offentlig gestaltning | dunkers | Wed Nov 04 | `R4-ingen-text-i-db` | 0 | — | nej |
| 32 | Studio Acusticum i Piteå | studio-acusticum | Wed Dec 09 | `R4-ingen-text-i-db` | 0 | — | ja |
| 33 | Candlelight: The Best of Hans Zimmer | visithelsingborg | Sun Dec 20 | `R4-ingen-text-i-db` | 0 | — | ja |
| 34 | Kulturellt mångfald i fokus presenterar – Old Stories, New Voices | dunkers | Sun Nov 15 | `R4-ingen-text-i-db` | 0 | — | nej |
| 35 | Kulturellt mångfald i fokus presenterar – YAMM band | dunkers | Sun Nov 15 | `R4-ingen-text-i-db` | 0 | — | nej |
| 36 | The Lords of the Rings, The Hobbit and the Rings of Power &#8211; In | visithelsingborg | Sun Mar 21 | `R4-ingen-text-i-db` | 0 | — | nej |
| 37 | Frankenstein Premiär &#8211; Samarbete med Moomsteatern | visithelsingborg | Thu Nov 19 | `R4-ingen-text-i-db` | 0 | — | nej |
| 38 | Studio Acusticum i Piteå | studio-acusticum | Sun Nov 15 | `R4-ingen-text-i-db` | 0 | — | ja |
| 39 | Jazzkonsert med studenter från Sundsgårdens musiklinje inriktning ja | dunkers | Mon Dec 07 | `R4-ingen-text-i-db` | 0 | — | nej |
| 40 | Snacka konst med Louise Hellstrand | dunkers | Thu Nov 05 | `R4-ingen-text-i-db` | 0 | — | nej |
| 41 | Studio Acusticum i Piteå | studio-acusticum | Tue Nov 17 | `R4-ingen-text-i-db` | 0 | — | ja |
| 42 | Candlelight: Christmas Classics | visithelsingborg | Sun Dec 20 | `R4-ingen-text-i-db` | 0 | — | ja |
| 43 | Gestion de l’anxiété dans le traitement des troubles alimentaires | eventbrite-stockholm | Fri Nov 13 | `R4-ingen-text-i-db` | 0 | — | ja |
| 44 | Hammarby Fotboll | tele2-arena | Fri Nov 06 | `R4-ingen-text-i-db` | 0 | — | ja |
| 45 | Jazz Jam Fridays • Vibrant jazz jam with Stockholms finest Live at S | stampense | Fri Nov 06 | `R4-ingen-text-i-db` | 0 | — | ja |
| 46 | The 1911 Triangle Shirtwaist Factory Fire in NY - Film History Lives | eventbrite-stockholm | Sat Mar 13 | `R4-ingen-text-i-db` | 0 | — | ja |
| 47 | Studio Acusticum i Piteå | studio-acusticum | Sat Dec 05 | `R4-ingen-text-i-db` | 0 | — | ja |
| 48 | Stampen’s World Famous Blues Jam! 14:00 - 19:00 · Free Entry! | stampen | Sat Nov 07 | `R4-ingen-text-i-db` | 0 | — | ja |
| 49 | Hemslöjdsgillets slöjdcafé | dunkers | Tue Nov 24 | `R4-ingen-text-i-db` | 0 | — | nej |
| 50 | MAGISKA VÄRLDAR OCH VÄSEN – KAMMARMUSIK FRÅN FANTASYNS VÄRLD | abf | Thu Nov 19 | `R4-ingen-text-i-db` | 0 | — | ja |
| 51 | Nanny Palmqvist med Strindbergs intima teater | dunkers | Thu Dec 03 | `R4-ingen-text-i-db` | 0 | — | nej |
| 52 | Jazz Jam Fridays • Vibrant jazz jam with Stockholms finest Live at S | stampen | Fri Oct 30 | `R4-ingen-text-i-db` | 0 | — | ja |
| 53 | SOWETO GOSPEL CHOIR &#8211; JOY | visithelsingborg | Thu Nov 05 | `R4-ingen-text-i-db` | 0 | — | nej |
| 54 | J. Cole: The Fall-Off Tour, Platinum Tickets | allevents-in-stockholm | Wed Nov 11 | `R4-ingen-text-i-db` | 0 | — | ja |
| 55 | ATL’S BIGGEST HALLOWEEN TAKEOVER | eventbrite-stockholm | Fri Oct 30 | `R4-ingen-text-i-db` | 0 | — | ja |
| 56 | Staden & vi: Ett ständigt pågående förvandlingsnummer | stadsmuseet | Wed Apr 21 | `R4-ingen-text-i-db` | 0 | — | ja |
| 57 | But That’s What They Said! Conceptual Accuracy Beyond the Words | eventbrite-stockholm | Sat Dec 19 | `R4-ingen-text-i-db` | 0 | — | ja |
| 58 | Lunchvisningar med Helsingborgs museum | dunkers | Tue Nov 03 | `R4-ingen-text-i-db` | 0 | — | nej |
| 59 | Joshua Idehen (+ Support: KURT) | lugerse | Fri Dec 11 | `R4-ingen-text-i-db` | 0 | — | ja |
| 60 | Tomode | lugerse | Fri Mar 05 | `R4-ingen-text-i-db` | 0 | — | ja |
| 61 | The Machine’s Eye in Human Hands | tiqets-stockholm | Sun Nov 29 | `R4-ingen-text-i-db` | 0 | — | ja |
| 62 | Candlelight: Vivaldi&#8217;s Four Seasons | visithelsingborg | Fri Nov 13 | `R4-ingen-text-i-db` | 0 | — | ja |
| 63 | Què fer davant l’afàsia progressiva primària? | eventbrite-stockholm | Sat Dec 12 | `R4-ingen-text-i-db` | 0 | — | ja |
| 64 | HSO &#8211; Tjajkovskijs pianokonsert nr 1 &#8211; &amp; Scheherazad | visithelsingborg | Thu Feb 18 | `R4-ingen-text-i-db` | 0 | — | nej |
| 65 | Den enfaldige mördaren &#8211; Samarbete med Helsingborgs riksteater | visithelsingborg | Thu Dec 17 | `R4-ingen-text-i-db` | 0 | — | nej |
| 66 | Understanding ADHD-Fostercarers: Connection, Regulation & Support | eventbrite-stockholm | Wed Nov 04 | `R4-ingen-text-i-db` | 0 | — | ja |
| 67 | Psychoanalysis and (De)polarization | eventbrite-stockholm | Sat Nov 07 | `R4-ingen-text-i-db` | 0 | — | ja |
| 68 | Kulturellt mångfald i fokus presenterar – Hanan Group | dunkers | Sat Nov 14 | `R4-ingen-text-i-db` | 0 | — | nej |
| 69 | Bagar Bengtsson | tiqets-stockholm | Wed Jun 16 | `R4-ingen-text-i-db` | 0 | — | ja |
| 70 | Lotta Antonsson: I Am Everything | tiqets-stockholm | Sun Nov 29 | `R4-ingen-text-i-db` | 0 | — | ja |
| 71 | Metalheadz | lugerse | Sat Dec 05 | `R4-ingen-text-i-db` | 0 | — | ja |
| 72 | Nils Ferlin & KlaraBohemerna | stadsmuseet | Wed Feb 10 | `R4-ingen-text-i-db` | 0 | — | ja |
| 73 | Studio Acusticum i Piteå | studio-acusticum | Tue Nov 24 | `R4-ingen-text-i-db` | 0 | — | ja |
| 74 | "Siempre es hoy"-EUGENIA ALMEIDA-VIRTUAL | eventbrite-stockholm | Fri Nov 06 | `R4-ingen-text-i-db` | 0 | — | ja |
| 75 | Soppgirobygget | visithelsingborg | Sat Feb 06 | `R4-ingen-text-i-db` | 0 | — | nej |
| 76 | Christer Sjögren &amp; Elisabeth Andreassen &#8211; Tillsammans | visithelsingborg | Fri Mar 05 | `R4-ingen-text-i-db` | 0 | — | nej |
| 77 | Lunchkonsert med studenter från Sundsgårdens klassiska inriktning | dunkers | Wed Dec 09 | `R4-ingen-text-i-db` | 0 | — | nej |
| 78 | Babymusik | dunkers | Wed Nov 04 | `R4-ingen-text-i-db` | 0 | — | nej |
| 79 | Stampen Disco Nights •  00:00 &#8211; 02:00 • Dance the night away!  | stampen | Sat Oct 31 | `R4-ingen-text-i-db` | 0 | — | ja |
| 80 | Introduktion till fritt broderi | dunkers | Fri Nov 20 | `R4-ingen-text-i-db` | 0 | — | nej |
| 81 | Staden & vi: Ett ständigt pågående förvandlingsnummer | stadsmuseet | Wed Mar 03 | `R4-ingen-text-i-db` | 0 | — | ja |
| 82 | AIK Fotboll | stockholmlive-evenemang | Sun Nov 08 | `R4-ingen-text-i-db` | 0 | — | ja |
| 83 | Historia i rörelse: Den franske dansmästaren i 1700-talets Strängnäs | kungliga-biblioteket | Thu Nov 12 | `R4-ingen-text-i-db` | 0 | — | ja |
| 84 | David Newbould • Live at Stampen • October 30 • 20:30 &#8211; 23.00 | stampen | Fri Oct 30 | `R4-ingen-text-i-db` | 0 | — | ja |
| 85 | Seniorakademin-Bach firar jul | abf | Fri Nov 27 | `R4-ingen-text-i-db` | 0 | — | ja |
| 86 | FREDTalks: När vi dör… | visithelsingborg | Tue Nov 03 | `R4-ingen-text-i-db` | 0 | — | ja |
| 87 | Bebiscafe – musikmagi för de allra minsta. | visithelsingborg | Wed Nov 18 | `R4-ingen-text-i-db` | 0 | — | nej |
| 88 | Better Landscapes: Essential Camera Skills in the Field with Adam Ed | eventbrite-stockholm | Wed Nov 11 | `R4-ingen-text-i-db` | 0 | — | ja |
| 89 | Lunchkonsert med Sundsgårdens Musiklinje | visithelsingborg | Tue Nov 10 | `R4-ingen-text-i-db` | 0 | — | nej |

## Hem-flödet — komplett lista

Eftersom Hem-selecten saknar `editorial_description`, `eventpulse_summary`, `description_license` och `venue_name`, saknar **alla 11308** events beskrivning i Hem-flödet.
Komplett lista: `docs/audit/data/events-without-description-HEM-flow-2026-11-02.csv` (89 rader).
