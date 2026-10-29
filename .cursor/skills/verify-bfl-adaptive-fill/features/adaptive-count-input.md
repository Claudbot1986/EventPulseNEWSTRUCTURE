# adaptive-count-input — feature #2 (live)

Speglar `09-ScrapingSupervisor/dashboard/public/index.html` (`#bfl-adaptive-count`,
`#bfl-adaptive-sub`) och `app.js` (`initBflCompareButtons` → `sync()`).

Antalsfältet bredvid knappen bestämmer hur många **nya** bilder som ska
genereras. Det är samma siffra som skickas i POST-bodyn.

## Sub-features

- **`<input type="number" id="bfl-adaptive-count">`** — `min=1`, `max=800`,
  default `300`.
- **Klientklippning** — `Math.max(1, Math.min(800, parseInt(value) || 300))`.
  Ett tomt fält faller tillbaka på 300 (inte 1).
- **Undertexten speglar fältet** — `#bfl-adaptive-sub` blir
  `"<N> bilder · adaptiv fill"` vid `input`-event. Det gör att operatören ser
  vad som kommer att köras **innan** klick.
- **Fältet disable:as under körningen** (tillsammans med knappen).

## How to get to it (user POV)

1. Öppna `http://localhost:7777/`.
2. Klicka i talfältet bredvid **🟧 MiniMax image-01**.
3. Skriv ett tal (t.ex. 3 för ett smoke-test, 300 för en full fyllning).
4. Undertexten under knappen ändras direkt: `3 bilder · adaptiv fill`.
5. Klicka knappen → POST-bodyn innehåller `"count":3`.

## Driving it with curl

```bash
# Klippning sker i klienten — servern klippar också (1–800)
curl -s -X POST http://localhost:7777/api/bfl/adaptive-run \
  -H "Content-Type: application/json" -d '{"count":9999}' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print("count:",d.get("count"))'
# → count: 800

curl -s -X POST http://localhost:7777/api/bfl/adaptive-run \
  -H "Content-Type: application/json" -d '{"count":0}' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print("count:",d.get("count"))'
# → count: 1
```

**Playwright-assertion** (undertext + POST-body):

```bash
node scripts/verify_bfl_adaptive_fill.mjs --count=3 --label=count-input
```

Drivern fyller i fältet, läser `#bfl-adaptive-sub` och jämför med
`"<N> bilder · adaptiv fill"`, och fångar POST-bodyn.

**Förväntat:**

| check | förväntat |
|---|---|
| Undertext efter fill(3) | `3 bilder · adaptiv fill` |
| Undertext efter fill(300) | `300 bilder · adaptiv fill` |
| POST-body | `{"count":3}` |
| Serverns `count` vid `{"count":9999}` | 800 |
| Serverns `count` vid `{"count":0}` | 1 |

## Gotchas

- **`parseInt(value) || 300`** — värdet `0` blir falskt och faller tillbaka på
  **300**, inte 1. Det är en inkonsekvens i klienten: fältet kan inte stå på 0
  via tangentbord, men serverns egen klippning (`count < 1 → 1`) ger 1 för ett
  direkt-API-anrop med 0. Båda beteendena är "säkra" men skiljer sig åt.
- **Fältet disable:as under körningen** — operatören kan inte ändra antalet
  mitt i en körning. Det är korrekt: antalet bestämmer `--max-total`.
- **Undertexten uppdateras på `input`, inte `change`.** När värdet sätts
  programmatiskt (`page.locator().fill()`) skickas `input` — men bara om fältet
  inte redan har fokus. Driver-skriptet fyller därför alltid i fältet innan
  klick.
- **Max 800.** Servern klippar `count` till `[1, 800]`. Ett större värde ger
  inte fler bilder — det ger 800.
