# 06-UI/HEM-QUARANTINE

Hem-trädet flyttades till karantän **2026-09-25** när home-tabben tog över Hem-supabase-logiken.

## Vad som finns här

| Original path | Nu |
|---|---|
| `screens/HomeScreen.js` (1 721 rader) | `screens/HomeScreen.js` |
| `screens/home/cardTimeLabel.js` | `screens/home/cardTimeLabel.js` |
| `screens/home/happeningNow.js` | `screens/home/happeningNow.js` |
| `screens/home/weekendDates.js` | `screens/home/weekendDates.js` |
| `screens/home/*.test.ts` | `screens/home/*.test.ts` |

Koden är **oförändrad** — `git mv` bevarar historiken. Filerna är redo att
flyttas tillbaka utan merge-konflikter.

## Varför karantän

Användaren har valt (2026-09-25) att Hem-utvecklingen ska ske i
**06-UI-sandbox/** som en fristående sandbox-sida (Hem-supabase,
HemStar-mock) tills vidare. 06-UI/Hem-sektionen pausades för att:

- inte dubbelutveckla två Hem-implementationer
- ge sandbox-teamet en ren yta utan 06-UI/provider-bloat
- hålla App Store-byggen (Crash-free) opåverkade medan Hem* formas

**Hem-tabben i BottomTabBar finns kvar** — den pekar nu på home-versionen
i `06-UI/screens/HomeScreen.js` (Hem-supabase-logik med riktig Supabase-data,
5 karuseller). Inga route/tab-ändringar krävs vid återställning.

## Vad som INTE är karantänsatt

- `06-UI/screens/HomeScreen.js` — **aktiv home-version** (Hem-supabase-
  logik, 5 karuseller, riktig Supabase-data).
- `06-UI/services/supabaseClient.js` — minimal klient för home-tab.
- `06-UI/components/EventPulseSenaste.js` + `EventPulseSenasteCard.js` —
  Senaste-rail helpers (kopierade från sandbox).
- `06-UI/AppShell.js` — pekar på nya HomeScreen med `onCardPress`.
- `06-UI/components/BottomTabBar.js` — Hem-fliken orörd.
- `06-UI/utils/chipSimulation.test.ts` — refererar HEM-QUARANTINE/helpers.
- `06-UI-sandbox/` — aktiv utvecklingsyta. Hem-supabase och HemStar-mock
  byggs där, inte här.

## Aktiv utveckling

| Yta | Vad | Status |
|---|---|---|
| `06-UI/screens/HomeScreen.js` | Home-tab med Hem-supabase-logik (5 karuseller, riktig Supabase-data) | Aktiv (2026-09-25) |
| `06-UI-sandbox/components/HemSupabase.js` | Sandbox-spegel av home-versionen | Committad (b97e39b) |
| `06-UI-sandbox/components/HemStar.js` | Mock-demo med ×3/×2/×1 minnes-funktion | Committad (06ab9ee) |
| `06-UI-sandbox/components/registry.js` | Sandbox-Hem-komponenterna listade | Committad |

## Återställning (Fas B — Hem* återvänder till 06-UI/)

```bash
# Från project root:
git mv 06-UI/HEM-QUARANTINE/screens/HomeScreen.js 06-UI/screens/HomeScreen.js
git mv 06-UI/HEM-QUARANTINE/screens/home          06-UI/screens/home

# Återställ chipSimulation-importen:
# import { nextLocalWeekdayIso } from '../HEM-QUARANTINE/screens/home/happeningNow';
#   →
# import { nextLocalWeekdayIso } from '../screens/home/happeningNow';

# Hem-supabase-versionen blir då en av två mounts — välj en:
# (a) Behåll Hem-supabase-montern, ersätt helpers i screens/home/
# (b) Ersätt Hem-supabase-montern med original HomeScreen (chips + chipsim)

rmdir 06-UI/HEM-QUARANTINE/screens
rmdir 06-UI/HEM-QUARANTINE
```

Inga andra kodändringar krävs för variant (a) — AppShell, BottomTabBar,
TABS-arrayen är orörda.
