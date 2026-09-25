# Byggprompt: Hem* — sandbox-version (06-UI-sandbox)

**Status:** Reviderad 2026-09-25. Tidigare variant (06-UI/ prod-plan) ersätts av denna.

**Historisk avvikelse (2026-09-25):** Jev rekommenderade `memory_first` (Senaste först, prob 0.81). Användaren överskrev detta och valde **För dig först**. Jevs utlåtande används som input för retention-design, inte som bindande beslut. Noterat i `feedback_fordig_first.md`.

**Syfte:** Sandbox-mock av retention-optimerad Hem-sektion. Visar hur den planerade 06-UI/-versionen ska bete sig — datakällor är hårdkodade, minne är per-komponent-state, ingen Supabase-/agent-koppling.

---

## 0. Kontext: vad som redan finns i sandbox

Dessa filer är redan på plats och återanvänds rakt av — INGEN portning behövs:

| Sandbox-fil | Roll |
|---|---|
| `06-UI-sandbox/components/EventPulseSenaste.js` | Spotify-stil rail (header + horisontell scroll). Används av Senaste-sektionen. |
| `06-UI-sandbox/components/EventPulseSenasteCard.js` | Kvadratisk 96 px-tile. Återanvänds av Senaste. |
| `06-UI-sandbox/components/EventPulseCarousel.js` | Horisontell karusell med kvadratiska 150 px-kort via `EventPulseCard`. Används av Ikväll/Helgen/För dig/Upptäck. |
| `06-UI-sandbox/components/EventPulseCard.js` | Karusell-kortet (CARD_WIDTH=150, aspect 1.15). |
| `06-UI-sandbox/components/HemScreen.js` | Befintlig 3-karusell-Hem-version (Din helg / Smak / Ikväll). **Rör EJ** — Hem\* är en separat komponent. |
| `06-UI-sandbox/App.js` | Visar COMPONENT_REGISTRY-listan → Hem\* blir synlig automatiskt efter registrering. |

Inga providers, ingen auth, ingen global state utanför komponenten (sandbox-regel).

---

## 1. Mål

Bygg en ny komponent i `06-UI-sandbox/` som heter exakt **Hem\*** och som aggregerar Senaste + 4 karuseller enligt retention-prioriteringen.

**Skall-krav:**
1. Sandbox-komponent som heter exakt `Hem*`, exponerad i registry-listan
2. Sektionsordning enligt **användarens val 2026-09-25** (Jevs memory_first överskriven): **För dig → Senaste → Ikväll → Helgen → Upptäck**
3. **För dig** + övriga karuseller = befintlig `EventPulseCarousel` (samma edge-bleed, skeleton, tom-state som redan finns)
4. **Senaste** = befintlig `EventPulseSenaste` + `EventPulseSenasteCard` (ingen ny komponent, återanvänd rakt av)
5. **Minnesfunktion i Senaste**: klick på Senaste-kort loggar en signal (vikt ×2) och omrangordnar Senaste live; "läs mer"-knapp kan väga ×3 om den byggs — annars demonstreras vikten via en hjälp-knapp eller två separata klick-hanterare
6. **Cold-start fallback**: tom signalhistorik ⇒ Senaste visar poolen i ursprunglig ordning (alla scores = 0)
7. **Återställ-knapp** så demo kan börja om utan omladdning

---

## 2. Forskningsbas + Jev-utlåtande (oförändrat från tidigare plan)

| Källa | Slutsats → designregel |
|---|---|
| `Youtube-learner/slutsatser/2026-09-20-spotify-algoritmen-popularity-index.md` | Namngivna + schemalagda algoritmprodukter ankrar beteende. Hem\* säljer utfallet, inte funktionerna. |
| `00-Vault/.../2026-09-20-Din-Helg-Research.md` (RQ1–RQ5) | reasons[]-chips synliga, micro-animation vid save/reject (sandbox-version: skippa animationer för enkelhet, bara logga). |
| `00-Vault/.../2026-09-23-Rankningsparametrar-Research.md` (K1–K3) | K2 chips always-visible, K1 outbound starkare än dwell, K3 utforskningsreserv ~10 %. |
| Mobbin-onboarding-1460 + Tim-Gabe (2026-09-20) | Sälj utfallet. |
| **Jev 2026-09-25 (advisor)** | memory_first (Senaste först). Sannolikhet 0.81, confidence 0.76. **Överskriven av användaren 2026-09-25** — se historisk avvikelse ovan. |
| **Jev 2026-09-25 (vikter)** | 5/3/1 vann (prob 0.38) men confidence 0.30 ⇒ välj **3/2/1** för enkelhet. |

---

## 3. Arkitektur / wire

```
06-UI-sandbox/components/HemStar.js                  ← NY ENDA fil för Hem*
├── imports: useState, useMemo, EventPulseCarousel, EventPulseSenaste
├── samples: SENASTE_POOL (8 ev.), IKVALL (5), HELGEN (5), FORDIG (5), UPPTACK (5)
├── state: signals = { [eventId]: { clicks, readMoreClicks, impressions } }
├── derived: senaste = topp 5 av SENASTE_POOL sorterade på score
├── dev-banner: visar "sandbox-preview, klicka för att se omrangering"
└── render (användarens val 2026-09-25 — Jevs memory_first överskriven):
    ├── Eyebrow + Titel (Hem*) + Subtitle (override-notering)
    ├── Banner ("SANDBOX-PREVIEW. Klicka Senaste-kort …")
    ├── "Återställ signaler (n st)" Pressable
    ├── <EventPulseCarousel headerText="För dig" cards={FORDIG} />
    ├── <EventPulseSenaste headerText="Senaste" cards={senaste} />
    ├── <EventPulseCarousel headerText="Ikväll" cards={IKVALL} />
    ├── <EventPulseCarousel headerText="Helgen" cards={HELGEN} />
    └── <EventPulseCarousel headerText="Upptäck" cards={UPPTACK} />
```

### Filer som ändras

| Fil | Ändring |
|---|---|
| `06-UI-sandbox/components/HemStar.js` | **NY** — hela komponenten enligt ovan |
| `06-UI-sandbox/components/registry.js` | **+1 import + +1 entry** i `COMPONENT_REGISTRY` (id: `hem-star`, name: `Hem*`, Component: HemStar, sampleProps: {}) |

### Filer som **inte** ändras

- `06-UI-sandbox/components/HemScreen.js` — parallell komponent, ska kunna samexistera
- `06-UI-sandbox/components/EventPulseSenaste.js`, `EventPulseSenasteCard.js`, `EventPulseCarousel.js`, `EventPulseCard.js` — återanvänds rakt av
- `06-UI-sandbox/App.js` — läser COMPONENT_REGISTRY, ingen ändring behövs
- Allt i `06-UI/` — sandbox-arbete rör inte prod-trädet

---

## 4. Datakällor (hårdkodade i HemStar — sandbox-regel)

Inga Supabase-/agent-anrop. Allt är hårdkodade `require()`-tiles + strängtitlar i komponenten.

| Sektion | Källa | Antal |
|---|---|---|
| Senaste-pool | `SENASTE_POOL` const i HemStar.js (8 events) | 8 |
| Ikväll | `IKVALL` const (5 events) | 5 |
| Helgen | `HELGEN` const (5 events) | 5 |
| För dig | `FORDIG` const (5 events) | 5 |
| Upptäck (K3) | `UPPTACK` const (5 events) | 5 |

`require('../assets/tile-N.png')` återanvänds från befintlig sandbox-pool (tile-1..tile-5).

**OBS för framtida 06-UI/-port:** när Hem\* flyttas till prod ersätts dessa `IKVALL`/`HELGEN`/`FORDIG`/`UPPTACK`-konstanter med hooks mot `06-UI/services/agentClient.js` (se 06-UI-plan § 4).

---

## 5. Minnes-funktion i "Senaste" (sandbox-version)

### Vikt-tabell (Jev-granskad, 3/2/1)

| Signal | Vikt | Sandbox-realisation |
|---|---|---|
| Läs mer-klick | 3× | För sandbox: separat Pressable under Senaste-railen, en knapp per synligt kort som triggar `handleReadMore(id)`. (Visar vikten utan att kräva en ny kort-variant.) |
| Klick på event-kort | 2× | `EventPulseSenaste` tar emot `cards` med `onPress` per-kort (befintlig prop). Wrappar i `handleSenasteClick(id)`. |
| Impression | 1× | Trackas vid render (useEffect med setTimeout 1 s för varje synligt kort-id). Sandbox-version: skippa i v1 för att hålla komponenten liten. Jev säger denna har lägst vikt; den kan läggas till i v1.1. |

### Algoritm
```js
function scoreFor(signalsForId) {
  return 3 * (signalsForId?.readMoreClicks || 0)
       + 2 * (signalsForId?.clicks || 0)
       + 1 * (signalsForId?.impressions || 0);
}

const senaste = SENASTE_POOL
  .map(e => ({ ...e, _score: scoreFor(signals[e.id]) }))
  .sort((a, b) => b._score - a._score)
  .slice(0, 5);
```

Tom historik ⇒ poolen i ursprunglig ordning (alla scores = 0 ⇒ stable sort ⇒ ursprung).

### Demo-flöde
1. Användaren öppnar Hem\* i sandbox
2. Senaste visar 5 events i pool-ordning
3. Användaren klickar på t.ex. kort 4 (eller dess "läs mer"-knapp)
4. Kortet flyttas upp i Senaste-railen (om score > 0)
5. Användaren klickar "Återställ signaler" ⇒ state nollställs ⇒ Senaste återgår till pool-ordning
6. Vid omladdning av sandbox-appen nollställs allt (useState-omstart — förväntat beteende i sandbox)

---

## 6. Implementation steps

1. **Skapa** `06-UI-sandbox/components/HemStar.js` enligt § 3-strukturen. Hårdkodade samples enligt § 4. Minneslogik enligt § 5.
2. **Uppdatera** `06-UI-sandbox/components/registry.js`:
   - Lägg till `import HemStar from './HemStar';`
   - Lägg till en entry `{ id: 'hem-star', name: 'Hem*', description: '...', Component: HemStar, sampleProps: {} }`
3. **Verifiera** (se § 7)

---

## 7. Verifiering

**Sandbox-miljö har typiskt inte full tsc/eslint — verifieringen är visuell.**

```bash
# Valfritt: kontrollera att inga syntaxfel uppstår
cd 06-UI-sandbox && node -e "require('./App.js')" 2>&1 | head -5
# Förväntat: inget felmeddelande om require-resolution.
```

**Visuellt (manuellt):**
1. Starta sandbox: `cd 06-UI-sandbox && npm start` (eller motsvarande)
2. Öppna i Expo Go
3. Tryck på "Hem\*" i listan
4. Verifiera:
   - 5 karuseller renderas i ordning **För dig → Senaste → Ikväll → Helgen → Upptäck**
   - Klick på Senaste-kort ⇒ det flyttas upp
   - "Återställ signaler" nollställer allt
   - Tomt Senaste-pool ⇒ stable sort ⇒ ursprunglig ordning
5. Avsluta sandbox-läge (tryck "‹ Komponenter" — ska gå tillbaka till listan utan fel)

---

## 8. Constraints (sandbox-sant)

- **Inga providers** (LanguageProvider, AuthProvider, NetworkProvider etc. finns inte i sandbox)
- **Ingen Supabase/agent-anrop** — allt är hårdkodade samples
- **Ingen global state** — allt är lokal `useState` i HemStar
- **Inga nya dependencies** — bara react/react-native som redan finns
- **Rör EJ** `06-UI-sandbox/components/HemScreen.js` (befintlig parallell version)
- **Rör EJ** `06-UI/` (sandbox-arbete isolerat dit)

---

## 9. Acceptance criteria

| ID | Krav |
|---|---|
| AC-1 | `HemStar.js` finns i `06-UI-sandbox/components/` |
| AC-2 | Registry visar "Hem\*" som list-element |
| AC-3 | Sektioner i ordning: **För dig → Senaste → Ikväll → Helgen → Upptäck** (användarens val 2026-09-25, Jevs memory_first överskriven) |
| AC-4 | Senaste använder befintlig `EventPulseSenaste` + `EventPulseSenasteCard` (ingen ny komponent) |
| AC-5 | Övriga 4 sektioner använder befintlig `EventPulseCarousel` |
| AC-6 | Minne: ×3 read_more, ×2 click (×1 impression optionellt) — **klick via kort-onPress (×2). Read_more-vikten finns kvar i scoreFor men har ingen UI-affordance (användaren tog bort "Läs mer"-bandet 2026-09-25)** |
| AC-7 | Klick på Senaste-kort ⇒ omrangordning sker live |
| AC-8 | "Återställ signaler"-knapp ⇒ state nollställs |
| AC-9 | Cold-start (tom historik) ⇒ pool-ursprunglig ordning |
| AC-10 | Inga ändringar i `06-UI-sandbox/components/HemScreen.js` eller `06-UI/` |
| AC-11 | Inga nya dependencies |

---

## 10. Sandbox-vs-prod mapping (för 06-UI/-port senare)

| Sandbox-koncept | 06-UI/-motsvarighet |
|---|---|
| `useState({})` för signaler | `useSenasteEvents()` hook + AsyncStorage-counter + `recordEventInteraction` |
| Hårdkodade IKVALL/HELGEN/FORDIG/UPPTACK-konstanter | hooks mot `fetchFeed`, `fetchRecommendedEvents`, `fetchSavedEvents` |
| "Återställ"-knapp | Bakgrunds-sync via `bootstrapSession()` + `clearAsyncStorage` |
| 5 events/sektion i sample | SECTION_LIMIT (12) från agent |
| Custom Banner-rad | ev. i18n `hemstar.banner.preview` |
| Läs mer via separat knapp under rail | Läs mer-knapp på `EventPulseSenasteCard` (kräver variant) |

---

## 11. Nästa steg (efter sandbox-demo)

1. Demo i sandbox — verifiera UX-flödet är rätt
2. A/B-förberedelse: vikter (3/2/1) ⇒ A/B-test mot 5/3/1 i prod senare
3. **Phase 2: Portning till `06-UI/` med Supabase-/agent-data** (se § 11b nedan — full spec)
4. Wiring via feature-flag `EXPO_PUBLIC_HEM_STAR_ENABLED`
5. K3 reserv-andel: mät 10 % i prod ⇒ justera

---

## 11b. Phase 2 — Hem* i `06-UI/` med riktig Supabase-data

### 11b.0 Syfte

Ersätta sandbox-hårdkodningen med riktiga Supabase-/agent-anrop. Målet är samma UX-flöde som visades i sandbox, men med levande data och persistent minne över sessioner.

### 11b.1 Datakällor (befintliga hooks — INTE nya endpoints)

All data via `06-UI/services/agentClient.js`. Inga nya endpoints i `08-Agent/server.ts` (om inget oväntat dyker upp — logga gate).

| Sektion | Hook / endpoint | Klientlogik |
|---|---|---|
| **Senaste** | ny `useSenasteEvents()` (egen hook under screens/hemstar/) | Rå pool: `fetchFeed({from:today-7d, days:14})` → aggregera lokala signaler (saves via `fetchSavedEvents` + AsyncStorage-counter för klick/impression) → score per event enligt sandbox-vikter (3/2/1) → topp 5. |
| **Ikväll** | `fetchFeed({from:today, days:1})` | klientfilter `start_time_local ≥ 18:00`. Samma mönster som `06-UI/screens/HomeScreen.js:115-135` (`useSection`-hooken). |
| **Helgen** | `fetchFeed({from:weekendStart, days:3})` | återanvänd `upcomingWeekendIsoSet` från `screens/home/weekendDates.js`. |
| **För dig** | `fetchRecommendedEvents({limit:10})` | server-side personaliserat; client slice till SECTION_LIMIT (12). |
| **Upptäck (K3)** | `fetchFeed({from, days:14})` + klientens "lägst score"-urval | ~10 % av flödet opåverkade av smakboost. Välj 5 events med lägst `score` (eller om ingen finns, slumpmässigt). |

Persistenta signaler via `recordEventInteraction({eventId, interaction, metadata:{source:'senaste'|'read_more'|'hemstar'}})` — best-effort (returnerar `{ok, warning}`, kastar aldrig). AsyncStorage-counter som lokal backup.

### 11b.2 Filer som skapas/ändras

| Fil | Ändring |
|---|---|
| `06-UI/screens/HemStarScreen.js` | **Byggs ut** från svart stub till full Hem* (ersätter sandbox-mock med hooks). paddingTop: 48 (binding SPACING.md). |
| `06-UI/screens/hemstar/useSenasteEvents.js` | **NY** — hook enligt § 11b.1. |
| `06-UI/screens/hemstar/useHemStarSections.js` | **NY** — samlar `useFeedSection` × 4 + `useRecommendedSection`. Fail-soft (ingen kraschar sidan). |
| `06-UI/utils/hemstar/signalStorage.js` | **NY** — tunn AsyncStorage-wrapper för signal-counter (`hemstar.signal-counts.v1`-key). |
| `06-UI/AppShell.js` | **+1 route** (feature-flag, default false, se § 11b.4). |
| `06-UI/components/BottomTabBar.js` | **+1 tab** (om feature-flag=true). Följ Utforska*-mönstret. |

### 11b.3 Komponenter att återanvända (rakt av)

- `06-UI/components/EventPulseSenaste.js`, `EventPulseSenasteCard.js` — portade 1:1 från sandbox (eller re-implementera med tokens från DESIGN_SYSTEM.md — portning-teamet väljer)
- `06-UI/components/EventPulseCarousel.js` — **finns redan**, återanvänd direkt (CARD_WIDTH=187 istället för sandbox 150 — design-beslut om vilken som vinner)
- `06-UI/utils/rankReasonLabels.js` — finns redan; rendera `reasons[]` på utvalda sektioner (K2)

### 11b.4 Wiring — feature-flag

Lägg till `EXPO_PUBLIC_HEM_STAR_ENABLED` env-flag. Mönster (kopierat från `EXPO_PUBLIC_EXPLORE_STAR_ENABLED`):

```js
// AppShell.js — top-level const
const HEM_STAR_ENABLED = process.env.EXPO_PUBLIC_HEM_STAR_ENABLED === 'true';

// BottomTabBar.js — TABS.push om true
if (process.env.EXPO_PUBLIC_HEM_STAR_ENABLED === 'true') {
  TABS.push({ id: 'hem-star', icon: 'home-outline', iconActive: 'home', labelKey: 'tabs.hemStar' });
}

// AppShell.js keep-alive ref
mountedTabsRef.current['hem-star'] = true; // när flagen är true
```

**Viktigt:** HemStar-routen får INTE mountas i prod innan flaggan är true (mönstret med `if (HEM_STAR_ENABLED)`).

### 11b.5 "Läs mer"-knapp

Bygger vidare på sandbox-mönstret. EventPulseCard / EventPulseSenasteCard saknar idag en "läs mer"-affordance ⇒ ny variant `EventPulseSenasteCard.v2.js` ELLER prop-passthrough. Logik:

```js
const handleReadMore = (event) => {
  recordEventInteraction({ eventId: event.id, interaction: 'click', metadata: {source:'read_more'} });
  openDetailsScreen(event.id); // samma flöde som HomeScreen.onCardPress
};
```

### 11b.6 Verifiering (obligatoriska grindar — kör innan "klart")

```bash
cd 06-UI && npx tsc --noEmit               # exit 0
cd 06-UI && npx eslint . --max-warnings 0  # exit 0 (eller logga 'optional, skip')
cd 06-UI && npm run verify-providers       # exit 0
```

**Manuella UI-tester:**
- Fresh install (ingen signalhistorik) ⇒ Senaste visar cold-start fallback (default-pool för 7 dagar)
- Gäst-save 3 events via Spara ⇒ dessa prioriteras i Senaste vid omladdning
- Klick på "läs mer" 2× på samma event ⇒ först i Senaste efter AsyncStorage-flush
- Tom karusell (t.ex. inga Ikväll-events idag) ⇒ return null (sandbox-mönster, redan i EventPulseCarousel.js)
- 5 sektioner laddade parallellt ⇒ scroll utan frame-drop på iPhone 11 / SE 2020
- Logga ut / logga in ⇒ samma sparade signaler (Anon-länkning via `linkIdentity` från tidigare arbete)

### 11b.7 Acceptance criteria (Phase 2)

| ID | Krav |
|---|---|
| AC-2-1 | HemStarScreen har 5 sektioner; **För dig först** (användarens val 2026-09-25, Jevs memory_first överskriven) |
| AC-2-2 | All data via `agentClient.js`-hooks, inga hårdkodade events |
| AC-2-3 | Signaler persisterar i AsyncStorage och klarar app-restart |
| AC-2-4 | Anon-användares signaler följer med vid konvertering till konto (via `linkIdentity` — befintlig) |
| AC-2-5 | Feature-flag styr Hem*-route (default false i main, true bakom env-flag) |
| AC-2-6 | `recordEventInteraction` kastar aldrig (best-effort-redan i klienten) |
| AC-2-7 | `npx tsc --noEmit` exit 0 |
| AC-2-8 | `npm run verify-providers` exit 0 |
| AC-2-9 | Inga ändringar i `06-UI/services/eventServiceClient.js` (Tier 0) |
| AC-2-10 | Inga ändringar i `08-Agent/server.ts` (om inte gate-flaggat) |
| AC-2-11 | reason-chips synliga på För dig-sektionen (K2-binding) |

### 11b.8 Constraints (Phase 2-specifika)

- **Rör EJ** `06-UI/services/eventServiceClient.js` (Tier 0-anon-read-path)
- **Rör EJ** `08-Agent/server.ts` om inte en gate flaggar behovet
- **Rör EJ** `06-UI-sandbox/` — sandbox- och prod-träden är isolerade
- **Inga nya dependencies** förutom ev. `@expo/vector-icons` (finns redan)
- **Inga Zustand/Redux/React Query** utan explicit godkännande — använd plain hooks + AsyncStorage
- **Inga syntetiska event-counts** i UI (räkneverk får inte hitta på siffror)

### 11b.9 Estimering (referens, INTE åtagande)

Sandbox-fasen klar. Phase 2 i 06-UI/ uppskattas till **två specialiserade dagar** med en expo-engineer för komponentbygge + hook-skrivning, plus en halvdag för visuell QA. Förbehåll: blockerad av Jevs §-sektioner som inte täcks än (t.ex. om `read_more`-knapp kräver designspec).

### 11b.10 Sandbox-vs-prod-port: diff-checklista

Vid flytt från sandbox-HemStar till 06-UI-HemStarScreen, kör denna check:

- [ ] Alla 5 sektioner i samma ordning
- [ ] Senaste har hook (inte hårdkodade events)
- [ ] Minnes-funktionen använder AsyncStorage-counter + recordEventInteraction
- [ ] EventPulseSenaste + EventPulseSenasteCard är portade (eller re-implementerade med 06-UI-tokens)
- [ ] EventPulseCarousel från 06-UI/components/ används
- [ ] reasons[]-chips visas på minst För dig-sektionen
- [ ] Läs mer-knapp finns på Senaste (signal ×3)
- [ ] Cold-start fallback testad (fresh install)
- [ ] Feature-flag styr visning (default false)
- [ ] npx tsc + npm run verify-providers exit 0
