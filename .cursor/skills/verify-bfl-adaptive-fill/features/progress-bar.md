# progress-bar — feature #3 (live)

Speglar `09-ScrapingSupervisor/dashboard/public/index.html`
(`#bfl-adaptive-progress`, `#bfl-adaptive-progress-bar`, `#bfl-adaptive-progress-fill`,
`#bfl-adaptive-progress-text`) och `app.js` (`setAdaptiveProgress`).

Progress-baren är operatörens enda visuella signal om att en lång körning
(300 bilder ≈ 35 min) lever.

## Sub-features

- **`#bfl-adaptive-progress`** — `hidden` tills en körning startar.
- **`#bfl-adaptive-progress-bar`** — `role="progressbar"`,
  `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` uppdateras.
- **`#bfl-adaptive-progress-fill`** — `style.width = "<procent>%"`.
- **`#bfl-adaptive-progress-text`** — `"<generated> / <count>"`.
- **Källa** — `GET /api/bfl/adaptive-run/:id/status` → `percent` + `generated`.
  Servern räknar `percent = round(generated / count * 100)`.
- **Uppdateringsfrekvens** — `app.js` pollar var 1,5 s.

## How to get to it (user POV)

1. Starta en körning med knappen.
2. Progress-baren visas direkt under/ bredvid knappen med `0 / N`.
3. Under körningen fylls balken och texten räknar upp `7 / 300`.
4. Vid slutet står balken på 100 % och texten `300 / 300`.
5. Statusraden ovanför visar sista bedömningen: `genererar… 7/300 · ✓ WIDE/konst`.

## Driving it with curl

```bash
RUNID=$(curl -s http://localhost:7777/api/bfl/adaptive-run/latest \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"]["runId"])')

for i in $(seq 1 60); do
  curl -s "http://localhost:7777/api/bfl/adaptive-run/$RUNID/status" | python3 -c '
import json,sys
r = json.load(sys.stdin)["result"]
print(f'"'"'{r["percent"]:>3}%  {r["generated"]:>4}/{r["count"]:<4} {r["status"]:<8} {r["lastVerdict"] or ""}'"'"')'
  sleep 2
done
```

**Playwright-assertion:**

```bash
node scripts/verify_bfl_adaptive_fill.mjs --count=3 --label=progress
```

Drivern sparar `03-running.png` (mitten av körningen) och `04-done.png` (slutet)
och verifierar att `aria-valuenow` går 0 → 100 och att slutvärdet är `"100"`.

**Förväntat:**

| check | förväntat |
|---|---|
| `#bfl-adaptive-progress` `hidden` före start | true |
| `hidden` efter klick | false |
| `aria-valuenow` efter start | 0 |
| `aria-valuenow` vid slut | 100 |
| `#bfl-adaptive-progress-text` vid slut | `"<count> / <count>"` |
| Fill-bredden | motsvarar `aria-valuenow` |

## Gotchas

- **`percent` räknas mot `count` (det beställda antalet), inte mot planens
  `target`.** När kvoten är uppfylld och `--extra` används kan `target` vara
  större än `count` — baren når då 100 % medan `remaining` i `progress.json`
  fortfarande är > 0. Det är korrekt: beställningen är uppfylld.
- **Baren fylls ihop med `generated`, som räknas per bild** — inte per omgång.
  Den är därför jämn, inte stegvis.
- **`aria-valuenow` sätts som attribut** (inte bara via bredd) — det gör att
  skärmläsare kan läsa framsteget.
- **Balken har ingen etiketttext** utöver `aria-label="Genereringsframsteg"`.
- **Baren visas även vid fel** (t.ex. 409) — då står den på 0 % med en
  feltext i statusraden. Det är avsiktligt: operatören ska se att något
  hände.
