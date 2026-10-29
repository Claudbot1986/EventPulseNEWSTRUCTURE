# adaptive-count-input — feature #2 (live)

Speglar `09-ScrapingSupervisor/dashboard/public/index.html` (`#bfl-adaptive-count`,
`#bfl-adaptive-sub`) och `app.js` (`initBflCompareButtons` → `sync()`).

Antalsfältet bredvid knappen bestämmer hur många **nya** bilder som ska
genereras. Det är samma siffra som skickas i POST-bodyn.

## Sub-features

- **`<input type="number" id="bfl-adaptive-count">`** — `min=1`, `max=800`,
  default `300`.
- **Klientklippning** — `Math.max(1, Math.min(800, parseInt(value ?? '300', 10) || 300))`.
  Ett tomt fält faller tillbaka på 300 (inte 1).
- **Undertexten speglar fältet** — `#bfl-adaptive-sub` blir
  `"<N> bilder · adaptiv fill"` vid `input`-event. Det gör att operatören ser
  vad som kommer att köras **innan** klick.
- **Fältet disable:as under körningen** (tillsammans med knappen).
- **Samma tal driver två saker** — `count` sätter både `--max-total` (tak på
  antal genererade bilder) och `--extra` (bilder utöver kvotplanen). Servern
  sätter `extra = parsed.extra ?? count`. Ett `extra` som specificeras
  explicit kan alltså avvika från `count`.

## How to get to it (user POV)

1. Öppna `http://localhost:7777/`.
2. Klicka i talfältet bredvid **🟧 MiniMax image-01**.
3. Skriv ett tal (t.ex. 3 för ett smoke-test, 300 för en full fyllning).
4. Undertexten under knappen ändras direkt: `3 bilder · adaptiv fill`.
5. Klicka knappen → POST-bodyn innehåller `"count":3`.

## Driving it with curl

> **VARNING:** `POST /api/bfl/adaptive-run` startar en **riktig** bildgenerering
> (MiniMax-kredit + flera minuter). Ett "curl-probe" av klippningen är alltså
> inte gratis. Om en körning redan pågår svarar servern 409 och inget startar.
>
> **Sidoeffektsfritt klippningsprov** (ren aritmetik, ingen HTTP):
>
> ```bash
> node -e '
> const cli = v => Math.max(1, Math.min(800, parseInt(v ?? "300", 10) || 300));
> const srv = v => Math.max(1, Math.min(800, Math.floor(Number(v) || 300)));
> for (const v of ["", "0", "-5", "9999", "3"]) console.log(JSON.stringify(v), "klient->", cli(v));
> '
> ```
>
> **Live-klippning via UI:t** (fångar POST:en innan den når servern — ingen
> generering startar):
>
> ```bash
> PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright node --input-type=module - <<'EOF'
> import { chromium } from 'playwright';
> let body = null;
> const browser = await chromium.launch({ headless: true });
> const page = await (await browser.newContext()).newPage();
> await page.route('**/api/bfl/adaptive-run', r => {
>   body = r.request().postData();
>   r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, runId: 'probe' }) });
> });
> await page.goto('http://localhost:7777/', { waitUntil: 'domcontentloaded' });
> await page.waitForSelector('#btn-bfl-compare-minimax[data-wired="1"]', { timeout: 30000 });
> for (const v of ['3', '0', '9999', '', '-5']) {
>   body = null;
>   await page.evaluate(() => {
>     for (const id of ['bfl-adaptive-count', 'btn-bfl-compare-minimax']) document.getElementById(id).disabled = false;
>   });
>   await page.locator('#bfl-adaptive-count').fill(v);
>   await page.waitForTimeout(140);
>   const sub = (await page.textContent('#bfl-adaptive-sub')).trim();
>   await page.locator('#btn-bfl-compare-minimax').click();
>   await page.waitForTimeout(220);
>   console.log(`fill(${JSON.stringify(v)}) undertext="${sub}" POST=${body}`);
> }
> await browser.close();
> EOF
> ```
>
> **Förväntat** (verifierat live 2026-10-29):
>
> | fill | undertext | POST.count |
> |---|---|---|
> | `"3"` | `3 bilder · adaptiv fill` | 3 |
> | `"0"` | `300 bilder · adaptiv fill` | 300 |
> | `"9999"` | `800 bilder · adaptiv fill` | 800 |
> | `""` | `300 bilder · adaptiv fill` | 300 |
> | `"-5"` | `1 bilder · adaptiv fill` | 1 |

**Playwright-assertion** (undertext + POST-body):

```bash
node scripts/verify_bfl_adaptive_fill.mjs --count=3 --label=count-input
```

Drivern fyller i fältet, läser `#bfl-adaptive-sub` och jämför med
`"<N> bilder · adaptiv fill"`, och fångar POST-bodyn. (Jämförelsen är en
substring-sökning, inte strikt likhet — "3 bilder · adaptiv fill" godtas även
som delsträng.)

## Gotchas

- **`parseInt(value) || 300`** — värdet `0` blir falskt och faller tillbaka på
  **300**, inte 1. Serverns egen klippning ger 1 för `{"count":0}` (fix
  2026-10-29: `count` klipps med `clampInt` som FALLBACKAR på 300 för
  oparsbara värden, så `{"count":"abc"}` → 300 i stället för NaN).
- **`fill()` fungerar oavsett om fältet har fokus.** Playwrights `fill()` på
  `input[type=number]` går via `selectText()` → `keyboard.insertText()`, som
  själv fokuserar elementet och skickar ett naturligt `input`-event.
  (En tidigare version av den här dokumentationen påstådde motsatsen —
  felaktigt, verifierat live 2026-10-29 med en event-räknare.)
- **Programmatisk `element.value = '42'` skickar INGET event.** Då står
  undertexten kvar med det gamla värdet. Det är den verkliga "stale"-fällan.
- **Fältet disable:as under körningen** — operatören kan inte ändra antalet
  mitt i en körning. Det är korrekt: antalet bestämmer `--max-total`.
  Låset släpps när pollningen ser ett terminalt status. Om status-endpointen
  svarar **404** (körningen finns inte) slutar pollningen och knappen
  låses upp igen (fix 2026-10-29 — tidigare kunde fältet bli låst permanent).
- **Undertexten uppdateras på `input`, inte `change`.**
- **Max 800.** Servern klippar `count` till `[1, 800]`. Ett större värde ger
  inte fler bilder — det ger 800.
- **Antalet driver både `--max-total` och `--extra`.** Ändrar du bara
  `extra` via API:t får du ett annat beteende än via UI:t.
