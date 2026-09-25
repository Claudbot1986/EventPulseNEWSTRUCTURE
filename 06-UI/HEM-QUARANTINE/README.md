# 06-UI/HEM-QUARANTINE

Hem-sektionen satt i karantän **2026-09-25**.

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

**Hem-tabben i BottomTabBar finns kvar** — den pekar nu på stubben i
`06-UI/screens/HomeScreen.js` som visar en karantän-banner. Inga
route/tab-ändringar krävs vid återställning.

## Vad som INTE är karantänsatt

- `06-UI/AppShell.js` — oförändrad. `mountedTabsRef.current.home` lever
  kvar och pekar på den nya stubben. `handleChipPress` /
  `handleHomeCardPress` finns kvar men anropas inte (stubben ignorerar
  props). Vid återställning plockas de i drift automatiskt.
- `06-UI/components/BottomTabBar.js` — Hem-fliken orörd.
- `06-UI/utils/chipSimulation.test.ts` — uppdaterad att importera från
  `../HEM-QUARANTINE/screens/home/happeningNow` (enda externa beroende).
- `06-UI-sandbox/` — aktiv utvecklingsyta. Hem-supabase och HemStar-mock
  byggs där, inte här.

## Aktiv utveckling

| Yta | Vad | Status |
|---|---|---|
| `06-UI-sandbox/components/HemSupabase.js` | Spegel av Hem* med riktig Supabase-data (events_public) | Committad (b97e39b) |
| `06-UI-sandbox/components/HemStar.js` | Mock-demo med ×3/×2/×1 minnes-funktion | Committad (06ab9ee) |
| `06-UI-sandbox/components/registry.js` | Båda Hem-komponenterna listade | Committad |

## Återställning

```bash
# Från project root:
git mv 06-UI/HEM-QUARANTINE/screens/HomeScreen.js 06-UI/screens/HomeScreen.js
git mv 06-UI/HEM-QUARANTINE/screens/home          06-UI/screens/home

# Återställ chipSimulation-importen:
# import { nextLocalWeekdayIso } from '../HEM-QUARANTINE/screens/home/happeningNow';
#   →
# import { nextLocalWeekdayIso } from '../screens/home/happeningNow';

# Radera stubben (nu ersatt av originalfilen):
# 06-UI/screens/HomeScreen.js är ORIGINAL — ta INTE bort!
rmdir 06-UI/HEM-QUARANTINE/screens
rmdir 06-UI/HEM-QUARANTINE
```

Inga andra kodändringar krävs — AppShell, BottomTabBar, TABS-arrayen
är orörda och HomeScreen-originalen plockas upp av AppShell direkt.
