/**
 * Italian (it) dictionary — key parity with sv.js is mandatory.
 * Fallback chain: chosen → en → sv.
 * Interpolation: {name} placeholders must match sv.js exactly.
 */
export default {
  // ─── Tabs ────────────────────────────────────────────────────────────────
  'tabs.home': 'Home',
  'tabs.explore': 'Esplora',
  'tabs.notifications': 'Notifiche',
  'tabs.profile': 'Profilo',
  'tabs.map': 'Mappa',

  // ─── Common ──────────────────────────────────────────────────────────────
  'common.retry': 'Riprova',
  'common.retryFetch': 'Ricarica',
  'common.close': 'Chiudi',
  'common.cancel': 'Annulla',
  'common.back': 'Indietro',
  'common.loading': 'Caricamento…',
  'common.save': 'Salva',
  'common.saved': '✓ Salvato',
  'common.saveEvent': 'Salva evento',
  'common.removeSaved': 'Rimuovi dai salvati',
  'common.dismiss': 'Nascondi',
  'common.dismissed': 'Nascosto',
  'common.dismissEvent': 'Nascondi questo evento',
  'common.open': 'Apri',
  'common.openArrow': 'Apri →',
  'common.continue': 'Continua',
  'common.continueNoChoice': 'Continua senza scegliere',
  'common.skip': 'Salta',
  'common.logIn': 'Accedi',
  'common.logOut': 'Esci',
  'common.addEmail': 'Aggiungi e-mail',
  'common.venueMissing': 'Luogo non specificato',
  'common.timeMissing': 'Ora non specificata',
  'common.dateMissing': 'Data mancante',
  'common.dateNotSet': 'Data non specificata',
  'common.loadError': 'Impossibile caricare: {error}',
  'common.externalLink': 'Link esterno',
  'common.readMore': 'Scopri di più',
  'common.openEvent': 'Apri evento',
  'common.free': 'Gratis',
  'common.priceFrom': 'Da {min} kr',
  'common.priceRange': '{min}–{max} kr',
  'common.titleMissing': 'Titolo mancante',
  'common.atTime': 'alle {time}',
  'common.today': 'Oggi',
  'common.tomorrow': 'Domani',
  'common.unknownError': 'errore sconosciuto',
  'common.networkError': 'errore di rete',

  // ─── Onboarding ──────────────────────────────────────────────────────────
  'onboarding.eyebrow': 'BENVENUTO IN EVENTPULSE',
  'onboarding.title': 'Cosa ti interessa?',
  'onboarding.subtitle':
    'Scegli una o più categorie. Le usiamo per mostrare prima gli eventi più rilevanti nella tua home. Puoi cambiarle in qualsiasi momento in Profilo.',
  'onboarding.continueA11y': 'Continua su EventPulse',
  'onboarding.category.music': 'Concerti',
  'onboarding.category.exhibitions': 'Mostre',
  'onboarding.category.sports': 'Sport',
  'onboarding.category.family': 'Bambini e famiglia',
  'onboarding.category.free': 'Gratis',
  'onboarding.category.nightlife': 'Serate',
  'onboarding.category.weekend': 'Weekend',

  // ─── Login (email magic link + Apple) ────────────────────────────────────
  'login.invalidEmail': 'E-mail non valida — controlla l’ortografia.',
  'login.appleUnavailable': 'Apple Sign In non è disponibile su questo dispositivo.',
  'login.appleIosOnly': 'Apple Sign In funziona solo su iOS.',
  'login.appleFailed': 'Impossibile accedere con Apple.',
  'login.sessionSaveFailed': 'Impossibile salvare la sessione — riprova.',
  'login.title': 'Accedi con e-mail',
  'login.body':
    'Ti inviamo un link magico via e-mail. Toccandolo accedi — nessuna password necessaria.',
  'login.sentTitle': 'Controlla la tua casella',
  'login.sentBodyLink':
    'Abbiamo inviato un link di conferma a {email}. Aprilo sullo stesso dispositivo — i tuoi eventi salvati e i tuoi gusti vengono con te.',
  'login.sentBodySignin':
    'Abbiamo inviato un link di accesso a {email}. Aprilo sullo stesso dispositivo per accedere.',
  'login.useOtherEmail': 'Usa un’altra e-mail',
  'login.appleContinue': 'Continua con Apple',
  'login.or': 'oppure',
  'login.emailPlaceholder': 'tu@email.com',
  'login.emailA11y': 'Indirizzo e-mail',
  'login.sendMagicLink': 'Invia link magico',
  'login.linkLandsAt': 'Il link porta a: {url}',

  // ─── Email code entry ────────────────────────────────────────────────────
  'codeEntry.errInvalid': 'Il codice non è corretto o è scaduto — controllalo e riprova.',
  'codeEntry.errRateLimited': 'Troppi tentativi — aspetta un attimo e riprova.',
  'codeEntry.errTimeout': 'Ci è voluto troppo tempo — controlla la connessione e riprova.',
  'codeEntry.errGeneric': 'Qualcosa è andato storto — riprova.',
  'codeEntry.resendTimeout': 'Ci è voluto troppo tempo — riprova.',
  'codeEntry.resendFailed': 'Impossibile inviare un nuovo codice — riprova.',
  'codeEntry.title': 'Inserisci il codice',
  'codeEntry.body': 'Abbiamo inviato un codice a 6 cifre a {email}. Inseriscilo qui per accedere.',
  'codeEntry.bodyLinkSuffix': ' I tuoi eventi salvati e i tuoi gusti passano all’account.',
  'codeEntry.boxesA11y': 'Codice di accesso, 6 cifre',
  'codeEntry.inputA11y': 'Campo del codice',
  'codeEntry.verifying': 'Verifica in corso…',
  'codeEntry.success': 'Fatto — accesso in corso!',
  'codeEntry.resendA11y': 'Invia un nuovo codice',
  'codeEntry.resendSending': 'Invio in corso…',
  'codeEntry.resendCooldown': 'Invia un nuovo codice ({seconds}s)',
  'codeEntry.resend': 'Invia un nuovo codice',
  'codeEntry.linkHint': 'Il codice non funziona? Apri invece il link nell’e-mail.',
  'codeEntry.changeEmail': 'Cambia indirizzo e-mail',

  // ─── Magic link handler ──────────────────────────────────────────────────
  'magicLink.errInvalid': 'Link magico non valido — assicurati di aver aperto l’ultimo link della tua e-mail.',
  'magicLink.errNoToken': 'Link magico non valido — token mancante.',
  'magicLink.errVerify': 'Impossibile verificare il link magico.',
  'magicLink.verifying': 'Verifica del link magico…',
  'magicLink.errTitle': 'Qualcosa è andato storto',
  'magicLink.backToApp': 'Torna all’app',

  // ─── Home ────────────────────────────────────────────────────────────────
  'home.cityEyebrow': 'STOCCOLMA',
  'home.greeting.night': 'Buonanotte, Stoccolma',
  'home.greeting.morning': 'Buongiorno, Stoccolma',
  'home.greeting.afternoon': 'Buon pomeriggio, Stoccolma',
  'home.greeting.evening': 'Buonasera, Stoccolma',
  'home.subtitle.night': 'È tutto tranquillo — dai un’occhiata agli eventi del weekend.',
  'home.subtitle.morning': 'Cosa vuoi fare oggi a Stoccolma?',
  'home.subtitle.afternoon': 'Hai programmi per stasera?',
  'home.subtitle.evening': 'Stoccolma è piena di eventi stasera.',
  'home.soldOut': 'Esaurito',
  'home.fewLeft': 'Ultimi posti',
  'home.cardA11y': '{title}{when} presso {venue}',
  'home.empty': '— nessun evento al momento —',
  'home.live.badge': 'DAL VIVO',
  'home.liveA11y': 'In corso: {title}{when} presso {venue}',
  'home.live.eyebrow': 'IN CORSO',
  'home.live.title': 'Sta succedendo ora',
  'home.live.errorA11y': 'Impossibile caricare gli eventi. Tocca per riprovare.',
  'home.live.error': 'Caricamento non riuscito — tocca per riprovare',
  'home.tonight.eyebrow': 'STASERA',
  'home.tonight.title': 'Succede stasera',
  'home.weekend.eyebrow': 'IL WEEKEND',
  'home.weekend.title': 'Questo weekend',
  'home.dinHelg.eyebrow': 'IL TUO WEEKEND',
  'home.dinHelg.title': 'Scelto per il tuo weekend',
  'toast.savedTaste': 'Salvato — impariamo i tuoi gusti',
  'home.free.eyebrow': 'GRATIS',
  'home.free.title': 'Eventi gratuiti',
  'home.recommended.eyebrow': 'CONSIGLIATI',
  'home.recommended.title': 'Per te',
  'home.ai.eyebrow': 'IMMAGINI IA · SMOKE TEST',
  'home.ai.title': 'Immagini generate da categoria + orario',
  'home.ai.loadError': 'Impossibile caricare le immagini IA: {error}',
  'home.ai.cardA11y': '{title} (immagine generata dall’IA)',
  'home.ai.chip': 'Generata dall’IA',
  'home.loadingForYou': 'Caricamento dei suggerimenti',
  'home.promptChipA11y': '{text}',
  'home.promptChipA11yReason': '{text}. {reason}',
  'home.curatedChipA11y': 'Scelta del curatore: {name}',
  'home.curated.eyebrow': 'SCELTE DEL CURATORE',
  'home.curated.title': 'Liste selezionate a mano',
  'home.suggestions.eyebrow': 'SUGGERIMENTI',
  'home.suggestions.title': 'Cosa vuoi fare?',
  'home.recentChipA11y': 'Ripeti la ricerca: {query}',
  'home.recent.eyebrow': 'RECENTI',
  'home.recent.title': 'Le tue ricerche recenti',
  'home.intentLoading': 'Caricamento dei suggerimenti dell’agente',
  'home.intentEmpty': '— nessuna corrispondenza per ora —',
  'home.agent.eyebrow': 'AGENTE',
  'home.agent.title': 'Suggerimenti dal tuo agente',
  'home.saved.eyebrow': 'SALVATI',
  'home.saved.title': 'I tuoi eventi salvati',
  'home.savedEmpty': '— nessun evento salvato per ora —',

  // ─── Explore (Esplora tab: feed, filters, list states) ──────────────────
  'explore.eyebrow': 'SCOPRI LA CITTÀ',
  'explore.title': 'Cosa succede in città?',
  'explore.subtitleCount': '{count} eventi reali da scoprire. Inizia a sfogliare e filtra quando vuoi.',
  'explore.loadingSubtitle': 'Caricamento di eventi reali vicino a te.',
  'explore.loadingMore': 'Caricamento di altri eventi...',
  'explore.errorTitle': 'Non riusciamo a caricare gli eventi al momento',
  'explore.errorSubtitle': 'Eventi reali da fonti verificate.',
  'explore.errorFallback': 'Impossibile caricare gli eventi',
  'explore.filter.closeA11y': 'Chiudi il menu dei filtri',
  'explore.filter.openA11y': 'Apri il menu dei filtri',
  'explore.filter.toggleOpen': 'Filtri ▾',
  'explore.filter.toggleClose': 'Filtri ▴',
  'explore.filter.when': 'Quando',
  'explore.filter.price': 'Prezzo',
  'explore.filter.category': 'Categoria',
  'explore.filter.clear': 'Cancella i filtri',
  'explore.emptyFilteredTitle': 'Nessun evento corrisponde ai filtri',
  'explore.emptyFilteredDetail': 'Prova a cancellare i filtri o ad ampliare l’intervallo di date.',
  'explore.emptyTitle': 'Nessun evento trovato',
  'explore.emptyDetail': 'I nuovi eventi pubblicati appariranno qui.',
  'explore.endOfList': 'Per ora è tutto.',
  'explore.showEvent': 'Mostra evento',
  'explore.timesAvailable': '{count} orari disponibili',
  'explore.youAsked': 'HAI CHIESTO TU',
  'explore.sharedEvent': 'Evento condiviso',
  'explore.sharedPrompt': 'Mostrami cosa mi è stato consigliato',
  'explore.time.ikvall': 'Stasera',
  'explore.time.imorgon': 'Domani',
  'explore.time.helgen': 'Il weekend',
  'explore.time.week': '7 giorni',
  'explore.price.under200': 'Sotto 200 kr',
  'explore.filterCat.music': 'Musica',
  'explore.filterCat.culture': 'Cultura',
  'explore.filterCat.sports': 'Sport',
  'explore.filterCat.theatre': 'Teatro',
  'explore.filterCat.food': 'Cibo & Drink',
  'explore.filterCat.nightlife': 'Vita notturna',
  'explore.filterCat.barn': 'Bambini',
  'explore.badge.music': 'MUSICA',
  'explore.badge.food': 'CIBO & DRINK',
  'explore.badge.culture': 'CULTURA',
  'explore.badge.nightlife': 'VITA NOTTURNA',
  'explore.badge.sports': 'SPORT',
  'explore.badge.tech': 'TECH',
  'explore.badge.barn': 'BAMBINI',
  'explore.badge.theatre': 'TEATRO',
  'explore.providers.all': 'Tutti gli organizzatori',

  // ─── Sources / CTA ───────────────────────────────────────────────────────
  'source.ticketmaster': 'Ticketmaster',
  'source.kulturhuset': 'Kulturhuset',
  'source.malmolive': 'Malmö Live',
  'source.unknown': 'sconosciuta',
  'source.footer': 'Fonte: {source}',
  'source.via': 'via {source}',
  'cta.ticketmaster': 'Compra i biglietti su Ticketmaster',
  'cta.kulturhuset': 'Scopri di più su Kulturhuset',
  'cta.malmolive': 'Scopri di più su Malmö Live',
  'cta.fallback': 'Scopri di più',

  // ─── Details screen ──────────────────────────────────────────────────────
  'details.linkErrorDevice': 'Non è stato possibile aprire il link su questo dispositivo.',
  'details.linkErrorNow': 'Non è stato possibile aprire il link al momento.',
  'details.calendarErrorDevice': 'Impossibile aprire il file del calendario su questo dispositivo.',
  'details.calendarErrorFetch': 'Impossibile recuperare il file del calendario: {msg}',
  'details.shareEventFallback': 'Un evento',
  'details.shareError': 'Impossibile creare il link di condivisione: {warning}',
  'details.shareMessage': '{title} — apri in EventPulse: {url}',
  'details.shareErrorOpen': 'Impossibile aprire il menu di condivisione: {msg}',
  'details.noExternalLink': 'Nei dati non esiste ancora un link esterno all’evento.',
  'details.calendarA11y': 'Aggiungi al calendario',
  'details.calendarBusy': 'Recupero del file del calendario…',
  'details.calendar': 'Aggiungi al calendario',
  'details.shareA11y': 'Condividi questo evento',
  'details.shareBusy': 'Preparazione della condivisione…',
  'details.share': 'Condividi',
  'details.when': 'Quando',
  'details.where': 'Dove',
  'details.about': 'Informazioni sull’evento',

  // ─── Map ─────────────────────────────────────────────────────────────────
  'map.loading': 'Caricamento dei luoghi…',
  'map.empty.eyebrow': 'MAPPA',
  'map.empty.title': '— nessun evento sulla mappa —',
  'map.empty.detail': 'I luoghi con coordinate appariranno qui come pin.',
  'map.sheet.eyebrow': 'LUOGO',
  'map.sheet.upcoming': '{count} eventi in arrivo',
  'map.sheet.found': '{count} eventi trovati',
  'map.sheet.empty': 'Nessun evento in arrivo per questo luogo.',
  'map.openA11y': 'Apri {title}',
  'map.errorFetch': 'Impossibile caricare i luoghi',
  'map.eyebrow': 'MAPPA',
  'map.title': 'Mappa',
  'map.subtitleCount': '{count} luoghi con eventi in arrivo.',
  'map.subtitleEmpty': 'Esplora Stoccolma — un pin per luogo.',
  'map.markerA11y': '{name} – {count} eventi',

  // ─── Notifications ───────────────────────────────────────────────────────
  'notifications.kind.reminder': 'Promemoria',
  'notifications.kind.match': 'Nuova corrispondenza per te',
  'notifications.kind.response': 'Risposta',
  'notifications.kind.fallback': 'Notifica',
  'notifications.eyebrow.reminder': 'PROMEMORIA',
  'notifications.eyebrow.match': 'NUOVE CORRISPONDENZE',
  'notifications.eyebrow.response': 'RISPOSTE',
  'notifications.time.nowPast': 'proprio ora',
  'notifications.time.nowFuture': 'ora',
  'notifications.time.pastMin': '{n} min fa',
  'notifications.time.futureMin': 'tra {n} min',
  'notifications.time.pastHours': '{h} h fa',
  'notifications.time.futureHours': 'tra {h} h',
  'notifications.time.pastHoursMin': '{h} h {m} min fa',
  'notifications.time.futureHoursMin': 'tra {h} h {m} min',
  'notifications.time.pastDays': '{d} g fa',
  'notifications.time.futureDays': 'tra {d} g',
  'notifications.pickRating': 'Scegli una valutazione',
  'notifications.pickRatingBody': 'Tocca una stella per valutare.',
  'notifications.tooLong': 'Troppo lunga',
  'notifications.tooLongBody': 'La nota può contenere al massimo 140 caratteri.',
  'notifications.ratingFailed': 'Impossibile inviare la valutazione',
  'notifications.ratingFailedBody': 'Riprova tra poco.',
  'notifications.rowA11y': '{kind}: {title}',
  'notifications.attended.eyebrow': 'PARTECIPATI',
  'notifications.starOne': 'stella',
  'notifications.starMany': 'stelle',
  'notifications.starA11y': '{count} {unit}',
  'notifications.rateHint': 'Tocca per valutare',
  'notifications.notePlaceholder': 'Scrivi una breve nota (max 140 caratteri, nessun dato personale)',
  'notifications.submitRating': 'Invia valutazione',
  'notifications.eyebrow': 'NOTIFICHE',
  'notifications.title': 'I tuoi promemoria e le risposte',
  'notifications.subtitle':
    'Appena una nuova corrispondenza, un promemoria o una risposta è pronta, arriva qui. Consiglio: salva gli eventi per ricevere un promemoria 2 ore prima.',
  'notifications.authBody':
    'Accedi per vedere notifiche e promemoria e valutare gli eventi a cui hai partecipato.',
  'notifications.fetchError': 'Impossibile caricare le notifiche al momento ({error}). Trascina verso il basso per riprovare.',
  'notifications.empty':
    'Nessuna notifica per ora. Salva un evento e riceverai un promemoria 2 ore prima dell’inizio.',
  'notifications.savedFallback': 'Evento salvato',

  // ─── Profile ─────────────────────────────────────────────────────────────
  'profile.unfollowFail': 'Impossibile smettere di seguire',
  'profile.notifSaveFail': 'Impossibile salvare l’impostazione delle notifiche',
  'profile.notifSaveFailWarning': 'Impossibile salvare l’impostazione delle notifiche ({warning}).',
  'profile.notifSaveFailNow': 'Impossibile salvare l’impostazione delle notifiche al momento.',
  'profile.notif.all': 'Tutte le notifiche',
  'profile.notif.newOnly': 'Nuovi eventi',
  'profile.notif.off': 'Disattivate',
  'profile.unfollow': 'Smetti di seguire',
  'profile.deleteGateWord': 'ELIMINA',
  'profile.deleteFailed': 'Impossibile eliminare l’account: {detail}',
  'profile.deleteFailedDetail': 'errore sconosciuto (stato {status})',
  'profile.deleteAlertTitle': 'Eliminare l’account?',
  'profile.deleteAlertBody':
    'Questo elimina il tuo account e tutto ciò che hai salvato — eventi salvati, luoghi seguiti, impostazioni delle notifiche. L’azione è irreversibile.',
  'profile.eyebrow': 'PROFILO',
  'profile.title': 'Salvati e impostazioni',
  'profile.account': 'Account',
  'profile.guestNudge':
    'I tuoi gusti sono già salvati nell’app. Aggiungi la tua e-mail per conservarli su tutti i dispositivi — puoi continuare a esplorare senza account.',
  'profile.about': 'Informazioni su EventPulse',
  'profile.subtitle': 'I tuoi eventi salvati, le categorie scelte e le impostazioni delle notifiche sono qui.',
  'profile.signedIn': 'Accesso effettuato',
  'profile.appleSignIn': 'Accesso con Apple',
  'profile.deleteDesc':
    'Elimina definitivamente l’account — tutto ciò che hai salvato e seguito e tutte le impostazioni delle notifiche scompaiono.',
  'profile.delete': 'Elimina account',
  'profile.following': 'Seguiti',
  'profile.followingDesc': 'Ecco cosa segui al momento. Premi a lungo su un chip per smettere di seguire.',
  'profile.noFollows':
    'Non segui ancora nessun luogo o artista. In fondo alla scheda di un evento c’è il pulsante ★ — premi a lungo per seguire un luogo.',
  'profile.venuesCount': 'Luoghi ({count})',
  'profile.artistsCount': 'Artisti ({count})',
  'profile.followsEmptyVenues': 'Nessun luogo seguito per ora.',
  'profile.followsEmptyArtists': 'Nessun artista seguito per ora.',
  'profile.entity.venue': 'luogo',
  'profile.entity.artist': 'artista',
  'profile.followChipA11y': 'Segui {entity} {label} — premi a lungo per smettere di seguire',
  'profile.longPressHint': 'Premi a lungo per smettere di seguire',
  'profile.venueChip': 'Luogo {id}…',
  'profile.artistChip': 'Artista {id}…',
  'profile.venueFallback': 'Luogo',
  'profile.artistFallback': 'Artista',
  'profile.notifications': 'Notifiche',
  'profile.pushVenues': 'Notifiche push per i luoghi seguiti',
  'profile.pushVenuesDesc':
    'Ricevi una notifica quando un luogo che segui aggiunge un nuovo evento. Consenti le notifiche per EventPulse nelle impostazioni del dispositivo (Impostazioni → Notifiche) per attivare la consegna.',
  'profile.pushSwitchA11y': 'Notifiche push per i luoghi seguiti',
  'profile.saving': 'Salvataggio…',
  'profile.language': 'Lingua',
  'profile.languageDesc': 'Scegli la lingua dell’app.',
  'profile.deleteModalTitle': 'Eliminare definitivamente l’account?',
  'profile.deleteModalBody':
    'Digita {word} in maiuscolo per confermare. L’azione è irreversibile — tutto ciò che hai salvato scomparirà.',
  'profile.deleteInputA11y': 'Testo di conferma',
  'profile.deleteConfirmA11y': 'Conferma eliminazione',
  'profile.deleteConfirm': 'Elimina',

  // ─── Auth reminder modal ─────────────────────────────────────────────────
  'authReminder.title': 'Conserva i tuoi gusti su tutti i dispositivi',
  'authReminder.body':
    'I tuoi eventi salvati e i suggerimenti personali sono attualmente archiviati solo su questo dispositivo. Aggiungi la tua e-mail e tutto ti seguirà ovunque accedi.',
  'authReminder.later': 'Più tardi',
  'authReminder.optOut': 'Non ricordarmelo più',

  // ─── Network banner ──────────────────────────────────────────────────────
  'network.a11y': 'Nessuna connessione di rete',
  'network.text': 'Nessuna connessione — mostriamo gli ultimi dati in cache',

  // ─── Din helg push (S5) ────────────────────────────────────────────────
  'pushPrompt.title': 'Vuoi ricevere il tuo weekend ogni settimana?',
  'pushPrompt.body':
    'Ogni giovedì alle 17:00 inviamo una notifica con 3–5 eventi scelti per il weekend — salvati e nuovi, in linea con i tuoi gusti.',
  'pushPrompt.example':
    'Il tuo weekend è qui — 3 proposte da venerdì a domenica.',
  'pushPrompt.accept': 'Sì, inviami il mio weekend',
  'pushPrompt.decline': 'Non ora',
  'profile.pushDinHelg': 'Notifiche Il tuo weekend',
  'profile.pushDinHelgDesc':
    'Una notifica ogni giovedì alle 17:00 con una selezione di eventi per il weekend.',
  'profile.pushDinHelgSwitchA11y': 'Notifiche push per Il tuo weekend',

  // ─── Explore search (2026-09-20) ─────────────────────────────────────────
  'explore.searchPlaceholder': 'Cerca eventi…',
  'explore.searchA11y': 'Campo di ricerca',
  'explore.noSearchResults': 'Nessun risultato per \"{q}\"',

  // ─── Rank reasons (chips on cards + agent labels) ───────────────────────
  'reason.time_fit.label': 'Orario giusto',
  'reason.time_fit.full': 'Corrisponde alla fascia oraria',
  'reason.under_budget.label': 'Sotto budget',
  'reason.under_budget.full': 'Entro il tuo budget',
  'reason.over_budget.label': 'Sopra budget',
  'reason.over_budget.full': 'Oltre il budget indicato',
  'reason.category_match.label': 'Categoria giusta',
  'reason.category_match.full': 'Corrisponde alla tua categoria',
  'reason.exclude_match.label': 'Non escluso',
  'reason.exclude_match.full': 'Rispetta le tue esclusioni',
  'reason.not_ended.label': 'Non concluso',
  'reason.not_ended.full': 'L’evento non è ancora concluso',
  'reason.high_confidence.label': 'Alta qualità',
  'reason.high_confidence.full': 'Dati di alta qualità',
  'reason.low_confidence.label': 'Bassa qualità',
  'reason.low_confidence.full': 'Dati di bassa qualità — da verificare',
  'reason.stale.label': 'Dati vecchi',
  'reason.stale.full': 'I dati potrebbero essere obsoleti',
  'reason.category_personalization.label': 'Categoria giusta',
  'reason.category_personalization.full': 'Corrisponde ai tuoi preferiti',
  'reason.venue_personalization_penalty.label': 'Zona sbagliata',
  'reason.venue_personalization_penalty.full': 'Di solito non ti piace questo luogo',
  'reason.followed_venue.label': 'Seguito',
  'reason.followed_venue.full': 'Segui questo luogo',
  'reason.followed_artist.label': 'Artista preferito',
  'reason.followed_artist.full': 'Segui uno degli artisti',
  'reason.outbound_personalization.label': 'I tuoi biglietti',
  'reason.outbound_personalization.full': 'Clicchi spesso sui biglietti per questo tipo di evento',

  // ─── Legal (privacy policy + terms) ─────────────────────────────────────
  // _legalDraftOnly: '1' = bozza AI (banner visibile), '0' = revisionata (banner nascosto).
  // Imposta '0' quando il testo è stato approvato.
  '_legalDraftOnly': '1',

  'legal.close': 'Chiudi',
  'legal.lastUpdatedLabel': 'Ultimo aggiornamento:',
  'legal.draftBannerTitle': '⚠️ Questa è una bozza generata dall\'AI',
  'legal.draftBannerBody':
    'Il testo è stato redatto da un\'AI basandosi su ciò che l\'app effettivamente fa. Deve essere rivisto da una persona responsabile o da un consulente esterno prima di essere pubblicato come policy definitiva. EventPulse non si assume responsabilità per la correttezza giuridica di questo testo nella sua forma attuale.',
  'legal.readOnWebLabel': 'Leggi la versione completa con formattazione sul web:',
  'legal.webMirrorNote':
    'Lo stesso testo è sul sito web — viene aggiornato lì per primo, la versione in-app viene replicata ad ogni rilascio.',

  // Profile rows that open the modals
  'profile.privacyPolicy': 'Informativa sulla privacy',
  'profile.privacyPolicyDesc': 'Leggi come gestiamo i tuoi dati.',
  'profile.terms': 'Termini di servizio',
  'profile.termsDesc': 'Regole per usare EventPulse.',

  // ─── Privacy policy sections (key order matches LegalModal.js buildSections)
  'legal.privacy.title': 'Informativa sulla privacy',
  'legal.privacy.lastUpdated': '2026-10-04 (bozza v0.1)',

  'legal.privacy.p1.title': '1. Chi siamo',
  'legal.privacy.p1.body':
    'EventPulse è un agente personale per eventi distribuito come app iOS e Android, sviluppato da [TODO: ragione sociale completa e partita IVA]. L\'app aiuta gli utenti nella regione di Stoccolma a trovare concerti, mostre e altri eventi in base ai propri gusti. Contatto per la privacy: privacy@eventpulse.nu [TODO: confermare].',

  'legal.privacy.p2a.title': '2.1 Dati dell\'account (quando crei un account)',
  'legal.privacy.p2a.bullets':
    'Indirizzo e-mail (se accedi tramite magic link).\nID Apple (se accedi con Apple — riceviamo solo un ID utente univoco, non la tua e-mail, se scegli di nasconderla).\nID utente anonimo generato automaticamente (se usi l\'app senza accedere).',

  'legal.privacy.p2b.title': '2.2 Dati generati dall\'utente',
  'legal.privacy.p2b.bullets':
    'Eventi che salvi, tocchi o segni come non interessanti.\nLocali e artisti che segui.\nIscrizioni push (se vuoi notifiche per locali specifici).\nEventuali conversazioni con l\'agente eventi integrato nell\'app.',

  'legal.privacy.p2c.title': '2.3 Dati del dispositivo e di utilizzo',
  'legal.privacy.p2c.bullets':
    'ID dispositivo hashato come stringa esadecimale di 64 caratteri (anonimo; non risalibile a te senza la nostra chiave di salt interna).\nPreferenza lingua.\nPosizione (solo se hai esplicitamente concesso l\'accesso alla posizione all\'app — usata per mostrare eventi vicini a te).',

  'legal.privacy.p2d.title': '2.4 Statistiche anonime (solo se acconsenti)',
  'legal.privacy.p2d.body':
    'L\'app ha un interruttore opt-in separato in Profilo → Privacy. Le statistiche includono eventi come tile_tap, event_view, event_save e simili. Nessuna informazione personally identifiable. Le statistiche sono conservate per un massimo di 30 giorni.',

  'legal.privacy.p3.title': '3. Perché raccogliamo i dati e su quale base legale',
  'legal.privacy.p3.body':
    'I dati dell\'account e i dati generati dall\'utente sono trattati per fornire il servizio richiesto (GDPR Art. 6(1)(b) contratto). Le notifiche push e le statistiche anonime si basano sul tuo consenso (Art. 6(1)(a)), che puoi revocare in qualsiasi momento nell\'app. I log tecnici senza PII sono trattati per sicurezza e debug (Art. 6(1)(f) legittimo interesse).',

  'legal.privacy.p4.title': '4. Per quanto tempo conserviamo i dati',
  'legal.privacy.p4.bullets':
    'Dati account: finché l\'account è attivo. Cancellati entro 30 giorni dall\'eliminazione dell\'account.\nDati generati dall\'utente: legati all\'account; cancellati all\'eliminazione dell\'account tramite regole di cascade del database.\nStatistiche anonime: 30 giorni, poi eliminate automaticamente.\nToken push: finché non disattivi le push per un locale o cancelli l\'account.',

  'legal.privacy.p5.title': '5. Con chi condividiamo i dati',
  'legal.privacy.p5.body':
    'Non condividiamo i tuoi dati personali con terze parti per marketing. Responsabili del trattamento: Supabase (autenticazione, database, archiviazione file — regione server [TODO: confermare EU, preferibilmente eu-north-1]); Expo / Apple Push Notification Service (consegna push); OpenAI / Anthropic / provider LLM scelto (chat agente — solo il testo che invii, non i dati dell\'account).',

  'legal.privacy.p6.title': '6. Trasferimenti internazionali',
  'legal.privacy.p6.body':
    'Alcuni responsabili possono trattare i dati al di fuori dell\'UE/SEE (in particolare i provider LLM con sede negli USA). Garantiamo che i trasferimenti avvengano con un meccanismo legale appropriato (clausole contrattuali standard della Commissione UE o equivalente). [TODO: documentare il meccanismo attuale per ogni provider].',

  'legal.privacy.p7.title': '7. I tuoi diritti (GDPR Art. 15–22)',
  'legal.privacy.p7.bullets':
    'Diritto di accesso (Art. 15): puoi richiedere una copia dei tuoi dati. Nell\'app: Profilo → Scarica i miei dati [TODO: pulsante in arrivo nella Fase 4].\nDiritto di rettifica (Art. 16): contattaci se qualcosa è sbagliato.\nDiritto di cancellazione (Art. 17): nell\'app: Profilo → Elimina account.\nDiritto di limitazione (Art. 18): disattiva le statistiche e/o le push in Profilo → Privacy.\nDiritto alla portabilità (Art. 20): stesso pulsante di esportazione dell\'Art. 15.\nDiritto di opposizione (Art. 21): contattaci.',

  'legal.privacy.p8.title': '8. Come esercitare i tuoi diritti',
  'legal.privacy.p8.body':
    'Direttamente nell\'app sotto Profilo per i diritti più comuni. Per altre richieste, scrivi a privacy@eventpulse.nu. Rispondiamo entro 30 giorni secondo il GDPR.',

  'legal.privacy.p9.title': '9. Cookie e tracciamento sul sito web',
  'legal.privacy.p9.body':
    'Il sito eventpulse.nu non usa cookie, pixel di tracciamento o script di terze parti. Il sito è interamente same-origin.',

  'legal.privacy.p10.title': '10. Modifiche a questa policy',
  'legal.privacy.p10.body':
    'Possiamo aggiornare questa policy. Per le modifiche sostanziali ti avvisiamo nell\'app. L\'ultimo aggiornamento è mostrato in cima.',

  'legal.privacy.p11.title': '11. Autorità di controllo',
  'legal.privacy.p11.body':
    'Se ritieni che trattiamo i tuoi dati in modo scorretto, puoi presentare un reclamo all\'autorità svedese per la protezione dei dati (IMY) — imy.se — o alla tua autorità locale.',

  // ─── Terms of service sections (key order matches LegalModal.js buildSections)
  'legal.terms.title': 'Termini di servizio',
  'legal.terms.lastUpdated': '2026-10-05 (bozza v0.2)',

  'legal.terms.t1.title': '1. Cos\'è il servizio',
  'legal.terms.t1.body':
    'EventPulse è un agente personale per eventi che mostra eventi nella regione di Stoccolma in base ai tuoi gusti. Il servizio è un\'app per iOS e Android. Gli eventi vengono recuperati da fonti pubbliche e presentati con descrizioni, orari, luoghi e link ai biglietti dove disponibili. EventPulse non vende biglietti.',

  'legal.terms.t2.title': '2. Chi può usare il servizio',
  'legal.terms.t2.body':
    'Devi avere almeno 16 anni per usare EventPulse. Se hai meno di 18 anni ti serve il consenso di un genitore.',

  'legal.terms.t3.title': '3. Account',
  'legal.terms.t3.body':
    'Puoi usare l\'app senza un account. Alcune funzioni richiedono un account. Accedi con magic link tramite e-mail o con Apple. Sei responsabile di mantenere private le tue credenziali. Avvisaci a privacy@eventpulse.nu se sospetti che il tuo account sia stato compromesso.',

  'legal.terms.t4.title': '4. Uso accettabile',
  'legal.terms.t4.bullets':
    'Non usare EventPulse per inviare spam, molestare altri o violare la legge.\nNon tentare di aggirare le barriere di sicurezza o accedere senza autorizzazione ai nostri sistemi.\nNon usare l\'app in modo da danneggiare la nostra infrastruttura o altri utenti.\nNon fare scraping, copiare o ridistribuire il contenuto degli eventi per scopi commerciali.\nNon fare reverse-engineering, decompilare o usare strumenti automatizzati contro l\'app o i nostri sistemi senza il nostro permesso scritto.',

  'legal.terms.t5.title': '5. Contenuto degli eventi e terze parti',
  'legal.terms.t5.body':
    'Le informazioni sugli eventi sono pubblicate dai rispettivi organizzatori. Non siamo responsabili della correttezza, attualità o disponibilità delle informazioni. Ci riserviamo il diritto di nascondere eventi che si rivelino errati, cancellati o fuorvianti.',

  'legal.terms.t6.title': '6. Notifiche push',
  'legal.terms.t6.body':
    'Se attivi le notifiche push per un locale o artista, ti inviamo una notifica quando rileviamo un nuovo evento da quella fonte. Puoi disattivare le push per singolo locale in qualsiasi momento, o globalmente nelle impostazioni del dispositivo. Limitiamo le notifiche push a un volume ragionevole — in genere non più di una notifica per locale seguito al giorno.',

  'legal.terms.t7.title': '7. Modifiche al servizio',
  'legal.terms.t7.body':
    'Sviluppiamo il servizio continuamente. Possiamo aggiungere, modificare o rimuovere funzionalità senza preavviso. Ci impegniamo a non fare modifiche che peggiorino ovviamente la tua esperienza senza buoni motivi.',

  'legal.terms.t8.title': '8. Cancellazione dell\'account e cessazione',
  'legal.terms.t8.body':
    'Puoi cancellare il tuo account in qualsiasi momento in Profilo → Elimina account. Cancelliamo tutti i dati legati all\'account. Possiamo disattivare o cancellare l\'account se violi questi termini o se il servizio viene dismesso.',

  'legal.terms.t9.title': '9. Proprietà intellettuale',
  'legal.terms.t9.body':
    'L\'app EventPulse, il marchio, il logo e il codice sottostante appartengono a noi e ai nostri licenzianti. Le immagini degli eventi appartengono ai rispettivi titolari.',

  'legal.terms.t10.title': '10. Limitazione di responsabilità',
  'legal.terms.t10.body':
    'EventPulse è fornito "così com\'è". Non garantiamo che il servizio sia privo di errori, ininterrotto o esente da difetti. Non siamo responsabili per danni indiretti. La nostra responsabilità totale è limitata a quanto hai pagato per il servizio negli ultimi 12 mesi. La legislazione obbligatoria a tutela dei consumatori (incluso il Codice del Consumo italiano e le equivalenti leggi locali) si applica sempre a beneficio del consumatore e ha precedenza con tale limitazione.',

  'legal.terms.t11.title': '11. Modifiche ai termini',
  'legal.terms.t11.body':
    'Possiamo aggiornare questi termini. Per le modifiche sostanziali ti avvisiamo nell\'app o via e-mail. Se non accetti i nuovi termini, puoi cancellare il tuo account.',

  'legal.terms.t12.title': '12. Legge applicabile e controversie',
  'legal.terms.t12.body':
    'Questi termini sono regolati dalla legge svedese. Le controversie sono risolte in un tribunale svedese, con il Tribunale di Stoccolma come primo grado. Puoi anche rivolgerti alla piattaforma di risoluzione online delle controversie della Commissione Europea (ec.europa.eu/consumers/odr).',

  'legal.terms.t13.title': '13. Contatti',
  'legal.terms.t13.body':
    'Domande su questi termini? Scrivi a privacy@eventpulse.nu.',

  'legal.terms.t14.title': '14. Comunicazioni',
  'legal.terms.t14.body':
    'Ti inviamo comunicazioni tramite l\'app, e-mail o notifiche push. Accetti che le comunicazioni elettroniche abbiano lo stesso effetto legale di quelle scritte. Questo vale in particolare per le comunicazioni di modifica ai sensi del §11 e per le informazioni relative alla sicurezza.',
  'legal.terms.t14.bullets':
    'Inviamo comunicazioni critiche di sicurezza e incidenti tramite push anche se hai disattivato le altre notifiche push.',
};
