# zoom-count-input — feature #3 (live)

Speglar `09-ScrapingSupervisor/dashboard/public/index.html` rad 61 (`#bfl-zoom-count`) — number-input som matar `count` till feature #1.

Klient-side state: inget eget run-state. Input är stateful i webbläsaren men skickas som POST-body till `/api/bfl/zoom-run`.

## Sub-features

- **HTML5 number-input** med `min="1" max="500" value="10"`.
- **Klient-validering** i `app.js:2925–2926`:
  ```js
  const count = Math.max(1, Math.min(500, parseInt(inp?.value ?? '10', 10) || 10));
  ```
  Klipper till `[1, 500]` och defaultar till `10` vid NaN/0.
- **Disabled under körning** — `setZoomButtonsDisabled(true)` sätter `inp.disabled = true`. Återställs vid success/fail.
- **Server-validering** — cap vid 500. `server.ts:2467` kör `Math.max(1, Math.min(500, parsed.count ?? 10))`. Skicka `count=9999` → svar med `count=500`, pipeline startar med 500.

## How to get to it (user POV)

1. Öppna `http://localhost:7777/`.
2. Längst upp till höger i `#bfl-zoom-wrap`-blocket: number-input `#bfl-zoom-count` (default `10`).
3. Skriv in önskat antal (1–500).
4. Tryck **🪄 Zoom-variation** → input blir disabled under körning.

## Driving it with curl

```bash
# Klient-klippning (1–500) verifieras enklast genom att läsa app.js:2925–2926.
# För server-validering, testa gränserna. Både klient OCH server klipper via
# `Math.max(1, Math.min(500, …))`:

# Nedre gräns (0 → Math.max(1, 0) = 1)
curl -s -X POST http://localhost:7777/api/bfl/zoom-run \
  -H "Content-Type: application/json" \
  -d '{"count":0}' | python3 -c 'import json,sys;d=json.load(sys.stdin);print("count:",d.get("count"))'
# → förväntat: {"ok":true, "count":1, ...}

# Övre gräns (500 → identity)
curl -s -X POST http://localhost:7777/api/bfl/zoom-run \
  -H "Content-Type: application/json" \
  -d '{"count":500}' | python3 -c 'import json,sys;d=json.load(sys.stdin);print("count:",d.get("count"))'
# → förväntat: {"ok":true, "count":500, ...}

# Utanför range (9999 → Math.min(500, 9999) = 500)
curl -s -X POST http://localhost:7777/api/bfl/zoom-run \
  -H "Content-Type: application/json" \
  -d '{"count":9999}' | python3 -c 'import json,sys;d=json.load(sys.stdin);print("count:",d.get("count"))'
# → förväntat: {"ok":true, "count":500, ...}  ← server cap till 500
```

**Förväntat (UI-klick):**

| input | POST body | Klient-clip | Server gör |
|---|---|---|---|
| tom / ogiltig | `''` | → 10 (NaN-fallback via `\|\| 10`) | kör 10 |
| `0` | `'0'` | → 10 (`parseInt('0')\|\|10` = 10) | kör 1 (server cappar till 1) |
| `-5` | `'-5'` | → 1 (`parseInt('-5')\|\|10` = -5, sedan `Math.max(1, -5)` = 1) | kör 1 |
| `500` | `'500'` | → 500 | kör 500 |
| `501` | `'501'` | → 500 | kör 500 |
| `9999` | `'9999'` | → 500 | kör 500 (server cappar) |

## Gotchas

**Båda klient och server klipper till 500.** UI klipper i `app.js:2926` (`Math.max(1, Math.min(500, ...))`), server klipper i `server.ts:2467` (`Math.max(1, Math.min(500, parsed.count ?? 10))`). Skicka `count=9999` via curl → svar med `count=500`. Konsekvens: räkna med count alltid 1–500 oavsett ingång.

**Default-värde 10 är hårdkodat i klienten** (`app.js:2926`). Om `inp.value` är tom eller NaN skickas 10. Inget "min antal"-meddelande till UI om användaren skriver 0.

**Input behåller värdet efter körning.** Användaren måste aktivt ändra inför nästa körning. Bra default-beteende men kan vara förvirrande om körningen tog lång tid.

**`min`/`max` i HTML är bara UI-validering.** Webbläsaren tillåter inte pil-öka över 500 men tangentbordstippning fungerar (server accepterar ändå).