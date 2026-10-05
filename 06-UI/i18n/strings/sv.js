/**
 * Swedish dictionary — the reference language (fallback of last resort).
 * Every key MUST exist here; other languages may omit keys and fall back
 * (chosen → en → sv). Values copied verbatim from the pre-i18n UI.
 *
 * Interpolation: {name} placeholders. Day/month name arrays live in
 * ../dateNames.js (not here — they are structured data, not flat strings).
 */
export default {
  // ─── Tabs ────────────────────────────────────────────────────────────────
  'tabs.home': 'Hem',
  'tabs.explore': 'Utforska',
  'tabs.notifications': 'Notiser',
  'tabs.profile': 'Profil',
  'tabs.map': 'Karta',

  // ─── Common ──────────────────────────────────────────────────────────────
  'common.retry': 'Försök igen',
  'common.retryFetch': 'Hämta igen',
  'common.close': 'Stäng',
  'common.cancel': 'Avbryt',
  'common.back': 'Tillbaka',
  'common.loading': 'Laddar…',
  'common.save': 'Spara',
  'common.saved': '✓ Sparad',
  'common.saveEvent': 'Spara event',
  'common.removeSaved': 'Ta bort från sparade',
  'common.dismiss': 'Dölj',
  'common.dismissed': 'Dold',
  'common.dismissEvent': 'Dölj detta event',
  'common.open': 'Öppna',
  'common.openArrow': 'Öppna →',
  'common.continue': 'Fortsätt',
  'common.continueNoChoice': 'Fortsätt utan val',
  'common.skip': 'Hoppa över',
  'common.logIn': 'Logga in',
  'common.logOut': 'Logga ut',
  'common.addEmail': 'Lägg till e-post',
  'common.venueMissing': 'Plats ej angiven',
  'common.timeMissing': 'Tid ej angiven',
  'common.dateMissing': 'Datum saknas',
  'common.dateNotSet': 'Datum ej angivet',
  'common.loadError': 'Kunde inte hämta: {error}',
  'common.externalLink': 'Extern länk',
  'common.readMore': 'Läs mer',
  'common.openEvent': 'Öppna event',
  'common.free': 'Gratis',
  'common.priceFrom': '{min} kr',
  'common.priceRange': '{min}–{max} kr',
  'common.titleMissing': 'Titel saknas',
  'common.atTime': 'klockan {time}',
  'common.today': 'Idag',
  'common.tomorrow': 'Imorgon',
  'common.unknownError': 'okänt fel',
  'common.networkError': 'nätverksfel',

  // ─── Onboarding ──────────────────────────────────────────────────────────
  'onboarding.eyebrow': 'VÄLKOMMEN TILL EVENTPULSE',
  'onboarding.title': 'Vad är du intresserad av?',
  'onboarding.subtitle':
    'Välj en eller flera kategorier. Vi använder dem för att visa relevanta evenemang först i din hemvy. Du kan ändra när som helst under Profil.',
  'onboarding.continueA11y': 'Fortsätt till EventPulse',
  'onboarding.category.music': 'Konserter',
  'onboarding.category.exhibitions': 'Utställningar',
  'onboarding.category.sports': 'Sport',
  'onboarding.category.family': 'Barn & familj',
  'onboarding.category.free': 'Gratis',
  'onboarding.category.nightlife': 'Kvällar',
  'onboarding.category.weekend': 'Helger',

  // ─── Login (email magic link + Apple) ────────────────────────────────────
  'login.invalidEmail': 'Ogiltig email — kontrollera stavningen.',
  'login.appleUnavailable': 'Apple Sign In är inte tillgängligt på den här enheten.',
  'login.appleIosOnly': 'Apple Sign In fungerar bara på iOS.',
  'login.appleFailed': 'Kunde inte logga in med Apple.',
  'login.sessionSaveFailed': 'Kunde inte spara sessionen — försök igen.',
  'login.title': 'Logga in med email',
  'login.body':
    'Vi skickar en magisk länk till din email. Klicka på den för att logga in — inget lösenord behövs.',
  'login.sentTitle': 'Kolla din inkorg',
  'login.sentBodyLink':
    'Vi har skickat en bekräftelselänk till {email}. Öppna den på samma enhet — dina sparade event och din smak följer med.',
  'login.sentBodySignin':
    'Vi har skickat en inloggningslänk till {email}. Öppna länken på samma enhet för att logga in.',
  'login.useOtherEmail': 'Använd annan email',
  'login.appleContinue': 'Fortsätt med Apple',
  'login.or': 'eller',
  'login.emailPlaceholder': 'din@email.com',
  'login.emailA11y': 'Email-adress',
  'login.sendMagicLink': 'Skicka magic link',
  'login.linkLandsAt': 'Länken landar på: {url}',

  // ─── Email code entry ────────────────────────────────────────────────────
  'codeEntry.errInvalid': 'Koden stämmer inte eller har gått ut — kontrollera och försök igen.',
  'codeEntry.errRateLimited': 'För många försök — vänta en liten stund och testa igen.',
  'codeEntry.errTimeout': 'Det tog för lång tid — kolla uppkopplingen och försök igen.',
  'codeEntry.errGeneric': 'Något gick fel — försök igen.',
  'codeEntry.resendTimeout': 'Det tog för lång tid — försök igen.',
  'codeEntry.resendFailed': 'Kunde inte skicka en ny kod — försök igen.',
  'codeEntry.title': 'Knappa in koden',
  'codeEntry.body': 'Vi har skickat en 6-siffrig kod till {email}. Skriv in den här för att logga in.',
  'codeEntry.bodyLinkSuffix': ' Dina sparade event och din smak följer med till kontot.',
  'codeEntry.boxesA11y': 'Inloggningskod, 6 siffror',
  'codeEntry.inputA11y': 'Kodfält',
  'codeEntry.verifying': 'Verifierar…',
  'codeEntry.success': 'Klart — du loggas in!',
  'codeEntry.resendA11y': 'Skicka ny kod',
  'codeEntry.resendSending': 'Skickar…',
  'codeEntry.resendCooldown': 'Skicka ny kod ({seconds}s)',
  'codeEntry.resend': 'Skicka ny kod',
  'codeEntry.linkHint': 'Funkar inte koden? Öppna hellre länken i mejlet.',
  'codeEntry.changeEmail': 'Ändra e-postadress',

  // ─── Magic link handler ──────────────────────────────────────────────────
  'magicLink.errInvalid': 'Ogiltig magic link — kontrollera att du öppnade den senaste länken i din email.',
  'magicLink.errNoToken': 'Ogiltig magic link — saknar token.',
  'magicLink.errVerify': 'Kunde inte verifiera magic link.',
  'magicLink.verifying': 'Verifierar magic link…',
  'magicLink.errTitle': 'Något gick fel',
  'magicLink.backToApp': 'Tillbaka till appen',

  // ─── Home ────────────────────────────────────────────────────────────────
  'home.cityEyebrow': 'STOCKHOLM',
  'home.greeting.night': 'God natt, Stockholm',
  'home.greeting.morning': 'God morgon, Stockholm',
  'home.greeting.afternoon': 'God eftermiddag, Stockholm',
  'home.greeting.evening': 'God kväll, Stockholm',
  'home.subtitle.night': 'Nu är det lugnt — kolla in helgens händelser.',
  'home.subtitle.morning': 'Vad vill du göra i Stockholm idag?',
  'home.subtitle.afternoon': 'Har du några planer för kvällen?',
  'home.subtitle.evening': 'Stockholm har massor på gång ikväll.',
  'home.soldOut': 'Slutsåld',
  'home.fewLeft': 'Få kvar',
  'home.cancelled': 'Inställt',
  'home.notOnSale': 'Ej öppet för försäljning',
  'home.cardA11y': '{title}{when} på {venue}',
  'home.empty': '— inga evenemang just nu —',
  'home.live.badge': 'LIVE',
  'home.liveA11y': 'Pågår nu: {title}{when} på {venue}',
  'home.live.eyebrow': 'PÅGÅR NU',
  'home.live.title': 'Händer just nu',
  'home.live.errorA11y': 'Kunde inte ladda händelser. Tryck för att försöka igen.',
  'home.live.error': 'Kunde inte ladda — tryck för att försöka igen',
  'home.tonight.eyebrow': 'IKVÄLL',
  'home.tonight.title': 'Händer ikväll',
  'home.weekend.eyebrow': 'HELGEN',
  'home.weekend.title': 'Denna helg',
  // Din helg (2026-09-20) — fast veckoritual: topp 3–5 av /agent/recommended
  // filtrerat på kommande fre–sön, alltid överst på Hem.
  'home.dinHelg.eyebrow': 'DIN HELG',
  'home.dinHelg.title': 'Plockat för din helg',
  'toast.savedTaste': 'Sparad — vi lär oss din smak',
  'home.free.eyebrow': 'GRATIS',
  'home.free.title': 'Gratis evenemang',
  'home.recommended.eyebrow': 'REKOMMENDERAT',
  'home.recommended.title': 'För dig',
  'home.ai.eyebrow': 'AI-BILDER · SMOKETEST',
  'home.ai.title': 'Genererade bilder från kategori + tid',
  'home.ai.loadError': 'Kunde inte hämta AI-bilder: {error}',
  'home.ai.cardA11y': '{title} (AI-genererad bild)',
  'home.ai.chip': 'AI-genererad',
  'home.loadingForYou': 'Laddar förslag',
  'home.promptChipA11y': '{text}',
  'home.promptChipA11yReason': '{text}. {reason}',
  'home.curatedChipA11y': 'Kuratorens val: {name}',
  'home.curated.eyebrow': 'KURATORENS VAL',
  'home.curated.title': 'Handplockade listor',
  'home.suggestions.eyebrow': 'FÖRSLAG',
  'home.suggestions.title': 'Vad vill du göra?',
  'home.recentChipA11y': 'Upprepa sökning: {query}',
  'home.recent.eyebrow': 'SENASTE',
  'home.recent.title': 'Dina senaste sökningar',
  'home.intentLoading': 'Laddar agentförslag',
  'home.intentEmpty': '— inga matchningar ännu —',
  'home.agent.eyebrow': 'AGENT',
  'home.agent.title': 'Förslag från din agent',
  'home.saved.eyebrow': 'SPARADE',
  'home.saved.title': 'Dina sparade evenemang',
  'home.savedEmpty': '— inga sparade evenemang ännu —',

  // Hem-supabase 5 sektioner (2026-09-25): För dig → Senaste → Ikväll →
  // Helgen → Upptäck. Section headers + Senaste-subtitles + Upptäck-tagline.
  'home.sections.fordig': 'För dig',
  'home.sections.senaste': 'Senaste',
  'home.sections.ikvall': 'Ikväll',
  'home.sections.helgen': 'Helgen',
  'home.sections.upptack': 'Upptäck',
  // Hem-karuseller (2026-09-26): 4 nya sektioner enligt HOME-CAROUSELS-PLAN.md.
  // Placering i HomeScreen: 4. Imorgon (→ efter Ikväll) / 6. Foodies (→ efter Helgen)
  // 7. Gratis / 8. Nytt på Eventpulse (innan Upptäck som flyttas till #9).
  // Online parkerad som future build — se docs/future-builds/online-carousel-2026-09-26.md.
  'home.sections.gratis': 'Gratis',
  'home.sections.imorgon': 'Imorgon',
  'home.sections.foodies': 'Foodies',
  'home.sections.nyttEventpulse': 'Nytt på Eventpulse',
  'home.subtitle.today': 'i dag',
  'home.subtitle.tomorrow': 'i morgon',
  'home.subtitle.yesterday': 'igår',
  'home.subtitle.dayBeforeYesterday': 'i förrgår',
  'home.subtitle.recommended': 'Rekommenderad',
  'home.subtitle.free': 'Gratis',
  'home.subtitle.upptack': 'Bortom din bubbla',
  'home.subtitle.errorUnknown': 'okänt fel',
  'home.emptySection': 'Inga events i denna sektion just nu.',

  // Hem-karuseller (2026-09-24, en rad per kategori). Fyra nya rader efter
  // HappeningNow: varje rad ÄR en kategori, alla kort i raden delar samma
  // filter. Spotify-explore-stil. Subtitle per kort = evenemangets egen
  // tid (dayTimeLabel "21:00 • LÖR"), inte kategori-namnet.
  'home.carousel.imorgon.header': 'Imorgon',
  'home.carousel.live.header': 'Live',
  'home.carousel.stamningsfullt.header': 'Stämningsfullt',
  'home.carousel.skratt.header': 'Skratt',

  // ─── Utforska-tiles (Hem, dev-gated EXPO_PUBLIC_EXPLORE_TILES) ───────────
  'home.explore.title': 'Utforska',
  'home.categories.title': 'Kategorier',
  'home.explore.gratis.label': 'Gratis',
  'home.explore.gratis.prompt': 'Gratis evenemang',
  'home.explore.live.label': 'Live',
  'home.explore.live.prompt': 'Live på scen',
  'home.explore.skratt.label': 'Skratt',
  'home.explore.skratt.prompt': 'Skratt — standup och komedi',
  'home.explore.stamning.label': 'Stämningsfullt',
  'home.explore.stamning.prompt': 'Stämningsfullt',
  'home.explore.helg.label': 'Helg',
  'home.explore.helg.prompt': 'Helgens evenemang',
  'home.explore.imorgon.label': 'Imorgon',
  'home.explore.imorgon.prompt': 'Imorgon',

  // ─── Explore (Utforska tab: feed, filters, list states) ─────────────────
  'explore.eyebrow': 'CITY DISCOVERY',
  'explore.title': 'Vad händer i stan?',
  'explore.subtitleCount': '{count} riktiga event att upptäcka. Börja browsa, filtrera när du vill.',
  'explore.loadingSubtitle': 'Hämtar riktiga event nära dig.',
  'explore.loadingMore': 'Hämtar fler event...',
  'explore.errorTitle': 'Vi kunde inte hämta event just nu',
  'explore.errorSubtitle': 'Riktiga event från verifierade källor.',
  'explore.errorFallback': 'Kunde inte hämta event',
  'explore.filter.closeA11y': 'Stäng filtermenyn',
  'explore.filter.openA11y': 'Öppna filtermenyn',
  'explore.filter.toggleOpen': 'Filter ▾',
  'explore.filter.toggleClose': 'Filter ▴',
  'explore.filter.when': 'När',
  'explore.filter.price': 'Pris',
  'explore.filter.category': 'Kategori',
  'explore.filter.source': 'Källa',
  'explore.filter.status': 'Status',
  'explore.filter.clear': 'Rensa filter',
  'explore.status.alla': 'Alla',
  'explore.status.tillgangliga': 'Endast tillgängliga',
  'explore.status.inklUtsalda': 'Inkl. utsålda',
  'explore.emptyFilteredTitle': 'Inga event matchar filtren',
  'explore.emptyFilteredDetail': 'Testa att rensa filtren eller bredda datumet.',
  'explore.emptyTitle': 'Inga event hittades',
  'explore.emptyDetail': 'När nya publicerade event finns visas de här.',
  // explore.empty.* (2026-09-28): per-tile/per-kategori tom-state för
  // ExploreDetailScreen (TILE_ROUTES i 06-UI/utils/tileRoutes.js).
  'explore.empty.gratis': 'Inga gratis evenemang hittades just nu.',
  'explore.empty.music': 'Inga musik-evenemang hittades just nu.',
  'explore.empty.theatreComedy': 'Inga standup- eller komedi-evenemang hittades just nu.',
  'explore.empty.mood': 'Inga stämningsfulla evenemang hittades just nu.',
  'explore.empty.weekend': 'Inga helg-evenemang hittades just nu.',
  'explore.empty.imorgon': 'Inga evenemang imorgon — försök en annan dag.',
  'explore.empty.opera': 'Inga opera-evenemang hittades just nu.',
  'explore.empty.theatre-comedy': 'Inga teater- eller komedi-evenemang hittades just nu.',
  'explore.empty.theatre-drama': 'Inga drama-evenemang hittades just nu.',
  'explore.empty.dance': 'Inga dans-evenemang hittades just nu.',
  'explore.empty.circus': 'Inga cirkus-evenemang hittades just nu.',
  'explore.empty.exhibition': 'Inga utställningar hittades just nu.',
  'explore.empty.flea-market': 'Inga loppmarknader hittades just nu.',
  'explore.empty.food': 'Inga mat-evenemang hittades just nu.',
  'explore.empty.wine-tasting': 'Inga vinprovningar hittades just nu.',
  'explore.empty.kids': 'Inga barn-evenemang hittades just nu.',
  'explore.empty.family': 'Inga familje-evenemang hittades just nu.',
  'explore.empty.film': 'Inga film-evenemang hittades just nu.',
  'explore.empty.talks-lectures': 'Inga föreläsningar hittades just nu.',
  'explore.empty.workshop': 'Inga workshops hittades just nu.',
  'explore.empty.sports': 'Inga sport-evenemang hittades just nu.',
  'explore.empty.nightlife': 'Inga nattlivs-evenemang hittades just nu.',
  'explore.empty.community': 'Inga community-evenemang hittades just nu.',
  'explore.endOfList': 'Det var allt vi har just nu.',
  'explore.showEvent': 'Visa event',
  'explore.timesAvailable': '{count} tider tillgängliga',
  'explore.youAsked': 'DU FRÅGADE',
  'explore.sharedEvent': 'Delat event',
  'explore.sharedPrompt': 'Visa mig vad jag har blivit tipsad om',
  'explore.time.ikvall': 'Ikväll',
  'explore.time.imorgon': 'Imorgon',
  'explore.time.helgen': 'Helgen',
  'explore.time.week': '7 dagar',
  'explore.price.under200': 'Under 200 kr',
  // explore.filterGroup.* + filterSubcat.* (2026-09-28): grupperade filter
  // för UtforskaFilterDropdown. Ersätter den gamla 18-rad-chips-raden med 8
  // expanderbara grupper och subval under varje.
  'explore.filterGroup.music': 'Musik',
  'explore.filterGroup.theatre': 'Teater & Scenkonst',
  'explore.filterGroup.exhibition': 'Utställning & Konst',
  'explore.filterGroup.food': 'Mat & Dryck',
  'explore.filterGroup.kids': 'Barn & Familj',
  'explore.filterGroup.filmLearning': 'Film & Lärande',
  'explore.filterGroup.sports': 'Sport',
  'explore.filterGroup.other': 'Övrigt',
  'explore.filterSubcat.popRock': 'Pop/Rock',
  'explore.filterSubcat.jazz': 'Jazz',
  'explore.filterSubcat.classical': 'Klassiskt',
  'explore.filterSubcat.electronic': 'Elektroniskt',
  'explore.filterSubcat.hipHop': 'Hip-hop',
  'explore.filterSubcat.metal': 'Metal',
  'explore.filterSubcat.worldFolk': 'Världsmusik/folk',
  'explore.filterSubcat.musical': 'Musikal',
  'explore.filterSubcat.opera': 'Opera',
  'explore.filterSubcat.theatreComedy': 'Komedi',
  'explore.filterSubcat.theatreDrama': 'Drama',
  'explore.filterSubcat.dance': 'Dans',
  'explore.filterSubcat.circus': 'Cirkus',
  'explore.filterSubcat.exhibition': 'Utställning',
  'explore.filterSubcat.food': 'Mat',
  'explore.filterSubcat.wineTasting': 'Vintasting',
  'explore.filterSubcat.fleaMarket': 'Loppis',
  'explore.filterSubcat.kids': 'Barn',
  'explore.filterSubcat.family': 'Familj',
  'explore.filterSubcat.film': 'Film',
  'explore.filterSubcat.talksLectures': 'Föreläsningar',
  'explore.filterSubcat.workshop': 'Workshop',
  'explore.filterSubcat.sports': 'Sport',
  'explore.filterSubcat.community': 'Community',
  'explore.filterCat.music': 'Musik',
  'explore.filterCat.culture': 'Kultur',
  'explore.filterCat.sports': 'Sport',
  'explore.filterCat.theatre': 'Teater',
  'explore.filterCat.food': 'Mat & Dryck',
  'explore.filterCat.nightlife': 'Nattliv',
  'explore.filterCat.barn': 'Barn',
  // Steg 4 (2026-09-27): nya v2-pills
  'explore.filterCat.opera': 'Opera',
  'explore.filterCat.theatreComedy': 'Komedi',
  'explore.filterCat.theatreDrama': 'Drama',
  'explore.filterCat.dance': 'Dans',
  'explore.filterCat.circus': 'Cirkus',
  'explore.filterCat.exhibition': 'Utställning',
  'explore.filterCat.fleaMarket': 'Loppis',
  'explore.filterCat.wineTasting': 'Vintasting',
  'explore.filterCat.kids': 'Barn',
  'explore.filterCat.family': 'Familj',
  'explore.filterCat.film': 'Film',
  'explore.filterCat.talksLectures': 'Föreläsningar',
  'explore.filterCat.workshop': 'Workshop',
  'explore.filterCat.community': 'Community',
  'explore.badge.music': 'MUSIK',
  'explore.badge.food': 'MAT & DRYCK',
  'explore.badge.culture': 'KULTUR',
  'explore.badge.nightlife': 'NATTLIV',
  'explore.badge.sports': 'SPORT',
  'explore.badge.tech': 'TECH',
  'explore.badge.barn': 'BARN',
  'explore.badge.theatre': 'TEATER',
  'explore.providers.all': 'Alla arrangörer',

  // ─── Sources / CTA ───────────────────────────────────────────────────────
  'source.ticketmaster': 'Ticketmaster',
  'source.kulturhuset': 'Kulturhuset',
  'source.malmolive': 'Malmö Live',
  'source.annexet': 'Annexet',
  'source.aviciiarena': 'Avicii Arena',
  'source.berwaldhallen': 'Berwaldhallen',
  'source.debaser': 'Debaser',
  'source.eventpulse': 'EventPulse',
  'source.fotografiska': 'Fotografiska',
  'source.friendsarena': 'Friends Arena',
  'source.fryshuset': 'Fryshuset',
  'source.kulturhusetBarnUng': 'Kulturhuset Barn & Ung',
  'source.malmoopera': 'Malmö Opera',
  'source.slakthuset': 'Slakthuset',
  'source.sodrateatern': 'Södra Teatern',
  'source.stockholmlive': 'Stockholm Live',
  'source.tele2arena': 'Tele2 Arena',
  'source.unknown': 'okänd',
  'source.footer': 'Källa: {source}',
  'source.via': 'via {source}',
  'cta.ticketmaster': 'Köp biljett via Ticketmaster',
  'cta.kulturhuset': 'Läs mer på Kulturhuset',
  'cta.malmolive': 'Läs mer på Malmö Live',
  'cta.fallback': 'Läs mer',

  // ─── Details screen ──────────────────────────────────────────────────────
  'details.linkErrorDevice': 'Länken kunde inte öppnas på den här enheten.',
  'details.linkErrorNow': 'Länken kunde inte öppnas just nu.',
  'details.calendarErrorDevice': 'Kan inte öppna kalenderfilen på den här enheten.',
  'details.calendarErrorFetch': 'Kunde inte hämta kalenderfil: {msg}',
  'details.shareEventFallback': 'Ett event',
  'details.shareError': 'Kunde inte skapa delningslänk: {warning}',
  'details.shareMessage': '{title} — öppna i EventPulse: {url}',
  'details.shareErrorOpen': 'Kunde inte öppna delningsmenyn: {msg}',
  'details.noExternalLink': 'Ingen extern eventlänk finns i datan ännu.',
  'details.calendarA11y': 'Lägg till i kalender',
  'details.calendarBusy': 'Hämtar kalenderfil…',
  'details.calendar': 'Lägg till i kalender',
  'details.shareA11y': 'Dela detta event',
  'details.shareBusy': 'Förbereder delning…',
  'details.share': 'Dela',
  'details.when': 'När',
  'details.where': 'Var',
  'details.about': 'Om eventet',
  // 2026-10-02 — visad i DetailsScreen när event saknar beskrivning.
  // Ärlig fallback istället för att "Om eventet"-sektionen försvinner tyst.
  // Källa namnges så användaren kan bedöma om det är värt att klicka vidare.
  'details.descriptionMissing': 'Ingen beskrivning finns från {source}.',
  'details.descriptionMissingUnknown': 'Ingen beskrivning finns.',

  // ─── Map ─────────────────────────────────────────────────────────────────
  'map.loading': 'Hämtar venues…',
  'map.empty.eyebrow': 'KARTA',
  'map.empty.title': '— inga evenemang på kartan —',
  'map.empty.detail': 'När det finns venues med koordinater visas de som pins här.',
  'map.sheet.eyebrow': 'VENUE',
  'map.sheet.upcoming': '{count} kommande event',
  'map.sheet.found': '{count} event hittade',
  'map.sheet.empty': 'Inga kommande event för den här platsen.',
  'map.openA11y': 'Öppna {title}',
  'map.errorFetch': 'Kunde inte hämta venues',
  // i18n note: the old copy mixed English ("venue{s}", "City discovery") into
  // Swedish sentences; the translated versions use "pin/plats" throughout.
  'map.eyebrow': 'KARTA',
  'map.title': 'Karta',
  'map.subtitleCount': '{count} platser med kommande event.',
  'map.subtitleEmpty': 'Utforska Stockholm — en pin per plats.',
  'map.markerA11y': '{name} – {count} event',

  // ─── Notifications ───────────────────────────────────────────────────────
  'notifications.kind.reminder': 'Påminnelse',
  'notifications.kind.match': 'Ny matchning för dig',
  'notifications.kind.response': 'Svar',
  'notifications.kind.fallback': 'Notis',
  'notifications.eyebrow.reminder': 'PÅMINNELSER',
  'notifications.eyebrow.match': 'NYA MATCHNINGAR',
  'notifications.eyebrow.response': 'SVAR',
  'notifications.time.nowPast': 'just nu',
  'notifications.time.nowFuture': 'nu',
  'notifications.time.pastMin': 'för {n} min',
  'notifications.time.futureMin': 'om {n} min',
  'notifications.time.pastHours': 'för {h} h',
  'notifications.time.futureHours': 'om {h} h',
  'notifications.time.pastHoursMin': 'för {h} h {m} min',
  'notifications.time.futureHoursMin': 'om {h} h {m} min',
  'notifications.time.pastDays': 'för {d} d',
  'notifications.time.futureDays': 'om {d} d',
  'notifications.pickRating': 'Välj ett betyg',
  'notifications.pickRatingBody': 'Tryck på en stjärna för att betygsätta.',
  'notifications.tooLong': 'För långt',
  'notifications.tooLongBody': 'Anteckningen får vara max 140 tecken.',
  'notifications.ratingFailed': 'Kunde inte skicka betyg',
  'notifications.ratingFailedBody': 'Prova igen om en stund.',
  'notifications.rowA11y': '{kind}: {title}',
  'notifications.attended.eyebrow': 'DELTAGIT',
  'notifications.starOne': 'stjärna',
  'notifications.starMany': 'stjärnor',
  'notifications.starA11y': '{count} {unit}',
  'notifications.rateHint': 'Tryck för att betygsätta',
  'notifications.notePlaceholder': 'Skriv en kort anteckning (max 140 tecken, inga personuppgifter)',
  'notifications.submitRating': 'Skicka betyg',
  'notifications.eyebrow': 'NOTISER',
  'notifications.title': 'Dina påminnelser och svar',
  'notifications.subtitle':
    'Så snart en ny matchning, påminnelse eller ett svar är klart dyker det här. Tips: spara events för att få påminnelser 2 timmar innan.',
  'notifications.authBody':
    'Logga in för att se dina notiser, påminnelser och betygsätta events du varit på.',
  'notifications.fetchError': 'Kunde inte hämta notiser just nu ({error}). Dra ner för att försöka igen.',
  'notifications.empty':
    'Inga notiser än. Spara ett evenemang så får du en påminnelse 2 timmar innan det börjar.',
  'notifications.savedFallback': 'Sparat event',

  // ─── Profile ─────────────────────────────────────────────────────────────
  'profile.unfollowFail': 'Kunde inte sluta följa',
  'profile.notifSaveFail': 'Kunde inte spara notis-inställningen',
  'profile.notifSaveFailWarning': 'Kunde inte spara notis-inställningen ({warning}).',
  'profile.notifSaveFailNow': 'Kunde inte spara notis-inställningen just nu.',
  'profile.notif.all': 'Alla notiser',
  'profile.notif.newOnly': 'Nya händelser',
  'profile.notif.off': 'Av',
  'profile.unfollow': 'Sluta följ',
  'profile.deleteGateWord': 'RADERA',
  'profile.deleteFailed': 'Kunde inte radera kontot: {detail}',
  'profile.deleteFailedDetail': 'okänt fel (status {status})',
  'profile.deleteAlertTitle': 'Radera konto?',
  'profile.deleteAlertBody':
    'Det här tar bort ditt konto och allt du har sparat — sparade events, följda platser, notis-inställningar. Åtgärden går inte att ångra.',
  'profile.eyebrow': 'PROFIL',
  'profile.title': 'Sparade & inställningar',
  'profile.account': 'Konto',
  'profile.guestNudge':
    'Din smak sparas redan i appen. Lägg till din e-post för att behålla den på alla enheter — du kan fortsätta utforska utan konto.',
  'profile.about': 'Om EventPulse',
  'profile.subtitle': 'Dina sparade events, kategorival och notis-inställningar hamnar här.',
  'profile.signedIn': 'Inloggad',
  'profile.appleSignIn': 'Apple-inloggning',
  'profile.deleteDesc':
    'Tar bort kontot permanent — allt du sparat, följt och alla notis-inställningar försvinner.',
  'profile.delete': 'Radera konto',
  'profile.following': 'Följer',
  'profile.followingDesc': 'Här är det du följer just nu. Lång-tryck på en chip för att sluta följa.',
  'profile.noFollows':
    'Du följer inga platser eller artister än. Längst ner på ett event-kort finns ★-knappen — lång-tryck för att följa en plats.',
  'profile.venuesCount': 'Platser ({count})',
  'profile.artistsCount': 'Artister ({count})',
  'profile.followsEmptyVenues': 'Inga följda platser än.',
  'profile.followsEmptyArtists': 'Inga följda artister än.',
  'profile.entity.venue': 'plats',
  'profile.entity.artist': 'artist',
  'profile.followChipA11y': 'Följer {entity} {label} — lång-tryck för att sluta följa',
  'profile.longPressHint': 'Lång-tryck för att sluta följa',
  'profile.venueChip': 'Plats {id}…',
  'profile.artistChip': 'Artist {id}…',
  'profile.venueFallback': 'Plats',
  'profile.artistFallback': 'Artist',
  'profile.notifications': 'Notifieringar',
  'profile.pushVenues': 'Push för följda venues',
  'profile.pushVenuesDesc':
    'Få en notis när en venue du följer lägger till ett nytt event. Dela din enhets push-token under Inställningar → Notiser → EventPulse för att aktivera leverans.',
  'profile.pushSwitchA11y': 'Push-notiser för följda venues',
  'profile.privacy': 'Integritet',
  'profile.analyticsConsent': 'Anonym användarstatistik',
  'profile.analyticsConsentDesc':
    'Hjälp oss förbättra appen med anonym data om hur den används — till exempel vilka Utforska-knappar du trycker på. Ingen personlig information. Kan stängas av när som helst.',
  'profile.analyticsSwitchA11y': 'Anonym användarstatistik på eller av',
  'profile.saving': 'Sparar…',
  'profile.language': 'Språk',
  'profile.languageDesc': 'Välj vilket språk appen visar.',
  'profile.deleteModalTitle': 'Radera konto permanent?',
  'profile.deleteModalBody':
    'Skriv {word} med stora bokstäver för att bekräfta. Det går inte att ångra — allt du sparat försvinner.',
  'profile.deleteInputA11y': 'Bekräftelsetecken',
  'profile.deleteConfirmA11y': 'Bekräfta radering',
  'profile.deleteConfirm': 'Radera',

  // ─── Auth reminder modal ─────────────────────────────────────────────────
  'authReminder.title': 'Behåll din smak på alla enheter',
  'authReminder.body':
    'Dina sparade evenemang och personliga förslag sparas just nu bara på den här enheten. Lägg till din e-post så följer allt med vart du än loggar in.',
  'authReminder.later': 'Senare',
  'authReminder.optOut': 'Påminn mig inte igen',

  // ─── Network banner ──────────────────────────────────────────────────────
  'network.a11y': 'Ingen nätanslutning',
  'network.text': 'Ingen anslutning — vi visar senast cachad data',

  // ─── Din helg push (S5) ────────────────────────────────────────────────
  'pushPrompt.title': 'Vill du få Din helg varje vecka?',
  'pushPrompt.body':
    'Varje torsdag 17:00 skickar vi en notis med 3–5 utvalda events för helgen — sparade och nya, direkt anpassade efter din smak.',
  'pushPrompt.example': 'Din helg är här — 3 kort för fredag–söndag.',
  'pushPrompt.accept': 'Ja, skicka Din helg',
  'pushPrompt.decline': 'Inte nu',
  'profile.pushDinHelg': 'Din helg-notiser',
  'profile.pushDinHelgDesc':
    'Få en notis varje torsdag 17:00 med utvalda events för helgen.',
  'profile.pushDinHelgSwitchA11y': 'Push-notiser för Din helg',

  // ─── Explore search (2026-09-20) ─────────────────────────────────────────
  'explore.searchPlaceholder': 'Sök event…',
  'explore.searchA11y': 'Sökfält',
  'explore.noSearchResults': 'Inga träffar på \"{q}\"',
  // 2026-10-02 (Utforska sök): fristående sök-skärm — titel, info,
  // feltexter, banner för AI-relaxation. Tangentfel i tangentbordet
  // matchar befintlig 'explore.*'-stil.
  'explore.search.title': 'Sök',
  'explore.search.openLabel': 'Öppna sök',
  'explore.search.heading': 'Hitta rätt event',
  'explore.search.subhead': 'Sök i titel och beskrivning — eller välj datum och kategori.',
  'explore.search.resultsEyebrow': 'Sökresultat för "{q}"',
  'explore.search.dateButton': 'Välj datum',
  'explore.search.dateSet': '{from}{sep}{to}',
  'explore.search.dateSetSingle': '{from}',
  'explore.search.dateSep': ' → ',
  'explore.search.dateAny': 'Alla datum',
  'explore.search.noFilters': 'Visar alla events',
  'explore.search.activeFilterCount': '{count} filter',
  'explore.search.clearAll': 'Rensa allt',
  'explore.search.applied': 'Sökresultat för \"{q}\"',
  'explore.search.appliedNoQuery': 'Aktiva filter',
  'explore.search.relaxedNotice': 'Vi hittade inget på \"{q}\" med dina filter — visar events i ett bredare datumintervall istället.',
  'explore.search.relaxedNoticeNoQuery': 'Vi hittade inget med dina filter — visar events i ett bredare datumintervall istället.',
  'explore.search.relaxedReset': 'Tillbaka till dina filter',
  'explore.search.empty': 'Inga matchande events. Försök bredda datumintervallet eller byta sökord.',
  'explore.search.error': 'Kunde inte söka just nu. Försök igen.',

  // ─── Rank reasons (chips on cards + agent labels) ───────────────────────
  'reason.time_fit.label': 'Bra tid',
  'reason.time_fit.full': 'Matchar tidsfönstret',
  'reason.under_budget.label': 'Under budget',
  'reason.under_budget.full': 'Inom din budget',
  'reason.over_budget.label': 'Över budget',
  'reason.over_budget.full': 'Över angiven budget',
  'reason.category_match.label': 'Rätt kategori',
  'reason.category_match.full': 'Matchar din kategori',
  'reason.exclude_match.label': 'Inte exkluderad',
  'reason.exclude_match.full': 'Uppfyller dina undantag',
  'reason.not_ended.label': 'Inte avslutad',
  'reason.not_ended.full': 'Eventet har inte avslutats',
  'reason.high_confidence.label': 'Hög kvalitet',
  'reason.high_confidence.full': 'Hög datakvalitet',
  'reason.low_confidence.label': 'Låg kvalitet',
  'reason.low_confidence.full': 'Låg datakvalitet — verifiera',
  'reason.stale.label': 'Gammal data',
  'reason.stale.full': 'Data kan vara gammal',
  'reason.category_personalization.label': 'Rätt kategori',
  'reason.category_personalization.full': 'Matchar dina favoriter',
  'reason.venue_personalization_penalty.label': 'Fel område',
  'reason.venue_personalization_penalty.full': 'Brukar inte gilla den här platsen',
  'reason.followed_venue.label': 'Följer',
  'reason.followed_venue.full': 'Du följer den här platsen',
  'reason.followed_artist.label': 'Favoritartist',
  'reason.followed_artist.full': 'Du följer en av artisterna',
  'reason.outbound_personalization.label': 'Dina biljettval',
  'reason.outbound_personalization.full': 'Du klickar ofta vidare till biljetter för den här typen av event',

  // ─── Legal (integritetspolicy + villkor) ─────────────────────────────────
  // _legalDraftOnly: '1' = AI-utkast (banner visas), '0' = granskat (banner borta).
  // Vänd till '0' när jurist/ansvarig har godkänt texten.
  '_legalDraftOnly': '1',

  'legal.close': 'Stäng',
  'legal.lastUpdatedLabel': 'Senast uppdaterad:',
  'legal.draftBannerTitle': '⚠️ Det här är ett AI-utkast',
  'legal.draftBannerBody':
    'Texten är skriven av AI som ett första förslag baserat på vad appen faktiskt gör. Den ska granskas av ansvarig person eller extern jurist innan den publiceras som slutgiltig policy. EventPulse ansvarar inte för textens rättsliga korrekthet i sin nuvarande form.',
  'legal.readOnWebLabel': 'Läs den fullständiga versionen med formatering på webben:',
  'legal.webMirrorNote':
    'Samma text finns på webbplatsen — den uppdateras där först, appens version speglas vid varje release.',

  // Profile rows that open the modals
  'profile.privacyPolicy': 'Integritetspolicy',
  'profile.privacyPolicyDesc': 'Läs hur vi hanterar dina uppgifter.',
  'profile.terms': 'Användarvillkor',
  'profile.termsDesc': 'Regler för att använda EventPulse.',

  // ─── Privacy policy sections (key order matches LegalModal.js buildSections)
  'legal.privacy.title': 'Integritetspolicy',
  'legal.privacy.lastUpdated': '2026-10-04 (utkast v0.1)',

  'legal.privacy.p1.title': '1. Vem vi är',
  'legal.privacy.p1.body':
    'EventPulse är en personlig event-agent i form av en iOS- och Android-app, utvecklad av [TODO: fullständigt företagsnamn och organisationsnummer]. Appen hjälper användare i Stockholmsregionen att hitta konserter, utställningar och andra evenemang baserat på deras egen smak. Kontakt för integritetsfrågor: privacy@eventpulse.nu [TODO: bekräfta].',

  'legal.privacy.p2a.title': '2.1 Kontouppgifter (när du skapar konto)',
  'legal.privacy.p2a.bullets':
    'E-postadress (om du loggar in via magic link).\nApple-id (om du loggar in med Apple — vi får bara ett unikt användar-id, inte din e-post, om du väljer att dölja den).\nAutogenererat anonymt användar-id (om du använder appen utan att logga in).',

  'legal.privacy.p2b.title': '2.2 Användargenererad data',
  'legal.privacy.p2b.bullets':
    'Evenemang du sparar, klickar på eller markerar som ointressanta.\nVenues och artister du följer.\nPush-prenumerationer (om du vill ha notiser för specifika venues).\nEventuella konversationer du har med appens inbyggda event-agent.',

  'legal.privacy.p2c.title': '2.3 Enhets- och användningsdata',
  'legal.privacy.p2c.bullets':
    'Enhets-id hashat som 64-tecken hex-kod (anonym, kan inte spåras tillbaka till dig utan vår interna salt-nyckel).\nSpråkinställning.\nPlats (endast om du uttryckligen gett appen platsåtkomst — används för att visa evenemang nära dig).',

  'legal.privacy.p2d.title': '2.4 Anonym statistik (endast om du godkänner)',
  'legal.privacy.p2d.body':
    'Appen har en separat opt-in-växel under Profil → Integritet. Statistik innehåller händelser som tile_tap, event_view, event_save med mera. Ingen personlig identifierbar information ingår. Statistik sparas i upp till 30 dagar.',

  'legal.privacy.p3.title': '3. Varför vi samlar in uppgifterna och med vilken rättslig grund',
  'legal.privacy.p3.body':
    'Kontouppgifter och användargenererad data behandlas för att leverera tjänsten du har bett om (GDPR Art. 6(1)(b) avtal). Push-notiser och anonym statistik bygger på ditt samtycke (Art. 6(1)(a)), som du kan återkalla när som helst i appen. Tekniska loggar utan PII behandlas för säkerhet och felsökning (Art. 6(1)(f) berättigat intresse).',

  'legal.privacy.p4.title': '4. Hur länge vi sparar uppgifterna',
  'legal.privacy.p4.bullets':
    'Kontouppgifter: så länge kontot är aktivt. Raderas inom 30 dagar efter kontoradering.\nAnvändargenererad data: knuten till kontot; raderas vid kontoradering via cascade i databasen.\nAnonym statistik: 30 dagar, därefter automatisk rensning.\nPush-tokens: tills du stänger av push för en venue eller raderar kontot.',

  'legal.privacy.p5.title': '5. Vem vi delar uppgifterna med',
  'legal.privacy.p5.body':
    'Vi delar inte dina personuppgifter med tredje part för marknadsföring. Underleverantörer: Supabase (autentisering, databas, fillagring — serverregion [TODO: bekräfta EU, helst eu-north-1]); Expo / Apple Push Notification Service (push-leverans); OpenAI / Anthropic / valfri LLM-leverantör (agent-chatt — endast texten du skickar, inte kontodata).',

  'legal.privacy.p6.title': '6. Överföring till tredje land',
  'legal.privacy.p6.body':
    'Vissa underleverantörer kan behandla data utanför EU/EES (särskilt USA-baserade LLM-leverantörer). Vi säkerställer att överföringar sker med lämplig rättslig mekanism (EU-kommissionens standardavtalsklausuler eller motsvarande). [TODO: dokumentera aktuell mekanism per leverantör].',

  'legal.privacy.p7.title': '7. Dina rättigheter (GDPR Art. 15–22)',
  'legal.privacy.p7.bullets':
    'Rätt till tillgång (Art. 15): Du kan begära en kopia av dina uppgifter. I appen: Profil → Ladda ner min data [TODO: knapp kommer i Fas 4].\nRätt till rättelse (Art. 16): Kontakta oss om något är fel.\nRätt till radering (Art. 17): I appen: Profil → Radera konto.\nRätt till begränsning (Art. 18): Stäng av statistik och/eller push under Profil → Integritet.\nRätt till dataportabilitet (Art. 20): Samma exportknapp som Art. 15.\nRätt att göra invändningar (Art. 21): Kontakta oss.',

  'legal.privacy.p8.title': '8. Hur du utövar dina rättigheter',
  'legal.privacy.p8.body':
    'Direkt i appen under Profil för de vanligaste rättigheterna. För övriga ärenden, skriv till privacy@eventpulse.nu. Vi svarar inom 30 dagar enligt GDPR.',

  'legal.privacy.p9.title': '9. Cookies och spårning på webbplatsen',
  'legal.privacy.p9.body':
    'Webbplatsen eventpulse.nu använder inga cookies, inga spårningspixlar och inga tredjeparts-skript. Webbplatsen är helt same-origin.',

  'legal.privacy.p10.title': '10. Ändringar av policyn',
  'legal.privacy.p10.body':
    'Vi kan uppdatera denna policy. Vid väsentliga ändringar meddelas du via appen. Senaste uppdatering anges högst upp.',

  'legal.privacy.p11.title': '11. Tillsynsmyndighet',
  'legal.privacy.p11.body':
    'Om du anser att vi hanterar dina uppgifter fel kan du klaga till Integritetsskyddsmyndigheten (IMY) — imy.se.',

  // ─── Terms of service sections (key order matches LegalModal.js buildSections)
  'legal.terms.title': 'Användarvillkor',
  'legal.terms.lastUpdated': '2026-10-04 (utkast v0.1)',

  'legal.terms.t1.title': '1. Vad tjänsten är',
  'legal.terms.t1.body':
    'EventPulse är en personlig event-agent som visar evenemang i Stockholmsregionen baserat på din egen smak. Tjänsten är en app för iOS och Android. Evenemang hämtas från publika källor och presenteras med beskrivningar, tider, platser och eventuella biljettlänkar. EventPulse säljer inga biljetter.',

  'legal.terms.t2.title': '2. Vem som kan använda tjänsten',
  'legal.terms.t2.body':
    'Du måste vara minst 16 år för att använda EventPulse. Om du är under 18 behöver du vårdnadshavares godkännande.',

  'legal.terms.t3.title': '3. Konto',
  'legal.terms.t3.body':
    'Du kan använda appen utan konto. Vissa funktioner kräver konto. Logga in med magic link via e-post eller med Apple. Du ansvarar för att dina inloggningsuppgifter inte används av någon annan. Meddela oss på privacy@eventpulse.nu om du misstänker att ditt konto har blivit hackat.',

  'legal.terms.t4.title': '4. Acceptabel användning',
  'legal.terms.t4.bullets':
    'Använd inte EventPulse för att skicka skräp, trakassera andra eller bryta mot lag.\nFörsök inte kringgå säkerhetsspärrar eller obehörigt komma åt våra system.\nAnvänd inte appen på ett sätt som skadar vår infrastruktur eller andra användare.\nSkrapa, kopiera eller vidaredistribuera inte evenemangsinnehåll i kommersiellt syfte.',

  'legal.terms.t5.title': '5. Evenemangsinnehåll och tredje part',
  'legal.terms.t5.body':
    'Evenemangsinformation publiceras av respektive arrangör. Vi ansvarar inte för att informationen är korrekt, aktuell eller tillgänglig. Vi förbehåller oss rätten att dölja events som visat sig vara felaktiga, avbokade eller vilseledande.',

  'legal.terms.t6.title': '6. Push-notiser',
  'legal.terms.t6.body':
    'Om du aktiverar push-notiser för en venue eller artist skickar vi dig en notis när vi upptäcker ett nytt evenemang från den källan. Du kan när som helst stänga av push per venue, eller globalt under din enhets inställningar.',

  'legal.terms.t7.title': '7. Ändringar av tjänsten',
  'legal.terms.t7.body':
    'Vi utvecklar tjänsten löpande. Vi kan lägga till, ändra eller ta bort funktioner utan förvarning. Vi strävar efter att inte göra ändringar som uppenbart försämrar din upplevelse utan goda skäl.',

  'legal.terms.t8.title': '8. Kontoradering och uppsägning',
  'legal.terms.t8.body':
    'Du kan när som helst radera ditt konto under Profil → Radera konto. Vi raderar då all kontoanknuten data. Vi kan stänga av eller radera kontot om du bryter mot dessa villkor eller om tjänsten läggs ned.',

  'legal.terms.t9.title': '9. Immateriella rättigheter',
  'legal.terms.t9.body':
    'EventPulse-appen, varumärket, logotypen och den underliggande koden tillhör oss och våra licensgivare. Evenemangsbilder tillhör respektive upphovsrättsinnehavare.',

  'legal.terms.t10.title': '10. Ansvarsbegränsning',
  'legal.terms.t10.body':
    'EventPulse tillhandahålls i befintligt skick. Vi garanterar inte att tjänsten är felfri, oavbruten eller fri från fel. Vi ansvarar inte för indirekta skador. Vårt totala ansvar är begränsat till vad du betalat för tjänsten under de senaste 12 månaderna.',

  'legal.terms.t11.title': '11. Ändringar av villkoren',
  'legal.terms.t11.body':
    'Vi kan uppdatera dessa villkor. Vid väsentliga ändringar meddelas du i appen eller via e-post. Om du inte godkänner de nya villkoren kan du radera ditt konto.',

  'legal.terms.t12.title': '12. Tillämplig lag och tvist',
  'legal.terms.t12.body':
    'Dessa villkor styrs av svensk rätt. Tvister avgörs i svensk domstol, med Stockholms tingsrätt som första instans. Du kan också vända dig till EU-kommissionens tvistlösningsplattform online (ec.europa.eu/consumers/odr).',

  'legal.terms.t13.title': '13. Kontakt',
  'legal.terms.t13.body':
    'Frågor om villkoren? Skriv till privacy@eventpulse.nu.',
};
