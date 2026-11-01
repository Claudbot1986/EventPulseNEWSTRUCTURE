# Beskrivningstäckning — audit 2026-11-01

> Genererad av `scripts/_audit_description_coverage.mjs` (read-only, ingen DB-skrivning).
> Beskrivnings-resolutionen är importerad från den äkta UI-modulen
> `06-UI/utils/descriptionFallback.js` — auditen kan inte glida ifrån appens beteende.

## Mätvärden

| Mätning | Antal | Andel av 11932 |
|---|---:|---:|
| Events i `events_public` (det appen läser) | 11932 | 100 % |
| **Saknar beskrivning i Hem-flödet** | **11932** | 100.0 % |
| **Saknar beskrivning i Agent/Utforska-flödet** | **90** | 0.8 % |
| **Saknar beskrivning i Sök-läget** | **205** | 1.7 % |
| Saknar beskrivning i BÅDA Hem och Agent | 90 | 0.8 % |
| Har beskrivning i Hem men inte i Agent | 0 | 0.0 % |
| Har bara `eventpulse_summary` → förlorar rad-preview i Sök | 115 | 1.0 % |

## Hem-flödets select-listor (lästa ur HomeScreen.js vid körning)

Antal select()-listor i HomeScreen.js: 10

| Fält | finns i Hem-select? | betyder |
|---|---|---|
| `editorial_description` | **NEJ** | resolution steg 1 (primär) |
| `eventpulse_summary` | **NEJ** | resolution steg 2 |
| `description_license` | **NEJ** | gate för steg 3 |
| `venue_name` | **NEJ** | gate för steg 4 (faktarad) |
| `description_sv` / `description_en` | JA | steg 3 (men licens-gated) |

## Sök-läget (`mapAgentEventToRow` i `rowMapping.js`)

Sök-läget mappar sökresultat via `mapAgentEventToRow`. Den mappen forwardar
`editorial_description` och `description_license` men **inte** `eventpulse_summary
(verifierat: 0 förekomster av fältet i `rowMapping.js`).

| Mätning | Antal |
|---|---:|
| Saknar beskrivning i Sök-läget | 205 |
| Har bara `eventpulse_summary` (ingen editorial) → saknar rad-preview | 115 |

## Fördelning per källa — saknar beskrivning i Hem-flödet

| Källa | Antal |
|---|---:|
| livespot-stockholm | 4059 |
| momentsapp-stockholm | 2786 |
| spelning-se | 540 |
| fb-events-stockholm-apify | 301 |
| kungstradgarden | 266 |
| vadkul-stockholm | 260 |
| sthlmlist | 260 |
| evensos-stockholm | 255 |
| thatsup-stockholm-articles | 193 |
| dn-kalendariet | 143 |
| lugerse | 141 |
| dramaten | 132 |
| aik | 123 |
| kulturhuset | 116 |
| allevents-in-stockholm | 108 |
| songkick-stockholm | 105 |
| eventbrite-stockholm | 98 |
| folkoperan | 95 |
| gota-lejon | 90 |
| lokalhelhet-calendar | 84 |
| jarfalla | 83 |
| kth-2 | 78 |
| sprakmuseet | 76 |
| thatsupse | 65 |
| stockholmsmassan | 65 |
| globen-3 | 63 |
| billetto-stockholm | 62 |
| nupagangse | 57 |
| stockholmlive-evenemang | 55 |
| nojesfabriken | 49 |
| zita | 41 |
| dansenshus | 40 |
| berwaldhallen | 39 |
| luma-stockholm | 36 |
| sodrateatern | 34 |
| visithelsingborg | 32 |
| kungliga-musikhogskolan | 32 |
| gratisistockholm | 31 |
| musikaliskase | 30 |
| debaser | 28 |
| kultur-stockholm | 26 |
| dunkers | 22 |
| biblioteketstockholmse | 21 |
| fotografiska | 21 |
| aviciiarena | 20 |
| konstkalendern | 20 |
| improvisationsteaterse | 19 |
| riksarkivet | 19 |
| medborgarhuset-2 | 18 |
| rival | 17 |
| ticketmaster | 16 |
| teater-galeasen | 15 |
| nalencom | 14 |
| waldemarsudde | 14 |
| kulturen | 13 |
| concerts50com | 13 |
| ticketmaster-se | 13 |
| lulea-hf-2 | 13 |
| studio-acusticum | 12 |
| wwwlivenationse | 12 |
| kulturhusetstadsteaternse | 12 |
| halmstad-konserthus-2 | 12 |
| grona-lund | 12 |
| ticketmaster-goteborg | 12 |
| vaxjo-teatern-2 | 11 |
| downtown-2 | 10 |
| hammarby | 10 |
| china-teatern | 10 |
| medeltidsmuseetstockholm | 9 |
| artipelag | 9 |
| wwwfamgose | 9 |
| wwwthelaughhousese | 9 |
| malmo-live | 9 |
| wwwtekniskamuseetse | 8 |
| kollaborationse | 8 |
| malmo-icc-2 | 8 |
| royaldjurgardense | 8 |
| stampen | 8 |
| stadseventse | 8 |
| wwwvisitstockholmse | 8 |
| nalen | 8 |
| stora-teatern | 8 |
| fallan | 7 |
| wwwnojesresorse | 7 |
| konserthuset-2 | 7 |
| eventbrite-discovery | 7 |
| biljettnuse | 7 |
| folkuniversitetet | 6 |
| tiqets-stockholm | 6 |
| hallsberg | 6 |
| iogt-nto | 6 |
| winterviken-se-en | 6 |
| wwwearlymusicswedense | 6 |
| chinateatern | 6 |
| viattse | 5 |
| konstfack | 5 |
| sjungaregardense | 5 |
| arkdes | 5 |
| kulturhuset-stadsteatern | 4 |
| kungliga-biblioteket | 4 |
| kulturfestivalenstockholmse | 4 |
| 3arena | 4 |
| nordiska-museet | 4 |
| cafe-opera | 4 |
| sensus | 4 |
| wwwsvtse | 4 |
| allevents-in | 4 |
| stadsmuseet | 4 |
| mkcentrumse | 3 |
| visitstockholm-en | 3 |
| tele2-arena | 3 |
| ifk-stockholm | 3 |
| abf | 3 |
| universe-stockholm | 3 |
| historiska-museet | 3 |
| nobel-prize-museum | 3 |
| fasching | 3 |
| ticketmaster-linkoping | 3 |
| kammarencom | 3 |
| kultur1-stockholm | 3 |
| cirkus | 3 |
| eventbrite-sthlm-categories | 3 |
| stockholms-universitet | 2 |
| friends-arena | 2 |
| wwwlokalhelhetse | 2 |
| sparvag-city | 2 |
| wwwsensusse | 2 |
| lysekil | 2 |
| wwwsfotose | 2 |
| engelbrekt | 2 |
| vasa-museum | 2 |
| wwwmodernamuseetse | 2 |
| vasalund-2 | 2 |
| founders-alliance | 2 |
| stampense | 1 |
| wwwnationalmuseumse | 1 |
| antikmassan | 1 |
| vallentunakkse | 1 |
| folkoperanse | 1 |
| eventbrite-stockholm-kungsholmens | 1 |
| wwwmynewsdeskcom | 1 |
| ticketmaster-sthlm-200km | 1 |
| way-out-west | 1 |
| polismuseet | 1 |
| candidate-f8742ec8-wwwvisitstockholmse | 1 |
| candidate-4dec5162-wwwvisitstockholmse | 1 |
| keinemusikcom | 1 |
| djurgarden | 1 |
| wwwoperanse | 1 |
| postmuseum | 1 |
| somosocial | 1 |
| formex | 1 |
| pingstkyrkan | 1 |
| astronomiska-huddinge | 1 |
| annexet | 1 |
| pustervik | 1 |
| storkyrkan-2 | 1 |
| eventbrite-sthlm-all | 1 |
| eventbrite-sthlm-business | 1 |
| djurgardens-if | 1 |
| hyroxukcom | 1 |
| eventbrite-sthlm-charity | 1 |
| wwwsomaliskkulturfestivalse | 1 |
| livrustkammaren | 1 |
| iicstoccolmaesteriit | 1 |
| eventbrite-sthlm-education | 1 |
| varbergs-if | 1 |
| intiman | 1 |

## Fördelning per källa — saknar beskrivning i Agent/Utforska-flödet

| Källa | Antal |
|---|---:|
| visithelsingborg | 23 |
| dunkers | 18 |
| eventbrite-stockholm | 11 |
| studio-acusticum | 8 |
| tiqets-stockholm | 6 |
| lugerse | 5 |
| stockholmlive-evenemang | 4 |
| stampen | 4 |
| abf | 3 |
| stadsmuseet | 3 |
| kungliga-biblioteket | 2 |
| stampense | 1 |
| tele2-arena | 1 |
| allevents-in-stockholm | 1 |

## Rotorsaksklassning — de 90 events som saknar beskrivning överallt

| Rotorsak | Antal | Betydelse |
|---|---:|---|
| `R4-ingen-text-i-db` | 90 | Ingen text finns alls i DB → antingen har källan ingen beskrivning, eller så misslyckades extraktionen. |

## Komplett lista — saknar beskrivning i BÅDA flödena

Fullständig lista med rotorsak per rad: `docs/audit/data/events-without-description-2026-11-01.csv` (90 rader).

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
| 11 | Baguettemusik | visithelsingborg | Thu Oct 29 | `R4-ingen-text-i-db` | 0 | — | ja |
| 12 | Occrasy | lugerse | Sat Dec 12 | `R4-ingen-text-i-db` | 0 | — | nej |
| 13 | Djurgården Hockey | stockholmlive-evenemang | Mon Dec 28 | `R4-ingen-text-i-db` | 0 | — | ja |
| 14 | Språkcafé – Language is Power | dunkers | Fri Oct 30 | `R4-ingen-text-i-db` | 0 | — | nej |
| 15 | SAMHAIN SÉANCE: Ancestral Collaboration with Pam Grossman & Janaka S | eventbrite-stockholm | Sun Nov 01 | `R4-ingen-text-i-db` | 0 | — | ja |
| 16 | Managing Your Emotions - Prof Ethan Kross | eventbrite-stockholm | Tue Nov 10 | `R4-ingen-text-i-db` | 0 | — | ja |
| 17 | Animation du débreffage - 17 décembre 2026 - En ligne | eventbrite-stockholm | Thu Dec 17 | `R4-ingen-text-i-db` | 0 | — | ja |
| 18 | Glam, sång och starka känslor med Operadonnorna | abf | Fri Nov 20 | `R4-ingen-text-i-db` | 0 | — | ja |
| 19 | AIK Hockey | stockholmlive-evenemang | Sun Nov 15 | `R4-ingen-text-i-db` | 0 | — | ja |
| 20 | Kulturellt mångfald i fokus presenterar – Edris Durani & Tamin Azizi | dunkers | Sun Nov 15 | `R4-ingen-text-i-db` | 0 | — | nej |
| 21 | Kulturellt mångfald I fokus presenterar – Haneen Choir – Echoes of S | dunkers | Sat Nov 14 | `R4-ingen-text-i-db` | 0 | — | nej |
| 22 | Studio Acusticum i Piteå | studio-acusticum | Fri Nov 27 | `R4-ingen-text-i-db` | 0 | — | ja |
| 23 | Stampen’s World Famous Blues Jam! 14:00 - 19:00 · Free Entry! | stampen | Sat Oct 31 | `R4-ingen-text-i-db` | 0 | — | ja |
| 24 | Café Hjärtat | visithelsingborg | Wed Oct 28 | `R4-ingen-text-i-db` | 0 | — | ja |
| 25 | Söndagsdans i Atriet | dunkers | Sun Nov 01 | `R4-ingen-text-i-db` | 0 | — | nej |
| 26 | Nils Petter Löfstedt: The Unmeasurable - The Photos | tiqets-stockholm | Sun Feb 07 | `R4-ingen-text-i-db` | 0 | — | ja |
| 27 | Studio Acusticum i Piteå | studio-acusticum | Sat Nov 14 | `R4-ingen-text-i-db` | 0 | — | ja |
| 28 | Mozart Requiem | visithelsingborg | Sat Nov 07 | `R4-ingen-text-i-db` | 0 | — | ja |
| 29 | Drop-in frukost i S:t Mikael &#8211; När det värsta händer | visithelsingborg | Sat Nov 07 | `R4-ingen-text-i-db` | 0 | — | ja |
| 30 | Kvällsvisningar med Helsingborgs museum | dunkers | Thu Nov 19 | `R4-ingen-text-i-db` | 0 | — | nej |
| 31 | Värdet av offentlig gestaltning | dunkers | Wed Nov 04 | `R4-ingen-text-i-db` | 0 | — | nej |
| 32 | Toner vid tolv | visithelsingborg | Thu Oct 29 | `R4-ingen-text-i-db` | 0 | — | ja |
| 33 | Studio Acusticum i Piteå | studio-acusticum | Wed Dec 09 | `R4-ingen-text-i-db` | 0 | — | ja |
| 34 | Musikbrunch | visithelsingborg | Thu Oct 29 | `R4-ingen-text-i-db` | 0 | — | nej |
| 35 | Candlelight: The Best of Hans Zimmer | visithelsingborg | Sun Dec 20 | `R4-ingen-text-i-db` | 0 | — | ja |
| 36 | Kulturellt mångfald i fokus presenterar – Old Stories, New Voices | dunkers | Sun Nov 15 | `R4-ingen-text-i-db` | 0 | — | nej |
| 37 | Kulturellt mångfald i fokus presenterar – YAMM band | dunkers | Sun Nov 15 | `R4-ingen-text-i-db` | 0 | — | nej |
| 38 | The Lords of the Rings, The Hobbit and the Rings of Power &#8211; In | visithelsingborg | Sun Mar 21 | `R4-ingen-text-i-db` | 0 | — | nej |
| 39 | Frankenstein Premiär &#8211; Samarbete med Moomsteatern | visithelsingborg | Thu Nov 19 | `R4-ingen-text-i-db` | 0 | — | nej |
| 40 | Studio Acusticum i Piteå | studio-acusticum | Sun Nov 15 | `R4-ingen-text-i-db` | 0 | — | ja |
| 41 | Jazzkonsert med studenter från Sundsgårdens musiklinje inriktning ja | dunkers | Mon Dec 07 | `R4-ingen-text-i-db` | 0 | — | nej |
| 42 | Snacka konst med Louise Hellstrand | dunkers | Thu Nov 05 | `R4-ingen-text-i-db` | 0 | — | nej |
| 43 | Studio Acusticum i Piteå | studio-acusticum | Tue Nov 17 | `R4-ingen-text-i-db` | 0 | — | ja |
| 44 | Candlelight: Christmas Classics | visithelsingborg | Sun Dec 20 | `R4-ingen-text-i-db` | 0 | — | ja |
| 45 | Gestion de l’anxiété dans le traitement des troubles alimentaires | eventbrite-stockholm | Fri Nov 13 | `R4-ingen-text-i-db` | 0 | — | ja |
| 46 | Hammarby Fotboll | tele2-arena | Fri Nov 06 | `R4-ingen-text-i-db` | 0 | — | ja |
| 47 | Studio Acusticum i Piteå | studio-acusticum | Sat Dec 05 | `R4-ingen-text-i-db` | 0 | — | ja |
| 48 | Hemslöjdsgillets slöjdcafé | dunkers | Tue Nov 24 | `R4-ingen-text-i-db` | 0 | — | nej |
| 49 | MAGISKA VÄRLDAR OCH VÄSEN – KAMMARMUSIK FRÅN FANTASYNS VÄRLD | abf | Thu Nov 19 | `R4-ingen-text-i-db` | 0 | — | ja |
| 50 | Nanny Palmqvist med Strindbergs intima teater | dunkers | Thu Dec 03 | `R4-ingen-text-i-db` | 0 | — | nej |
| 51 | Jazz Jam Fridays • Vibrant jazz jam with Stockholms finest Live at S | stampen | Fri Oct 30 | `R4-ingen-text-i-db` | 0 | — | ja |
| 52 | SOWETO GOSPEL CHOIR &#8211; JOY | visithelsingborg | Thu Nov 05 | `R4-ingen-text-i-db` | 0 | — | nej |
| 53 | J. Cole: The Fall-Off Tour, Platinum Tickets | allevents-in-stockholm | Wed Nov 11 | `R4-ingen-text-i-db` | 0 | — | ja |
| 54 | ATL’S BIGGEST HALLOWEEN TAKEOVER | eventbrite-stockholm | Fri Oct 30 | `R4-ingen-text-i-db` | 0 | — | ja |
| 55 | Staden & vi: Ett ständigt pågående förvandlingsnummer | stadsmuseet | Wed Apr 21 | `R4-ingen-text-i-db` | 0 | — | ja |
| 56 | But That’s What They Said! Conceptual Accuracy Beyond the Words | eventbrite-stockholm | Sat Dec 19 | `R4-ingen-text-i-db` | 0 | — | ja |
| 57 | Lunchvisningar med Helsingborgs museum | dunkers | Tue Nov 03 | `R4-ingen-text-i-db` | 0 | — | nej |
| 58 | Joshua Idehen (+ Support: KURT) | lugerse | Fri Dec 11 | `R4-ingen-text-i-db` | 0 | — | ja |
| 59 | Tomode | lugerse | Fri Mar 05 | `R4-ingen-text-i-db` | 0 | — | ja |
| 60 | The Machine’s Eye in Human Hands | tiqets-stockholm | Sun Nov 29 | `R4-ingen-text-i-db` | 0 | — | ja |
| 61 | Candlelight: Vivaldi&#8217;s Four Seasons | visithelsingborg | Fri Nov 13 | `R4-ingen-text-i-db` | 0 | — | ja |
| 62 | Què fer davant l’afàsia progressiva primària? | eventbrite-stockholm | Sat Dec 12 | `R4-ingen-text-i-db` | 0 | — | ja |
| 63 | HSO &#8211; Tjajkovskijs pianokonsert nr 1 &#8211; &amp; Scheherazad | visithelsingborg | Thu Feb 18 | `R4-ingen-text-i-db` | 0 | — | nej |
| 64 | Den enfaldige mördaren &#8211; Samarbete med Helsingborgs riksteater | visithelsingborg | Thu Dec 17 | `R4-ingen-text-i-db` | 0 | — | nej |
| 65 | Understanding ADHD-Fostercarers: Connection, Regulation & Support | eventbrite-stockholm | Wed Nov 04 | `R4-ingen-text-i-db` | 0 | — | ja |
| 66 | Psychoanalysis and (De)polarization | eventbrite-stockholm | Sat Nov 07 | `R4-ingen-text-i-db` | 0 | — | ja |
| 67 | Kulturellt mångfald i fokus presenterar – Hanan Group | dunkers | Sat Nov 14 | `R4-ingen-text-i-db` | 0 | — | nej |
| 68 | Bagar Bengtsson | tiqets-stockholm | Wed Jun 16 | `R4-ingen-text-i-db` | 0 | — | ja |
| 69 | Lotta Antonsson: I Am Everything | tiqets-stockholm | Sun Nov 29 | `R4-ingen-text-i-db` | 0 | — | ja |
| 70 | Metalheadz | lugerse | Sat Dec 05 | `R4-ingen-text-i-db` | 0 | — | ja |
| 71 | Nils Ferlin & KlaraBohemerna | stadsmuseet | Wed Feb 10 | `R4-ingen-text-i-db` | 0 | — | ja |
| 72 | Studio Acusticum i Piteå | studio-acusticum | Tue Nov 24 | `R4-ingen-text-i-db` | 0 | — | ja |
| 73 | "Siempre es hoy"-EUGENIA ALMEIDA-VIRTUAL | eventbrite-stockholm | Fri Nov 06 | `R4-ingen-text-i-db` | 0 | — | ja |
| 74 | Soppgirobygget | visithelsingborg | Sat Feb 06 | `R4-ingen-text-i-db` | 0 | — | nej |
| 75 | Christer Sjögren &amp; Elisabeth Andreassen &#8211; Tillsammans | visithelsingborg | Fri Mar 05 | `R4-ingen-text-i-db` | 0 | — | nej |
| 76 | Lunchkonsert med studenter från Sundsgårdens klassiska inriktning | dunkers | Wed Dec 09 | `R4-ingen-text-i-db` | 0 | — | nej |
| 77 | Babymusik | dunkers | Wed Nov 04 | `R4-ingen-text-i-db` | 0 | — | nej |
| 78 | Stampen Disco Nights •  00:00 &#8211; 02:00 • Dance the night away!  | stampen | Sat Oct 31 | `R4-ingen-text-i-db` | 0 | — | ja |
| 79 | Introduktion till fritt broderi | dunkers | Fri Nov 20 | `R4-ingen-text-i-db` | 0 | — | nej |
| 80 | Lunchvisning i konsthallen | dunkers | Tue Oct 27 | `R4-ingen-text-i-db` | 0 | — | nej |
| 81 | Toner vid tolv: Middagsbön med lunchmusik | visithelsingborg | Thu Oct 29 | `R4-ingen-text-i-db` | 0 | — | ja |
| 82 | Staden & vi: Ett ständigt pågående förvandlingsnummer | stadsmuseet | Wed Mar 03 | `R4-ingen-text-i-db` | 0 | — | ja |
| 83 | AIK Fotboll | stockholmlive-evenemang | Sun Nov 08 | `R4-ingen-text-i-db` | 0 | — | ja |
| 84 | Historia i rörelse: Den franske dansmästaren i 1700-talets Strängnäs | kungliga-biblioteket | Thu Nov 12 | `R4-ingen-text-i-db` | 0 | — | ja |
| 85 | David Newbould • Live at Stampen • October 30 • 20:30 &#8211; 23.00 | stampen | Fri Oct 30 | `R4-ingen-text-i-db` | 0 | — | ja |
| 86 | Seniorakademin-Bach firar jul | abf | Fri Nov 27 | `R4-ingen-text-i-db` | 0 | — | ja |
| 87 | FREDTalks: När vi dör… | visithelsingborg | Tue Nov 03 | `R4-ingen-text-i-db` | 0 | — | ja |
| 88 | Bebiscafe – musikmagi för de allra minsta. | visithelsingborg | Wed Nov 18 | `R4-ingen-text-i-db` | 0 | — | nej |
| 89 | Better Landscapes: Essential Camera Skills in the Field with Adam Ed | eventbrite-stockholm | Wed Nov 11 | `R4-ingen-text-i-db` | 0 | — | ja |
| 90 | Lunchkonsert med Sundsgårdens Musiklinje | visithelsingborg | Tue Nov 10 | `R4-ingen-text-i-db` | 0 | — | nej |

## Hem-flödet — komplett lista

Eftersom Hem-selecten saknar `editorial_description`, `eventpulse_summary`, `description_license` och `venue_name`, saknar **alla 11932** events beskrivning i Hem-flödet.
Komplett lista: `docs/audit/data/events-without-description-HEM-flow-2026-11-01.csv` (11932 rader).
