# Parked: Online-karusell (Online carousel)

**Datum parkerad:** 2026-09-26
**Status:** PARKERAD — future build. Ingen aktiv kod, ingen aktiv migration.
**Beslut:** Användaren röstade för att ta bort just nu. "Jag orkar inte!"
**Original plan:** Samma fil — ursprungligen `docs/HOME-CAROUSELS-PLAN.md`. Online-specen finns i §D i originalfilen (sparad oförändrad nedan).

---

## Varför parkerad (decision record)

### Vad utreddes

1. **Migration-applicering**: `is_online` / `online_url`-kolumner fanns i `20260926-0001` + backfill `0002`, men Online-karusellen i HomeScreen var ändå tom.
2. **Pre-flight 100 slumpmässiga events via Jev** (`scripts/jev-call.py --type noul`): 0 events med `p_online ≥ 0.7`.
3. **Exakt nyckelordssök (multi-språk, multi-fält, inkl. URL/source)**: 5811 events totalt, **bara 3 bekräftat online** efter manuell inspektion (0.05 %):
   - "Medeltiden online – digitalt tillgängliggörande av medeltida handskrifter" (KB)
   - "Washington Crossing the Delaware – Livestream" (Eventbrite)
   - "KTH webinarium" (KTH-serie)
4. **Source-medelvärden** (top 4):
   - thatsup-articles 0.281, evensos 0.269, sthlmlist 0.126, spelning-se 0.076
   - Ingen källa producerar huvudsakligen online-events.
5. **Jev noul på meta-beslutet** "Ska vi jaga online-events via Exa eller acceptera physical-only?": **0.95 att Stockholm-fokus > online-jakt**.

### Konsekvens

- Online-karusellen togs bort från `06-UI/screens/HomeScreen.js` (state, query, cards, render).
- `home.sections.online` togs bort från `06-UI/i18n/strings/sv.js` och `en.js`.
- Migrations `20260926-0001` + `0002` flyttades till `05-Supabase/migrations/_future-builds/online-events/` så de inte körs av misstag.
- Migration `20260926-0003-link-health.sql` exponerar dock `is_online` / `online_url` på viewn — **oförändrad** (krävs för link-health oavsett karusell).

---

## Att återaktivera (när användaren vill)

När användaren återvänder till detta (eller när Stockholm-grafen har tillräcklig densitet för att motivera online-jakt):

1. **Flytta tillbaka migrations**:
   ```bash
   mv 05-Supabase/migrations/_future-builds/online-events/20260926-0001-add-is-online.sql \
      05-Supabase/migrations/
   mv 05-Supabase/migrations/_future-builds/online-events/20260926-0002-backfill-is-online.sql \
      05-Supabase/migrations/
   ```
2. **Kör migrations** mot prod (kräver explicit human approval).
3. **Återställ HomeScreen-koden** — original-spec i §D i denna fil (rad 166–252 i original-HOME-CAROUSELS-PLAN.md).
4. **Återställ i18n-keys** (`home.sections.online`).
5. **Förbättrad backfill** — den nuvarande heuristiken (titel-ord) hittar bara ~5 events. Nästa steg: LLM-klassificering via Jev per event vid nightly cron (Jev-förslag 2026-09-26).
6. **Ingestion-koppling** — uppdatera käll-specifika adapters att sätta `is_online=true` när source markerar det (t.ex. `source='youtube_live'`).

### Trigger för återaktivering

EventPulse är en **personal event agent för Stockholm** (`docs/MASTERPLAN.md`). Online-karuseller aktiveras inte förrän **antingen**:

- Användaren uttryckligen efterfrågar dem igen, **eller**
- Online-jakt via Exa hittar ≥30 verifierade online-events i Stockholm-området.

---

## Filer som togs bort / parkerades

| Fil | Åtgärd |
|---|---|
| `docs/HOME-CAROUSELS-PLAN.md` | Flyttad hit |
| `05-Supabase/migrations/20260926-0001-add-is-online.sql` | Flyttad till `_future-builds/online-events/` |
| `05-Supabase/migrations/20260926-0002-backfill-is-online.sql` | Flyttad till `_future-builds/online-events/` |
| `06-UI/screens/HomeScreen.js` (5 ställen) | Online-raderna borttagna (state, query, cards, render, kommentar) |
| `06-UI/i18n/strings/sv.js` | `home.sections.online`-key borttagen |
| `06-UI/i18n/strings/en.js` | `home.sections.online`-key borttagen |

---

## Lessons learned (för framtida similar-karuseller)

1. **Verifiera datatäthet INNAN implementation.** 0.05 % verified online gör karusellen meningslös. Spot-checks på 5–10 events räcker inte.
2. **Generalization Protection Rule gäller även för karuseller.** Om en karusell behöver en migration för att fungera, säkerställ att migrationens datafyllning är bred nog — annars blir karusellen visuellt trasig.
3. **Jev-pilot ≥100 events + multi-fält-sök** innan kodskrivning. Jev:s free-form probability var bättre än viktad poäng-design.
4. **Parkera, radera aldrig.** Future-builds-mappen är samlingsplatsen för saker användaren aktivt valt bort.

---

---

# Original HOME-CAROUSELS-PLAN (oförändrad)

Nedan följer den ursprungliga planen som den såg ut 2026-09-26. Online-specen finns i §D — det är den planen som nu är parkerad.

---

# Plan: Home-sektionen — 5 nya karuseller (Spotify/Eventbrite-mönster)

**Datum:** 2026-09-26
**Status:** PLANERAD — ingen kod ännu. PLANNING ONLY.
**Scope:** `06-UI/screens/HomeScreen.js` + en Supabase-migration (`is_online`).
**Verifiering:** Real data mot `events_public` redan idag (se §Verifiering).

**Titelnamn (användarens val 2026-09-26):**
- A → **"Gratis"** (sv) / "Free" (en)
- B → **"Imorgon"** (sv) / "Tomorrow" (en)
- C → **"Foodies"** (sv) / "Foodies" (en)  — *var "Mat" i planen, bytt till "Foodies" enligt användaren*
- D → **"Online"** (sv) / "Online" (en) ← **Parkerad 2026-09-26 — se beslut ovan**
- E → **"Nytt på Eventpulse"** (sv) / "New on EventPulse" (en) — *var "Nytt" i planen, utökat enligt användaren*