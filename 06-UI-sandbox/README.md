# 06-UI-sandbox

Isolerad Expo-app för snabb UI-iteration. **Rör aldrig `06-UI/` härifrån.**

## Varför

`06-UI/App.js` har vuxit till ~2500 rader och drar in AppShell, providers,
services och bakgrundslogik som inte behövs när man bara vill testa en
knapp-färg eller ett kort-layout. Hela Expo Go-bundeln laddar på flera
sekunder. Sandboxen är en **tom, snabb testmiljö** där du bygger UI i
isolering och kopierar in färdiga komponenter i `06-UI/` för hand.

## Struktur

```
06-UI-sandbox/
├── App.js              ← root: 4 tabs (Hem/Utforska/Karta/Profil)
├── index.js            ← registerRootComponent
├── app.json            ← eget bundle-id, eget schema, eget namn
├── package.json        ← MINIMAL deps (ingen Supabase/maps/auth/notifications)
├── assets/
│   ├── README.md       ← hur du fyller bild-platser med AI-bilder
│   └── tile-1..5.png   ← 5 placeholder PNGs (1×1 transparent)
└── components/          ← HÄR bygger du nya UI-komponenter
```

## Arbetsflöde

```bash
cd 06-UI-sandbox
npm install
npx expo start
```

1. Bygg en komponent i `components/`, importera i `App.js`.
2. Testa i Expo Go — snabb reload, ingen stor bundle.
3. När komponenten är klar: kopiera in den i `06-UI/components/`.

Sandboxen har ingen automatisk synk till `06-UI/` — det är ett medvetet val.
Drift mellan sandbox och riktiga appen är **din** kontroll.

## Bild-platser

App.js renderar 5 `ImageSlot`-komponenter som letar efter `assets/tile-1.png`
till `tile-5.png`. Om filen saknas visas en svart placeholder med titeln.
För att fylla dem med AI-genererade bilder, se `assets/README.md`.

## Konventioner

- **Ingen Zustand / Redux / React Query** utan explicit godkännande
  (06-UI är intentionalt tunn). Använd `useState`.
- **Inga services/anrop** — sandboxen har ingen backend-koppling.
- **Sektioner är helt svarta** — så layout-buggar syns mot bakgrunden.

## UI-regler och AI-instruktioner

Innan du bygger någon UI-komponent här — läs först dessa två:

- **`.claude/eventpulse/ui/README.md`** — index för hela UI-hjärnan
  (regler, tokens, komponent-konventioner, states, motion, a11y,
  anti-AI-mönster, self-review).
- **`.claude/eventpulse/ui/UI_RULES.md`** — kärnregler och
  anti-AI-mönster.

Plus repo-level-skillen (`.claude/skills/frontend-design/SKILL.md`)
som sammanfattar arbetsflödet och pekar vidare. Allt är git-spårat,
inget ändrar produktionsbeteendet, allt är lätt att återställa.

Om du genererar UI utan att läsa dessa är chansen stor att du
introducerar ett AI-default-mönster (purple gradient, alla i kort,
godtycklig spacing) som inte passar EventPulse.