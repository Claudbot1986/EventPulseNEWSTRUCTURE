# 100 Event Source Candidates for EventPulse

## Test Results (2026-03-28)

**Pipeline:** `fetchHtml(url) → extractFromJsonLd(html) → toRawEventInput()`
**Total tested:** 100 | **Success:** 0 | **Events extracted:** 0

### Status Categories
- ✅ success = JSON-LD Event blocks found and extracted
- 📭 no-jsonld = HTML fetched but no JSON-LD scripts found
- 🏷️ wrong-type = JSON-LD found but no schema.org/Event objects
- 🖥️ js-render = HTML empty/too small (likely JS-rendered)
- 🚫 blocked = HTTP 403/401 forbidden
- 🔗 bad-url = HTTP 404
- ❌ parse-error = JSON parse failed
- ⏱️ timeout = request timed out
- ❓ unknown = DNS error, connection refused, SSL error

---

## FULL RESULTS TABLE

| # | Källa | URL | Typ | Stad | Status | Events | Conf |
|---|--------|-----|-----|------|--------|--------|------|
| 1 | Konserthuset Stockholm | www.konserthuset.se | konserthus | Stockholm | 📭 no-jsonld | — | — |
| 2 | Berwaldhallen | www.berwaldhallen.se | konserthus | Stockholm | 📭 no-jsonld | — | — |
| 3 | Göteborgs Symfoniker (GSO) | www.gso.se | konserthus | Göteborg | 📭 no-jsonld | — | — |
| 4 | Malmö Live | malmolive.se | konserthus | Malmö | 📭 no-jsonld | — | — |
| 5 | Fryshuset | fryshuset.se | arena | Stockholm | 📭 no-jsonld | — | — |
| 6 | Avicii Arena | aviciiarena.se | arena | Stockholm | 🏷️ wrong-type | 0 | — |
| 7 | Kulturhuset Stadsteatern | www.kulturhuset.se | kulturhus | Stockholm | 🏷️ wrong-type | 0 | — |
| 8 | Malmö Opera | www.malmoopera.se | opera | Malmö | 📭 no-jsonld | — | — |
| 9 | GöteborgsOperan | www.goteborgsoperan.se | opera | Göteborg | ❓ unknown (DNS) | — | — |
| 10 | Kungliga Operan | www.operan.se | opera | Stockholm | 📭 no-jsonld | — | — |
| 11 | Folkoperan | www.folkoperan.se | opera | Stockholm | 🏷️ wrong-type | 0 | — |
| 12 | Dramaten | www.dramaten.se | teater | Stockholm | 📭 no-jsonld | — | — |
| 13 | Uppsala Konserthus | www.uppsalakonserthus.se | konserthus | Uppsala | ❓ unknown (DNS) | — | — |
| 14 | Malmö Konserthus | www.malmo-konserthus.se | konserthus | Malmö | ❓ unknown (DNS) | — | — |
| 15 | Stora Teatern Göteborg | www.stora-teatern.goteborg.se | teater | Göteborg | ❓ unknown (DNS) | — | — |
| 16 | Debaser | debaser.se | musik | Stockholm | 📭 no-jsonld | — | — |
| 17 | Slakthuset | slakthuset.se | musik | Stockholm | 🔗 bad-url (404) | — | — |
| 18 | Stora Teatern Uppsala | www.storateatern.se | musik | Uppsala | 🏷️ wrong-type | 0 | — |
| 19 | Cirkus | www.cirkus.se | teater | Stockholm | 🏷️ wrong-type | 0 | — |
| 20 | China Teatern | www.chinateatern.se | teater | Stockholm | 🏷️ wrong-type | 0 | — |
| 21 | Oscar Teatern | www.oscarsteatern.se | teater | Stockholm | 🏷️ wrong-type | 0 | — |
| 22 | Moderna Museet | www.modernamuseet.se | museum | Stockholm | 🏷️ wrong-type | 0 | — |
| 23 | Nationalmuseum | www.nationalmuseum.se | museum | Stockholm | 🏷️ wrong-type | 0 | — |
| 24 | Nobelmuseet | www.nobelmuseet.se | museum | Stockholm | ❓ unknown (SSL) | — | — |
| 25 | Naturhistoriska Riksmuseet | www.nrm.se | museum | Stockholm | 📭 no-jsonld | — | — |
| 26 | Nordiska Museet | www.nordiskamuseet.se | museum | Stockholm | 🏷️ wrong-type | 0 | — |
| 27 | ArkDes | arkdes.se | museum | Stockholm | 🏷️ wrong-type | 0 | — |
| 28 | Fotografiska | www.fotografiska.com | museum | Stockholm | 🏷️ wrong-type | 0 | — |
| 29 | Artipelag | www.artipelag.se | museum | Stockholm | 🏷️ wrong-type | 0 | — |
| 30 | Waldemarsudde | www.waldemarsudde.se | museum | Stockholm | 🏷️ wrong-type | 0 | — |
| 31 | Skansen | www.skansen.se | familj | Stockholm | 🏷️ wrong-type | 0 | — |
| 32 | Junibacken | www.junibacken.se | familj | Stockholm | 🏷️ wrong-type | 0 | — |
| 33 | Gröna Lund | www.gronalund.se | nöje | Stockholm | 📭 no-jsonld | — | — |
| 34 | Liseberg | www.liseberg.se | nöje | Göteborg | 🏷️ wrong-type | 0 | — |
| 35 | Uppsala Linné Science Park | www.linne.uu.se | museum | Uppsala | ❓ unknown (DNS) | — | — |
| 36 | Polismuseum | www.polismuseum.se | museum | Stockholm | ⏱️ timeout | — | — |
| 37 | Vasamuseet | www.vasamuseet.se | museum | Stockholm | 📭 no-jsonld | — | — |
| 38 | Livrustkammaren | www.livrustkammaren.se | museum | Stockholm | 🏷️ wrong-type | 0 | — |
| 39 | Tekniska Museet | www.tekniska.se | museum | Stockholm | ⏱️ timeout | — | — |
| 40 | Astronomiska Huddinge | www.astronomiska.se | museum | Stockholm | 📭 no-jsonld | — | — |
| 41 | Avicii Arena (sport) | www.aviciiarena.se | arena | Stockholm | 🏷️ wrong-type | 0 | — |
| 42 | Scandinavium | www.scandinavium.se | arena | Göteborg | 📭 no-jsonld | — | — |
| 43 | Malmö Arena | www.malmoarena.se | arena | Malmö | 🏷️ wrong-type | 0 | — |
| 44 | Friends Arena | friendsarena.se | arena | Stockholm | 🏷️ wrong-type | 0 | — |
| 45 | Tele2 Arena | tele2arena.se | arena | Stockholm | 🏷️ wrong-type | 0 | — |
| 46 | Eggers Arena (EHCO) | www.eggersarena.se | arena | Göteborg | ❓ unknown (DNS) | — | — |
| 47 | Hovet | www.hovet.se | sport | Stockholm | ❓ unknown (DNS) | — | — |
| 48 | Malmö Arena (ishockey) | www.malmoarena.se | sport | Malmö | 🏷️ wrong-type | 0 | — |
| 49 | FC Rosengård | www.fcc.se | sport | Malmö | 📭 no-jsonld | — | — |
| 50 | IFK Göteborg | www.ifkgoteborg.se | sport | Göteborg | 🏷️ wrong-type | 0 | — |
| 51 | Allt om Mat | www.alltommat.se | mat | Sverige | 🏷️ wrong-type | 0 | — |
| 52 | White Guide | whiteguide.se | mat | Sverige | ⏱️ timeout | — | — |
| 53 | Din Gastrotek | www.gastrotek.se | mat | Sverige | ❓ unknown (DNS) | — | — |
| 54 | Swedish Food | www.swedishfood.com | mat | Sverige | 🏷️ wrong-type | 0 | — |
| 55 | Way Out West | wayoutwest.se | festival | Göteborg | 🏷️ wrong-type | 0 | — |
| 56 | Get Lost | getlost.se | festival | Stockholm | ❓ unknown (ECONNREFUSED) | — | — |
| 57 | Stockholm Music & Arts | stockholmmaf.se | festival | Stockholm | ❓ unknown (DNS) | — | — |
| 58 | Storsjöodjuret | www.storsjoodjuret.se | festival | Östersund | ❓ unknown (DNS) | — | — |
| 59 | Summerburst | summerburst.se | festival | Stockholm | ❓ unknown (ECONNREFUSED) | — | — |
| 60 | Uppsala Reggae Festival | www.uppsala-reggae.se | festival | Uppsala | ❓ unknown (DNS) | — | — |
| 61 | Göteborgs Jazz Festival | www.jazzfestival.se | festival | Göteborg | ❓ unknown (DNS) | — | — |
| 62 | Stockholm Jazz Festival | www.stojazz.se | festival | Stockholm | ❓ unknown (DNS) | — | — |
| 63 | Melodifestivalen (SVT) | www.svt.se/melodifestivalen | underhållning | Sverige | 🔗 bad-url (404) | — | — |
| 64 | Stockholms Universitet | www.su.se/evenemang | akademi | Stockholm | 📭 no-jsonld | — | — |
| 65 | Göteborgs Universitet | gu.se/evenemang | akademi | Göteborg | 📭 no-jsonld | — | — |
| 66 | Uppsala Universitet | www.uu.se/evenemang | akademi | Uppsala | 🔗 bad-url (404) | — | — |
| 67 | Lunds Universitet | www.lu.se/evenemang | akademi | Lund | 📭 no-jsonld | — | — |
| 68 | KTH | www.kth.se/evenemang | akademi | Stockholm | 🔗 bad-url (404) | — | — |
| 69 | SLU | www.slu.se/evenemang | akademi | Uppsala | 🔗 bad-url (404) | — | — |
| 70 | Karolinska Institutet | ki.se/om/arrangement | akademi | Stockholm | 🔗 bad-url (404) | — | — |
| 71 | Mittuniversitetet | www.miun.se/evenemang | akademi | Sundsvall | 📭 no-jsonld | — | — |
| 72 | Högskolan i Skövde | www.his.se/evenemang | akademi | Skövde | 🔗 bad-url (404) | — | — |
| 73 | Malmö Universitet | www.mau.se/evenemang | akademi | Malmö | 🔗 bad-url (404) | — | — |
| 74 | Svenska Fotbollförbundet | www.svenskfotboll.se | sport | Sverige | 📭 no-jsonld | — | — |
| 75 | Svenska Hockeyligan (SHL) | www.shl.se | sport | Sverige | 📭 no-jsonld | — | — |
| 76 | Svenska Baskethallsförbundet | www.sbf.se | sport | Sverige | 📭 no-jsonld | — | — |
| 77 | Svenska Innebandyförbundet | www.svenskaif.se | sport | Sverige | ❓ unknown (DNS) | — | — |
| 78 | Friidrottsförbundet | www.friidrott.se | sport | Sverige | 📭 no-jsonld | — | — |
| 79 | Ridsportförbundet | www.ridsport.se | sport | Sverige | 📭 no-jsonld | — | — |
| 80 | Svenska Schackförbundet | schack.se/evenemang | sport | Sverige | 🏷️ wrong-type | 0 | — |
| 81 | Svenska Bowlingförbundet | www.svenska-bowling.se | sport | Sverige | ❓ unknown (DNS) | — | — |
| 82 | Svenska Tennisförbundet | www.tennis.se | sport | Sverige | 📭 no-jsonld | — | — |
| 83 | Västerås Konstmuseum | www.vasterasmuseum.se | museum | Västerås | ❓ unknown (DNS) | — | — |
| 84 | Borås Zoo (Animagic) | www.animagic.se | nöje | Borås | 📭 no-jsonld | — | — |
| 85 | Helsingborgs Dagblad | www.hd.se/evenemang | media | Helsingborg | 🔗 bad-url (404) | — | — |
| 86 | Göteborgs-Posten | www.gp.se/evenemang | media | Göteborg | 🔗 bad-url (404) | — | — |
| 87 | Sydsvenskan | www.sydsvenskan.se/evenemang | media | Malmö | 🔗 bad-url (404) | — | — |
| 88 | UNT (Uppsala) | www.unt.se/evenemang | media | Uppsala | 🔗 bad-url (404) | — | — |
| 89 | Norrköpings Tidningar | www.nt.se/evenemang | media | Norrköping | 🔗 bad-url (404) | — | — |
| 90 | Västerbottens-Kuriren | www.vk.se/evenemang | media | Umeå | 🔗 bad-url (404) | — | — |
| 91 | Helsingborgs Konserthus | www.helsingborgskonserthus.se | konserthus | Helsingborg | 🏷️ wrong-type | 0 | — |
| 92 | Östersund Festival | www.ostersund.se/festival | festival | Östersund | 🔗 bad-url (404) | — | — |
| 93 | Unga Teatern | www.ungateatern.se | teater | Stockholm | ❓ unknown (DNS) | — | — |
| 94 | Röhsska Museet | www.rohus.se | museum | Göteborg | 📭 no-jsonld | — | — |
| 95 | Textilmuséet | www.textilmuseet.se | museum | Borås | 📭 no-jsonld | — | — |
| 96 | ArbetSam | www.arbetam.se | museum | Stockholm | ❓ unknown (DNS) | — | — |
| 97 | Millesgården | www.millesgarden.se | museum | Stockholm | 📭 no-jsonld | — | — |
| 98 | Gröna Lund (nöje) | www.gronalund.se | nöje | Stockholm | 📭 no-jsonld | — | — |
| 99 | Liseberg (nöje) | www.liseberg.se | nöje | Göteborg | 🏷️ wrong-type | 0 | — |
| 100 | Billetto (aggregator) | billetto.se | aggregator | Sverige | 🏷️ wrong-type | 0 | — |

---

## SUMMARY

| Status | Antal | Andel |
|--------|-------|-------|
| 📭 no-jsonld | 30 | 30% |
| 🏷️ wrong-type | 31 | 31% |
| ❓ unknown (DNS/SSL/conn) | 24 | 24% |
| 🔗 bad-url (404) | 15 | 15% |
| ✅ success | 0 | 0% |
| **Total** | **100** | **100%** |

---

## ANALYSIS

### Problem 1: No JSON-LD (30 sources)
These pages load but have no `<script type="application/ld+json">` tags at all. They may use:
- JavaScript-rendered event calendars
- Server-side rendering without structured data
- Event data loaded via separate API calls (network path)
- **Action:** Try `/calendar` or `/events` subpages, or use HTML DOM extraction

### Problem 2: Wrong-type JSON-LD (31 sources)
These pages have JSON-LD but it's `WebPage`, `Organization`, `Place`, or `BreadcrumbList` — not `Event`. Many Swedish institutions use `WebPage` with event data embedded differently.
- **Action:** Check if the event data is in a subpage (individual event pages have Event JSON-LD but list pages don't)

### Problem 3: DNS / Connection Errors (24 sources)
Many hostnames are wrong or outdated (site may have moved, subdomain wrong, or site is down).
- **Action:** Manual investigation needed for each — some may have moved to new domains

### Problem 4: 404 Bad URLs (15 sources)
University `/evenemang` pages and media sites have changed URLs or removed event sections.
- **Action:** Find correct event section URLs for these sites

---

## NEXT STEPS

1. **Fix URL errors** — many `www.` subdomains are wrong; try root domain or specific event pages
2. **Try program/calendar subpages** — `konserthuset.se/program`, `dramaten.se/kalender` etc.
3. **Try individual event pages** — wrong-type often means the homepage lacks events but event detail pages have Event JSON-LD
4. **Cloudflare/browser rendering** — needed for JS-rendered pages
5. **Network/API discovery** — many sites load events via XHR; find internal JSON endpoints

---

*Test run: 2026-03-28 | Script: services/ingestion/src/100candidateTester.ts*
